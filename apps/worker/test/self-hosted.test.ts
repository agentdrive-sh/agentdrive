import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/env';
import { selfHosted } from '../src/lib/self-hosted';
import { StorageService, resumeMonth } from '../src/services/storage';
import { mintAgentKey } from '../src/routes/cli-auth';
import { deliveredCode } from './magic-code-helper';

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

beforeEach(clearKv);

const GB = 1024 ** 3;
const ON: Partial<Env> = { SELF_HOSTED: 'true' };
// Every value but the exact string "true" must keep production behavior.
const OFF: Array<Partial<Env>> = [{}, { SELF_HOSTED: '' }, { SELF_HOSTED: 'false' }, { SELF_HOSTED: 'TRUE' }, { SELF_HOSTED: '1' }, { SELF_HOSTED: ' true' }];

let ipSeq = 0;
async function call(path: string, mode: Partial<Env>, init: { method?: string; key?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<Response> {
  ipSeq += 1;
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': `10.9.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`,
        ...(init.key && { Authorization: `Bearer ${init.key}` }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { ...(env as unknown as Env), ...mode },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

interface Org { key: string; org_id: string; wid: string }

async function setup(): Promise<Org> {
  const reg = (await (await call('/register', {}, { method: 'POST', body: { agent_name: 'Host', org_name: 'Host Org' } })).json()) as {
    data: { api_key: string; org_id: string };
  };
  const ws = (await (await call('/workspaces', {}, { method: 'POST', key: reg.data.api_key, body: { name: 'WS' } })).json()) as { data: { id: string } };
  return { key: reg.data.api_key, org_id: reg.data.org_id, wid: ws.data.id };
}

async function setUsage(orgId: string, patch: Record<string, number>): Promise<void> {
  const usage = (await env.KV.get<Record<string, number>>(`usage:${orgId}`, 'json')) ?? {};
  await env.KV.put(`usage:${orgId}`, JSON.stringify({ ...usage, ...patch }));
}

describe('selfHosted', () => {
  it('is on only for the exact string "true"', () => {
    expect(selfHosted(ON)).toBe(true);
    for (const mode of OFF) expect(selfHosted(mode)).toBe(false);
  });
});

describe('plan caps', () => {
  async function atCaps(): Promise<Org> {
    const org = await setup();
    await setUsage(org.org_id, { workspace_count: 1, agent_count: 3, member_count: 1 });
    return org;
  }
  const attempts = (org: Org, mode: Partial<Env>) => Promise.all([
    call('/workspaces', mode, { method: 'POST', key: org.key, body: { name: 'Second' } }),
    call('/workspaces/notes/files', mode, { method: 'POST', key: org.key, body: { path: 'a.md', content: 'x' } }),
    call('/keys', mode, { method: 'POST', key: org.key, body: { name: 'another' } }),
    call('/org/invite', mode, { method: 'POST', key: org.key, body: { email: 'dev@example.com', role: 'member' } }),
  ]);

  it('refuse at the Free workspace, agent and seat caps unless SELF_HOSTED is exactly "true"', async () => {
    for (const mode of OFF) {
      await clearKv();
      const responses = await attempts(await atCaps(), mode);
      expect(responses.map((r) => r.status)).toEqual([402, 402, 402, 402]);
      expect(await Promise.all(responses.map(async (r) => ((await r.json()) as { metric: string }).metric)))
        .toEqual(['workspace_count', 'workspace_count', 'agent_count', 'member_count']);
    }
  });

  it('are lifted on a self-hosted instance, where invites are refused outright', async () => {
    const responses = await attempts(await atCaps(), ON);
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 501]);
    expect(await responses[3]!.json()).toMatchObject({ code: 'invites_disabled', error: expect.stringContaining('/v1/keys') });
  });

  it('lift the Team requirement for bring-your-own-bucket on a self-hosted instance', async () => {
    const org = await setup();
    const body = {
      name: 'own', provider: 's3-hmac', endpoint: 'https://s3.us-east-2.amazonaws.com', region: 'us-east-2',
      bucket: 'own-bucket', access_key_id: 'AKIAEXAMPLE', secret_access_key: 'synthetic-secret',
    };
    const hosted = await call('/bucket-config', {}, { method: 'POST', key: org.key, body });
    expect(hosted.status).toBe(403);
    expect(await hosted.json()).toMatchObject({ code: 'plan_required' });
    expect((await call('/bucket-config', ON, { method: 'POST', key: org.key, body })).status).toBe(201);
  });
});

describe('resume meter', () => {
  const TRANSCRIPT = 'sessions/github.com__acme__app/claude-code/abc123.md';
  const month = resumeMonth(new Date());
  const markers = async (org: Org) => (await env.KV.list({ prefix: `xresume_m:${org.org_id}:${month}:` })).keys.length;

  async function fullMonth(): Promise<{ org: Org; fid: string }> {
    const org = await setup();
    const res = await call(`/workspaces/${org.wid}/files`, {}, {
      method: 'POST', key: org.key, headers: { 'X-Agent-Platform': 'claude-code' }, body: { path: TRANSCRIPT, content: '# transcript' },
    });
    const fid = ((await res.json()) as { data: { id: string } }).data.id;
    await Promise.all(Array.from({ length: 10 }, (_, i) => env.KV.put(`xresume_m:${org.org_id}:${month}:${String(i).padStart(32, 'f')}`, '')));
    return { org, fid };
  }
  const resume = (org: Org, fid: string, mode: Partial<Env>) =>
    call(`/workspaces/${org.wid}/files/${fid}?content=true`, mode, { key: org.key, headers: { 'X-Agent-Platform': 'codex' } });

  it('refuses an enforced Free org past its monthly resumes when not self-hosted', async () => {
    const { org, fid } = await fullMonth();
    const res = await resume(org, fid, { RESUME_METER_ENFORCE: 'true', SELF_HOSTED: 'TRUE' });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'plan_limit', metric: 'resume_count' });
  });

  it('neither counts, warns nor refuses on a self-hosted instance', async () => {
    const { org, fid } = await fullMonth();
    const res = await resume(org, fid, { RESUME_METER_ENFORCE: 'true', ...ON });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { content: string }; usage_warning?: unknown };
    expect(body.data.content).toBe('# transcript');
    expect(body.usage_warning).toBeUndefined();
    expect(await markers(org)).toBe(10);
  });
});

