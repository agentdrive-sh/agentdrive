import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { generateId } from '@agentdrive/shared';
import type { OAuthProvider } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import {
  STATE_TTL_SECONDS,
  signState,
  verifyState,
  getProviderConfig,
  buildAuthorizeUrl,
  exchangeCode,
} from '../services/oauth.js';
import { StorageService } from '../services/storage.js';

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();

const STATE_COOKIE = 'adrive_oauth_state';
// Name, encoding and lifetime must match what apps/web/lib/session.ts reads and writes.
const SESSION_COOKIE = 'adrive_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

function sameNonce(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

function notConfigured(provider: OAuthProvider) {
  const upper = provider.toUpperCase();
  return {
    success: false as const,
    error: `OAuth provider not configured. Set ${upper}_OAUTH_CLIENT_ID + ${upper}_OAUTH_CLIENT_SECRET via wrangler secret put.`,
  };
}

async function handleAuthorize(c: Context<AppType>, provider: OAuthProvider) {
  const cfg = getProviderConfig(c.env, provider);
  if (!cfg) return c.json(notConfigured(provider), 503);
  const redirectAfter = c.req.query('redirect_after') ?? undefined;
  const here = new URL(c.req.url);
  const site = new URL(c.env.SITE_URL);
  // Cookies are scoped by host name, not port. Every sign-in ends by setting the site's
  // session cookie, so it starts on the site's host to put its state cookie on the same one.
  if (here.hostname !== site.hostname) {
    return c.redirect(`${site.origin}${here.pathname}${here.search}`, 302);
  }
  const nonce = crypto.randomUUID();
  const state = await signState(
    { provider, nonce, origin: here.origin, redirect_after: redirectAfter },
    c.env.TOKEN_SIGNING_SECRET,
  );
  setCookie(c, STATE_COOKIE, nonce, { prefix: 'host', httpOnly: true, sameSite: 'Lax', maxAge: STATE_TTL_SECONDS });
  return c.redirect(buildAuthorizeUrl(provider, cfg, state), 302);
}

async function handleCallback(c: Context<AppType>, provider: OAuthProvider) {
  const cfg = getProviderConfig(c.env, provider);
  if (!cfg) return c.json(notConfigured(provider), 503);

  const code = c.req.query('code');
  const stateStr = c.req.query('state');
  const errorParam = c.req.query('error');
  if (errorParam) return c.json({ success: false, error: `OAuth error: ${errorParam}` }, 400);
  if (!code || !stateStr) return c.json({ success: false, error: 'Missing code or state' }, 400);

  const state = await verifyState(stateStr, c.env.TOKEN_SIGNING_SECRET);
  if (!state?.origin || state.provider !== provider) {
    return c.json({ success: false, error: 'Invalid or expired state' }, 400);
  }

  // Providers only call back to APP_URL; finish on the host the sign-in started on, which holds its state cookie.
  const here = new URL(c.req.url);
  if (here.hostname !== new URL(state.origin).hostname) {
    return c.redirect(`${state.origin}${here.pathname}${here.search}`, 302);
  }

  // A signed state alone proves nothing about the browser: anyone can hand theirs to someone else.
  const nonce = deleteCookie(c, STATE_COOKIE, { prefix: 'host' });
  if (!nonce || !sameNonce(nonce, state.nonce)) {
    return c.json({ success: false, error: 'This sign-in was not started in this browser. Please sign in again.' }, 400);
  }

  const profile = await exchangeCode(provider, cfg, code);
  if (!profile) return c.json({ success: false, error: 'Failed to exchange code with provider' }, 400);

  const storage = new StorageService(c.env.KV, c.env.R2);

  // The email index is the one source of the sign-in org for every sign-in
  // method, so accepting an invite or being removed applies here too.
  const orgId = await storage.getOrCreateOrgForEmail(profile.email, c.env, profile.name);
  if (!(await storage.getUserByProvider(provider, profile.sub))) {
    await storage.linkProvider(orgId, provider, profile.sub, profile.email);
  }

  const sessionId = generateId('sess');
  await storage.createSession(sessionId, profile.email, orgId);

  const base = c.env.SITE_URL.replace(/\/$/, '');

  // Not HttpOnly: the site reads it in the browser and clears it on sign-out.
  setCookie(c, SESSION_COOKIE, JSON.stringify({ api_key: sessionId, email: profile.email, org_id: orgId }), {
    path: '/',
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_MAX_AGE,
  });
  const target = state.redirect_after || '/';
  return c.redirect(`${base}${target.startsWith('/') ? target : `/${target}`}`, 302);
}

app.get('/google', (c) => handleAuthorize(c, 'google'));
app.get('/google/callback', (c) => handleCallback(c, 'google'));
app.get('/github', (c) => handleAuthorize(c, 'github'));
app.get('/github/callback', (c) => handleCallback(c, 'github'));

export default app;
