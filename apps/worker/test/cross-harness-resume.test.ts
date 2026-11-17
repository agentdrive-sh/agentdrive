import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/env';
import { isoWeek, resumeMarkerKey, resumeMonth } from '../src/services/storage';
import { deliveredCode } from './magic-code-helper';

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

beforeEach(clearKv);

type Headers = Record<string, string>;

let ipSeq = 0;
function api(path: string, method: string, headers: Headers, body?: unknown): Promise<Response> {
  ipSeq += 1;
  return SELF.fetch(`http://localhost/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `10.8.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

interface Org { key: Headers; org_id: string; agent_id: string; wid: string }

async function setup(): Promise<Org> {
  const reg = await json<{ api_key: string; org_id: string; agent_id: string }>(
    await api('/register', 'POST', {}, { agent_name: 'Resumer', org_name: 'Resume Org' }),
  );
  const key = { Authorization: `Bearer ${reg.api_key}` };
  const wid = (await json<{ id: string }>(await api('/workspaces', 'POST', key, { name: 'WS' }))).id;
  return { key, org_id: reg.org_id, agent_id: reg.agent_id, wid };
}

async function write(org: Org, path: string): Promise<string> {
  const res = await api(`/workspaces/${org.wid}/files`, 'POST', { ...org.key, 'X-Agent-Platform': 'claude-code' }, { path, content: '# transcript' });
  expect(res.status).toBe(201);
  return (await json<{ id: string }>(res)).id;
}

async function read(org: Org, fid: string, headers: Headers): Promise<void> {
  expect((await api(`/workspaces/${org.wid}/files/${fid}?content=true`, 'GET', headers)).status).toBe(200);
}

async function xresumeKeys(): Promise<Array<{ name: string; metadata?: unknown }>> {
  return (await env.KV.list({ prefix: 'metric:xresume:' })).keys;
}

// Recording runs in waitUntil, after the response.
function settled<T>(check: () => Promise<T>): Promise<T> {
  return vi.waitFor(async () => {
    const value = await check();
    if (!value) throw new Error('not recorded yet');
    return value;
  }, { timeout: 3000, interval: 20 });
}

// A negative case can only be told from a slow write by a later read that does
// record: once it lands, the earlier reads' recordings would have too.
async function expectOnlyControl(org: Org, fid: string): Promise<void> {
  await read(org, fid, { ...org.key, 'X-Agent-Platform': 'gemini-cli' });
  const activation = await settled(() => env.KV.get<Record<string, string>>(`activation:${org.org_id}`, 'json'));
  expect(activation.to).toBe('gemini-cli');
  const keys = await xresumeKeys();
  expect(keys).toHaveLength(1);
  expect(keys[0]!.metadata).toMatchObject({ to: 'gemini-cli' });
}

const TRANSCRIPT = 'sessions/github.com__acme__app/claude-code/abc123.md';

describe('cross-harness resume metric', () => {
  it('records the activation and the weekly key when another harness reads a session', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    await read(org, fid, { ...org.key, 'X-Agent-Platform': 'codex' });

    const activation = await settled(() => env.KV.get<Record<string, string>>(`activation:${org.org_id}`, 'json'));
    expect(activation).toMatchObject({ from: 'claude-code', to: 'codex', agent_id: org.agent_id, project: 'github.com__acme__app' });
    const keys = await settled(async () => (await xresumeKeys()).length > 0 && xresumeKeys());
    expect(keys.map((k) => k.name)).toEqual([`metric:xresume:${isoWeek(new Date())}:${org.org_id}:${org.agent_id}`]);
    expect(keys[0]!.metadata).toMatchObject({ from: 'claude-code', to: 'codex' });
  });

  it('keeps the first activation when a later cross-harness resume happens', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    await read(org, fid, { ...org.key, 'X-Agent-Platform': 'codex' });
    const first = await settled(() => env.KV.get(`activation:${org.org_id}`));
    const minted = await json<{ api_key: string; agent_id: string }>(await api('/keys', 'POST', org.key, { name: 'second' }));
    await read(org, fid, { Authorization: `Bearer ${minted.api_key}`, 'X-Agent-Platform': 'cursor' });
    await settled(async () => (await xresumeKeys()).length === 2);
    expect(await env.KV.get(`activation:${org.org_id}`)).toBe(first);
    expect((await xresumeKeys()).map((k) => k.name).sort()).toEqual(
      [org.agent_id, minted.agent_id].map((a) => `metric:xresume:${isoWeek(new Date())}:${org.org_id}:${a}`).sort(),
    );
  });

  it('records nothing for the same harness, an unknown platform, or an uploaded file', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    const upload = await write(org, 'sessions/github.com__acme__app/files/notes.md');
    await read(org, fid, { ...org.key, 'X-Agent-Platform': 'claude-code' });
    await read(org, fid, { ...org.key, 'X-Agent-Platform': 'cli' });
    await read(org, fid, org.key);
    await read(org, upload, { ...org.key, 'X-Agent-Platform': 'codex' });
    await expectOnlyControl(org, fid);
  });

  it('records nothing for a share link or a signed-in person', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    const share = await json<{ url: string }>(await api(`/workspaces/${org.wid}/share`, 'POST', org.key, { permission: 'view' }));
    const token = new URL(share.url).pathname.split('/s/')[1]!;
    await read(org, fid, { 'X-Share-Token': token, 'X-Agent-Platform': 'codex' });

    const email = 'dev@example.com';
    expect((await api('/org/invite', 'POST', org.key, { email, role: 'member' })).status).toBe(201);
    const session = await json<{ session_id: string }>(await api('/auth/verify-code', 'POST', {}, { email, code: await deliveredCode(email) }));
    const person = { 'X-Session-Token': session.session_id, 'X-Agent-Platform': 'codex' };
    expect((await api(`/org/invites/${org.org_id}/accept`, 'POST', person)).status).toBe(200);
    await read(org, fid, person);
    await expectOnlyControl(org, fid);
  });
});