describe('usage warnings', () => {
  const warnings = async (org: Org, mode: Partial<Env>) => {
    const responses = await Promise.all([
      call(`/workspaces/${org.wid}/files`, mode, { method: 'POST', key: org.key, body: { path: 'b.md', content: 'y' } }),
      call('/runs', mode, { method: 'POST', key: org.key, body: { task: 't', status: 'success' } }),
      call('/context', mode, { method: 'POST', key: org.key, body: { task: 'anything' } }),
    ]);
    return Promise.all(responses.map(async (r) => ((await r.json()) as { usage_warning?: { upgrade_url: string } }).usage_warning));
  };

  it('carry an upgrade link when not self-hosted', async () => {
    const org = await setup();
    await setUsage(org.org_id, { storage_bytes: Math.round(GB * 0.95) });
    for (const warning of await warnings(org, {})) expect(warning?.upgrade_url).toMatch(/\/billing\/upgrade\?plan=pro$/);
  });

  it('are not emitted on a self-hosted instance', async () => {
    const org = await setup();
    await setUsage(org.org_id, { storage_bytes: Math.round(GB * 0.95) });
    expect(await warnings(org, ON)).toEqual([undefined, undefined, undefined]);
  });
});

describe('registration', () => {
  const TOKEN = 'b'.repeat(64);
  const BOOT: Partial<Env> = { ...ON, SELF_HOSTED_BOOTSTRAP_TOKEN: TOKEN };
  const register = (mode: Partial<Env>, token?: string) => call('/register', mode, {
    method: 'POST', body: { agent_name: 'Someone' }, headers: token === undefined ? {} : { 'X-Bootstrap-Token': token },
  });
  const orgCount = async () => (await env.KV.list({ prefix: 'org:' })).keys.length;

  it('is closed on a self-hosted instance without the bootstrap token', async () => {
    for (const [mode, token] of [[ON, undefined], [ON, TOKEN], [BOOT, undefined], [BOOT, 'c'.repeat(64)], [BOOT, TOKEN.slice(1)], [BOOT, '']] as const) {
      const res = await register(mode, token);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ success: false, code: 'registration_closed' });
    }
    expect(await orgCount()).toBe(0);
  });

  type Reg = { data: { api_key: string; org_id: string; agent_id: string; org_name: string } };

  it('creates the one org with the token', async () => {
    const res = await register(BOOT, TOKEN);
    expect(res.status).toBe(201);
    expect(((await res.json()) as Reg).data).toMatchObject({ org_id: 'org_selfhosted', org_name: 'Self-hosted' });
    expect(await orgCount()).toBe(1);
  });

  it('mints a new owner key in the existing org on a later token register, for recovery', async () => {
    const first = ((await (await register(BOOT, TOKEN)).json()) as Reg).data;
    const ws = (await (await call('/workspaces', ON, { method: 'POST', key: first.api_key, body: { name: 'Kept' } })).json()) as { data: { id: string } };
    const again = await register(BOOT, TOKEN);
    expect(again.status).toBe(201);
    const second = ((await again.json()) as Reg).data;
    expect(second.org_id).toBe(first.org_id);
    expect(second.api_key).not.toBe(first.api_key);
    expect(await orgCount()).toBe(1);

    const org = (await (await call('/org', ON, { key: second.api_key })).json()) as { data: { id: string; created_by: string } };
    expect(org.data).toMatchObject({ id: first.org_id, created_by: second.agent_id });
    const listed = (await (await call('/workspaces', ON, { key: second.api_key })).json()) as { data: Array<{ id: string }> };
    expect(listed.data.map((w) => w.id)).toContain(ws.data.id);
    // Owner rights: the recovered key can revoke the lost one.
    const keys = (await (await call('/keys', ON, { key: second.api_key })).json()) as { data: Array<{ key_id: string; agent_id: string }> };
    const lost = keys.data.find((k) => k.agent_id === first.agent_id)!;
    expect((await call(`/keys/${lost.key_id}`, ON, { method: 'DELETE', key: second.api_key })).status).toBe(200);
    expect((await call('/org', ON, { key: first.api_key })).status).toBe(401);
  });

  it('refuses to register while a second org exists', async () => {
    await new StorageService(env.KV, env.R2).createOrg('org_stray', 'Stray', 'x', {});
    expect((await register(BOOT, TOKEN)).status).toBe(500);
    expect(await orgCount()).toBe(1);
  });

  it('stays open, and ignores the header, when SELF_HOSTED is anything but "true"', async () => {
    for (const mode of OFF) {
      expect((await register(mode)).status).toBe(201);
      expect((await register({ ...mode, SELF_HOSTED_BOOTSTRAP_TOKEN: TOKEN }, 'wrong')).status).toBe(201);
    }
  });

  async function emailSignIn(email: string, mode: Partial<Env>): Promise<{ sent: Response; verified: Response }> {
    const sent = await call('/auth/send-code', mode, { method: 'POST', body: { email } });
    return { sent, verified: await call('/auth/verify-code', mode, { method: 'POST', body: { email, code: await deliveredCode(email) } }) };
  }

  it('turns email sign-in off entirely on a self-hosted instance', async () => {
    const reg = ((await (await register(BOOT, TOKEN)).json()) as Reg).data;
    const email = 'member@example.com';
    await new StorageService(env.KV, env.R2).addOrgMember(reg.org_id, email, 'member', 'admin');
    await env.KV.put(`idx:email_org:${email}`, reg.org_id);
    for (const address of ['stranger@example.com', email]) {
      const { sent, verified } = await emailSignIn(address, ON);
      for (const res of [sent, verified]) {
        expect(res.status).toBe(501);
        expect(await res.json()).toMatchObject({ code: 'email_signin_disabled' });
      }
    }
    expect(await env.KV.list({ prefix: 'session:' })).toMatchObject({ keys: [] });
    expect(await orgCount()).toBe(1);
  });

  it('refuses email sign-in before the magic-code Durable Object is reached', async () => {
    const unreachable = new Proxy({}, { get: () => { throw new Error('MAGIC_CODES reached'); } }) as unknown as Env['MAGIC_CODES'];
    for (const path of ['/auth/send-code', '/auth/verify-code']) {
      const res = await call(path, { ...ON, MAGIC_CODES: unreachable }, { method: 'POST', body: { email: 'a@example.com', code: '123456' } });
      expect(res.status).toBe(501);
    }
  });

  it('gives no org to the OAuth, CLI or MCP-consent paths on an empty instance', async () => {
    const s = new StorageService(env.KV, env.R2);
    await expect(s.getOrCreateOrgForEmail('oauth@example.com', BOOT)).rejects.toMatchObject({ status: 403 });
    await expect(s.createOrg('org_x', 'x', 'x', BOOT)).rejects.toMatchObject({ status: 403 });
    await expect(mintAgentKey({ ...(env as unknown as Env), ...BOOT }, { email: 'cli@example.com', name: 'CLI' })).rejects.toMatchObject({ status: 403 });
    expect(await orgCount()).toBe(0);
  });

  it('still finds an existing member their org on the OAuth path', async () => {
    const reg = ((await (await register(BOOT, TOKEN)).json()) as Reg).data;
    const email = 'member@example.com';
    await env.KV.put(`idx:email_org:${email}`, reg.org_id);
    expect(await new StorageService(env.KV, env.R2).getOrCreateOrgForEmail(email, ON)).toBe(reg.org_id);
    expect(await orgCount()).toBe(1);
  });

  it('keeps email sign-in, a new org per email, and invites when not self-hosted', async () => {
    const reg = (await (await register({})).json()) as { data: { api_key: string } };
    const { sent, verified } = await emailSignIn('stranger@example.com', {});
    expect([sent.status, verified.status]).toEqual([200, 200]);
    expect(await orgCount()).toBe(2);
    expect((await call('/org/invite', {}, { method: 'POST', key: reg.data.api_key, body: { email: 'dev@example.com', role: 'member' } })).status).toBe(201);
  });
});

