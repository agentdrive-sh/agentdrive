import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF, createExecutionContext, waitOnExecutionContext, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/env';
import { idempotencyRecord } from '../src/durable-objects/idempotency';
import { fingerprint } from '../src/middleware/idempotency';

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

beforeEach(clearKv);

interface Agent { api_key: string; agent_id: string }

async function registerAgent(name: string): Promise<Agent> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: name, org_name: `${name}Org` }),
  });
  return ((await res.json()) as { data: Agent }).data;
}

async function createWorkspace(agent: Agent): Promise<string> {
  const res = await SELF.fetch('http://localhost/v1/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.api_key}` },
    body: JSON.stringify({ name: 'ws' }),
  });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

function writeRequest(agent: Agent, wid: string, key: string | null, content = 'hello'): Request {
  return new Request(`http://localhost/v1/workspaces/${wid}/files`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${agent.api_key}`,
      ...(key === null ? {} : { 'Idempotency-Key': key }),
    },
    body: JSON.stringify({ path: 'notes/a.md', content }),
  });
}

async function call(req: Request, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...(env as unknown as Env), ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function versionCount(agent: Agent, wid: string, fid: string): Promise<number> {
  const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/${fid}/versions`, {
    headers: { Authorization: `Bearer ${agent.api_key}` },
  });
  return ((await res.json()) as { data: unknown[] }).data.length;
}

describe('Idempotency-Key on REST writes', () => {
  it('replays the stored response to a retry without running the write again', async () => {
    const agent = await registerAgent('Idem');
    const wid = await createWorkspace(agent);

    const first = await SELF.fetch(writeRequest(agent, wid, 'key-1'));
    expect(first.status).toBe(201);
    expect(first.headers.get('Idempotent-Replayed')).toBeNull();
    const firstBody = await first.text();

    const retry = await SELF.fetch(writeRequest(agent, wid, 'key-1'));
    expect(retry.status).toBe(201);
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
    expect(retry.headers.get('Content-Type')).toContain('application/json');
    expect(await retry.text()).toBe(firstBody);

    const fid = (JSON.parse(firstBody) as { data: { id: string } }).data.id;
    expect(await versionCount(agent, wid, fid)).toBe(1);

    const unkeyed = await SELF.fetch(writeRequest(agent, wid, null));
    expect(unkeyed.status).toBe(200);
    expect(await versionCount(agent, wid, fid)).toBe(2);
  });

  it('answers 422 when a key is reused with a different request', async () => {
    const agent = await registerAgent('Idem');
    const wid = await createWorkspace(agent);
    expect((await SELF.fetch(writeRequest(agent, wid, 'key-2', 'one'))).status).toBe(201);
    const reused = await SELF.fetch(writeRequest(agent, wid, 'key-2', 'two'));
    expect(reused.status).toBe(422);
    expect(await reused.json()).toMatchObject({ success: false, code: 'idempotency_key_reused' });
  });

  it.each([
    ['empty', ''],
    ['a space', 'has space'],
    ['256 characters', 'k'.repeat(256)],
  ])('rejects a key that is %s with 400', async (_label, key) => {
    const agent = await registerAgent('Idem');
    const wid = await createWorkspace(agent);
    const res = await SELF.fetch(writeRequest(agent, wid, key));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'invalid_idempotency_key' });
  });

  it('accepts a 255-character key', async () => {
    const agent = await registerAgent('Idem');
    const wid = await createWorkspace(agent);
    expect((await SELF.fetch(writeRequest(agent, wid, '~'.repeat(255)))).status).toBe(201);
  });

  it('answers 409 while the first request with the key is in flight', async () => {
    const agent = await registerAgent('Idem');
    const wid = await createWorkspace(agent);
    const req = writeRequest(agent, wid, 'key-3');
    const claim = await idempotencyRecord(env as unknown as Env, `agent:${agent.agent_id}`, 'key-3').claim(await fingerprint(req.clone()));
    expect(claim.outcome).toBe('claimed');
    const res = await SELF.fetch(req);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'idempotency_key_in_use' });
  });

  it('runs concurrent retries once', async () => {
    const agent = await registerAgent('Idem');
    const wid = await createWorkspace(agent);
    const responses = await Promise.all(Array.from({ length: 5 }, () => SELF.fetch(writeRequest(agent, wid, 'key-4'))));
    const fresh = responses.filter((r) => r.status === 201 && !r.headers.get('Idempotent-Replayed'));
    expect(fresh).toHaveLength(1);
    for (const r of responses) expect([201, 409]).toContain(r.status);
    const fid = ((await fresh[0]!.json()) as { data: { id: string } }).data.id;
    expect(await versionCount(agent, wid, fid)).toBe(1);
  });

  it('scopes keys to the principal', async () => {
    const a = await registerAgent('IdemA');
    const b = await registerAgent('IdemB');
    const wa = await createWorkspace(a);
    const wb = await createWorkspace(b);
    expect((await SELF.fetch(writeRequest(a, wa, 'shared'))).status).toBe(201);
    const other = await SELF.fetch(writeRequest(b, wb, 'shared'));
    expect(other.status).toBe(201);
    expect(other.headers.get('Idempotent-Replayed')).toBeNull();
  });

  it('spends no key on a 401, a 429, a 404 or a 5xx', async () => {
    const agent = await registerAgent('Idem');
    const wid = await createWorkspace(agent);

    const badKey = writeRequest({ ...agent, api_key: 'agentdrive_live_nope' }, wid, 'key-5');
    expect((await SELF.fetch(badKey)).status).toBe(401);

    const limited = { RL_PRINCIPAL: { limit: async () => ({ success: false }) } as RateLimit };
    expect((await call(writeRequest(agent, wid, 'key-5'), limited)).status).toBe(429);

    expect((await SELF.fetch(writeRequest(agent, 'ws_missing', 'key-6'))).status).toBe(404);
    expect((await SELF.fetch(writeRequest(agent, 'ws_missing', 'key-6'))).headers.get('Idempotent-Replayed')).toBeNull();

    const broken = new Proxy({}, { get: () => async () => { throw new Error('r2 down'); } }) as R2Bucket;
    expect((await call(writeRequest(agent, wid, 'key-5'), { R2: broken })).status).toBe(500);

    const res = await SELF.fetch(writeRequest(agent, wid, 'key-5'));
    expect(res.status).toBe(201);
    expect(res.headers.get('Idempotent-Replayed')).toBeNull();
  });

  it('ignores the header on read-only POST routes and on GET', async () => {
    const agent = await registerAgent('Idem');
    const search = () => SELF.fetch('http://localhost/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.api_key}`, 'Idempotency-Key': 's-1' },
      body: JSON.stringify({ query: 'anything' }),
    });
    await search();
    expect((await search()).headers.get('Idempotent-Replayed')).toBeNull();
    const list = await SELF.fetch('http://localhost/v1/workspaces', {
      headers: { Authorization: `Bearer ${agent.api_key}`, 'Idempotency-Key': ' not valid ' },
    });
    expect(list.status).toBe(200);
  });

  it('answers 409 idempotency_response_not_stored when the first response was too large to keep', async () => {
    const agent = await registerAgent('Idem');
    const wid = await createWorkspace(agent);
    const req = writeRequest(agent, wid, 'big');
    const record = idempotencyRecord(env as unknown as Env, `agent:${agent.agent_id}`, 'big');
    const claim = await record.claim(await fingerprint(req.clone()));
    if (claim.outcome !== 'claimed') throw new Error(claim.outcome);
    await record.complete(claim.token, 201, 'application/json', null);
    const res = await SELF.fetch(req);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'idempotency_response_not_stored' });
  });
});

