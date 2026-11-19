import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/env';
import { PLAN_QUOTAS, hashApiKey } from '@agentdrive/shared';
import { StorageService } from '../src/services/storage';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    OAUTH_KV: KVNamespace;
  }
}

// The issuer is SITE_URL (http://localhost:3001) and resource A is MCP_URL (http://localhost/mcp),
// so the two hosts route apart exactly as agentdrive.sh and mcp.agentdrive.sh do.
const SITE = 'http://localhost:3001';
const MCP = 'http://localhost/mcp';
const REDIRECT = 'http://127.0.0.1:9999/cb';

async function clearKv(kv: KVNamespace) {
  let cursor: string | undefined;
  do {
    const list = await kv.list({ cursor });
    await Promise.all(list.keys.map((k) => kv.delete(k.name)));
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
}

beforeEach(async () => {
  await clearKv(env.KV);
  await clearKv(env.OAUTH_KV);
});

afterEach(() => {
  vi.useRealTimers();
});

// Past KEY_PROPAGATION_GRACE_MS: a missing key now reads as revoked, not propagating.
function pastKeyGrace() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 6 * 60 * 1000);
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function registerClient(extra: Record<string, unknown> = {}): Promise<{ client_id: string }> {
  const res = await SELF.fetch(`${SITE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: '<script>x</script>', token_endpoint_auth_method: 'none', ...extra }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function signIn(email = 'person@example.com') {
  const s = new StorageService(env.KV, env.R2);
  const orgId = await s.getOrCreateOrgForEmail(email, env);
  const sessionId = `sess_${crypto.randomUUID()}`;
  await s.createSession(sessionId, email, orgId);
  return { orgId, sessionId, cookie: `adrive_session=${encodeURIComponent(JSON.stringify({ api_key: sessionId, email, org_id: orgId }))}` };
}

function authorizeUrl(clientId: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 'st-1', scope: 'mcp', resource: MCP, ...params });
  return `${SITE}/auth/authorize?${qs}`;
}

async function openConsent(clientId: string, challenge: string, cookie: string, resource = MCP) {
  const res = await SELF.fetch(authorizeUrl(clientId, { code_challenge: challenge, code_challenge_method: 'S256', resource }), {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  const html = await res.text();
  return {
    res,
    html,
    // Test emails need no HTML unescaping.
    form: {
      handle: /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? '',
      account: /name="account" value="([^"]+)"/.exec(html)?.[1] ?? '',
    },
    binding: (res.headers.get('Set-Cookie') ?? '').split(';')[0],
  };
}

function decide(decision: string, form: { handle: string; account: string }, cookies: string[]) {
  return SELF.fetch(`${SITE}/auth/authorize`, {
    method: 'POST',
    headers: { Cookie: cookies.join('; '), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, decision }),
    redirect: 'manual',
  });
}

async function token(body: Record<string, string>) {
  const res = await SELF.fetch(`${SITE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  return { status: res.status, body: (await res.json()) as { access_token?: string; refresh_token?: string; scope?: string; error?: string } };
}

async function approve(clientId: string, cookie: string, resource = MCP) {
  const { verifier, challenge } = await pkce();
  const consent = await openConsent(clientId, challenge, cookie, resource);
  expect(consent.res.status).toBe(200);
  const approved = await decide('approve', consent.form, [cookie, consent.binding]);
  expect(approved.status).toBe(302);
  return { verifier, code: new URL(approved.headers.get('Location')!).searchParams.get('code')! };
}

function redeem(clientId: string, { code, verifier }: { code: string; verifier: string }, resource = MCP) {
  return token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource });
}

// Consent, approve and redeem the code: the whole browser + client round trip.
async function connect(clientId: string, cookie: string, resource = MCP) {
  const { body } = await redeem(clientId, await approve(clientId, cookie, resource), resource);
  return body as { access_token: string; refresh_token: string; scope: string };
}

function toolsList(url: string, bearer?: string) {
  return SELF.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer && { Authorization: `Bearer ${bearer}` }) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

async function oauthKeys(orgId: string) {
  const ids = (await env.KV.list({ prefix: `idx:org_keys:${orgId}:` })).keys.map((k) => k.name.split(':').pop()!);
  const metas = await Promise.all(ids.map((id) => new StorageService(env.KV, env.R2).getApiKey(orgId, id)));
  return metas.filter((m) => m?.oauth_client_id);
}