describe('org quotas', () => {
  type OrgBody = { data: { quota: Record<string, number | null> } };

  it('are null (unlimited) on a self-hosted instance', async () => {
    const org = await setup();
    const quota = ((await (await call('/org', ON, { key: org.key })).json()) as OrgBody).data.quota;
    expect(Object.keys(quota).length).toBeGreaterThan(3);
    expect(Object.values(quota).every((v) => v === null)).toBe(true);
  });

  it('are the plan numbers otherwise', async () => {
    const org = await setup();
    for (const mode of OFF) {
      const quota = ((await (await call('/org', mode, { key: org.key })).json()) as OrgBody).data.quota;
      expect(quota).toMatchObject({ max_agents: 3, max_workspaces: 1, max_human_seats: 1 });
    }
  });
});

describe('billing', () => {
  const routes = [
    ['GET', '/billing/plan'], ['POST', '/billing/checkout'], ['POST', '/billing/portal'], ['GET', '/billing/invoices'], ['POST', '/webhooks/stripe'],
  ] as const;

  it('every billing route answers 501 billing_disabled on a self-hosted instance', async () => {
    const org = await setup();
    for (const [method, path] of routes) {
      const res = await call(path, ON, { method, key: org.key, body: method === 'POST' ? { plan: 'pro' } : undefined });
      expect(res.status, `${method} ${path}`).toBe(501);
      expect(await res.json()).toMatchObject({ success: false, code: 'billing_disabled' });
    }
  });

  it('stays on when SELF_HOSTED is anything but "true"', async () => {
    const org = await setup();
    for (const mode of OFF) {
      expect((await call('/billing/plan', mode, { key: org.key })).status).toBe(200);
      expect((await call('/webhooks/stripe', mode, { method: 'POST', body: {} })).status).toBe(400);
    }
  });
});
