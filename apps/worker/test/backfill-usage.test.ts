import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { computeUsage, restKv, type KvReader } from '../scripts/backfill-usage';

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

beforeEach(clearKv);

const kv: KvReader = {
  async list(prefix) {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.KV.list({ prefix, cursor });
      names.push(...page.keys.map((k) => k.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return names;
  },
  get: (key) => env.KV.get(key),
};

function api(apiKey: string, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return SELF.fetch(`http://localhost/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('backfill computeUsage', () => {
  it('recomputes the same storage, embeddings and agents that live metering counted', async () => {
    const reg = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'Backfill', org_name: 'BackfillOrg' }),
    });
    const { api_key, org_id } = ((await reg.json()) as { data: { api_key: string; org_id: string } }).data;
    const ws = ((await (await api(api_key, '/workspaces', 'POST', { name: 'B' })).json()) as { data: { id: string } }).data.id;

    await api(api_key, `/workspaces/${ws}/files`, 'POST', { path: 'a.md', content: 'first' });
    await api(api_key, `/workspaces/${ws}/files`, 'POST', { path: 'a.md', content: 'y'.repeat(5000) });
    const gone = ((await (await api(api_key, `/workspaces/${ws}/files`, 'POST', { path: 'b.md', content: 'temp' })).json()) as { data: { id: string } }).data.id;
    await api(api_key, `/workspaces/${ws}/files/${gone}`, 'DELETE');
    await api(api_key, `/workspaces/${ws}/files`, 'POST', { path: 'c.md', content: 'z'.repeat(20_000) });
    const key = ((await (await api(api_key, '/keys', 'POST', { name: 'spare' })).json()) as { data: { key_id: string } }).data;
    await api(api_key, '/keys', 'POST', { name: 'kept' });
    await api(api_key, `/keys/${key.key_id}`, 'DELETE');

    const live = (await env.KV.get<Record<string, number>>(`usage:${org_id}`, 'json'))!;
    const computed = await computeUsage(kv);
    expect(computed.get(org_id)).toEqual({
      storage_bytes: live.storage_bytes,
      embedding_count: live.embedding_count,
      agent_count: live.agent_count,
    });
    expect(live).toMatchObject({ storage_bytes: 5 + 5000 + 20_000, agent_count: 2 });
  });

  it('reports an org with nothing stored as zero', async () => {
    await env.KV.put('org:org_empty', JSON.stringify({ id: 'org_empty', plan: 'trial' }));
    expect((await computeUsage(kv)).get('org_empty')).toEqual({ storage_bytes: 0, embedding_count: 0, agent_count: 0 });
  });
});

describe('backfill restKv', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows list cursors, reads a missing key as null, and writes only the key it is given', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
      if (url.includes('/keys?')) {
        const second = url.includes('cursor=c1');
        return Response.json({ success: true, result: [{ name: second ? 'org:b' : 'org:a' }], result_info: { cursor: second ? '' : 'c1' } });
      }
      if (url.endsWith('/values/usage%3Aorg_a') && (init.method ?? 'GET') === 'GET') return new Response('{"agent_count":1}');
      if (init.method === 'PUT') return new Response('{"success":true}');
      return new Response('not found', { status: 404 });
    });
    const kv = restKv('acct', 'tok', 'ns');
    expect(await kv.list('org:')).toEqual(['org:a', 'org:b']);
    expect(await kv.get('usage:org_a')).toBe('{"agent_count":1}');
    expect(await kv.get('usage:missing')).toBeNull();
    await kv.put('usage:org_a', '{}');
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', url: 'https://api.cloudflare.com/client/v4/accounts/acct/storage/kv/namespaces/ns/values/usage%3Aorg_a', body: '{}' });
  });
});
