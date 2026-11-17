import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';

// Phase 4 / T-E3 — sequential commit order regression test.
//
// The CEO plan locks the order: bucket write → file:* metadata → idx:ws_files
// pointer. NEVER Promise.all that chain — parallelizing it yields a race
// where path-based reads see the pointer before the canonical record
// exists, returning 404 for a just-written file.
//
// These tests guard the property at two layers:
//   1. End-to-end: a write followed immediately by a path-based read must
//      always resolve to the freshly-written file. Codifies "the user does
//      not observe the race."
//   2. KV-key order: after a new write completes, the canonical file:*
//      key exists and the idx:ws_files key exists. (Direct in-order
//      capture requires intercepting the KV runtime; the e2e + the unit
//      tests in storage-locator.test.ts cover the observable contract.)

interface RegisterOk { success: true; data: { api_key: string; agent_id: string; org_id: string } }

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

async function registerAgent(): Promise<RegisterOk['data']> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: 'CommitOrderBot' }),
  });
  return ((await res.json()) as RegisterOk).data;
}

function authHeader(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function createWs(key: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/v1/workspaces', {
    method: 'POST',
    headers: authHeader(key),
    body: JSON.stringify({ name: 'order-ws' }),
  });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

describe('T-E3: sequential commit order — bucket → file:* → idx:ws_files', () => {
  it('a new-file write is immediately resolvable by ID', async () => {
    await clearKv();
    const agent = await registerAgent();
    const wid = await createWs(agent.api_key);

    const writeRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ path: 'order/by-id.md', content: 'one' }),
    });
    const wrote = (await writeRes.json()) as { data: { id: string } };

    const readRes = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${wrote.data.id}`,
      { headers: authHeader(agent.api_key) },
    );
    expect(readRes.status).toBe(200);
  });

  it('a new-file write is immediately resolvable in the list endpoint by path prefix', async () => {
    await clearKv();
    const agent = await registerAgent();
    const wid = await createWs(agent.api_key);

    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ path: 'order/by-prefix.md', content: 'two' }),
    });

    const listRes = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files?prefix=order/`,
      { headers: authHeader(agent.api_key) },
    );
    const body = (await listRes.json()) as { data: Array<{ path: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.path).toBe('order/by-prefix.md');
  });

  it('canonical file:* record and idx:ws_files index BOTH exist after a new write', async () => {
    await clearKv();
    const agent = await registerAgent();
    const wid = await createWs(agent.api_key);

    const writeRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ path: 'order/canonical.md', content: 'three' }),
    });
    const wrote = (await writeRes.json()) as { data: { id: string; path: string } };

    const fileMeta = await env.KV.get(`file:${wid}:${wrote.data.id}`);
    const indexEntry = await env.KV.get(`idx:ws_files:${wid}:${wrote.data.path}`);
    expect(fileMeta).not.toBeNull();
    expect(indexEntry).toBe(wrote.data.id);
  });

  it('an update keeps file:* metadata in sync with the new content_hash', async () => {
    await clearKv();
    const agent = await registerAgent();
    const wid = await createWs(agent.api_key);

    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ path: 'order/edit.md', content: 'first' }),
    });
    const updateRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: authHeader(agent.api_key),
      body: JSON.stringify({ path: 'order/edit.md', content: 'second' }),
    });
    const updated = (await updateRes.json()) as { data: { id: string; content_hash: string } };

    const readRes = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${updated.data.id}?content=true`,
      { headers: authHeader(agent.api_key) },
    );
    const body = (await readRes.json()) as { data: { content: string; content_hash: string } };
    expect(body.data.content).toBe('second');
    expect(body.data.content_hash).toBe(updated.data.content_hash);
  });
});