// What a location the new key has not reached yet reads.
async function hideKey(orgId: string) {
  const [key] = await oauthKeys(orgId);
  await env.KV.delete(`api_key:${await env.KV.get(`idx:org_keys:${orgId}:${key!.key_id}`)}`);
}

// Past ORPHAN_SWEEP_GRACE_MS, so the consent sweep may take these keys.
async function backdateKeys(orgId: string) {
  for (const { name } of (await env.KV.list({ prefix: `idx:org_keys:${orgId}:` })).keys) {
    const metaKey = `api_key:${await env.KV.get(name)}`;
    const meta = (await env.KV.get<Record<string, unknown>>(metaKey, 'json'))!;
    await env.KV.put(metaKey, JSON.stringify({ ...meta, created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() }));
  }
}

const grantCount = async () => (await env.OAUTH_KV.list({ prefix: 'grant:' })).keys.length;
const agentCount = async (orgId: string) => ((await env.KV.get<{ agent_count: number }>(`usage:${orgId}`, 'json'))?.agent_count ?? 0);
const fillAgentSlots = async (orgId: string) => {
  const usage = (await env.KV.get<Record<string, number>>(`usage:${orgId}`, 'json')) ?? {};
  await env.KV.put(`usage:${orgId}`, JSON.stringify({ ...usage, agent_count: PLAN_QUOTAS.trial.max_agents }));
};