describe('IdempotencyRecord', () => {
  const record = (name: string) => idempotencyRecord(env as unknown as Env, 'agent:test', name);

  it('frees an abandoned claim after its lease', async () => {
    const stub = record('lease');
    const first = await stub.claim('fp');
    if (first.outcome !== 'claimed') throw new Error(first.outcome);
    await runInDurableObject(stub, (_obj, state) => {
      state.storage.sql.exec('UPDATE entry SET lease_until = ?', Date.now() - 1);
    });
    const second = await stub.claim('fp');
    expect(second.outcome).toBe('claimed');
    await stub.complete(first.token, 201, 'application/json', new TextEncoder().encode('{"late":true}').buffer as ArrayBuffer);
    expect((await stub.claim('fp')).outcome).toBe('in_flight');
  });

  it('deletes the entry when its alarm fires after 24 hours', async () => {
    const stub = record('expiry');
    const claim = await stub.claim('fp');
    if (claim.outcome !== 'claimed') throw new Error(claim.outcome);
    await stub.complete(claim.token, 201, 'application/json', new TextEncoder().encode('{}').buffer as ArrayBuffer);
    expect((await stub.claim('fp')).outcome).toBe('replay');
    await runInDurableObject(stub, async (_obj, state) => {
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
      state.storage.sql.exec('UPDATE entry SET expires = ?', Date.now() - 1);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, (_obj, state) => {
      expect(state.storage.sql.exec('SELECT name FROM sqlite_master WHERE name = ?', 'entry').toArray()).toHaveLength(0);
    });
  });

  it('treats an expired entry as new even before its alarm runs', async () => {
    const stub = record('stale');
    const claim = await stub.claim('fp');
    if (claim.outcome !== 'claimed') throw new Error(claim.outcome);
    await stub.complete(claim.token, 201, 'application/json', new ArrayBuffer(0));
    await runInDurableObject(stub, (_obj, state) => {
      state.storage.sql.exec('UPDATE entry SET expires = ?', Date.now() - 1);
    });
    expect((await stub.claim('other')).outcome).toBe('claimed');
  });

  it('claims a key once when a path no handler matches passes through nested auth', async () => {
    const agent = await registerAgent('Idem');
    const wid = await createWorkspace(agent);
    const fid = ((await (await SELF.fetch(writeRequest(agent, wid, null))).json()) as { data: { id: string } }).data.id;
    const bogus = () =>
      SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/${fid}/bogus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.api_key}`, 'Idempotency-Key': 'nested' },
        body: '{}',
      });
    for (const res of [await bogus(), await bogus()]) {
      expect(res.status).toBe(404);
      expect(res.headers.get('Idempotent-Replayed')).toBeNull();
    }
  });

  it('never stores a minted API key: each keyed request mints a new one', async () => {
    const agent = await registerAgent('Idem');
    const mint = async () => {
      const res = await SELF.fetch('http://localhost/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.api_key}`, 'Idempotency-Key': 'mint' },
        body: JSON.stringify({ name: 'laptop' }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('Idempotent-Replayed')).toBeNull();
      return ((await res.json()) as { data: { api_key: string } }).data.api_key;
    };
    expect(await mint()).not.toBe(await mint());
  });
});
