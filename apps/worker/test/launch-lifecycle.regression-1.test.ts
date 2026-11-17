import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { hashApiKey, type FileMeta } from '@agentdrive/shared';
import worker from '../src/index.js';
import type { Env } from '../src/env.js';
import { StorageService } from '../src/services/storage.js';
import { BucketConfigStore } from '../src/services/bucket-config.js';
import { resolveDriverForRead, resolveDriverForWrite } from '../src/services/bucket-driver/resolve.js';
import { keywordSearch } from '../src/services/keyword-search.js';

// Regression: launch data lifecycle audit, found by /qa on 2026-11-16.
// Value: protects=deleted/stale content and bucket credentials; fails_when=retrieval trusts orphan vectors or configs are destroyed;
// why_new=CRUD and driver units did not exercise these cross-boundary lifecycles; seam=none;
// no_claim=provider propagation/acceptance (deterministic AI, Vectorize and S3 transport fixtures).

const vectors = new Map<string, { id: string; values: number[]; metadata: Record<string, unknown> }>();
let deleteCalls: string[][];
let sequence = 0;
let embeddingFailure = false;
let upsertFailure = false;
let embeddingCalls = 0;
let duringEmbedding: (() => Promise<void>) | undefined;
let inferenceFault: 'missing' | 'short' | 'nonfinite' | undefined;
let receiptFault: 'missing' | 'empty' | 'partial' | 'legacy' | undefined;
const s = () => new StorageService(env.KV, env.R2);
const bindings = (): Env => ({
  ...(env as unknown as Env),
  AI: { run: async (_: string, input: { text: string[] }) => {
    embeddingCalls++;
    if (embeddingFailure) throw new Error('synthetic inference failure');
    await duringEmbedding?.();
    if (inferenceFault === 'missing') return {};
    if (inferenceFault === 'short') return { data: input.text.map(() => Array(767).fill(0.1)) };
    if (inferenceFault === 'nonfinite') return { data: input.text.map(() => Array(768).fill(Infinity)) };
    return { data: input.text.map(() => Array(768).fill(0.1)) };
  } } as unknown as Ai,
  VECTORIZE: {
    upsert: async (items: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>) => {
      if (upsertFailure) throw new Error('synthetic vector mutation failure');
      for (const item of items) vectors.set(item.id, item);
      if (receiptFault === 'missing') return undefined;
      if (receiptFault === 'empty') return { mutationId: '' };
      if (receiptFault === 'partial') return { count: items.length, ids: [] };
      if (receiptFault === 'legacy') return { count: items.length, ids: items.map((item) => item.id) };
      return { mutationId: 'fixture_reindex_receipt' };
    },
    // Deliberately retain deleted vectors to model delayed index propagation.
    deleteByIds: async (ids: string[]) => { deleteCalls.push(ids); },
    query: async (_: number[], options: { topK: number; returnMetadata: string }) => {
      // Actual Vectorize v2 rejects >50 matches with returnMetadata:'all'.
      // https://developers.cloudflare.com/vectorize/platform/limits/
      if (options.returnMetadata === 'all' && options.topK > 50) throw new Error('Provider full-metadata query limit exceeded');
      return { matches: [...vectors.values()].map((v) => ({ ...v, score: 0.9 })) };
    },
  } as unknown as VectorizeIndex,
});