describe('discovery', () => {
  it('serves the ChatGPT domain proof as plaintext at the MCP origin only', async () => {
    const path = '/.well-known/openai-apps-challenge';
    const response = await SELF.fetch(new URL(path, MCP), { redirect: 'manual' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(await response.text()).toBe('test-public-domain-proof');
    expect((await SELF.fetch(new URL(path, SITE), { redirect: 'manual' })).status).toBe(404);
  });

  it('serves authorization server metadata on the issuer', async () => {
    const res = await SELF.fetch(`${SITE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.issuer).toBe(SITE);
    expect(meta.authorization_endpoint).toBe(`${SITE}/auth/authorize`);
    expect(meta.token_endpoint).toBe(`${SITE}/auth/token`);
    expect(meta.registration_endpoint).toBe(`${SITE}/auth/register`);
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.scopes_supported).toContain('mcp');
    expect(meta.client_id_metadata_document_supported).toBe(true);
  });

  it('serves each resource its own protected resource metadata, and only on its own host', async () => {
    const a = (await (await SELF.fetch('http://localhost/.well-known/oauth-protected-resource/mcp')).json()) as Record<string, unknown>;
    expect(a).toMatchObject({ resource: MCP, authorization_servers: [SITE], scopes_supported: ['mcp'] });
    const b = (await (await SELF.fetch(`${SITE}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
    expect(b).toMatchObject({ resource: SITE, authorization_servers: [SITE] });

    expect((await SELF.fetch('http://localhost/.well-known/oauth-protected-resource', { redirect: 'manual' })).status).toBe(404);
    expect((await SELF.fetch(`${SITE}/.well-known/oauth-protected-resource/mcp`, { redirect: 'manual' })).status).toBe(404);
  });

  it('serves no authorization server metadata on the MCP host and no OpenID configuration', async () => {
    for (const url of ['http://localhost/.well-known/oauth-authorization-server', `${SITE}/.well-known/openid-configuration`]) {
      const res = await SELF.fetch(url, { redirect: 'manual' });
      expect(res.status).not.toBe(200);
    }
  });
});

describe('/mcp authentication', () => {
  it('challenges an unauthenticated request with the resource metadata and scope', async () => {
    const res = await toolsList(MCP);
    expect(res.status).toBe(401);
    const challenge = res.headers.get('WWW-Authenticate')!;
    expect(challenge).toContain('resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"');
    expect(challenge).toContain('scope="mcp"');
  });

  it('lets a browser client read the challenge', async () => {
    const res = await SELF.fetch(MCP, { method: 'POST', headers: { Origin: 'https://claude.ai', 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://claude.ai');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('WWW-Authenticate');
  });

  it('rejects an unknown API key', async () => {
    expect((await toolsList(MCP, 'agentdrive_live_fake')).status).toBe(401);
  });
});

describe('authorization code flow', () => {
  it('escapes the client name, cannot be framed, sets the binding cookie, and never sends form-action', async () => {
    const { client_id } = await registerClient();
    const { cookie } = await signIn();
    const { challenge } = await pkce();
    const { res, html } = await openConsent(client_id, challenge, cookie);
    expect(res.status).toBe(200);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&#60;script&#62;x&#60;/script&#62;');
    expect(html).toContain('Signed in as person@example.com');
    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('form-action');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-oauth-consent-/);
  });

  it('issues a code, then tokens that reach /mcp only on the resource they were issued for', async () => {
    const { client_id } = await registerClient();
    const { cookie } = await signIn();
    const { verifier, challenge } = await pkce();
    const consent = await openConsent(client_id, challenge, cookie);
    const approved = await decide('approve', consent.form, [cookie, consent.binding]);
    expect(approved.status).toBe(302);
    const location = new URL(approved.headers.get('Location')!);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('st-1');
    expect(location.searchParams.get('iss')).toBe(SITE);

    const { status, body } = await token({
      grant_type: 'authorization_code',
      code: location.searchParams.get('code')!,
      redirect_uri: REDIRECT,
      client_id,
      code_verifier: verifier,
      resource: MCP,
    });
    expect(status).toBe(200);
    // A refresh token comes without asking for offline_access.
    expect(body).toMatchObject({ scope: 'mcp' });
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();

    const list = await toolsList(MCP, body.access_token);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(22);
    expect((await toolsList(`${SITE}/mcp`, body.access_token)).status).toBe(401);
  });

  it('keeps a token for the site resource off the MCP resource', async () => {
    const { client_id } = await registerClient();
    const { cookie } = await signIn();
    const { access_token } = await connect(client_id, cookie, SITE);
    expect((await toolsList(`${SITE}/mcp`, access_token)).status).toBe(200);
    expect((await toolsList(MCP, access_token)).status).toBe(401);
  });

  it('rotates the refresh token', async () => {
    const { client_id } = await registerClient();
    const { cookie } = await signIn();
    const first = await connect(client_id, cookie);
    const { status, body } = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id });
    expect(status).toBe(200);
    expect(body.refresh_token).toBeTruthy();
    expect(body.refresh_token).not.toBe(first.refresh_token);
    expect((await toolsList(MCP, body.access_token)).status).toBe(200);
  });

  it('refreshes as usual past the propagation grace while the key exists', async () => {
    const { client_id } = await registerClient();
    const { cookie } = await signIn();
    const first = await connect(client_id, cookie);
    pastKeyGrace();
    const { status, body } = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id });
    expect(status).toBe(200);
    expect((await toolsList(MCP, body.access_token)).status).toBe(200);
  });

  it('accepts a just-minted key that has not reached the location the client calls from', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const approved = await approve(client_id, cookie);
    await hideKey(orgId);
    const { status, body } = await redeem(client_id, approved);
    expect(status).toBe(200);
    expect((await toolsList(MCP, body.access_token!)).status).toBe(200);
    const refreshed = await token({ grant_type: 'refresh_token', refresh_token: body.refresh_token!, client_id });
    expect(refreshed.status).toBe(200);
  });

  it('redeems a code without checking its key, which only refresh and /mcp do', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const approved = await approve(client_id, cookie);
    await hideKey(orgId);
    pastKeyGrace();
    const { status, body } = await redeem(client_id, approved);
    expect(status).toBe(200);
    expect((await toolsList(MCP, body.access_token!)).status).toBe(401);
  });

  it('stores the key only in the encrypted grant props', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    await connect(client_id, cookie);
    const [key] = await oauthKeys(orgId);
    expect(key?.name).toBe('<script>x</script> (OAuth)');
    for (const { name } of (await env.OAUTH_KV.list()).keys) {
      expect(await env.OAUTH_KV.get(name)).not.toContain('agentdrive_live_');
    }
  });
});

