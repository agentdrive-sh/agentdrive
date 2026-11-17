import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { PLAN_QUOTAS } from '@agentdrive/shared';
import { orgQuota, usageStatus } from '../src/services/limits';
import { chunkCountFor, chunkText } from '../src/services/embeddings';
import { StorageService } from '../src/services/storage';

const SITE = 'http://localhost:3001';
const GB = 1024 ** 3;
const EMPTY = { storage_bytes: 0, embedding_count: 0, agent_count: 0, workspace_count: 0, member_count: 0 };

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

beforeEach(clearKv);

describe('usageStatus', () => {
  const storageAt = (ratio: number) => usageStatus('trial', { ...EMPTY, storage_bytes: Math.ceil(GB * ratio) }, SITE);

  it('maps each threshold to its level', () => {
    expect(storageAt(0.79).level).toBe('ok');
    expect(storageAt(0.8).level).toBe('warn80');
    expect(storageAt(0.9).level).toBe('warn90');
    expect(storageAt(0.99).level).toBe('warn99');
    // Storage and embeddings never pause: past the limit they keep warning.
    expect(storageAt(1).level).toBe('warn99');
    expect(storageAt(1.2).level).toBe('warn99');
  });

  it('reports used, limit and percent per metric', () => {
    const s = storageAt(0.92);
    expect(s.metrics.storage_bytes).toEqual({ used: Math.ceil(GB * 0.92), limit: GB, pct: 92, level: 'warn90' });
    expect(s.metrics.embedding_count).toEqual({ used: 0, limit: 10_000, pct: 0, level: 'ok' });
  });

  it('has no message below 80%', () => {
    expect(storageAt(0.79).message).toBeUndefined();
  });

  it('words a warning with plan name, human units and the upgrade link', () => {
    expect(storageAt(0.92).message).toBe(
      `AgentDrive: your Free plan has used 92% of its storage (0.92 of 1 GB). Upgrade to Pro: ${SITE}/billing/upgrade?plan=pro`,
    );
    const emb = usageStatus('trial', { ...EMPTY, embedding_count: 9_200 }, SITE);
    expect(emb.message).toBe(
      `AgentDrive: your Free plan has used 92% of its embeddings (9.2K of 10K). Upgrade to Pro: ${SITE}/billing/upgrade?plan=pro`,
    );
  });

  it('words a full consumable as a warning with the real percent, not a pause', () => {
    expect(storageAt(1.2).message).toBe(
      `AgentDrive: your Free plan has used 120% of its storage (1.2 of 1 GB). Upgrade to Pro: ${SITE}/billing/upgrade?plan=pro`,
    );
  });

  it('picks the next tier: trial and starter to pro, pro to team, team to enterprise', () => {
    expect(usageStatus('trial', EMPTY, SITE)).toMatchObject({ next_plan: 'pro', upgrade_url: `${SITE}/billing/upgrade?plan=pro` });
    expect(usageStatus('starter', EMPTY, SITE)).toMatchObject({ next_plan: 'pro', upgrade_url: `${SITE}/billing/upgrade?plan=pro` });
    expect(usageStatus('pro', EMPTY, SITE)).toMatchObject({ next_plan: 'team', upgrade_url: `${SITE}/billing/upgrade?plan=team` });
    expect(usageStatus('team', EMPTY, SITE)).toMatchObject({
      next_plan: 'enterprise',
      upgrade_url: 'mailto:hello@agentdrive.sh?subject=AgentDrive%20Enterprise',
    });
    const team = usageStatus('team', { ...EMPTY, storage_bytes: PLAN_QUOTAS.team.storage_bytes * 0.85 }, SITE);
    expect(team.message).toMatch(/Upgrade to Enterprise: mailto:hello@agentdrive\.sh/);
  });

  // A solo Free account always sits at 1 of 1 workspace and seat; that is not a pause.
  it('keeps the overall level to storage and embeddings', () => {
    const s = usageStatus('trial', { ...EMPTY, workspace_count: 1, member_count: 1, agent_count: 3 }, SITE);
    expect(s.metrics.workspace_count.level).toBe('paused');
    expect(s.level).toBe('ok');
  });

  it('takes the worse of storage and embeddings', () => {
    const s = usageStatus('trial', { ...EMPTY, storage_bytes: GB * 0.85, embedding_count: 10_000 }, SITE);
    expect(s.level).toBe('warn99');
    expect(s.message).toMatch(/used 100% of its embeddings \(10K of 10K\)/);
  });
});

