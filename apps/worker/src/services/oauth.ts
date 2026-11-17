import type { OAuthProvider, OAuthStatePayload } from '@agentdrive/shared';
import type { Env } from '../env.js';

export const STATE_TTL_SECONDS = 600;

function base64UrlEncode(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signState(payload: Omit<OAuthStatePayload, 'exp'>, secret: string): Promise<string> {
  const full: OAuthStatePayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };
  const encoder = new TextEncoder();
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(full)));
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  return `${payloadB64}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifyState(state: string, secret: string): Promise<OAuthStatePayload | null> {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const key = await getSigningKey(secret);
  const encoder = new TextEncoder();
  const sig = base64UrlDecode(sigB64);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sig as ArrayBufferView<ArrayBuffer>,
    encoder.encode(payloadB64),
  );
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as OAuthStatePayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface ProviderProfile {
  sub: string;
  email: string;
  name?: string;
}

export interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

export function getProviderConfig(env: Env, provider: OAuthProvider): OAuthClientConfig | null {
  const base = env.APP_URL.replace(/\/$/, '');
  if (provider === 'google') {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
    return {
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: `${base}/auth/oauth/google/callback`,
    };
  }
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) return null;
  return {
    client_id: env.GITHUB_OAUTH_CLIENT_ID,
    client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
    redirect_uri: `${base}/auth/oauth/github/callback`,
  };
}

export function buildAuthorizeUrl(provider: OAuthProvider, cfg: OAuthClientConfig, state: string): string {
  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: cfg.client_id,
      redirect_uri: cfg.redirect_uri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    redirect_uri: cfg.redirect_uri,
    scope: 'read:user user:email',
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  id_token?: string;
  token_type: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
}

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
}

interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export async function exchangeCode(
  provider: OAuthProvider,
  cfg: OAuthClientConfig,
  code: string,
): Promise<ProviderProfile | null> {
  if (provider === 'google') {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        redirect_uri: cfg.redirect_uri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return null;
    const tokens = (await tokenRes.json()) as GoogleTokenResponse;

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) return null;
    const profile = (await profileRes.json()) as GoogleUserInfo;
    if (!profile.email || profile.email_verified !== true) return null;
    return { sub: profile.sub, email: profile.email.toLowerCase(), name: profile.name };
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      redirect_uri: cfg.redirect_uri,
    }),
  });
  if (!tokenRes.ok) return null;
  const tokens = (await tokenRes.json()) as GitHubTokenResponse;
  if (!tokens.access_token) return null;

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'User-Agent': 'agentdrive-worker',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as GitHubUser;

  let email = user.email?.toLowerCase();
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'User-Agent': 'agentdrive-worker',
        Accept: 'application/vnd.github+json',
      },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as GitHubEmail[];
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (primary) email = primary.email.toLowerCase();
    }
  }
  if (!email) return null;
  return { sub: String(user.id), email, name: user.name ?? user.login };
}