describe('revocation', () => {
  it('ends the grant when its key is revoked in /v1/keys', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId, sessionId } = await signIn();
    const { access_token } = await connect(client_id, cookie);
    const [key] = await oauthKeys(orgId);
    const del = await SELF.fetch(`http://localhost/v1/keys/${key!.key_id}`, { method: 'DELETE', headers: { 'X-Session-Token': sessionId } });
    expect(del.status).toBe(200);
    pastKeyGrace();
    expect((await toolsList(MCP, access_token)).status).toBe(401);
  });

  it('past the propagation grace, a revoked key ends /mcp access and refresh, so the client connects again', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const { access_token, refresh_token } = await connect(client_id, cookie);
    const [key] = await oauthKeys(orgId);
    await new StorageService(env.KV, env.R2).revokeApiKey(orgId, key!.key_id!);
    pastKeyGrace();
    expect((await toolsList(MCP, access_token)).status).toBe(401);
    const { status, body } = await token({ grant_type: 'refresh_token', refresh_token, client_id });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_grant');
  });

  it('revokes the old key when the same client is authorized again', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const first = await connect(client_id, cookie);
    const [oldKey] = await oauthKeys(orgId);
    const oldHash = await env.KV.get(`idx:org_keys:${orgId}:${oldKey!.key_id}`);

    const second = await connect(client_id, cookie);
    expect(await env.KV.get(`api_key:${oldHash}`)).toBeNull();
    expect(await oauthKeys(orgId)).toHaveLength(1);
    pastKeyGrace();
    expect((await toolsList(MCP, first.access_token)).status).toBe(401);
    expect((await toolsList(MCP, second.access_token)).status).toBe(200);
  });
});

describe('agent cap', () => {
  it('mints nothing and grants nothing at the cap, and shows the upgrade link', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    await fillAgentSlots(orgId);
    const { challenge } = await pkce();
    const consent = await openConsent(client_id, challenge, cookie);

    const res = await decide('approve', consent.form, [cookie, consent.binding]);
    expect(res.status).toBe(402);
    expect(res.headers.get('Location')).toBeNull();
    const html = await res.text();
    expect(html).toContain('href="http://localhost:3001/billing/upgrade?plan=pro"');
    expect(html).toContain('href="http://localhost:3001/keys"');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('Content-Security-Policy')).not.toContain('form-action');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(await oauthKeys(orgId)).toHaveLength(0);
    expect(await grantCount()).toBe(0);
    expect(await agentCount(orgId)).toBe(PLAN_QUOTAS.trial.max_agents);
  });

  it('lets an org at the cap reconnect an app it already uses', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const first = await connect(client_id, cookie);
    const [oldKey] = await oauthKeys(orgId);
    const oldHash = await env.KV.get(`idx:org_keys:${orgId}:${oldKey!.key_id}`);
    await fillAgentSlots(orgId);

    const second = await connect(client_id, cookie);
    expect(second.access_token).toBeTruthy();
    expect(await agentCount(orgId)).toBe(PLAN_QUOTAS.trial.max_agents);
    expect(await env.KV.get(`api_key:${oldHash}`)).toBeNull();
    pastKeyGrace();
    expect((await toolsList(MCP, first.access_token)).status).toBe(401);
    expect((await toolsList(MCP, second.access_token)).status).toBe(200);
  });
});

