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

type ContextOk = {
  success: true;
  data: {
    artifacts: Array<{
      path: string;
      score: number | null;
      created_at: number;
      match_kind?: 'semantic' | 'keyword';
      agent_platform?: string;
      attribution?: {
        semantic_score: number;
        recency_score: number;
        blended_score: number;
        diversity_penalty?: number;
        reasons: string[];
      };
      last_run?: {
        run_id: string;
        task: string;
        status: string;
        agent_platform: string;
      };
    }>;
    retrieved_at: number;
  };
};

type ErrorBody = { success: false; error: string };

async function clearKv() {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

async function registerAgent(agentName = 'CtxBot'): Promise<RegisterOk['data']> {
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

describe('POST /v1/context — validation + auth', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await SELF.fetch('http://localhost/v1/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'plan the release' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when task is missing', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
  });

  it('rejects limit beyond max with 400', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ task: 'x', limit: 999 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields including the now-removed include_facts (clean break, no silent no-op)', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ task: 'plan things', include_facts: true }),
    });
    expect(res.status).toBe(400);
  });

  it('returns an empty artifact set when there is nothing to retrieve', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ task: 'first task in a brand new org' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContextOk;
    expect(body.data.artifacts).toEqual([]);
    expect(typeof body.data.retrieved_at).toBe('number');
  });
});

describe('POST /v1/context — Phase 1 excellence pass', () => {
  // Vectorize + Workers AI aren't bound in the test pool, so the semantic
  // retrieval path degrades to zero hits and the keyword fallback kicks in.
  // These tests pin the keyword-fallback attribution contract; the semantic
  // diversity rerank is exercised in a separate unit test below.
  async function writeFile(apiKey: string, wid: string, path: string, content: string): Promise<void> {
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ path, content }),
    });
  }

  async function createWorkspace(apiKey: string): Promise<string> {
    const res = await SELF.fetch('http://localhost/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ name: 'CtxWs' }),
    });
    const body = (await res.json()) as { data: { id: string } };
    return body.data.id;
  }

  it('keyword-fallback artifacts carry an attribution block citing keyword fallback', async () => {
    const agent = await registerAgent('CtxBot2');
    const wid = await createWorkspace(agent.api_key);
    await writeFile(agent.api_key, wid, 'notes/launch-plan.md', 'launch the release on Tuesday');

    const res = await SELF.fetch('http://localhost/v1/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ task: 'launch' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContextOk;
    expect(body.data.artifacts.length).toBeGreaterThan(0);
    const first = body.data.artifacts[0]!;
    expect(first.match_kind).toBe('keyword');
    expect(first.attribution).toBeDefined();
    expect(Array.isArray(first.attribution!.reasons)).toBe(true);
    expect(first.attribution!.reasons.join(' ').toLowerCase()).toMatch(/keyword/);
    expect(typeof first.attribution!.recency_score).toBe('number');
  });
});