describe('cross-agent resume meter', () => {
  const month = resumeMonth(new Date());
  const markerPrefix = (org: Org, m = month) => `xresume_m:${org.org_id}:${m}:`;
  const markers = async (org: Org, m = month) => (await env.KV.list({ prefix: markerPrefix(org, m) })).keys.map((k) => k.name);
  const seed = (org: Org, n: number, m = month) =>
    Promise.all(Array.from({ length: n }, (_, i) => env.KV.put(`${markerPrefix(org, m)}${String(i).padStart(32, 'f')}`, '')));
  const codex = (org: Org) => ({ ...org.key, 'X-Agent-Platform': 'codex' });

  // Calls the worker directly so a test can switch enforcement on or break KV;
  // waits out waitUntil so marker writes have landed.
  async function call(path: string, headers: Headers, overrides: Partial<Env> = {}): Promise<Response> {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`http://localhost/v1${path}`, { headers }),
      { ...(env as unknown as Env), ...overrides },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }
  const enforced = { RESUME_METER_ENFORCE: 'true' };
  const resume = (org: Org, fid: string, headers: Headers, overrides: Partial<Env> = {}) =>
    call(`/workspaces/${org.wid}/files/${fid}?content=true`, headers, overrides);
  const warning = async (res: Response) => ((await res.json()) as { usage_warning?: { message: string } }).usage_warning;

  it('counts a cross-harness read under the org and month', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    expect((await resume(org, fid, codex(org))).status).toBe(200);
    const keys = await markers(org);
    expect(keys).toEqual([await resumeMarkerKey(org.org_id, month, TRANSCRIPT, 'codex')]);
    expect(keys[0]).toMatch(new RegExp(`^xresume_m:${org.org_id}:\\d{4}-\\d{2}:[0-9a-f]{32}$`));
  });

  it('does not count a repeat read of a session already resumed this month', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    await seed(org, 7);
    expect(await warning(await resume(org, fid, codex(org)))).toMatchObject({ metric: 'resume_count', level: 'warn80' });
    const again = await warning(await resume(org, fid, codex(org)));
    expect(again).toMatchObject({ metric: 'resume_count', level: 'warn80' });
    expect(again!.message).toContain('(8 of 10)');
    expect(await markers(org)).toHaveLength(8);
  });

  it('treats a session as already counted when its marker is listed but the get misses it', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    await seed(org, 9);
    await env.KV.put(await resumeMarkerKey(org.org_id, month, TRANSCRIPT, 'codex'), '');
    const kv = env.KV;
    const lagging = {
      get: (key: string, type?: never) => (key.startsWith('xresume_m:') ? Promise.resolve(null) : kv.get(key, type)),
      getWithMetadata: kv.getWithMetadata.bind(kv),
      put: kv.put.bind(kv),
      delete: kv.delete.bind(kv),
      list: kv.list.bind(kv),
    } as unknown as KVNamespace;

    const res = await resume(org, fid, codex(org), { ...enforced, KV: lagging });
    expect(res.status).toBe(200);
    expect((await warning(res))!.message).toContain('(10 of 10)');
    expect(await markers(org)).toHaveLength(10);
  });

  it('counts nothing for the same harness or an unknown platform', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    for (const platform of ['claude-code', 'cli']) {
      expect((await resume(org, fid, { ...org.key, 'X-Agent-Platform': platform })).status).toBe(200);
    }
    expect((await resume(org, fid, org.key)).status).toBe(200);
    expect(await markers(org)).toEqual([]);
  });

  it('warns at 80% with the resume metric', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    await seed(org, 7);
    expect(await warning(await resume(org, fid, codex(org)))).toEqual({
      metric: 'resume_count',
      level: 'warn80',
      message: 'AgentDrive: your Free plan has used 80% of its cross-agent resumes this month (8 of 10). Upgrade to Pro: http://localhost:3001/billing/upgrade?plan=pro',
      upgrade_url: 'http://localhost:3001/billing/upgrade?plan=pro',
    });
  });

  it('at the limit warns while enforcement is off, and refuses only a new session once it is on', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    const other = await write(org, 'sessions/github.com__acme__app/claude-code/def456.md');
    await seed(org, 10);

    const off = await resume(org, fid, codex(org));
    expect(off.status).toBe(200);
    expect(await warning(off)).toMatchObject({ metric: 'resume_count', level: 'warn99' });

    const refused = await resume(org, other, codex(org), enforced);
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ success: false, code: 'plan_limit', metric: 'resume_count', used: 11, limit: 10, plan: 'trial' });
    expect(await markers(org)).toHaveLength(11);

    const counted = await resume(org, fid, codex(org), enforced);
    expect(counted.status).toBe(200);
    expect(((await counted.json()) as { data: { content: string } }).data.content).toBe('# transcript');
  });

  it('counts but never warns or refuses a paid plan', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    const meta = await env.KV.get<Record<string, unknown>>(`org:${org.org_id}`, 'json');
    await env.KV.put(`org:${org.org_id}`, JSON.stringify({ ...meta, plan: 'pro' }));
    await seed(org, 12);

    const res = await resume(org, fid, codex(org), enforced);
    expect(res.status).toBe(200);
    expect(await warning(res)).toBeUndefined();
    expect(await markers(org)).toHaveLength(13);

    const plan = await json<{ usage: Record<string, number>; quota: Record<string, unknown>; status: { metrics: Record<string, unknown> } }>(
      await api('/billing/plan', 'GET', org.key),
    );
    expect(plan.quota.max_resumes_month).toBeNull();
    expect(plan.usage.resume_count).toBe(13);
    expect(plan.status.metrics).not.toHaveProperty('resume_count');
  });

  it('reports the Free count and limit on /v1/billing/plan', async () => {
    const org = await setup();
    await seed(org, 3);
    const plan = await json<{ usage: Record<string, number>; quota: Record<string, unknown>; status: { metrics: Record<string, unknown> } }>(
      await api('/billing/plan', 'GET', org.key),
    );
    expect(plan.quota.max_resumes_month).toBe(10);
    expect(plan.usage.resume_count).toBe(3);
    expect(plan.status.metrics.resume_count).toEqual({ used: 3, limit: 10, pct: 30, level: 'ok' });
  });

  it("does not count last month's markers", async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    const now = new Date();
    const lastMonth = resumeMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));
    await seed(org, 10, lastMonth);
    await env.KV.put(await resumeMarkerKey(org.org_id, lastMonth, TRANSCRIPT, 'codex'), '');

    const res = await resume(org, fid, codex(org), enforced);
    expect(res.status).toBe(200);
    expect(await warning(res)).toBeUndefined();
    expect(await markers(org)).toHaveLength(1);
  });

  it('serves the content when the meter cannot reach KV', async () => {
    const org = await setup();
    const fid = await write(org, TRANSCRIPT);
    const kv = env.KV;
    const broken = {
      get: kv.get.bind(kv),
      getWithMetadata: kv.getWithMetadata.bind(kv),
      put: kv.put.bind(kv),
      delete: kv.delete.bind(kv),
      list: (opts?: KVNamespaceListOptions) =>
        opts?.prefix?.startsWith('xresume_m:') ? Promise.reject(new Error('kv down')) : kv.list(opts),
    } as unknown as KVNamespace;
    const errors = vi.spyOn(console, 'error');

    const res = await resume(org, fid, codex(org), { ...enforced, KV: broken });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { content: string } }).data.content).toBe('# transcript');
    expect(errors.mock.calls.map((args) => String(args[0]))).toContain(
      JSON.stringify({ event: 'resume_meter_error', org_id: org.org_id, from: 'claude-code', to: 'codex' }),
    );

    const plan = await call('/billing/plan', org.key, { KV: broken });
    expect(plan.status).toBe(200);
    const data = ((await plan.json()) as { data: { usage: Record<string, unknown>; quota: Record<string, unknown> } }).data;
    expect(data.usage).not.toHaveProperty('resume_count');
    expect(data.quota.max_resumes_month).toBe(10);
    errors.mockRestore();
  });

  // Documents the soft cap (dec-2c48b700): both first reads see 9 and go through.
  it('lets two concurrent first reads at 9 both through', async () => {
    const org = await setup();
    const a = await write(org, TRANSCRIPT);
    const b = await write(org, 'sessions/github.com__acme__app/claude-code/def456.md');
    await seed(org, 9);
    const [ra, rb] = await Promise.all([resume(org, a, codex(org), enforced), resume(org, b, codex(org), enforced)]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect(await markers(org)).toHaveLength(11);
  });
});
