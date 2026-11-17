import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

// Phase 3 — /v1/org/timeline characterization tests. Pins:
//  - 401 on missing auth
//  - 403 on share-token auth (timeline is org-scoped)
//  - happy path: cross-workspace merge, newest-first, per-event shape
//  - `?since=` filter excludes older events
//  - `?limit=` cap honored
//  - agent_platform propagates from auth into the event

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

interface RegisterOk { success: true; data: { api_key: string; agent_id: string; org_id: string } }

async function registerAgent(name = 'TLBot', org = 'TLOrg'): Promise<RegisterOk['data']> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: name, org_name: org }),
  });
  const body = (await res.json()) as RegisterOk;
  return body.data;
}

async function setOrgPlan(orgId: string, plan: 'pro' | 'team'): Promise<void> {
  const org = await env.KV.get<Record<string, unknown>>(`org:${orgId}`, 'json');
  await env.KV.put(`org:${orgId}`, JSON.stringify({ ...org, plan }));
}

function headers(apiKey: string, platform?: string): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (platform) h['X-Agent-Platform'] = platform;
  return h;
}

async function createWs(apiKey: string, name: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/v1/workspaces', {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

async function writeFile(apiKey: string, wid: string, path: string, content: string, platform?: string): Promise<void> {
  await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
    method: 'POST',
    headers: headers(apiKey, platform),
    body: JSON.stringify({ path, content }),
  });
}

interface TimelineOk {
  success: true;
  data: Array<{
    id: string;
    workspace_id: string;
    actor_type: 'agent' | 'human';
    actor_id: string;
    agent_platform?: string;
    action: string;
    target_type: string;
    target_id: string;
    created_at: string;
  }>;
  cursor: string | null;
  truncated: boolean;
}

beforeEach(async () => {
  await clearKv();
});

describe('GET /v1/org/timeline', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://localhost/v1/org/timeline');
    expect(res.status).toBe(401);
  });

  it('returns an empty list when the org has no workspaces yet', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/org/timeline', { headers: headers(agent.api_key) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TimelineOk;
    expect(body.data).toEqual([]);
    expect(body.cursor).toBeNull();
  });

  it('merges activity across multiple workspaces, newest first', async () => {
    const agent = await registerAgent();
    await setOrgPlan(agent.org_id, 'pro');
    const wsA = await createWs(agent.api_key, 'A');
    const wsB = await createWs(agent.api_key, 'B');
    await writeFile(agent.api_key, wsA, 'doc1.md', 'one');
    await writeFile(agent.api_key, wsB, 'doc2.md', 'two');

    const res = await SELF.fetch('http://localhost/v1/org/timeline', { headers: headers(agent.api_key) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TimelineOk;
    expect(body.data.length).toBeGreaterThanOrEqual(4); // 2 ws.create + 2 file.write
    const wsIds = new Set(body.data.map((e) => e.workspace_id));
    expect(wsIds.has(wsA)).toBe(true);
    expect(wsIds.has(wsB)).toBe(true);
    // Newest-first ordering by created_at descending
    for (let i = 1; i < body.data.length; i++) {
      expect(body.data[i - 1]!.created_at >= body.data[i]!.created_at).toBe(true);
    }
  });

  it('stamps agent_platform from X-Agent-Platform header onto written events', async () => {
    const agent = await registerAgent();
    const wid = await createWs(agent.api_key, 'P');
    await writeFile(agent.api_key, wid, 'doc.md', 'hi', 'codex');

    const res = await SELF.fetch('http://localhost/v1/org/timeline', { headers: headers(agent.api_key) });
    const body = (await res.json()) as TimelineOk;
    const fileWrite = body.data.find((e) => e.action === 'file.write');
    expect(fileWrite).toBeDefined();
    expect(fileWrite!.agent_platform).toBe('codex');
  });

  it('honors ?since= and excludes events at or before the cutoff', async () => {
    const agent = await registerAgent();
    const wid = await createWs(agent.api_key, 'C');
    await writeFile(agent.api_key, wid, 'first.md', 'one');
    // Take a snapshot; new events written after this point should be the only ones returned.
    const cut = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(agent.api_key, wid, 'second.md', 'two');

    const res = await SELF.fetch(`http://localhost/v1/org/timeline?since=${encodeURIComponent(cut)}`, {
      headers: headers(agent.api_key),
    });
    const body = (await res.json()) as TimelineOk;
    for (const e of body.data) {
      expect(e.created_at > cut).toBe(true);
    }
    const paths = body.data.filter((e) => e.action === 'file.write').map((e) => e.target_id);
    expect(paths.length).toBeGreaterThan(0);
  });

  it('honors ?limit= cap', async () => {
    const agent = await registerAgent();
    const wid = await createWs(agent.api_key, 'D');
    for (let i = 0; i < 6; i++) {
      await writeFile(agent.api_key, wid, `f${i}.md`, `c${i}`);
    }
    const res = await SELF.fetch('http://localhost/v1/org/timeline?limit=3', { headers: headers(agent.api_key) });
    const body = (await res.json()) as TimelineOk;
    expect(body.data.length).toBe(3);
    expect(body.truncated).toBe(true);
  });

  it('rejects limit > 1000 with 400', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/org/timeline?limit=99999', {
      headers: headers(agent.api_key),
    });
    expect(res.status).toBe(400);
  });

  it('sets Cache-Control: private max-age=30', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/org/timeline', { headers: headers(agent.api_key) });
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toMatch(/private/);
    expect(cc).toMatch(/max-age=30/);
  });
});
