import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF, createExecutionContext } from 'cloudflare:test';
import { signState, verifyState, exchangeCode } from '../src/services/oauth.js';
import oauthRoutes from '../src/routes/oauth.js';
import type { OAuthStatePayload } from '@agentdrive/shared';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    KV: KVNamespace;
    R2: R2Bucket;
    FILE_COLLAB: DurableObjectNamespace;
    ENVIRONMENT: string;
    APP_URL: string;
    TOKEN_SIGNING_SECRET: string;
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    GITHUB_OAUTH_CLIENT_ID?: string;
    GITHUB_OAUTH_CLIENT_SECRET?: string;
  }
}

async function clearKv() {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

beforeEach(async () => {
  await clearKv();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OAuth state HMAC', () => {
  it('signs and verifies a state payload round-trip', async () => {
    const secret = env.TOKEN_SIGNING_SECRET;
    const state = await signState({ provider: 'google', nonce: 'n1', origin: 'http://localhost', redirect_after: '/signin/callback' }, secret);
    const decoded = await verifyState(state, secret);
    expect(decoded).not.toBeNull();
    expect(decoded?.provider).toBe('google');
    expect(decoded?.redirect_after).toBe('/signin/callback');
    expect(decoded?.nonce).toBe('n1');
    expect(decoded?.origin).toBe('http://localhost');
    expect(decoded?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a state token tampered with a different signing secret', async () => {
    const state = await signState({ provider: 'github', nonce: 'n1', origin: 'http://localhost' }, env.TOKEN_SIGNING_SECRET);
    const decoded = await verifyState(state, 'wrong-secret');
    expect(decoded).toBeNull();
  });

  it('rejects a malformed state token', async () => {
    const decoded = await verifyState('not-a-real-state', env.TOKEN_SIGNING_SECRET);
    expect(decoded).toBeNull();
  });

  it('rejects an expired state token', async () => {
    const past: OAuthStatePayload = {
      nonce: 'n',
      provider: 'google',
      origin: 'http://localhost',
      exp: Math.floor(Date.now() / 1000) - 10,
    };
    const encoder = new TextEncoder();
    const payloadJson = JSON.stringify(past);
    const payloadB64 = btoa(payloadJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.TOKEN_SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64)));
    let binary = '';
    for (let i = 0; i < sig.length; i++) binary += String.fromCharCode(sig[i]);
    const sigB64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const decoded = await verifyState(`${payloadB64}.${sigB64}`, env.TOKEN_SIGNING_SECRET);
    expect(decoded).toBeNull();
  });
});

describe('GET /auth/oauth/* — graceful degradation', () => {
  it('returns 503 when Google OAuth secrets are unset', async () => {
    const res = await SELF.fetch('http://localhost/auth/oauth/google');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/GOOGLE_OAUTH_CLIENT_ID/);
  });

  it('returns 503 when GitHub OAuth secrets are unset', async () => {
    const res = await SELF.fetch('http://localhost/auth/oauth/github');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/GITHUB_OAUTH_CLIENT_ID/);
  });
});

describe('GET /v1/auth/providers', () => {
  it('reports email always enabled, google/github false when secrets missing', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/providers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { google: boolean; github: boolean; email: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.email).toBe(true);
    expect(body.data.google).toBe(false);
    expect(body.data.github).toBe(false);
  });
});

describe('GET /cli-auth', () => {
  it("forwards older CLI links to the site's page, which asks before linking a CLI", async () => {
    const res = await SELF.fetch('http://localhost/cli-auth?id=cli_xyz123', { redirect: 'manual' });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://agentdrive.sh/cli-auth?id=cli_xyz123');
  });
});

describe('CLI sign-in through Google', () => {
  it('ends a Google sign-in for the CLI on the confirmation page, linking nothing by itself', async () => {
    const start = (await (await SELF.fetch('http://localhost/v1/auth/cli/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shows_user_code: true }),
    })).json()) as { data: { id: string; device_code: string } };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at' });
      return Response.json({ sub: 'g1', email: 'cli-oauth@example.com', email_verified: true });
    });
    const googleEnv = { ...env, GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' };
    const confirm = `/cli-auth?id=${start.data.id}`;
    // cli_auth_id is what CLI sign-in links used to carry; it must not complete the login either.
    const begin = await oauthRoutes.request(
      `http://localhost/google?cli_auth_id=${start.data.id}&redirect_after=${encodeURIComponent(confirm)}`,
      undefined,
      googleEnv,
      createExecutionContext(),
    );
    const state = new URL(begin.headers.get('location')!).searchParams.get('state')!;
    const res = await oauthRoutes.request(
      `http://localhost/google/callback?code=c&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: begin.headers.getSetCookie()[0].split(';')[0] } },
      googleEnv,
      createExecutionContext(),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`http://localhost:3001${confirm}`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('adrive_session='))).toBe(true);

    const poll = (await (await SELF.fetch('http://localhost/v1/auth/cli/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: start.data.id, device_code: start.data.device_code }),
    })).json()) as { data: { status: string } };
    expect(poll.data).toEqual({ status: 'pending' });
    const orgId = (await env.KV.get('idx:email_org:cli-oauth@example.com'))!;
    expect((await env.KV.list({ prefix: `idx:org_keys:${orgId}:` })).keys).toHaveLength(0);
  });
});