describe('reconnecting', () => {
  async function overCap(orgId: string) {
    const usage = (await env.KV.get<Record<string, number>>(`usage:${orgId}`, 'json')) ?? {};
    await env.KV.put(`usage:${orgId}`, JSON.stringify({ ...usage, agent_count: PLAN_QUOTAS.trial.max_agents + 1 }));
  }

  it('keeps the working connection when an org over its cap is refused a reconnect', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const first = await connect(client_id, cookie);
    await overCap(orgId);
    const { challenge } = await pkce();
    const consent = await openConsent(client_id, challenge, cookie);

    const res = await decide('approve', consent.form, [cookie, consent.binding]);
    expect(res.status).toBe(402);
    expect(await oauthKeys(orgId)).toHaveLength(1);
    expect(await agentCount(orgId)).toBe(PLAN_QUOTAS.trial.max_agents + 1);
    expect((await toolsList(MCP, first.access_token)).status).toBe(200);
  });

  it('keeps the working connection when a reconnect cannot be completed', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const first = await connect(client_id, cookie);
    const { challenge } = await pkce();
    const consent = await openConsent(client_id, challenge, cookie);
    const client = (await env.OAUTH_KV.get<Record<string, unknown>>(`client:${client_id}`, 'json'))!;
    await env.OAUTH_KV.put(`client:${client_id}`, JSON.stringify({ ...client, redirectUris: ['http://127.0.0.1:9999/other'] }));

    await decide('approve', consent.form, [cookie, consent.binding]).catch(() => null);
    expect(await oauthKeys(orgId)).toHaveLength(1);
    expect(await agentCount(orgId)).toBe(1);
    expect((await toolsList(MCP, first.access_token)).status).toBe(200);
  });

  it('frees the slot of a key whose grant expired, so abandoned connects never fill the cap', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    for (let round = 0; round <= PLAN_QUOTAS.trial.max_agents; round++) {
      const { challenge } = await pkce();
      const consent = await openConsent(client_id, challenge, cookie);
      const res = await decide('approve', consent.form, [cookie, consent.binding]);
      expect(res.status).toBe(302);
      // KV expiry of the grant: an unredeemed code after 600s, or a refresh idle for 30 days.
      for (const { name } of (await env.OAUTH_KV.list({ prefix: 'grant:' })).keys) await env.OAUTH_KV.delete(name);
      await backdateKeys(orgId);
      expect(await agentCount(orgId)).toBe(1);
    }
    expect(await oauthKeys(orgId)).toHaveLength(1);
  });

  it('spares a key no grant holds yet until it is past the sweep grace', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    await approve(client_id, cookie);
    // Its grant not listed yet (or an overlapping consent's): to the sweep it looks orphaned.
    for (const { name } of (await env.OAUTH_KV.list({ prefix: 'grant:' })).keys) await env.OAUTH_KV.delete(name);
    const [young] = await oauthKeys(orgId);

    await approve(client_id, cookie);
    expect((await oauthKeys(orgId)).map((k) => k!.key_id)).toContain(young!.key_id);
    expect(await agentCount(orgId)).toBe(2);

    for (const { name } of (await env.OAUTH_KV.list({ prefix: 'grant:' })).keys) await env.OAUTH_KV.delete(name);
    await backdateKeys(orgId);
    await approve(client_id, cookie);
    expect((await oauthKeys(orgId)).map((k) => k!.key_id)).not.toContain(young!.key_id);
    expect(await agentCount(orgId)).toBe(1);
  });

  it('never sweeps a key that was not minted for an OAuth client', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId, sessionId } = await signIn();
    const manual = await SELF.fetch('http://localhost/v1/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionId },
      body: JSON.stringify({ name: 'x (OAuth)' }),
    });
    expect(manual.status).toBe(201);
    const { key_id } = ((await manual.json()) as { data: { key_id: string } }).data;
    await backdateKeys(orgId);

    await connect(client_id, cookie);
    expect(await new StorageService(env.KV, env.R2).getApiKey(orgId, key_id)).not.toBeNull();
  });
});