describe('orgQuota', () => {
  it('caps team seats at the purchased count, falling back to the 3-seat minimum', () => {
    expect(orgQuota({ plan: 'team', seats: 12 }).max_human_seats).toBe(12);
    expect(orgQuota({ plan: 'team' }).max_human_seats).toBe(3);
    expect(orgQuota({ plan: 'team', seats: 1 }).max_human_seats).toBe(3);
    expect(orgQuota({ plan: 'pro', seats: 12 }).max_human_seats).toBe(1);
  });
});

describe('chunkCountFor', () => {
  it('matches chunkText for ASCII content', () => {
    for (const len of [0, 1, 1500, 1501, 2800, 2801, 20_000, 100_000]) {
      expect(chunkCountFor(len)).toBe(chunkText('a'.repeat(len)).length);
    }
  });
});

// --- HTTP ---

interface Agent {
  api_key: string;
  org_id: string;
}

async function registerAgent(): Promise<Agent> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: 'LimitBot', org_name: 'LimitOrg' }),
  });
  return ((await res.json()) as { data: Agent }).data;
}

function api(agent: Agent, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return SELF.fetch(`http://localhost/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.api_key}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function usageOf(orgId: string): Promise<Record<string, number>> {
  return (await env.KV.get<Record<string, number>>(`usage:${orgId}`, 'json')) ?? {};
}

async function setUsage(orgId: string, patch: Record<string, number>): Promise<void> {
  await env.KV.put(`usage:${orgId}`, JSON.stringify({ ...(await usageOf(orgId)), ...patch }));
}

async function setPlan(orgId: string, plan: string): Promise<void> {
  const org = await env.KV.get<Record<string, unknown>>(`org:${orgId}`, 'json');
  await env.KV.put(`org:${orgId}`, JSON.stringify({ ...org, plan }));
}

async function write(agent: Agent, wid: string, path: string, content: string): Promise<Response> {
  return api(agent, `/workspaces/${wid}/files`, 'POST', { path, content });
}

async function newWorkspace(agent: Agent): Promise<string> {
  const res = await api(agent, '/workspaces', 'POST', { name: 'Limits' });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

describe('metering', () => {
  it('counts storage per version and embeddings per live content, and gives both back on delete', async () => {
    const agent = await registerAgent();
    const wid = await newWorkspace(agent);
    const big = 'x'.repeat(4000);

    const created = (await (await write(agent, wid, 'a.md', 'hello')).json()) as { data: { id: string } };
    expect(await usageOf(agent.org_id)).toMatchObject({ storage_bytes: 5, embedding_count: 1 });

    await write(agent, wid, 'a.md', big);
    expect(await usageOf(agent.org_id)).toMatchObject({ storage_bytes: 4005, embedding_count: chunkText(big).length });

    const put = await api(agent, `/workspaces/${wid}/files/${created.data.id}`, 'PUT', { content: 'bye' });
    expect(put.status).toBe(200);
    expect(await usageOf(agent.org_id)).toMatchObject({ storage_bytes: 4008, embedding_count: 1 });

    expect((await api(agent, `/workspaces/${wid}/files/${created.data.id}`, 'DELETE')).status).toBe(200);
    expect(await usageOf(agent.org_id)).toMatchObject({ storage_bytes: 0, embedding_count: 0 });
  });

  it('never drives a counter below zero for files written before metering', async () => {
    const agent = await registerAgent();
    const wid = await newWorkspace(agent);
    const created = (await (await write(agent, wid, 'old.md', 'legacy content')).json()) as { data: { id: string } };
    await setUsage(agent.org_id, { storage_bytes: 0, embedding_count: 0 });
    await api(agent, `/workspaces/${wid}/files/${created.data.id}`, 'DELETE');
    expect(await usageOf(agent.org_id)).toMatchObject({ storage_bytes: 0, embedding_count: 0 });
  });

  it('frees one agent slot per key when a member holding several is removed', async () => {
    const agent = await registerAgent();
    await setPlan(agent.org_id, 'pro');
    const s = new StorageService(env.KV, env.R2);
    await s.addOrgMember(agent.org_id, 'm@x.io', 'member', 'owner@x.io');
    for (let i = 0; i < 6; i++) {
      await s.createApiKey(agent.org_id, `ag_m${i}`, `k${i}`, `hash${i}`, `pre${i}`, 'm@x.io');
      await s.addOrgAgent(agent.org_id, `ag_m${i}`, `k${i}`);
      await s.incrementUsage(agent.org_id, 'agent_count', 1);
    }
    const before = (await usageOf(agent.org_id)).agent_count;
    await s.removeOrgMember(agent.org_id, 'm@x.io');
    expect((await usageOf(agent.org_id)).agent_count).toBe(before - 6);
  });

  it('frees an agent slot when its key is revoked', async () => {
    const agent = await registerAgent();
    const res = await api(agent, '/keys', 'POST', { name: 'extra' });
    const key = ((await res.json()) as { data: { key_id: string } }).data;
    expect((await usageOf(agent.org_id)).agent_count).toBe(2);
    expect((await api(agent, `/keys/${key.key_id}`, 'DELETE')).status).toBe(200);
    expect((await usageOf(agent.org_id)).agent_count).toBe(1);
    // A second revoke of the same key frees nothing more.
    await api(agent, `/keys/${key.key_id}`, 'DELETE');
    expect((await usageOf(agent.org_id)).agent_count).toBe(1);
  });
});

interface LimitBody {
  success: false;
  error: string;
  code: string;
  metric: string;
  used: number;
  limit: number;
  plan: string;
  upgrade_url: string;
}

describe('no pause at 100%', () => {
  it('keeps accepting file writes and edits past full storage, with a warning', async () => {
    const agent = await registerAgent();
    const wid = await newWorkspace(agent);
    const created = (await (await write(agent, wid, 'keep.md', 'kept')).json()) as { data: { id: string } };
    await setUsage(agent.org_id, { storage_bytes: GB, embedding_count: 10_000 });

    const res = await write(agent, wid, 'new.md', 'more');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { usage_warning?: { level: string; message: string } };
    expect(body.usage_warning?.level).toBe('warn99');
    expect(body.usage_warning?.message).not.toMatch(/paused/);

    const put = await api(agent, `/workspaces/${wid}/files/${created.data.id}`, 'PUT', { content: 'changed' });
    expect(put.status).toBe(200);
  });

  it('still names a new workspace by write past full storage', async () => {
    const agent = await registerAgent();
    await setUsage(agent.org_id, { storage_bytes: GB });
    expect((await write(agent, 'notes', 'a.md', 'x')).status).toBe(201);
  });

  it('refuses a second workspace on Free with plan_limit', async () => {
    const agent = await registerAgent();
    await newWorkspace(agent);
    const res = await api(agent, '/workspaces', 'POST', { name: 'Second' });
    expect(res.status).toBe(402);
    expect((await res.json()) as LimitBody).toMatchObject({ code: 'plan_limit', metric: 'workspace_count', used: 1, limit: 1 });
  });
});

describe('usage warnings', () => {
  it('rides on successful writes and run logs at 80% and over', async () => {
    const agent = await registerAgent();
    const wid = await newWorkspace(agent);
    expect(((await (await write(agent, wid, 'a.md', 'x')).json()) as { usage_warning?: unknown }).usage_warning).toBeUndefined();

    await setUsage(agent.org_id, { storage_bytes: Math.round(GB * 0.85) });
    const res = (await (await write(agent, wid, 'b.md', 'y')).json()) as { usage_warning?: { level: string; message: string; upgrade_url: string } };
    expect(res.usage_warning).toMatchObject({ level: 'warn80', upgrade_url: `${SITE}/billing/upgrade?plan=pro` });
    expect(res.usage_warning!.message).toMatch(/has used 85% of its storage/);

    const run = (await (await api(agent, '/runs', 'POST', { task: 't', status: 'success' })).json()) as { usage_warning?: { level: string } };
    expect(run.usage_warning?.level).toBe('warn80');
  });

  it('returns the full status from /billing/plan', async () => {
    const agent = await registerAgent();
    await setUsage(agent.org_id, { storage_bytes: GB });
    const body = (await (await api(agent, '/billing/plan')).json()) as {
      data: { status: { level: string; upgrade_url: string; metrics: Record<string, { pct: number }> } };
    };
    expect(body.data.status.level).toBe('warn99');
    expect(body.data.status.metrics.storage_bytes.pct).toBe(100);
    expect(body.data.status.upgrade_url).toBe(`${SITE}/billing/upgrade?plan=pro`);
  });

  it('adds the warning to /context so drive_context can show it', async () => {
    const agent = await registerAgent();
    await setUsage(agent.org_id, { embedding_count: 9_500 });
    const body = (await (await api(agent, '/context', 'POST', { task: 'anything' })).json()) as { usage_warning?: { level: string } };
    expect(body.usage_warning?.level).toBe('warn90');
  });
});
