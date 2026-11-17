import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { hashApiKey } from '@agentdrive/shared';
import worker from '../src/index';
import type { Env } from '../src/env';

async function clearKv() {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

beforeEach(clearKv);

async function call(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`http://localhost${path}`, init), { ...(env as unknown as Env), ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return call(`/v1/auth/cli${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

interface Start { id: string; auth_url: string; user_code: string; device_code: string; expires_in: number }
type Poll = { status: string; api_key?: string; org_id?: string; email?: string; error?: string; upgrade_url?: string };

async function start(): Promise<Start> {
  const res = await post('/start', { shows_user_code: true });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: Start }).data;
}

async function poll(s: Start, deviceCode = s.device_code): Promise<Poll> {
  const res = await post('/poll', { id: s.id, device_code: deviceCode });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Poll }).data;
}

function complete(s: Start, sessionId: string, userCode?: string): Promise<Response> {
  return post('/complete', { id: s.id, user_code: userCode }, { 'X-Session-Token': sessionId });
}

async function session(email: string, orgId?: string): Promise<string> {
  const sessionId = `sess_${email}`;
  await env.KV.put(`session:${sessionId}`, JSON.stringify({
    session_id: sessionId,
    email,
    org_id: orgId,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    last_active_at: new Date().toISOString(),
  }));
  return sessionId;
}

async function registerOrg(): Promise<string> {
  const res = await call('/v1/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_name: 'CliBot' }) });
  return ((await res.json()) as { data: { org_id: string } }).data.org_id;
}

async function keysIn(orgId: string): Promise<number> {
  return (await env.KV.list({ prefix: `idx:org_keys:${orgId}:` })).keys.length;
}

describe('CLI sign-in with a user code', () => {
  it('authorizes with the code from the terminal and lets only the poller with the device code collect the key', async () => {
    const s = await start();
    expect(s.id).toMatch(/^cli_/);
    expect(s.user_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(s.expires_in).toBeLessThanOrEqual(600);
    // Whoever is sent the link learns neither the code nor the poll secret from it.
    expect(s.auth_url).toBe(`http://localhost:3001/cli-auth?id=${s.id}`);
    const stored = (await env.KV.get(`cli_pending:${s.id}`))!;
    for (const secret of [s.user_code, s.user_code.replace('-', ''), s.device_code]) {
      expect(s.auth_url).not.toContain(secret);
      expect(stored).not.toContain(secret);
    }
    expect(await poll(s)).toEqual({ status: 'pending' });

    const orgId = await registerOrg();
    await env.KV.put(`org_member:${orgId}:cli@example.com`, JSON.stringify({ org_id: orgId, email: 'cli@example.com', role: 'member' }));
    const sessionId = await session('cli@example.com', orgId);
    const res = await complete(s, sessionId, ` ${s.user_code.replace('-', '').toLowerCase()} `);
    expect(res.status).toBe(200);
    expect(await env.KV.get(`cli_pending:${s.id}`)).not.toContain(sessionId);

    const done = await poll(s);
    expect(done).toMatchObject({ status: 'complete', email: 'cli@example.com', org_id: orgId });
    expect(done.api_key).toMatch(/^agentdrive_live_/);
    expect(JSON.stringify(done)).not.toContain(sessionId);
    // A retry after a lost response still gets the same key, but the record now expires within a minute.
    const [entry] = (await env.KV.list({ prefix: `cli_pending:${s.id}` })).keys;
    expect(entry!.expiration!).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 61);
    const delivered = (await env.KV.get<{ delivered_at?: number }>(`cli_pending:${s.id}`, 'json'))!.delivered_at;
    expect(delivered).toBeGreaterThan(0);
    expect((await poll(s)).api_key).toBe(done.api_key);
    expect((await env.KV.get<{ delivered_at?: number }>(`cli_pending:${s.id}`, 'json'))!.delivered_at).toBe(delivered);
    expect(await poll({ ...s, device_code: 'not-the-device-code' })).toEqual({ status: 'expired' });

    expect((await call('/v1/auth/me', { headers: { Authorization: `Bearer ${done.api_key}` } })).status).toBe(200);
    const meta = await env.KV.get<{ key_id: string }>(`api_key:${await hashApiKey(done.api_key!)}`, 'json');
    expect(await env.KV.get(`idx:org_keys:${orgId}:${meta!.key_id}`)).toBeTruthy();
  });

  it('refuses a missing code, a wrong code and an expired record, minting nothing', async () => {
    const sessionId = await session('refuse@example.com');
    const s = await start();

    const none = await post('/complete', { id: s.id }, { 'X-Session-Token': sessionId });
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ code: 'user_code_required' });

    const wrong = await complete(s, sessionId, s.user_code === 'AAAA-AAAA' ? 'BBBB-BBBB' : 'AAAA-AAAA');
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: 'wrong_code', error: expect.stringContaining('4 tries left') });
    expect(await poll(s)).toEqual({ status: 'pending' });

    const record = JSON.parse((await env.KV.get(`cli_pending:${s.id}`))!) as { expires_at: number };
    await env.KV.put(`cli_pending:${s.id}`, JSON.stringify({ ...record, expires_at: Math.floor(Date.now() / 1000) - 1 }));
    const expired = await complete(s, sessionId, s.user_code);
    expect(expired.status).toBe(404);
    expect(await expired.json()).toMatchObject({ code: 'expired' });
    expect(await poll(s)).toEqual({ status: 'expired' });
    expect(await env.KV.get('idx:email_org:refuse@example.com')).toBeNull();
  });

  it('kills the record after five wrong codes, so even the right code then fails', async () => {
    const sessionId = await session('guess@example.com');
    const s = await start();
    const wrongCode = s.user_code === 'AAAA-AAAA' ? 'BBBB-BBBB' : 'AAAA-AAAA';
    for (let i = 0; i < 4; i += 1) expect((await complete(s, sessionId, wrongCode)).status).toBe(400);
    const fifth = await complete(s, sessionId, wrongCode);
    expect(fifth.status).toBe(403);
    expect(await fifth.json()).toMatchObject({ code: 'denied' });

    expect((await complete(s, sessionId, s.user_code)).status).toBe(404);
    expect(await poll(s)).toMatchObject({ status: 'denied', error: expect.stringContaining('wrong codes') });
    expect(await env.KV.get('idx:email_org:guess@example.com')).toBeNull();
  });

  it('gives nothing to a poller holding only the id from the browser URL', async () => {
    const sessionId = await session('url-only@example.com');
    const s = await start();
    expect((await complete(s, sessionId, s.user_code)).status).toBe(200);

    expect(await poll(s, 'not-the-device-code')).toEqual({ status: 'expired' });
    expect((await post('/poll', { id: s.id })).status).toBe(400);
    expect((await poll(s)).status).toBe('complete');
  });

  it('tells a CLI that does not show the code to update, and starts nothing', async () => {
    for (const init of [{ method: 'POST' }, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }]) {
      const res = await call('/v1/auth/cli/start', init);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe('cli_outdated');
      expect(body.error).toContain('npm i -g @adrive/cli@latest');
    }
    expect((await env.KV.list({ prefix: 'cli_pending:' })).keys).toHaveLength(0);
  });

  it('gives a session without an org its own org and a key in it', async () => {
    const s = await start();
    expect((await complete(s, await session('new-cli@example.com'), s.user_code)).status).toBe(200);

    const done = await poll(s);
    const orgId = await env.KV.get('idx:email_org:new-cli@example.com');
    expect(orgId).toMatch(/^org_/);
    expect(done.org_id).toBe(orgId);
    const me = (await (await call('/v1/auth/me', { headers: { Authorization: `Bearer ${done.api_key}` } })).json()) as { data: { org_id: string } };
    expect(me.data.org_id).toBe(orgId);
  });

  it('refuses a login at the agent cap with the upgrade link, and the poller sees the refusal', async () => {
    const email = 'capped@example.com';
    const orgId = await registerOrg();
    await env.KV.put(`org_member:${orgId}:${email}`, JSON.stringify({ org_id: orgId, email, role: 'owner' }));
    await env.KV.put(`idx:email_org:${email}`, orgId);
    const usage = (await env.KV.get<Record<string, number>>(`usage:${orgId}`, 'json')) ?? {};
    await env.KV.put(`usage:${orgId}`, JSON.stringify({ ...usage, agent_count: 3 }));
    const keysBefore = await keysIn(orgId);
    const s = await start();

    const res = await complete(s, await session(email, orgId), s.user_code);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; upgrade_url: string };
    expect(body).toMatchObject({ code: 'plan_limit', metric: 'agent_count', upgrade_url: 'http://localhost:3001/billing/upgrade?plan=pro' });

    expect(await poll(s)).toEqual({ status: 'refused', error: body.error, upgrade_url: body.upgrade_url });
    expect(await keysIn(orgId)).toBe(keysBefore);
    expect((await env.KV.get<Record<string, number>>(`usage:${orgId}`, 'json'))!.agent_count).toBe(3);
  });

  it('points a self-hosted instance at --with-key instead of starting a browser login it cannot finish', async () => {
    const res = await call('/v1/auth/cli/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shows_user_code: true }),
    }, { SELF_HOSTED: 'true' });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('cli_browser_signin_disabled');
    expect(body.error).toContain('adrive auth login --with-key');
    expect((await env.KV.list({ prefix: 'cli_pending:' })).keys).toHaveLength(0);
  });

  it('rejects /complete without a session', async () => {
    const s = await start();
    expect((await post('/complete', { id: s.id, user_code: s.user_code })).status).toBe(401);
  });

  it('reports an unknown id as expired', async () => {
    expect(await poll({ id: 'cli_nope', device_code: 'x' } as Start)).toEqual({ status: 'expired' });
  });
});