async function call(path: string, key: string, method = 'GET', body?: unknown, session = false): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`http://localhost/v1${path}`, {
    method,
    headers: { [session ? 'X-Session-Token' : 'Authorization']: session ? key : `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), bindings(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function principal(plan: 'team' | 'trial' = 'team') {
  const n = ++sequence;
  const org = `org_launch_${n}`;
  const agent = `ag_launch_${n}`;
  const key = `agentdrive_live_launch_regression_${n}`;
  await s().createOrg(org, 'Launch regression', agent, env);
  await s().updateOrg(org, { plan });
  await s().createApiKey(org, agent, 'Launch', await hashApiKey(key), 'synthetic');
  await s().addOrgAgent(org, agent, 'Launch');
  const ws = await s().createWorkspace(`ws_launch_${n}`, 'Launch', agent, org);
  return { org, agent, key, wid: ws.id };
}

async function write(p: Awaited<ReturnType<typeof principal>>, path = 'private.md', content = 'synthetic confidential phrase'): Promise<FileMeta> {
  const res = await call(`/workspaces/${p.wid}/files`, p.key, 'POST', { path, content });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: FileMeta }).data;
}

const configBody = { name: 'Customer bucket', provider: 's3-hmac', endpoint: 'https://s3.example.invalid', region: 'us-east-1', bucket: 'fixture', access_key_id: 'synthetic', secret_access_key: 'synthetic' };

beforeEach(async () => {
  let cursor: string | undefined;
  do {
    const page = await env.KV.list({ cursor });
    await Promise.all(page.keys.map((key) => env.KV.delete(key.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  vectors.clear(); deleteCalls = [];
  embeddingFailure = false; upsertFailure = false; embeddingCalls = 0; duringEmbedding = undefined;
  inferenceFault = undefined; receiptFault = undefined;
});

describe('ship P1 delegate identity and rejection boundaries', () => {
  // Value: protects=production-issued delegated authority and fail-closed maintenance/readiness;
  // fails_when=raw creator emails lose admin authority or invalid provider/storage results report success;
  // why_new=prior authorization fixtures did not mint human-owned keys through the production writer;
  // seam=none; no_claim=real provider acceptance, propagation or global KV consistency.
  async function issued(p: Awaited<ReturnType<typeof principal>>, role: 'owner' | 'admin' | 'member') {
    const email = `${role}-${p.org}@example.invalid`;
    await s().addOrgMember(p.org, email, role, 'owner@example.invalid');
    const session = `sess_issued_${p.org}_${role}`;
    await s().createSession(session, email, p.org);
    const response = await call('/keys', session, 'POST', { name: `${role} production-issued key` }, true);
    expect(response.status).toBe(201);
    const key = ((await response.json()) as any).data.api_key as string;
    const hash = await hashApiKey(key);
    const meta = await env.KV.get<any>(`api_key:${hash}`, 'json');
    expect(meta.created_by).toBe(email); // Actual production writer uses the raw email.
    return { key, email, hash, meta };
  }

  it('authorizes actually issued owner/admin keys and their legitimate legacy-prefixed metadata', async () => {
    const p = await principal(); const file = await write(p);
    const statuses: Array<{ role: string; create: number; assign: number; reindex: number; clear: number; verify: number; retire: number }> = [];
    for (const role of ['owner', 'admin'] as const) {
      const identity = await issued(p, role);
      const config = await new BucketConfigStore(env.KV).create({ name: 'Managed native bucket', provider: 'agentdrive-r2', org_id: p.org, created_by: p.agent });
      const created = await call('/bucket-config', identity.key, 'POST', configBody);
      const assign = await call(`/workspaces/${p.wid}/bucket-config`, identity.key, 'PUT', { bucket_config_id: config.id });
      const reindex = await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, identity.key, 'POST', {});
      const clear = await call(`/workspaces/${p.wid}/bucket-config`, identity.key, 'DELETE');
      // An actual minted key with historical prefixed metadata must still use current membership.
      await env.KV.put(`api_key:${identity.hash}`, JSON.stringify({ ...identity.meta, created_by: `member:${identity.email}` }));
      const verify = await call(`/bucket-config/${config.id}/verify`, identity.key, 'POST', {});
      const retire = await call(`/bucket-config/${config.id}`, identity.key, 'DELETE');
      statuses.push({ role, create: created.status, assign: assign.status, reindex: reindex.status, clear: clear.status, verify: verify.status, retire: retire.status });
    }
    expect(statuses).toEqual(['owner', 'admin'].map((role) => ({ role, create: 201, assign: 200, reindex: 200, clear: 200, verify: 200, retire: 200 })));
  });

  it('denies issued ordinary, downgraded and revoked delegates and preserves foreign workspaces', async () => {
    const p = await principal(); const other = await principal(); const file = await write(p);
    const member = await issued(p, 'member');
    expect((await call('/bucket-config', member.key, 'POST', configBody)).status).toBe(403);
    expect((await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, member.key, 'POST', {})).status).toBe(403);
    const admin = await issued(p, 'admin');
    await s().addOrgMember(p.org, admin.email, 'member', 'owner@example.invalid');
    expect((await call('/bucket-config', admin.key, 'POST', configBody)).status).toBe(403);
    expect(await s().removeOrgMember(p.org, admin.email)).toBe(true);
    expect((await call('/bucket-config', admin.key, 'POST', configBody)).status).toBe(401);
    const owner = await issued(p, 'owner');
    const before = await s().getWorkspace(other.wid);
    expect((await call(`/workspaces/${other.wid}/bucket-config`, owner.key, 'PUT', { bucket_config_id: 'default' })).status).toBe(404);
    expect((await call(`/workspaces/${other.wid}/bucket-config`, owner.key, 'DELETE')).status).toBe(404);
    expect(await s().getWorkspace(other.wid)).toEqual(before);
  });

  it('rejects malformed inference and mutation receipts without version or usage effects', async () => {
    const p = await principal(); const file = await write(p);
    const versions = await s().getVersions(file.id); const usage = await s().getUsage(p.org);
    for (const fault of ['missing', 'short', 'nonfinite'] as const) {
      inferenceFault = fault; vectors.clear();
      const response = await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, p.key, 'POST', {});
      expect(response.status).toBe(502);
      expect(((await response.json()) as any).code).toBe('reindex_failed');
      expect(vectors.size).toBe(0);
    }
    inferenceFault = undefined;
    for (const fault of ['missing', 'empty', 'partial'] as const) {
      receiptFault = fault;
      const response = await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, p.key, 'POST', {});
      expect(response.status).toBe(502);
      expect(((await response.json()) as any).code).toBe('reindex_failed');
    }
    receiptFault = 'legacy';
    const accepted = await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, p.key, 'POST', {});
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as any).data).toMatchObject({ status: 'accepted', count: 1 });
    expect(await s().getFile(p.wid, file.id)).toEqual(file);
    expect(await s().getVersions(file.id)).toEqual(versions);
    expect(await s().getUsage(p.org)).toEqual(usage);
  });

  it('refuses hash-mismatched stored bytes before inference without modifying canonical metadata', async () => {
    const p = await principal(); const content = `Unique hash-guard fixture ${p.wid}`; const file = await write(p, 'integrity.md', content);
    const key = file.object_key!; const calls = embeddingCalls;
    const versions = await s().getVersions(file.id); const usage = await s().getUsage(p.org);
    try {
      await env.R2.put(key, 'Synthetic incorrect stored bytes');
      const response = await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, p.key, 'POST', {});
      expect(response.status).toBe(502);
      expect(((await response.json()) as any).code).toBe('content_mismatch');
      expect(embeddingCalls).toBe(calls);
      expect(await s().getFile(p.wid, file.id)).toEqual(file);
      expect(await s().getVersions(file.id)).toEqual(versions);
      expect(await s().getUsage(p.org)).toEqual(usage);
    } finally { await env.R2.put(key, content); }
  });

  it('bounds hung KV and R2 readiness probes and reports the failed dependency', async () => {
    await Promise.all((['KV', 'R2'] as const).map(async (binding) => {
      const never = () => new Promise<never>(() => {});
      const ctx = createExecutionContext();
      const testBindings = { ...bindings(), [binding]: binding === 'KV' ? { get: never } : { head: never } } as Env;
      const response = await worker.fetch(new Request('http://localhost/v1/health'), testBindings, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ status: 'unavailable', checks: { kv: binding === 'KV' ? 'unavailable' : 'ok', r2: binding === 'R2' ? 'unavailable' : 'ok' } });
    }));
  });
});

describe('owner maintenance and human comment permissions', () => {
  async function human(p: Awaited<ReturnType<typeof principal>>, role: 'owner' | 'admin' | 'member') {
    const email = `${role}@example.invalid`;
    await s().addOrgMember(p.org, email, role, 'owner@example.invalid');
    const id = `sess_launch_${role}`;
    await s().createSession(id, email, p.org);
    return id;
  }

  it('lets owning-org owners/admins comment while ordinary members still need a workspace role', async () => {
    const p = await principal(); const file = await write(p);
    for (const role of ['owner', 'admin', 'member'] as const) {
      const session = await human(p, role);
      const res = await call(`/workspaces/${p.wid}/files/${file.id}/comments`, session, 'POST', { body: `${role} real session comment` }, true);
      expect(res.status).toBe(role === 'member' ? 403 : 201);
    }
  });

  it('reindexes through owner/admin auth without changing file versions, bytes or usage', async () => {
    const p = await principal(); const file = await write(p);
    const beforeUsage = await s().getUsage(p.org);
    const beforeVersions = await s().getVersions(file.id);
    vectors.clear();
    const session = await human(p, 'owner');
    const res = await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, session, 'POST', {}, true);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toMatchObject({ status: 'accepted', content_hash: file.content_hash, mutation_id: 'fixture_reindex_receipt' });
    expect(vectors.size).toBe(1);
    expect(await s().getFile(p.wid, file.id)).toEqual(file);
    expect(await s().getVersions(file.id)).toEqual(beforeVersions);
    expect(await s().getUsage(p.org)).toEqual(beforeUsage);
  });

  it('refuses missing identity, ordinary members and foreign workspaces without indexing', async () => {
    const p = await principal(); const file = await write(p); const other = await principal();
    const before = embeddingCalls;
    const session = await human(p, 'member');
    expect((await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, '', 'POST')).status).toBe(401);
    expect((await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, session, 'POST', {}, true)).status).toBe(403);
    expect((await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, other.key, 'POST')).status).toBe(404);
    expect(embeddingCalls).toBe(before);
  });

  it('restores independent indexes for identical legacy copies', async () => {
    const p = await principal(); const file = await write(p);
    const ws = await s().createWorkspace(`${p.wid}_legacy`, 'Legacy', p.agent, p.org);
    const copy = await write({ ...p, wid: ws.id });
    vectors.clear();
    for (const [wid, fid] of [[p.wid, file.id], [ws.id, copy.id]]) {
      expect((await call(`/workspaces/${wid}/files/${fid}/reindex`, p.key, 'POST')).status).toBe(200);
    }
    expect(vectors.size).toBe(2);
    const res = await call('/search', p.key, 'POST', { query: 'confidential' });
    expect(((await res.json()) as any).data.hits).toHaveLength(2);
  });

  it.each(['inference', 'vector'])('does not report success when %s fails', async (provider) => {
    const p = await principal(); const file = await write(p);
    vectors.clear();
    embeddingFailure = provider === 'inference'; upsertFailure = provider === 'vector';
    const res = await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, p.key, 'POST');
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).success).toBe(false);
    expect(vectors.size).toBe(0);
    expect(await s().getFile(p.wid, file.id)).toEqual(file);
  });

  it('reports conflict when canonical file metadata changes during inference', async () => {
    const p = await principal(); const file = await write(p);
    duringEmbedding = async () => {
      await s().writeFile(p.wid, file.path, 'replacement public text', 'agent', p.agent);
    };
    const res = await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, p.key, 'POST');
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).success).toBe(false);
    const search = await call('/search', p.key, 'POST', { query: 'confidential' });
    expect(((await search.json()) as any).data.hits).toEqual([]);
  });

  it('does not send Private Workspace ciphertext to inference during reindex', async () => {
    const p = await principal(); const file = await write(p, 'private.md', 'agentdrive-encrypted:v0:synthetic');
    const before = embeddingCalls;
    const res = await call(`/workspaces/${p.wid}/files/${file.id}/reindex`, p.key, 'POST');
    expect(res.status).toBe(409);
    expect(embeddingCalls).toBe(before);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('launch retrieval lifecycle', () => {
  it.each([
    { endpoint: '/context', body: { task: 'confidential', limit: 10 } },
    { endpoint: '/context', body: { task: 'confidential', limit: 20 } },
    { endpoint: '/search', body: { query: 'confidential', top_k: 13 } },
    { endpoint: '/search', body: { query: 'confidential', top_k: 50 } },
  ])('keeps semantic retrieval within provider limits for $endpoint $body', async ({ endpoint, body }) => {
    const p = await principal(); const file = await write(p);
    const res = await call(endpoint, p.key, 'POST', body);
    expect(res.status).toBe(200);
    const data = ((await res.json()) as any).data;
    const hits = data.artifacts ?? data.hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: file.path, content_hash: file.content_hash, match_kind: 'semantic' });
  });

  it('schedules vector cleanup through the real file DELETE route', async () => {
    const p = await principal(); const file = await write(p);
    expect((await call(`/workspaces/${p.wid}/files/${file.id}`, p.key, 'DELETE')).status).toBe(200);
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  it('excludes deleted content from search and context while index deletion is delayed', async () => {
    const p = await principal(); const file = await write(p);
    await call(`/workspaces/${p.wid}/files/${file.id}`, p.key, 'DELETE');
    expect(vectors.size).toBe(1);
    const search = await call('/search', p.key, 'POST', { query: 'confidential' });
    expect(((await search.json()) as any).data.hits).toEqual([]);
    const context = await call('/context', p.key, 'POST', { task: 'confidential' });
    expect(((await context.json()) as any).data.artifacts).toEqual([]);
  });

  it('rejects the old snippet after an update even if index cleanup lags', async () => {
    const p = await principal(); const file = await write(p);
    expect((await call(`/workspaces/${p.wid}/files/${file.id}`, p.key, 'PUT', { content: 'replacement public text' })).status).toBe(200);
    // Historical index entries use seconds; API output must still use ms.
    for (const vector of vectors.values()) vector.metadata.created_at = Math.floor(Date.now() / 1000);
    const res = await call('/context', p.key, 'POST', { task: 'text' });
    const artifacts = ((await res.json()) as any).data.artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].snippet).toContain('replacement public text');
    expect(artifacts[0].attribution.recency_score).toBeGreaterThan(0.99);
    expect(artifacts[0].created_at).toBeGreaterThan(1_000_000_000_000);
  });

  it('keeps identical content independently indexed across organizations', async () => {
    const first = await principal(); const second = await principal();
    await write(first); await write(second);
    expect(vectors.size).toBe(2);
    for (const p of [first, second]) {
      const res = await call('/search', p.key, 'POST', { query: 'confidential' });
      const hits = ((await res.json()) as any).data.hits;
      expect(hits).toHaveLength(1); expect(hits[0].ws_id).toBe(p.wid);
    }
  });

  it('preserves identical workspace copies when one file is deleted', async () => {
    const p = await principal();
    const other = await s().createWorkspace(`${p.wid}_copy`, 'Other project', p.agent, p.org);
    const first = await write(p);
    await write({ ...p, wid: other.id });
    expect(vectors.size).toBe(2);
    const before = await call('/search', p.key, 'POST', { query: 'confidential' });
    expect(((await before.json()) as any).data.hits).toHaveLength(2);
    const retained = [...vectors.values()].find((v) => v.metadata.ws_id === other.id)!;
    await call(`/workspaces/${p.wid}/files/${first.id}`, p.key, 'DELETE');
    expect(deleteCalls.flat()).not.toContain(retained.id);
    const after = await call('/search', p.key, 'POST', { query: 'confidential' });
    const hits = ((await after.json()) as any).data.hits;
    expect(hits).toHaveLength(1); expect(hits[0].ws_id).toBe(other.id);
  });
});

describe('launch bucket safety', () => {
  it.each(['view', 'edit'] as const)('does not let a foreign-org owner with %s access change workspace storage', async (permission) => {
    const caller = await principal(); const target = await principal();
    const email = 'foreign-owner@example.invalid';
    await s().addOrgMember(caller.org, email, 'owner', 'owner@example.invalid');
    await s().createSession('sess_foreign_owner', email, caller.org);
    await s().assignRole(target.wid, email, permission, target.agent);
    const store = new BucketConfigStore(env.KV);
    const foreignConfig = await store.create({ ...configBody, provider: 's3-hmac', org_id: caller.org, created_by: caller.agent });
    const targetConfig = await store.create({ ...configBody, provider: 's3-hmac', org_id: target.org, created_by: target.agent });
    expect((await call(`/workspaces/${target.wid}/bucket-config`, target.key, 'PUT', { bucket_config_id: targetConfig.id })).status).toBe(200);
    expect((await call(`/workspaces/${target.wid}`, 'sess_foreign_owner', 'GET', undefined, true)).status).toBe(200);
    const before = await s().getWorkspace(target.wid);
    for (const [method, body] of [
      ['PUT', { bucket_config_id: 'default' }],
      ['PUT', { bucket_config_id: foreignConfig.id }],
      ['DELETE', undefined],
    ] as const) {
      expect((await call(`/workspaces/${target.wid}/bucket-config`, 'sess_foreign_owner', method, body, true)).status).toBe(403);
      expect(await s().getWorkspace(target.wid)).toEqual(before);
    }
  });

  it.each(['owner', 'admin', 'member'] as const)('keeps workspace storage management scoped to owning-org %s authority', async (role) => {
    const p = await principal();
    const email = `${role}@example.invalid`;
    await s().addOrgMember(p.org, email, role, 'owner@example.invalid');
    await s().createSession('sess_bucket_manager', email, p.org);
    const cfg = await new BucketConfigStore(env.KV).create({ ...configBody, provider: 's3-hmac', org_id: p.org, created_by: p.agent });
    const before = await s().getWorkspace(p.wid);
    expect((await call(`/workspaces/${p.wid}/bucket-config`, 'sess_bucket_manager', 'PUT', { bucket_config_id: cfg.id }, true)).status).toBe(role === 'member' ? 403 : 200);
    expect((await s().getWorkspace(p.wid))?.bucket_config_id).toBe(role === 'member' ? undefined : cfg.id);
    expect((await call(`/workspaces/${p.wid}/bucket-config`, 'sess_bucket_manager', 'DELETE', undefined, true)).status).toBe(role === 'member' ? 403 : 200);
    expect(await s().getWorkspace(p.wid)).toEqual(before);
  });

  it('exposes unfinished live collaboration as unavailable instead of accepting writes', async () => {
    const p = await principal();
    const res = await call(`/workspaces/${p.wid}/files/f_unused/collaborate`, p.key);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).code).toBe('collaboration_unavailable');
  });

  it('rejects ordinary-member config deletion without changing credentials', async () => {
    const p = await principal();
    const cfg = ((await (await call('/bucket-config', p.key, 'POST', configBody)).json()) as any).data;
    await s().addOrgMember(p.org, 'member@example.com', 'member', 'owner@example.com');
    await s().createSession('sess_launch_member', 'member@example.com', p.org);
    const res = await call(`/bucket-config/${cfg.id}`, 'sess_launch_member', 'DELETE', undefined, true);
    expect(res.status).toBe(403);
    expect(await new BucketConfigStore(env.KV).get(p.org, cfg.id)).not.toBeNull();
  });

  it('refuses BYO creation and assignment on Free while permitting Team', async () => {
    const p = await principal('trial');
    expect((await call('/bucket-config', p.key, 'POST', configBody)).status).toBe(403);
    const cfg = await new BucketConfigStore(env.KV).create({ ...configBody, provider: 's3-hmac', org_id: p.org, created_by: p.agent });
    expect((await call(`/workspaces/${p.wid}/bucket-config`, p.key, 'PUT', { bucket_config_id: cfg.id })).status).toBe(403);
    await s().updateOrg(p.org, { plan: 'team' });
    expect((await call(`/workspaces/${p.wid}/bucket-config`, p.key, 'PUT', { bucket_config_id: cfg.id })).status).toBe(200);
  });

  it('requires detaching an active workspace before retiring its config', async () => {
    const p = await principal();
    const cfg = ((await (await call('/bucket-config', p.key, 'POST', configBody)).json()) as any).data;
    expect((await call(`/workspaces/${p.wid}/bucket-config`, p.key, 'PUT', { bucket_config_id: cfg.id })).status).toBe(200);
    expect((await call(`/bucket-config/${cfg.id}`, p.key, 'DELETE')).status).toBe(409);
    expect(await new BucketConfigStore(env.KV).get(p.org, cfg.id)).not.toBeNull();
    expect((await call(`/workspaces/${p.wid}/bucket-config`, p.key, 'DELETE')).status).toBe(200);
    expect((await call(`/bucket-config/${cfg.id}`, p.key, 'DELETE')).status).toBe(200);
  });

  it('retires a config without stranding old reads or permitting new writes', async () => {
    const p = await principal();
    const store = new BucketConfigStore(env.KV);
    const cfg = await store.create({ ...configBody, provider: 's3-hmac', org_id: p.org, created_by: p.agent });
    const file = await write(p);
    const located = { ...file, provider: 's3-hmac' as const, bucket_config_id: cfg.id, object_key: 'content/example' };
    expect(await store.delete(p.org, cfg.id)).toBe(true);
    expect(await store.get(p.org, cfg.id)).toBeNull();
    await expect(resolveDriverForRead(bindings(), located)).resolves.toMatchObject({ objectKey: 'content/example' });
    const ws = (await s().getWorkspace(p.wid))!;
    await expect(resolveDriverForWrite(bindings(), { ...ws, bucket_config_id: cfg.id }, file.content_hash)).rejects.toThrow(/retired|archived|not found/);
  });

  it('keyword fallback resolves stored S3 credentials and preserves current timestamps', async () => {
    const p = await principal();
    const cfg = await new BucketConfigStore(env.KV).create({ ...configBody, provider: 's3-hmac', org_id: p.org, created_by: p.agent });
    const file = await write(p);
    await env.KV.put(`file:${p.wid}:${file.id}`, JSON.stringify({ ...file, provider: 's3-hmac', bucket_config_id: cfg.id, object_key: 'content/example' }));
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (request: Request) => { urls.push(request.url); return new Response('synthetic confidential phrase'); });
    const hits = await keywordSearch(bindings(), { orgId: p.org, workspaceId: p.wid, query: 'confidential', limit: 5 });
    expect(hits).toHaveLength(1);
    expect(urls[0]).toBe('https://s3.example.invalid/fixture/content/example');
    expect(hits[0].created_at).toBeGreaterThan(1_000_000_000_000);
  });
});