describe('authorize request handling', () => {
  it('sends a signed-out person to login and back, clearing a stale session cookie', async () => {
    const { client_id } = await registerClient();
    const { challenge } = await pkce();
    const url = authorizeUrl(client_id, { code_challenge: challenge, code_challenge_method: 'S256' });

    const res = await SELF.fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!, SITE);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe(url.slice(SITE.length));
    expect(res.headers.get('Set-Cookie')).toBeNull();

    const stale = `adrive_session=${encodeURIComponent(JSON.stringify({ api_key: 'sess_gone' }))}`;
    const again = await SELF.fetch(url, { headers: { Cookie: stale }, redirect: 'manual' });
    expect(again.status).toBe(302);
    expect(again.headers.get('Set-Cookie')).toMatch(/^adrive_session=; Path=\/; Max-Age=0/);
  });

  it('redirects a denial back to the client with access_denied and its state', async () => {
    const { client_id } = await registerClient();
    const { cookie } = await signIn();
    const { challenge } = await pkce();
    const consent = await openConsent(client_id, challenge, cookie);
    const res = await decide('deny', consent.form, [cookie, consent.binding]);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('st-1');
    expect(await grantCount()).toBe(0);
  });

  it('requires PKCE of a confidential client too', async () => {
    const { client_id } = await registerClient({ token_endpoint_auth_method: 'client_secret_basic' });
    const res = await SELF.fetch(authorizeUrl(client_id, {}), { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('error')).toBe('invalid_request');
  });

  it('renders an unregistered redirect URI locally instead of redirecting to it', async () => {
    const { client_id } = await registerClient();
    const { challenge } = await pkce();
    const res = await SELF.fetch(authorizeUrl(client_id, { code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: 'https://evil.example/cb' }), { redirect: 'manual' });
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('gives the agent slot back when the grant cannot be completed', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const { challenge } = await pkce();
    const consent = await openConsent(client_id, challenge, cookie);
    // The client drops its redirect URI between the consent page and the approval.
    const client = (await env.OAUTH_KV.get<Record<string, unknown>>(`client:${client_id}`, 'json'))!;
    await env.OAUTH_KV.put(`client:${client_id}`, JSON.stringify({ ...client, redirectUris: ['http://127.0.0.1:9999/other'] }));

    const res = await decide('approve', consent.form, [cookie, consent.binding]).catch(() => null);
    expect(res?.headers.get('Location') ?? null).toBeNull();
    expect(await grantCount()).toBe(0);
    expect(await oauthKeys(orgId)).toHaveLength(0);
    expect(await agentCount(orgId)).toBe(0);
  });

  it('grants nothing when the session changes to another account after the page opened', async () => {
    const { client_id } = await registerClient();
    const a = await signIn('a@example.com');
    const b = await signIn('b@example.com');
    const { challenge } = await pkce();
    const consent = await openConsent(client_id, challenge, a.cookie);
    expect(consent.form.account).toBe('a@example.com');

    const res = await decide('approve', consent.form, [b.cookie, consent.binding]);
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
    expect(await grantCount()).toBe(0);
    expect(await oauthKeys(a.orgId)).toHaveLength(0);
    expect(await oauthKeys(b.orgId)).toHaveLength(0);
  });

  it('grants nothing to an approval posted without the consent cookie', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const { challenge } = await pkce();
    const consent = await openConsent(client_id, challenge, cookie);
    const res = await decide('approve', consent.form, [cookie]);
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
    expect(await grantCount()).toBe(0);
    expect(await oauthKeys(orgId)).toHaveLength(0);
  });

  it('grants nothing to an approval posted without a session', async () => {
    const { client_id } = await registerClient();
    const { cookie, orgId } = await signIn();
    const { challenge } = await pkce();
    const consent = await openConsent(client_id, challenge, cookie);
    const res = await decide('approve', consent.form, [consent.binding]);
    expect(res.status).toBe(401);
    expect(await grantCount()).toBe(0);
    expect(await oauthKeys(orgId)).toHaveLength(0);
  });
});

describe('raw API keys at /mcp', () => {
  it('still work, and stop working once revoked', async () => {
    const reg = (await (await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'RawBot' }),
    })).json()) as { data: { api_key: string } };
    expect((await toolsList(MCP, reg.data.api_key)).status).toBe(200);
    await env.KV.delete(`api_key:${await hashApiKey(reg.data.api_key)}`);
    expect((await toolsList(MCP, reg.data.api_key)).status).toBe(401);
  });
});

describe('self-hosted consent', () => {
  // A session with no org would need one created at consent; a self-hosted instance refuses that.
  async function orglessSession(email: string) {
    const sessionId = `sess_${crypto.randomUUID()}`;
    await new StorageService(env.KV, env.R2).createSession(sessionId, email);
    return `adrive_session=${encodeURIComponent(JSON.stringify({ api_key: sessionId, email }))}`;
  }
  async function decideAs(mode: Record<string, string>, form: { handle: string; account: string }, cookies: string[]) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`${SITE}/auth/authorize`, {
      method: 'POST',
      headers: { Cookie: cookies.join('; '), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...form, decision: 'approve' }),
      redirect: 'manual',
    }), { ...(env as unknown as Env), ...mode }, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }
  const counts = async () => ({
    orgs: (await env.KV.list({ prefix: 'org:' })).keys.length,
    grants: (await env.OAUTH_KV.list({ prefix: 'grant:' })).keys.length,
  });

  it('refuses with the error page before any grant exists', async () => {
    const { client_id } = await registerClient();
    const cookie = await orglessSession('stranger@example.com');
    const consent = await openConsent(client_id, (await pkce()).challenge, cookie);
    const res = await decideAs({ SELF_HOSTED: 'true' }, consent.form, [cookie, consent.binding]);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('Registration is closed');
    expect(await counts()).toEqual({ orgs: 0, grants: 0 });
  });

  it('still creates the org and grant when not self-hosted', async () => {
    const { client_id } = await registerClient();
    const cookie = await orglessSession('person@example.com');
    const consent = await openConsent(client_id, (await pkce()).challenge, cookie);
    expect((await decideAs({}, consent.form, [cookie, consent.binding])).status).toBe(302);
    expect(await counts()).toEqual({ orgs: 1, grants: 1 });
  });
});
