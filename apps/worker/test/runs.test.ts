import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { deliveredCode } from './magic-code-helper';

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

type RunCreateOk = {
  success: true;
  data: { run_id: string; created_at: number };
};

type RunListOk = {
  success: true;
  data: Array<{ run_id: string; agent_id: string; task: string; agent_platform: string }>;
  cursor: string | null;
};

type ErrorBody = { success: false; error: string };

async function clearKv() {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

async function registerAgent(agentName = 'RunsBot'): Promise<RegisterOk['data']> {
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

describe('POST /v1/runs', () => {
  it('logs a run and returns run_id + created_at (201)', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
        'X-Agent-Platform': 'claude-code',
        'X-Agent-Role': 'planner',
      },
      body: JSON.stringify({
        task: 'refactor the auth middleware',
        status: 'success',
        artifacts_referenced: ['docs/auth.md'],
        artifacts_produced: ['src/middleware/auth.ts'],
        duration_ms: 12345,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as RunCreateOk;
    expect(body.success).toBe(true);
    expect(body.data.run_id).toMatch(/^run_/);
    expect(typeof body.data.created_at).toBe('number');
  });

  it('returns 400 when task is missing', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ status: 'success' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
  });

  it('returns 400 for an invalid status', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({ task: 'do thing', status: 'totally_made_up' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 when no auth header is supplied', async () => {
    const res = await SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 't', status: 'success' }),
    });
    expect(res.status).toBe(401);
  });

  it('stamps agent_platform / agent_role from headers onto the persisted run', async () => {
    const agent = await registerAgent();
    const post = await SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
        'X-Agent-Platform': 'codex',
        'X-Agent-Role': 'reviewer',
      },
      body: JSON.stringify({ task: 'review pr', status: 'success' }),
    });
    expect(post.status).toBe(201);

    const list = await SELF.fetch('http://localhost/v1/runs', {
      headers: { Authorization: `Bearer ${agent.api_key}` },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as RunListOk;
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0].agent_platform).toBe('codex');
  });

  it('coerces an invalid X-Agent-Platform value to "unknown"', async () => {
    const agent = await registerAgent();
    await SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
        'X-Agent-Platform': 'not-a-real-platform',
      },
      body: JSON.stringify({ task: 't', status: 'success' }),
    });
    const list = await SELF.fetch('http://localhost/v1/runs', {
      headers: { Authorization: `Bearer ${agent.api_key}` },
    });
    const body = (await list.json()) as RunListOk;
    expect(body.data[0].agent_platform).toBe('unknown');
  });
});

describe('POST /v1/runs — workspace ownership', () => {
  async function createWorkspace(apiKey: string): Promise<string> {
    const res = await SELF.fetch('http://localhost/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ name: 'ws' }),
    });
    return ((await res.json()) as { data: { id: string } }).data.id;
  }

  async function logRun(apiKey: string, workspaceId: string) {
    return SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ task: 't', status: 'success', workspace_id: workspaceId }),
    });
  }

  it('accepts its own workspace and rejects another org\'s or a missing one', async () => {
    const a1 = await registerAgent('wsOwnerA');
    const a2 = await registerAgent('wsOwnerB');
    const ws1 = await createWorkspace(a1.api_key);
    expect((await logRun(a1.api_key, ws1)).status).toBe(201);
    expect((await logRun(a2.api_key, ws1)).status).toBe(404);
    expect((await logRun(a2.api_key, 'ws_does_not_exist')).status).toBe(404);
  });
});

