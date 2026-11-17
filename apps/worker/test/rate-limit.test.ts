import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/env';

async function clearKv() {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

// The real binding uses Date.now for its fixed window. Hold only Date constant
// so the burst cannot cross an epoch; I/O and native timers still run normally.
beforeEach(async () => {
  await clearKv();
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const testEnv = env as unknown as Env & { RL_REGISTER_PROD: RateLimit; RL_MAGIC_PROD: RateLimit };

async function call(path: string, init: RequestInit, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`http://localhost/v1${path}`, init), { ...testEnv, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function expectRateLimited(res: Response, seconds: number): Promise<void> {
  expect(res.status).toBe(429);
  expect(res.headers.get('Retry-After')).toBe(String(seconds));
  expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
  const body = (await res.json()) as { success: boolean; code: string; error: string };
  expect(body).toMatchObject({ success: false, code: 'rate_limited' });
  expect(body.error).toContain(`${seconds} seconds`);
}

async function registerAgent(ip: string): Promise<{ api_key: string; agent_id: string }> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ agent_name: 'limited' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { api_key: string; agent_id: string } }).data;
}

// Spends a key's budget on the binding itself: a 100-request HTTP burst is slow
// enough in the full suite to cross a window and destabilise the pool.
async function spend(binding: RateLimit, key: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) expect((await binding.limit({ key })).success).toBe(true);
}

describe('IP rate limiting', () => {
  const prodRegister = { RL_REGISTER: testEnv.RL_REGISTER_PROD };
  const register = (ip: string) => call('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ agent_name: 'spamBot' }),
  }, prodRegister);

  it('returns 429 with Retry-After 60 once /v1/register passes 5 a minute from one IP', async () => {
    for (let i = 0; i < 5; i += 1) expect((await register('203.0.113.10')).status).toBe(201);
    await expectRateLimited(await register('203.0.113.10'), 60);
  }, 30_000);

  it('uses separate buckets for different IPs', async () => {
    for (let i = 0; i < 5; i += 1) await register('198.51.100.1');
    expect((await register('198.51.100.1')).status).toBe(429);
    expect((await register('198.51.100.2')).status).toBe(201);
  }, 30_000);

  it('limits /v1/auth/send-code to 10 a minute from one IP', async () => {
    // A new address each time, so the per-address send cap (5 an hour) stays out of it.
    let n = 0;
    const send = () => call('/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.20' },
      body: JSON.stringify({ email: `ip-limit-${(n += 1)}@example.com`, purpose: 'login' }),
    }, { RL_MAGIC: testEnv.RL_MAGIC_PROD });
    for (let i = 0; i < 10; i += 1) expect((await send()).status).not.toBe(429);
    await expectRateLimited(await send(), 60);
  }, 30_000);

  // Each start is an anonymous KV write.
  it('limits /v1/auth/cli/start to 10 a minute from one IP', async () => {
    const start = () => call('/auth/cli/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.30' },
      body: JSON.stringify({ shows_user_code: true }),
    }, { RL_MAGIC: testEnv.RL_MAGIC_PROD });
    for (let i = 0; i < 10; i += 1) expect((await start()).status).toBe(201);
    await expectRateLimited(await start(), 60);
  }, 30_000);

  it('counts /v1/auth/cli/complete apart from sign-in, so mistyped codes end in denied, not 429', async () => {
    const prod = { RL_MAGIC: testEnv.RL_MAGIC_PROD };
    const post = (path: string, ip: string, body: unknown, headers: Record<string, string> = {}) => call(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip, ...headers },
      body: JSON.stringify(body),
    }, prod);
    const ip = '203.0.113.31';
    for (let i = 0; i < 10; i += 1) expect((await post('/auth/cli/start', ip, { shows_user_code: true })).status).toBe(201);
    await expectRateLimited(await post('/auth/cli/start', ip, { shows_user_code: true }), 60);

    const start = (await (await post('/auth/cli/start', '203.0.113.32', { shows_user_code: true })).json()) as { data: { id: string; user_code: string } };
    await env.KV.put('session:sess_rl_cli', JSON.stringify({
      session_id: 'sess_rl_cli', email: 'rl-cli@example.com',
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(), last_active_at: new Date().toISOString(),
    }));
    const wrong = start.data.user_code === 'AAAA-AAAA' ? 'BBBB-BBBB' : 'AAAA-AAAA';
    const complete = () => post('/auth/cli/complete', ip, { id: start.data.id, user_code: wrong }, { 'X-Session-Token': 'sess_rl_cli' });
    for (let i = 0; i < 4; i += 1) expect((await complete()).status).toBe(400);
    expect((await complete()).status).toBe(403);
    for (let i = 0; i < 5; i += 1) expect((await complete()).status).toBe(404);
    await expectRateLimited(await complete(), 60);
  }, 30_000);
});

describe('principal rate limiting', () => {
  it('refuses the 101st request from one key within 10 seconds', async () => {
    const agent = await registerAgent('192.0.2.1');
    const get = () => SELF.fetch('http://localhost/v1/runs/run_missing', { headers: { Authorization: `Bearer ${agent.api_key}` } });
    await spend(testEnv.RL_PRINCIPAL!, `agent:${agent.agent_id}`, 99);
    expect((await get()).status).toBe(404);
    await expectRateLimited(await get(), 10);
  });

  it('allows the request when the limiter throws or is not bound', async () => {
    const { api_key } = await registerAgent('192.0.2.2');
    const init = { headers: { Authorization: `Bearer ${api_key}` } };
    const broken = { limit: async () => { throw new Error('limiter down'); } } as RateLimit;
    expect((await call('/workspaces', init, { RL_PRINCIPAL: broken })).status).toBe(200);
    expect((await call('/workspaces', init, { RL_PRINCIPAL: undefined })).status).toBe(200);
  });

  it('refuses the 21st search from one key within 10 seconds', async () => {
    const agent = await registerAgent('192.0.2.3');
    const search = () => SELF.fetch('http://localhost/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agent.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'handoff' }),
    });
    await spend(testEnv.RL_SEARCH!, `agent:${agent.agent_id}`, 19);
    expect((await search()).status).toBe(200);
    await expectRateLimited(await search(), 10);
  });

  it('spends no share-link use on a rate-limited content read', async () => {
    const agent = await registerAgent('192.0.2.4');
    const owner = { Authorization: `Bearer ${agent.api_key}`, 'Content-Type': 'application/json' };
    const ws = await SELF.fetch('http://localhost/v1/workspaces', { method: 'POST', headers: owner, body: JSON.stringify({ name: 'shared' }) });
    const wid = ((await ws.json()) as { data: { id: string } }).data.id;
    const file = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST', headers: owner, body: JSON.stringify({ path: 'plan.md', content: 'plan' }),
    });
    const fid = ((await file.json()) as { data: { id: string } }).data.id;
    const share = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/share`, {
      method: 'POST', headers: owner, body: JSON.stringify({ permission: 'view', max_uses: 5 }),
    });
    const { url, token_id } = ((await share.json()) as { data: { url: string; token_id: string } }).data;
    const read = () => call(`/workspaces/${wid}/files/${fid}?content=true`, { headers: { 'X-Share-Token': new URL(url).pathname.split('/s/')[1]! } });
    const used = () => env.KV.get(`token_used:${token_id}`);

    expect((await read()).status).toBe(200);
    expect(await used()).toBe('1');
    await spend(testEnv.RL_PRINCIPAL!, `share:${token_id}`, 99);
    await expectRateLimited(await read(), 10);
    expect(await used()).toBe('1');
  });
});
