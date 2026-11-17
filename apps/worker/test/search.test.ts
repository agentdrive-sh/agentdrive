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
