import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    KV: KVNamespace;
    R2: R2Bucket;
    FILE_COLLAB: DurableObjectNamespace;
    ENVIRONMENT: string;
    APP_URL: string;
    TOKEN_SIGNING_SECRET: string;
  }
}

type RegisterOk = {
  success: true;
  data: { agent_id: string; api_key: string; org_id: string };
};

type SearchOk = {
  success: true;
  data: { hits: Array<{ path: string; score: number }>; total: number };
};

type ErrorBody = { success: false; error: string };

async function clearKv() {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

async function registerAgent(agentName = 'SearchBot'): Promise<RegisterOk['data']> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: agentName }),
  });
  const body = (await res.json()) as RegisterOk;
  return body.data;
}

beforeEach(async () => {
  await clearKv();
});

describe('POST /v1/search — validation + auth', () => {
  it('returns 401 without an Authorization header', async () => {
    const res = await SELF.fetch('http://localhost/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when query is missing', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ workspace_id: 'ws_abc' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
  });

  it('returns 400 when top_k exceeds the max', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ query: 'x', top_k: 500 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when filter.agent_platform is not a known enum value', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ query: 'x', filter: { agent_platform: 'made-up' } }),
    });
    expect(res.status).toBe(400);
  });

  it('applies path and writer filters to keyword matches before taking top_k', async () => {
    const agent = await registerAgent();
    const headers = { 'content-type': 'application/json', Authorization: `Bearer ${agent.api_key}` };
    const post = (path: string, body: unknown, platform = 'codex') => SELF.fetch(`http://localhost/v1/${path}`, {
      method: 'POST', headers: { ...headers, 'X-Agent-Platform': platform }, body: JSON.stringify(body),
    });
    const workspace = await post('workspaces', { name: 'Search' });
    const wid = ((await workspace.json()) as { data: { id: string } }).data.id;
    for (const [path, platform] of [['aa.md', 'codex'], ['docs/one.md', 'cursor'], ['docs/two.md', 'codex']]) {
      expect((await post(`workspaces/${wid}/files`, { path, content: 'example keyword' }, platform)).status).toBe(201);
    }
    const filter = { path_prefix: 'docs/', agent_id: agent.agent_id, agent_platform: 'codex' };
    const query = { query: 'keyword', workspace_id: wid, filter, top_k: 1 };
    const matched = await post('search', query);
    expect(((await matched.json()) as SearchOk).data.hits).toMatchObject([{ path: 'docs/two.md', score: null, agent_platform: 'codex' }]);
    const missing = await post('search', { ...query, filter: { ...filter, agent_id: 'another' } });
    expect(((await missing.json()) as SearchOk).data.hits).toHaveLength(0);
  });

  it('returns path and readable content matches when another stored bucket is unavailable', async () => {
    const agent = await registerAgent();
    const headers = { 'content-type': 'application/json', Authorization: `Bearer ${agent.api_key}` };
    const post = (path: string, body: unknown) => SELF.fetch(`http://localhost/v1/${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const workspace = await post('workspaces', { name: 'Search' });
    const wid = ((await workspace.json()) as { data: { id: string } }).data.id;
    const offline = await post(`workspaces/${wid}/files`, { path: 'roadmap.md', content: 'unavailable content' });
    const fid = ((await offline.json()) as { data: { id: string } }).data.id;
    const key = `file:${wid}:${fid}`;
    const meta = await env.KV.get<Record<string, unknown>>(key, 'json');
    await env.KV.put(key, JSON.stringify({ ...meta, provider: 's3-hmac', bucket_config_id: 'missing' }));
    expect((await post(`workspaces/${wid}/files`, { path: 'notes.md', content: 'readable roadmap' })).status).toBe(201);
    const res = await post('search', { query: 'roadmap' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as SearchOk).data.hits).toMatchObject([
      { path: 'roadmap.md', snippet: 'roadmap.md' }, { path: 'notes.md', snippet: 'readable roadmap' },
    ]);
  });

  it('returns an empty hits array on an org with no embeddings', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ query: 'anything goes here' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchOk;
    expect(body.success).toBe(true);
    expect(body.data.hits).toEqual([]);
    expect(body.data.total).toBe(0);
  });
});