describe('Google sign-in', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubGoogle(profile: Record<string, unknown>) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at' });
      return Response.json(profile);
    });
  }
  const cfg = { client_id: 'id', client_secret: 'secret', redirect_uri: 'http://localhost/cb' };

  // Sign-in resolves the org from the email, so an unverified one must never count.
  it('rejects a Google account whose email is not verified', async () => {
    stubGoogle({ sub: '1', email: 'victim@example.com', email_verified: false });
    expect(await exchangeCode('google', cfg, 'code')).toBeNull();
  });

  it('accepts a verified Google email', async () => {
    stubGoogle({ sub: '1', email: 'Me@Example.com', email_verified: true });
    expect(await exchangeCode('google', cfg, 'code')).toMatchObject({ email: 'me@example.com' });
  });
});

describe('OAuth sign-in is bound to the browser that started it', () => {
  const SITE = 'http://localhost:3001';
  const APP = 'http://app.localhost';
  const googleEnv = () => ({ ...env, GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' });
  const call = (url: string, cookie?: string) =>
    oauthRoutes.request(url, cookie ? { headers: { Cookie: cookie } } : undefined, googleEnv(), createExecutionContext());

  function stubGoogle() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at' });
      return Response.json({ sub: 'g-attacker', email: 'attacker@example.com', email_verified: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  async function startOnSite() {
    const res = await call(`${SITE}/google?redirect_after=%2Fsignin%2Fcallback`);
    const location = new URL(res.headers.get('location')!);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('__Host-adrive_oauth_state='))!;
    return { res, state: location.searchParams.get('state')!, cookie: cookie.split(';')[0] };
  }

  async function sessionCount() {
    return (await env.KV.list({ prefix: 'session:' })).keys.length;
  }

  it('start sets a host-only state cookie whose value is the nonce in the signed state', async () => {
    const { res, state, cookie } = await startOnSite();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^https:\/\/accounts\.google\.com\//);
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('__Host-adrive_oauth_state='))!;
    expect(setCookie).toMatch(/; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(setCookie).not.toMatch(/Domain=/i);
    const decoded = await verifyState(state, env.TOKEN_SIGNING_SECRET);
    expect(cookie).toBe(`__Host-adrive_oauth_state=${decoded!.nonce}`);
    expect(decoded!.origin).toBe(SITE);
  });

  it('sends a sign-in started on another host to the site first, setting nothing', async () => {
    const res = await call(`${APP}/google?redirect_after=%2Fsignin%2Fcallback`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${SITE}/google?redirect_after=%2Fsignin%2Fcallback`);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('refuses a callback from a browser without the state cookie', async () => {
    const fetchMock = stubGoogle();
    const { state } = await startOnSite();
    const res = await call(`${SITE}/google/callback?code=attacker-code&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('adrive_session='))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sessionCount()).toBe(0);
  });

  it("refuses a callback whose state belongs to another browser's sign-in", async () => {
    const fetchMock = stubGoogle();
    const attacker = await startOnSite();
    const victim = await startOnSite();
    const res = await call(`${SITE}/google/callback?code=attacker-code&state=${encodeURIComponent(attacker.state)}`, victim.cookie);
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('adrive_session='))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sessionCount()).toBe(0);
  });

  it('signs the starting browser in with a cookie, never putting the session id in a URL', async () => {
    stubGoogle();
    const { state, cookie } = await startOnSite();

    // The provider calls back to APP_URL; that hop forwards to the host holding the state cookie.
    const relay = await call(`${APP}/google/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(relay.status).toBe(302);
    expect(relay.headers.get('location')).toBe(`${SITE}/google/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(relay.headers.getSetCookie()).toEqual([]);
    expect(await sessionCount()).toBe(0);

    const res = await call(relay.headers.get('location')!, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${SITE}/signin/callback`);

    const cookies = res.headers.getSetCookie();
    expect(cookies).toContain('__Host-adrive_oauth_state=; Max-Age=0; Path=/; Secure');
    const session = cookies.find((c) => c.startsWith('adrive_session='))!;
    expect(session).toMatch(/; Max-Age=2592000; Path=\/; Secure; SameSite=Lax$/);
    expect(session).not.toMatch(/HttpOnly|Domain=/i);
    const value = JSON.parse(decodeURIComponent(session.split(';')[0].slice('adrive_session='.length))) as {
      api_key: string;
      email: string;
      org_id: string;
    };
    expect(value.email).toBe('attacker@example.com');
    expect(value.org_id).toMatch(/^org_/);
    expect(await env.KV.get(`session:${value.api_key}`)).toBeTruthy();
    expect(relay.headers.get('location')).not.toContain(value.api_key);
    expect(res.headers.get('location')).not.toContain(value.api_key);
  });

  it('refuses the same callback replayed by the browser that completed it', async () => {
    stubGoogle();
    const { state, cookie } = await startOnSite();
    const url = `${SITE}/google/callback?code=c&state=${encodeURIComponent(state)}`;
    const first = await call(url, cookie);
    expect(first.status).toBe(302);
    // The first response expired the state cookie, so the browser no longer sends it.
    expect(first.headers.getSetCookie()).toContain('__Host-adrive_oauth_state=; Max-Age=0; Path=/; Secure');

    const replay = await call(url);
    expect(replay.status).toBe(400);
    expect(replay.headers.getSetCookie().some((c) => c.startsWith('adrive_session='))).toBe(false);
    expect(await sessionCount()).toBe(1);
  });
});