describe('POST /v1/runs — tool_calls', () => {
  it('persists tool_calls and returns them via GET /v1/runs/:rid', async () => {
    const agent = await registerAgent();
    const create = await SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent.api_key}`,
      },
      body: JSON.stringify({
        task: 'implement search dedupe',
        status: 'success',
        tool_calls: [
          { tool: 'drive_search', status: 'success', time_offset_ms: 0, duration_ms: 80, args_summary: 'q=auth' },
          { tool: 'drive_write', status: 'success', time_offset_ms: 200, duration_ms: 40 },
        ],
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as RunCreateOk;

    const get = await SELF.fetch(`http://localhost/v1/runs/${created.data.run_id}`, {
      headers: { Authorization: `Bearer ${agent.api_key}` },
    });
    expect(get.status).toBe(200);
    const body = (await get.json()) as { success: true; data: { tool_calls: Array<{ tool: string }> } };
    expect(body.data.tool_calls).toHaveLength(2);
    expect(body.data.tool_calls[0].tool).toBe('drive_search');
  });

  it('truncates args_summary / result_summary to 500 chars and caps tool_calls at 100', async () => {
    const agent = await registerAgent();
    const huge = 'x'.repeat(2000);
    const tcs = Array.from({ length: 150 }, (_, i) => ({
      tool: 'drive_search',
      status: 'success' as const,
      time_offset_ms: i * 10,
      args_summary: huge,
      result_summary: huge,
    }));
    const create = await SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.api_key}` },
      body: JSON.stringify({ task: 't', status: 'success', tool_calls: tcs }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as RunCreateOk;
    const get = await SELF.fetch(`http://localhost/v1/runs/${created.data.run_id}`, {
      headers: { Authorization: `Bearer ${agent.api_key}` },
    });
    const body = (await get.json()) as { success: true; data: { tool_calls: Array<{ args_summary: string; result_summary: string }> } };
    expect(body.data.tool_calls.length).toBe(100);
    expect(body.data.tool_calls[0].args_summary.length).toBe(500);
    expect(body.data.tool_calls[0].result_summary.length).toBe(500);
  });
});

