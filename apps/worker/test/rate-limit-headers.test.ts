import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import wranglerToml from '../wrangler.toml?raw';
import { LIMITERS, rateLimitPolicy } from '../src/middleware/rate-limit';

async function clearKv() {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

beforeEach(async () => {
  await clearKv();
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function registerAgent(): Promise<{ api_key: string; agent_id: string }> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: 'headers' }),
  });
  return ((await res.json()) as { data: { api_key: string; agent_id: string } }).data;
}

describe('RateLimit-Policy', () => {
  it('matches [[ratelimits]] in wrangler.toml', () => {
    const configured = Object.fromEntries(
      [...wranglerToml.matchAll(/\[\[ratelimits\]\]\s*name = "(\w+)"[^[]*?simple = \{ limit = (\d+), period = (\d+) \}/g)]
        .map(([, name, limit, period]) => [name, { limit: Number(limit), period: Number(period) }]),
    );
    const declared = Object.fromEntries(Object.values(LIMITERS).map(({ binding, limit, period }) => [binding, { limit, period }]));
    expect(declared).toEqual(configured);
  });

  it('is a structured-field list of the policies', () => {
    expect(rateLimitPolicy(['principal', 'search'])).toBe('"principal";q=100;w=10, "search";q=20;w=10');
  });

  it('names the principal policy on authenticated responses, errors included', async () => {
    const agent = await registerAgent();
    const auth = { Authorization: `Bearer ${agent.api_key}` };
    const ok = await SELF.fetch('http://localhost/v1/workspaces', { headers: auth });
    expect(ok.headers.get('RateLimit-Policy')).toBe('"principal";q=100;w=10');
    const missing = await SELF.fetch('http://localhost/v1/workspaces/ws_missing', { headers: auth });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('RateLimit-Policy')).toBe('"principal";q=100;w=10');
  });

  it('adds the search policy on search', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.api_key}` },
      body: JSON.stringify({ query: 'x' }),
    });
    expect(res.headers.get('RateLimit-Policy')).toBe('"principal";q=100;w=10, "search";q=20;w=10');
  });

  it('names the per-IP policy on registration and none on unlimited routes', async () => {
    const res = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'ip' }),
    });
    expect(res.headers.get('RateLimit-Policy')).toBe('"ip_register";q=5;w=60');
    expect((await SELF.fetch('http://localhost/v1/health')).headers.get('RateLimit-Policy')).toBeNull();
  });

  it('counts a request to a nested route once against the principal limit', async () => {
    const agent = await registerAgent();
    const wid = ((await (await SELF.fetch('http://localhost/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.api_key}` },
      body: JSON.stringify({ name: 'nested' }),
    })).json()) as { data: { id: string } }).data.id;
    // That create spent one; leave room for exactly one more request.
    for (let i = 0; i < LIMITERS.principal.limit - 2; i += 1) {
      expect((await env.RL_PRINCIPAL!.limit({ key: `agent:${agent.agent_id}` })).success).toBe(true);
    }
    const write = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.api_key}` },
      body: JSON.stringify({ path: 'a.md', content: 'a' }),
    });
    expect(write.status).toBe(201);
  });
});