describe('GET /v1/runs/:rid', () => {
  it('returns 404 for a missing run', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/runs/run_nope', {
      headers: { Authorization: `Bearer ${agent.api_key}` },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 (not 403) when run belongs to another org', async () => {
    const a1 = await registerAgent('orgOne');
    const a2 = await registerAgent('orgTwo');
    const create = await SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a1.api_key}` },
      body: JSON.stringify({ task: 't', status: 'success' }),
    });
    const created = (await create.json()) as RunCreateOk;
    const res = await SELF.fetch(`http://localhost/v1/runs/${created.data.run_id}`, {
      headers: { Authorization: `Bearer ${a2.api_key}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /v1/runs', () => {
  it('returns runs for the authenticated agent (paginated shape)', async () => {
    const agent = await registerAgent();
    for (let i = 0; i < 3; i++) {
      await SELF.fetch('http://localhost/v1/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agent.api_key}`,
        },
        body: JSON.stringify({ task: `t${i}`, status: 'success' }),
      });
    }
    const res = await SELF.fetch('http://localhost/v1/runs', {
      headers: { Authorization: `Bearer ${agent.api_key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunListOk;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(3);
    expect(body.cursor === null || typeof body.cursor === 'string').toBe(true);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await SELF.fetch('http://localhost/v1/runs');
    expect(res.status).toBe(401);
  });

  it("lists every agent's runs in the org for a signed-in member, and nothing from other orgs", async () => {
    const email = 'owner@runs.test';
    const code = await deliveredCode(email);
    const json = { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.9.0.1' };
    const verify = await SELF.fetch('http://localhost/v1/auth/verify-code', { method: 'POST', headers: json, body: JSON.stringify({ email, code }) });
    const session = { 'X-Session-Token': ((await verify.json()) as { data: { session_id: string } }).data.session_id };

    const keys: string[] = [];
    for (const name of ['laptop', 'desktop']) {
      const res = await SELF.fetch('http://localhost/v1/keys', { method: 'POST', headers: { ...json, ...session }, body: JSON.stringify({ name }) });
      keys.push(((await res.json()) as { data: { api_key: string } }).data.api_key);
    }
    const outsider = await registerAgent('Outsider');
    for (const [task, key] of [['from laptop', keys[0]], ['from desktop', keys[1]], ['other org', outsider.api_key]] as const) {
      await SELF.fetch('http://localhost/v1/runs', { method: 'POST', headers: { ...json, Authorization: `Bearer ${key}` }, body: JSON.stringify({ task, status: 'success' }) });
    }

    const res = await SELF.fetch('http://localhost/v1/runs', { headers: session });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunListOk;
    expect(body.data.map((r) => r.task).sort()).toEqual(['from desktop', 'from laptop']);

    const own = await SELF.fetch('http://localhost/v1/runs?agent_id=', { headers: { Authorization: `Bearer ${keys[0]}` } });
    expect(((await own.json()) as RunListOk).data.map((r) => r.task)).toEqual(['from laptop']);
  });
});

describe('session upsert + project index', () => {
  type FullRun = {
    run_id: string;
    org_id: string;
    task: string;
    agent_platform: string;
    created_at: number;
    updated_at?: number;
    metadata: Record<string, unknown>;
  };

  async function postRun(apiKey: string, body: Record<string, unknown>, platform = 'claude-code') {
    return SELF.fetch('http://localhost/v1/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Agent-Platform': platform,
      },
      body: JSON.stringify({ status: 'in_progress', ...body }),
    });
  }

  async function listProject(apiKey: string, query: string) {
    const res = await SELF.fetch(`http://localhost/v1/runs?${query}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { status: res.status, body: (await res.json()) as { success: boolean; data: FullRun[]; cursor: string | null } };
  }

  async function keysWithPrefix(prefix: string) {
    return (await env.KV.list({ prefix })).keys.map((k) => k.name);
  }

  it('upserts by run_id: replaces the record, keeps created_at, one index entry each', async () => {
    const agent = await registerAgent();
    const first = await postRun(agent.api_key, { run_id: 'claude-code:s1', task: 'first', metadata: { project: 'github.com__o__r' } });
    expect(first.status).toBe(201);
    const created = (await first.json()) as RunCreateOk;
    await new Promise((r) => setTimeout(r, 5));
    const second = await postRun(agent.api_key, { run_id: 'claude-code:s1', task: 'second', metadata: { project: 'github.com__o__r' } });
    expect(second.status).toBe(200);

    const get = await SELF.fetch('http://localhost/v1/runs/claude-code%3As1', {
      headers: { Authorization: `Bearer ${agent.api_key}` },
    });
    const run = ((await get.json()) as { data: FullRun }).data;
    expect(run.task).toBe('second');
    expect(run.created_at).toBe(created.data.created_at);
    expect(run.updated_at).toBeGreaterThan(run.created_at);

    expect(await keysWithPrefix(`idx:project_runs:${agent.org_id}:github.com__o__r:`)).toHaveLength(1);
    expect(await keysWithPrefix(`idx:agent_runs:${agent.agent_id}:`)).toHaveLength(1);
  });

  it('moves the project index entry when the project changes', async () => {
    const agent = await registerAgent();
    await postRun(agent.api_key, { run_id: 'codex:s2', task: 't', metadata: { project: 'p-one' } });
    await postRun(agent.api_key, { run_id: 'codex:s2', task: 't', metadata: { project: 'p-two' } });
    expect(await keysWithPrefix(`idx:project_runs:${agent.org_id}:p-one:`)).toHaveLength(0);
    expect(await keysWithPrefix(`idx:project_runs:${agent.org_id}:p-two:`)).toHaveLength(1);
  });

  it('rejects an invalid run_id or metadata.project with 400', async () => {
    const agent = await registerAgent();
    for (const body of [
      { run_id: 'Bad Id', task: 't' },
      { run_id: 'claude-code:has spaces', task: 't' },
      { run_id: 'claude-code:x', task: 't', metadata: { project: 'Upper/Case' } },
      { task: 't', metadata: { project: 42 } },
    ]) {
      const res = await postRun(agent.api_key, body);
      expect(res.status).toBe(400);
    }
  });

  it('still accepts the server-generated run id form for updates', async () => {
    const agent = await registerAgent();
    const created = (await (await postRun(agent.api_key, { task: 'a' })).json()) as RunCreateOk;
    const res = await postRun(agent.api_key, { run_id: created.data.run_id, task: 'b' });
    expect(res.status).toBe(200);
  });

  it('lists a project newest-first with a platform filter', async () => {
    const agent = await registerAgent();
    await postRun(agent.api_key, { run_id: 'claude-code:a', task: 'a', metadata: { project: 'proj' } }, 'claude-code');
    await new Promise((r) => setTimeout(r, 5));
    await postRun(agent.api_key, { run_id: 'codex:b', task: 'b', metadata: { project: 'proj' } }, 'codex');
    await new Promise((r) => setTimeout(r, 5));
    await postRun(agent.api_key, { run_id: 'claude-code:a', task: 'a2', metadata: { project: 'proj' } }, 'claude-code');
    await postRun(agent.api_key, { run_id: 'codex:other', task: 'x', metadata: { project: 'other' } }, 'codex');

    const all = await listProject(agent.api_key, 'project=proj');
    expect(all.status).toBe(200);
    expect(all.body.data.map((r) => r.run_id)).toEqual(['claude-code:a', 'codex:b']);

    const codexOnly = await listProject(agent.api_key, 'project=proj&platform=codex');
    expect(codexOnly.body.data.map((r) => r.run_id)).toEqual(['codex:b']);

    const paged = await listProject(agent.api_key, 'project=proj&limit=1');
    expect(paged.body.data).toHaveLength(1);
    expect(typeof paged.body.cursor).toBe('string');
  });

  it('orders a project by reported last activity, not write time, and moves the key on update', async () => {
    const agent = await registerAgent();
    const t = Date.now() - 3_600_000;
    await postRun(agent.api_key, { run_id: 'codex:new', task: 'n', metadata: { project: 'proj', last_activity_at: t + 600_000 } }, 'codex');
    await postRun(agent.api_key, { run_id: 'claude-code:old', task: 'o', metadata: { project: 'proj', last_activity_at: t } });
    expect((await listProject(agent.api_key, 'project=proj')).body.data.map((r) => r.run_id)).toEqual(['codex:new', 'claude-code:old']);

    await postRun(agent.api_key, { run_id: 'claude-code:old', task: 'o', metadata: { project: 'proj', last_activity_at: t + 900_000 } });
    expect((await listProject(agent.api_key, 'project=proj')).body.data.map((r) => r.run_id)).toEqual(['claude-code:old', 'codex:new']);
    expect(await keysWithPrefix(`idx:project_runs:${agent.org_id}:proj:`)).toHaveLength(2);
  });

  it('clamps a future last_activity_at and rejects a non-integer one', async () => {
    const agent = await registerAgent();
    await postRun(agent.api_key, { run_id: 'codex:f', task: 'f', metadata: { project: 'proj', last_activity_at: Date.now() + 86_400_000 } });
    const run = (await listProject(agent.api_key, 'project=proj')).body.data[0]!;
    expect(run.metadata.last_activity_at as number).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    for (const bad of ['soon', 1.5, -1]) {
      expect((await postRun(agent.api_key, { task: 't', metadata: { last_activity_at: bad } })).status).toBe(400);
    }
  });

  it('keeps reading project pages until the platform filter fills the limit', async () => {
    const agent = await registerAgent();
    const t = Date.now() - 3_600_000;
    await postRun(agent.api_key, { run_id: 'codex:oldest', task: 'c', metadata: { project: 'proj', last_activity_at: t } }, 'codex');
    for (let i = 1; i <= 3; i++) {
      await postRun(agent.api_key, { run_id: `claude-code:n${i}`, task: 'n', metadata: { project: 'proj', last_activity_at: t + i * 1000 } });
    }
    const codex = await listProject(agent.api_key, 'project=proj&platform=codex&limit=1');
    expect(codex.body.data.map((r) => r.run_id)).toEqual(['codex:oldest']);

    const none = await listProject(agent.api_key, 'project=proj&platform=gemini-cli&limit=1');
    expect(none.body.data).toEqual([]);
    expect(none.body.cursor).toBeNull();
  });

  it('never returns more than limit when the platform filter spans several pages', async () => {
    const agent = await registerAgent();
    const t = Date.now() - 3_600_000;
    for (let i = 0; i < 6; i++) {
      const platform = i % 2 === 0 ? 'codex' : 'claude-code';
      await postRun(agent.api_key, { run_id: `${platform}:m${i}`, task: 'm', metadata: { project: 'proj', last_activity_at: t + i * 1000 } }, platform);
    }
    const page = await listProject(agent.api_key, 'project=proj&platform=codex&limit=2');
    expect(page.body.data.map((r) => r.run_id)).toEqual(['codex:m4', 'codex:m2']);
    const rest = await listProject(agent.api_key, `project=proj&platform=codex&limit=2&cursor=${page.body.cursor}`);
    expect(rest.body.data.map((r) => r.run_id)).toEqual(['codex:m0']);
  });

  it('lists runs older than 14 days on Free in project, agent and file run lists', async () => {
    const agent = await registerAgent();
    const h = { Authorization: `Bearer ${agent.api_key}`, 'Content-Type': 'application/json' };
    const post = async (path: string, body: unknown) =>
      ((await (await SELF.fetch(`http://localhost/v1${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) })).json()) as { data: { id: string } }).data.id;
    const ws = await post('/workspaces', { name: 'W' });
    const fid = await post(`/workspaces/${ws}/files`, { path: 'notes.md', content: 'x' });
    const day = 86_400_000;
    for (const [id, age] of [['codex:old', 30 * day], ['codex:new', day]] as const) {
      const run = { run_id: id, task: id, workspace_id: ws, artifacts_produced: [fid], metadata: { project: 'proj', last_activity_at: Date.now() - age } };
      expect((await postRun(agent.api_key, run, 'codex')).ok).toBe(true);
    }

    expect((await listProject(agent.api_key, 'project=proj')).body.data.map((r) => r.run_id)).toEqual(['codex:new', 'codex:old']);
    expect((await listProject(agent.api_key, '')).body.data.map((r) => r.run_id).sort()).toEqual(['codex:new', 'codex:old']);
    const fileRuns = (await (await SELF.fetch(`http://localhost/v1/workspaces/${ws}/files/${fid}/runs`, { headers: h })).json()) as { data: FullRun[] };
    expect(fileRuns.data.map((r) => r.run_id).sort()).toEqual(['codex:new', 'codex:old']);
  });

  it('rejects an invalid project query with 400', async () => {
    const agent = await registerAgent();
    expect((await listProject(agent.api_key, 'project=Bad%20Project')).status).toBe(400);
    expect((await listProject(agent.api_key, 'project=ok&platform=nope')).status).toBe(400);
  });

  it('isolates the same run_id across orgs', async () => {
    const a1 = await registerAgent('orgA');
    const a2 = await registerAgent('orgB');
    await postRun(a1.api_key, { run_id: 'claude-code:shared', task: 'org one', metadata: { project: 'proj' } });
    const second = await postRun(a2.api_key, { run_id: 'claude-code:shared', task: 'org two', metadata: { project: 'proj' } });
    expect(second.status).toBe(201);

    const one = await listProject(a1.api_key, 'project=proj');
    const two = await listProject(a2.api_key, 'project=proj');
    expect(one.body.data.map((r) => r.task)).toEqual(['org one']);
    expect(two.body.data.map((r) => r.task)).toEqual(['org two']);
    expect(one.body.data[0].org_id).toBe(a1.org_id);
  });
});
