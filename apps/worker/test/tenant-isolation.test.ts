import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import type { ShareTokenMeta, WorkspaceMeta } from '@agentdrive/shared';
import { deliveredCode } from './magic-code-helper';

// Every workspace-scoped request must prove the workspace belongs to the
// caller's org. Another org's workspace answers exactly like a missing one
// (404), so ids can't be probed, and nothing a refused request asked for is
// written.

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

type Headers = Record<string, string>;

let ipSeq = 0;
function freshIp(): Headers {
  ipSeq += 1;
  return { 'cf-connecting-ip': `10.9.${Math.floor(ipSeq / 250)}.${ipSeq % 250}` };
}

function api(path: string, method: string, headers: Headers, body?: unknown): Promise<Response> {
  return SELF.fetch(`http://localhost/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...freshIp(), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

interface Principal { headers: Headers; org_id: string; agent_id: string }

async function registerAgent(name: string): Promise<Principal> {
  const res = await api('/register', 'POST', {}, { agent_name: name, org_name: `${name} Org` });
  expect(res.status).toBe(201);
  const data = await json<{ api_key: string; org_id: string; agent_id: string }>(res);
  return { headers: { Authorization: `Bearer ${data.api_key}` }, org_id: data.org_id, agent_id: data.agent_id };
}

async function mintKeyRecord(who: Headers): Promise<{ headers: Headers; key_id: string; agent_id: string }> {
  const res = await api('/keys', 'POST', who, { name: 'second harness' });
  expect(res.status).toBe(201);
  const data = await json<{ api_key: string; key_id: string; agent_id: string }>(res);
  return { headers: { Authorization: `Bearer ${data.api_key}` }, key_id: data.key_id, agent_id: data.agent_id };
}

async function mintKey(who: Headers): Promise<Headers> {
  return (await mintKeyRecord(who)).headers;
}

async function signIn(email: string): Promise<Headers> {
  const code = await deliveredCode(email);
  const res = await api('/auth/verify-code', 'POST', {}, { email, code });
  expect(res.status).toBe(200);
  return { 'X-Session-Token': (await json<{ session_id: string }>(res)).session_id };
}

async function joinOrg(owner: Principal, email: string): Promise<Headers> {
  expect((await api('/org/invite', 'POST', owner.headers, { email, role: 'member' })).status).toBe(201);
  const who = await signIn(email);
  expect((await api(`/org/invites/${owner.org_id}/accept`, 'POST', who)).status).toBe(200);
  return who;
}

async function upgradeToTeam(org: Principal): Promise<void> {
  const meta = (await env.KV.get<Record<string, unknown>>(`org:${org.org_id}`, 'json'))!;
  await env.KV.put(`org:${org.org_id}`, JSON.stringify({ ...meta, plan: 'team' }));
}

async function createWorkspace(who: Headers, name = 'WS'): Promise<string> {
  const res = await api('/workspaces', 'POST', who, { name });
  expect(res.status).toBe(201);
  return (await json<{ id: string }>(res)).id;
}

async function writeFile(who: Headers, wid: string, path: string, content: string): Promise<string> {
  const res = await api(`/workspaces/${wid}/files`, 'POST', who, { path, content });
  expect(res.status).toBe(201);
  return (await json<{ id: string }>(res)).id;
}

async function readContent(who: Headers, wid: string, fid: string): Promise<string> {
  const res = await api(`/workspaces/${wid}/files/${fid}?content=true`, 'GET', who);
  expect(res.status).toBe(200);
  return (await json<{ content: string }>(res)).content;
}

async function createShare(who: Headers, wid: string, body: Record<string, unknown>): Promise<{ token: string; token_id: string }> {
  const res = await api(`/workspaces/${wid}/share`, 'POST', who, body);
  expect(res.status).toBe(201);
  const data = await json<{ url: string; token_id: string }>(res);
  expect(data.url.startsWith('http://localhost:3001/s/')).toBe(true);
  return { token: new URL(data.url).pathname.split('/s/')[1]!, token_id: data.token_id };
}

async function shareToken(who: Headers, wid: string, body: Record<string, unknown>): Promise<string> {
  return (await createShare(who, wid, body)).token;
}

const SECRET = 'alpha secret roadmap';

let a: Principal;
let b: Principal;
let wsA: string;
let fA: string;
let wsB: string;

beforeEach(async () => {
  await clearKv();
  a = await registerAgent('Alpha');
  b = await registerAgent('Bravo');
  wsA = await createWorkspace(a.headers, 'Alpha WS');
  fA = await writeFile(a.headers, wsA, 'plan.md', SECRET);
  expect((await api(`/workspaces/${wsA}/files/${fA}/comments`, 'POST', a.headers, { body: 'alpha comment' })).status).toBe(201);
  expect((await api(`/workspaces/${wsA}/roles`, 'POST', a.headers, { email: 'kept@example.com', permission: 'view' })).status).toBe(201);
  wsB = await createWorkspace(b.headers, 'Bravo WS');
});

function readRoutes(): Array<[string, string]> {
  return [
    ['GET', `/workspaces/${wsA}`],
    ['GET', `/workspaces/${wsA}/files`],
    ['GET', `/workspaces/${wsA}/files/${fA}`],
    ['GET', `/workspaces/${wsA}/files/${fA}?content=true`],
    ['GET', `/workspaces/${wsA}/files/${fA}/versions`],
    ['GET', `/workspaces/${wsA}/files/${fA}/comments`],
    ['GET', `/workspaces/${wsA}/files/${fA}/runs`],
    ['GET', `/workspaces/${wsA}/activity`],
    ['GET', `/workspaces/${wsA}/roles`],
  ];
}

function writeRoutes(): Array<[string, string, unknown?]> {
  return [
    ['POST', `/workspaces/${wsA}/files`, { path: 'evil.md', content: 'planted' }],
    ['POST', `/workspaces/${wsA}/files`, { path: 'plan.md', content: 'pwned' }],
    ['PUT', `/workspaces/${wsA}/files/${fA}`, { content: 'pwned' }],
    ['DELETE', `/workspaces/${wsA}/files/${fA}`],
    ['POST', `/workspaces/${wsA}/files/${fA}/comments`, { body: 'planted comment' }],
    ['POST', `/workspaces/${wsA}/share`, { permission: 'edit' }],
    ['POST', `/workspaces/${wsA}/roles`, { email: 'mallory@example.com', permission: 'edit' }],
    ['DELETE', `/workspaces/${wsA}/roles/${encodeURIComponent('kept@example.com')}`],
    ['PUT', `/workspaces/${wsA}/bucket-config`, { bucket_config_id: 'default' }],
    ['DELETE', `/workspaces/${wsA}/bucket-config`],
    ['POST', `/workspaces/${wsA}/sandbox/exec`, { cmd: 'cat plan.md' }],
  ];
}

async function expectAllNotFound(who: Headers, routes: Array<[string, string, unknown?]>): Promise<void> {
  for (const [method, path, body] of routes) {
    const res = await api(path, method, who, body);
    const text = await res.text();
    expect({ method, path, status: res.status }).toEqual({ method, path, status: 404 });
    expect(text).not.toContain('alpha');
  }
}

async function expectOrgAUntouched(): Promise<void> {
  const files = await json<Array<{ id: string; path: string; version: number }>>(await api(`/workspaces/${wsA}/files`, 'GET', a.headers));
  expect(files.map((f) => [f.path, f.version])).toEqual([['plan.md', 1]]);
  expect(await readContent(a.headers, wsA, fA)).toBe(SECRET);
  const comments = await json<Array<{ body: string }>>(await api(`/workspaces/${wsA}/files/${fA}/comments`, 'GET', a.headers));
  expect(comments.map((c) => c.body)).toEqual(['alpha comment']);
  expect((await env.KV.list({ prefix: 'token:' })).keys).toEqual([]);
  expect(await env.KV.get(`role:${wsA}:mallory@example.com`)).toBeNull();
  expect(await env.KV.get(`role:${wsA}:kept@example.com`)).not.toBeNull();
  const ws = await env.KV.get<WorkspaceMeta>(`ws:${wsA}`, 'json');
  expect(ws!.org_id).toBe(a.org_id);
  expect(ws!.bucket_config_id).toBeUndefined();
}

describe("another org's agent key", () => {
  it("gets 404 reading org A's workspace, files, versions, comments, runs, activity and roles", async () => {
    await expectAllNotFound(b.headers, readRoutes());
  });

  it("gets 404 writing to org A's workspace and changes nothing", async () => {
    await expectAllNotFound(b.headers, writeRoutes());
    await expectOrgAUntouched();
  });

  it("cannot reach org A's workspace through search, context or runs", async () => {
    expect((await api('/search', 'POST', b.headers, { workspace_id: wsA, query: 'alpha roadmap' })).status).toBe(404);
    expect((await api('/context', 'POST', b.headers, { workspace_id: wsA, task: 'alpha roadmap' })).status).toBe(404);
    expect((await api('/runs', 'POST', b.headers, { task: 't', status: 'success', workspace_id: wsA })).status).toBe(404);

    const search = await api('/search', 'POST', b.headers, { query: 'alpha roadmap' });
    expect(search.status).toBe(200);
    expect(await search.text()).not.toContain('alpha');
    const context = await api('/context', 'POST', b.headers, { task: 'alpha roadmap' });
    expect(context.status).toBe(200);
    expect(await context.text()).not.toContain('alpha');
  });

  it('ignores a stale organization workspace index across listing, retrieval, activity and member removal', async () => {
    await env.KV.put(`idx:org_workspaces:${b.org_id}:${wsA}`, wsA);
    const workspaces = await json<Array<{ id: string }>>(await api('/workspaces', 'GET', b.headers));
    expect(workspaces.map(w => w.id)).toEqual([wsB]);
    const timeline = await json<Array<{ workspace_id: string }>>(await api('/org/timeline', 'GET', b.headers));
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.every(event => event.workspace_id === wsB)).toBe(true);
    const search = await json<{ hits: unknown[] }>(await api('/search', 'POST', b.headers, { query: SECRET }));
    expect(search.hits).toEqual([]);
    const context = await json<{ artifacts: unknown[] }>(await api('/context', 'POST', b.headers, { task: SECRET }));
    expect(context.artifacts).toEqual([]);

    await joinOrg(b, 'kept@example.com');
    expect((await api('/org/members/kept%40example.com', 'DELETE', b.headers)).status).toBe(200);
    expect(await env.KV.get(`role:${wsA}:kept@example.com`)).not.toBeNull();
  });

  it("cannot read org A's comments by putting A's file id under its own workspace", async () => {
    const res = await api(`/workspaces/${wsB}/files/${fA}/comments`, 'GET', b.headers);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('alpha');
  });

  it('cannot create a workspace under an id it chose', async () => {
    const res = await api('/workspaces/ws_chosen/files', 'POST', b.headers, { path: 'a.md', content: 'x' });
    expect(res.status).toBe(404);
    expect(await env.KV.get('ws:ws_chosen')).toBeNull();
  });
});

describe('workspaces an agent names on first write', () => {
  it('are private to the org, so two orgs choosing the same name never meet', async () => {
    await upgradeToTeam(a);
    await upgradeToTeam(b);
    const resA = await api('/workspaces/notes/files', 'POST', a.headers, { path: 'n.md', content: 'alpha note' });
    expect(resA.status).toBe(201);
    const wsNamedA = (await json<{ workspace_id: string }>(resA)).workspace_id;
    expect(wsNamedA).not.toBe('notes');
    expect(await env.KV.get('ws:notes')).toBeNull();

    const resB = await api('/workspaces/notes/files', 'POST', b.headers, { path: 'n.md', content: 'bravo note' });
    expect(resB.status).toBe(201);
    const wsNamedB = (await json<{ workspace_id: string }>(resB)).workspace_id;
    expect(wsNamedB).not.toBe(wsNamedA);

    const listA = await api('/workspaces/notes/files', 'GET', a.headers);
    expect(await listA.text()).not.toContain(wsNamedB);
    const fileB = (await json<Array<{ id: string }>>(await api('/workspaces/notes/files', 'GET', b.headers)))[0]!.id;
    expect(await readContent(b.headers, 'notes', fileB)).toBe('bravo note');
    expect(await readContent(b.headers, wsNamedB, fileB)).toBe('bravo note');
    expect((await api(`/workspaces/${wsNamedA}/files`, 'GET', b.headers)).status).toBe(404);
    expect((await api('/search', 'POST', b.headers, { workspace_id: 'notes', query: 'alpha note' })).status).toBe(200);
    expect(await (await api('/search', 'POST', b.headers, { workspace_id: 'notes', query: 'alpha note' })).text()).not.toContain('alpha');

    const ws = await env.KV.get<WorkspaceMeta>(`ws:${wsNamedA}`, 'json');
    expect(ws).toMatchObject({ name: 'notes', org_id: a.org_id });
    expect(await env.KV.get(`idx:org_workspaces:${a.org_id}:${wsNamedA}`)).toBe(wsNamedA);
  });

  it("stop at the plan's workspace limit, and never block writes to a workspace that exists", async () => {
    const res = await api('/workspaces/notes/files', 'POST', a.headers, { path: 'n.md', content: 'x' });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { code: string; metric: string; upgrade_url: string };
    expect(body.code).toBe('plan_limit');
    expect(body.metric).toBe('workspace_count');
    expect(body.upgrade_url).toContain('/billing/upgrade?plan=pro');
    expect((await env.KV.list({ prefix: `idx:org_workspaces:${a.org_id}:` })).keys).toHaveLength(1);
    expect((await api(`/workspaces/${wsA}/files`, 'POST', a.headers, { path: 'more.md', content: 'x' })).status).toBe(201);

    await upgradeToTeam(a);
    expect((await api('/workspaces/notes/files', 'POST', a.headers, { path: 'n.md', content: 'x' })).status).toBe(201);
    const meta = (await env.KV.get<Record<string, unknown>>(`org:${a.org_id}`, 'json'))!;
    await env.KV.put(`org:${a.org_id}`, JSON.stringify({ ...meta, plan: 'trial' }));
    expect((await api('/workspaces/notes/files', 'POST', a.headers, { path: 'n2.md', content: 'x' })).status).toBe(201);
  });

  it('are not created by a read', async () => {
    expect((await api('/workspaces/drafts/files', 'GET', a.headers)).status).toBe(404);
    expect((await env.KV.list({ prefix: `idx:org_workspaces:${a.org_id}:` })).keys).toHaveLength(1);
  });
});

describe('a session for an unrelated email', () => {
  it("gets 404 on every org A workspace route and changes nothing", async () => {
    const stranger = await signIn('stranger@example.com');
    await expectAllNotFound(stranger, readRoutes());
    await expectAllNotFound(stranger, writeRoutes());
    await expectOrgAUntouched();
  });
});

describe('a removed member', () => {
  it('loses read and write access, including through roles granted while a member', async () => {
    const alice = await joinOrg(a, 'alice@example.com');
    expect((await api(`/workspaces/${wsA}/files`, 'GET', alice)).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/roles`, 'POST', a.headers, { email: 'alice@example.com', permission: 'edit' })).status).toBe(201);
    expect((await api(`/workspaces/${wsA}/files`, 'POST', alice, { path: 'alice.md', content: 'hi' })).status).toBe(201);

    expect((await api('/org/members/alice%40example.com', 'DELETE', a.headers)).status).toBe(200);

    await expectAllNotFound(alice, readRoutes());
    expect((await api(`/workspaces/${wsA}/files`, 'POST', alice, { path: 'later.md', content: 'x' })).status).toBe(404);
    expect(await env.KV.get(`role:${wsA}:alice@example.com`)).toBeNull();
  });
});

describe('the owning org', () => {
  it('keeps full access from every key and from member sessions', async () => {
    const second = await mintKey(a.headers);
    expect(await readContent(second, wsA, fA)).toBe(SECRET);
    expect((await api(`/workspaces/${wsA}/files/${fA}`, 'PUT', second, { content: 'v2' })).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/activity`, 'GET', second)).status).toBe(200);
    expect((await api(`/workspaces/${wsA}`, 'GET', second)).status).toBe(200);
    expect((await api('/search', 'POST', second, { workspace_id: wsA, query: 'v2' })).status).toBe(200);
    expect((await api('/runs', 'POST', second, { task: 't', status: 'success', workspace_id: wsA })).status).toBe(201);

    const member = await joinOrg(a, 'member@example.com');
    expect(await readContent(member, wsA, fA)).toBe('v2');
    expect((await api(`/workspaces/${wsA}/files/${fA}/comments`, 'GET', member)).status).toBe(200);
  });

  it("lets a share token in only to its own workspace", async () => {
    const token = await shareToken(a.headers, wsA, { permission: 'view' });
    expect((await api(`/workspaces/${wsA}/files?token=${token}`, 'GET', {})).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', { 'X-Share-Token': token })).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/files/${fA}`, 'PUT', { 'X-Share-Token': token }, { content: 'x' })).status).toBe(403);
    expect((await api(`/workspaces/${wsB}/files?token=${token}`, 'GET', {})).status).toBe(404);
  });

  it('lets a file-scoped view link read its transcript with no login, as adrive resume does', async () => {
    const path = 'sessions/proj/codex/s1.md';
    const fid = await writeFile(a.headers, wsA, path, '# transcript');
    const token = await shareToken(a.headers, wsA, { permission: 'view', file_id: fid });
    const info = await json<{ workspace_id: string; file_id: string }>(await api(`/token-info/${token}`, 'GET', {}));
    expect(info).toMatchObject({ workspace_id: wsA, file_id: fid });
    const h = { 'X-Share-Token': token };
    expect((await json<{ path: string }>(await api(`/workspaces/${wsA}/files/${fid}`, 'GET', h))).path).toBe(path);
    expect(await readContent(h, wsA, fid)).toBe('# transcript');
  });

  it('holds a file-scoped share token to its one file', async () => {
    const other = await writeFile(a.headers, wsA, 'other.md', 'other content');
    const token = await shareToken(a.headers, wsA, { permission: 'edit', file_id: fA });
    const h = { 'X-Share-Token': token };
    expect((await api(`/workspaces/${wsA}/files/${fA}`, 'PUT', h, { content: 'edited' })).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/files/${fA}/versions`, 'GET', h)).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/files/${other}?content=true`, 'GET', h)).status).toBe(404);
    expect((await api(`/workspaces/${wsA}/files/${other}/versions`, 'GET', h)).status).toBe(404);
    expect((await api(`/workspaces/${wsA}/files/${other}/comments`, 'GET', h)).status).toBe(404);
    expect((await api(`/workspaces/${wsA}/files/${other}`, 'PUT', h, { content: 'pwned' })).status).toBe(404);
    expect((await api(`/workspaces/${wsA}/files`, 'POST', h, { path: 'other.md', content: 'pwned' })).status).toBe(404);
    expect(await readContent(a.headers, wsA, other)).toBe('other content');
  });

  it('lets an explicitly granted outside email in at its granted level', async () => {
    expect((await api(`/workspaces/${wsA}/roles`, 'POST', a.headers, { email: 'guest@example.com', permission: 'view' })).status).toBe(201);
    const guest = await signIn('guest@example.com');
    expect(await readContent(guest, wsA, fA)).toBe(SECRET);
    expect((await api(`/workspaces/${wsA}/files`, 'POST', guest, { path: 'g.md', content: 'x' })).status).toBe(403);
    expect((await api(`/workspaces/${wsB}/files`, 'GET', guest)).status).toBe(404);
  });

  it("ignores a role another org's agent planted before the org check existed", async () => {
    await env.KV.put(`role:${wsA}:planted@example.com`, JSON.stringify({
      workspace_id: wsA, email: 'planted@example.com', permission: 'edit', assigned_by: b.agent_id, assigned_at: new Date().toISOString(),
    }));
    const planted = await signIn('planted@example.com');
    await expectAllNotFound(planted, readRoutes());
    await expectAllNotFound(planted, writeRoutes());
    await expectOrgAUntouched();
  });
});

describe('legacy workspaces without an org', () => {
  async function stripOrg(wid: string, org: string, createdBy: string): Promise<void> {
    const ws = (await env.KV.get<WorkspaceMeta>(`ws:${wid}`, 'json'))!;
    const { org_id: _drop, ...rest } = ws;
    await env.KV.put(`ws:${wid}`, JSON.stringify({ ...rest, created_by: createdBy }));
    await env.KV.delete(`idx:org_workspaces:${org}:${wid}`);
  }

  it("belong to the creating agent's org, are claimed for it on first use, and stay closed to others", async () => {
    await stripOrg(wsA, a.org_id, a.agent_id);

    await expectAllNotFound(b.headers, readRoutes());
    await expectAllNotFound(await signIn('stranger@example.com'), readRoutes());
    expect((await env.KV.get<WorkspaceMeta>(`ws:${wsA}`, 'json'))!.org_id).toBeUndefined();

    const second = await mintKey(a.headers);
    expect(await readContent(second, wsA, fA)).toBe(SECRET);
    expect((await env.KV.get<WorkspaceMeta>(`ws:${wsA}`, 'json'))!.org_id).toBe(a.org_id);
    expect(await env.KV.get(`idx:org_workspaces:${a.org_id}:${wsA}`)).toBe(wsA);
  });

  it("stay closed to an org other than the creator's", async () => {
    await stripOrg(wsA, a.org_id, b.agent_id);
    expect((await api(`/workspaces/${wsA}/files`, 'GET', a.headers)).status).toBe(404);
    expect((await env.KV.get<WorkspaceMeta>(`ws:${wsA}`, 'json'))!.org_id).toBeUndefined();
  });

  it("are still claimed for the org after the creating agent's key is revoked", async () => {
    await upgradeToTeam(a);
    const creator = await mintKeyRecord(a.headers);
    const legacy = await createWorkspace(creator.headers, 'Legacy');
    const file = await writeFile(creator.headers, legacy, 'old.md', 'legacy notes');
    await stripOrg(legacy, a.org_id, creator.agent_id);

    expect((await api(`/keys/${creator.key_id}`, 'DELETE', creator.headers)).status).toBe(200);

    expect(await readContent(a.headers, legacy, file)).toBe('legacy notes');
    expect((await env.KV.get<WorkspaceMeta>(`ws:${legacy}`, 'json'))!.org_id).toBe(a.org_id);
  });
});

describe('a file-scoped share token', () => {
  it('lists only its own file and cannot read the workspace or its activity', async () => {
    await writeFile(a.headers, wsA, 'other.md', 'other content');
    expect((await api(`/workspaces/${wsA}/roles`, 'POST', a.headers, { email: 'secret-guest@example.com', permission: 'edit' })).status).toBe(201);
    const h = { 'X-Share-Token': await shareToken(a.headers, wsA, { permission: 'view', file_id: fA }) };

    const list = await api(`/workspaces/${wsA}/files`, 'GET', h);
    expect(list.status).toBe(200);
    expect((await json<Array<{ path: string }>>(list)).map((f) => f.path)).toEqual(['plan.md']);
    expect(await json(await api(`/workspaces/${wsA}/files?prefix=other`, 'GET', h))).toEqual([]);

    for (const path of [`/workspaces/${wsA}/activity`, `/workspaces/${wsA}`, `/workspaces/${wsA}/share`]) {
      const res = await api(path, 'GET', h);
      const text = await res.text();
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(text).not.toContain('other.md');
      expect(text).not.toContain('secret-guest');
    }

    expect(await readContent(h, wsA, fA)).toBe(SECRET);
    expect((await api(`/workspaces/${wsA}/files/${fA}/comments`, 'GET', h)).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/files/${fA}/versions`, 'GET', h)).status).toBe(200);
  });

  it('leaves a workspace-wide token able to list every file', async () => {
    await writeFile(a.headers, wsA, 'other.md', 'other content');
    const h = { 'X-Share-Token': await shareToken(a.headers, wsA, { permission: 'view' }) };
    const files = await json<Array<{ path: string }>>(await api(`/workspaces/${wsA}/files`, 'GET', h));
    expect(files.map((f) => f.path)).toEqual(['other.md', 'plan.md']);
  });
});

describe('revoking a share token', () => {
  it('cuts the link off at once, and only the owning org can list or revoke it', async () => {
    const { token, token_id } = await createShare(a.headers, wsA, { permission: 'edit' });
    const h = { 'X-Share-Token': token };
    expect(await readContent(h, wsA, fA)).toBe(SECRET);

    const listed = await json<Array<{ token_id: string; permission: string; revoked: boolean }>>(await api(`/workspaces/${wsA}/share`, 'GET', a.headers));
    expect(listed.map((t) => [t.token_id, t.permission, t.revoked])).toEqual([[token_id, 'edit', false]]);

    const outsider = await signIn('stranger@example.com');
    for (const who of [b.headers, outsider, h]) {
      expect((await api(`/workspaces/${wsA}/share`, 'GET', who)).status).toBe(404);
      expect((await api(`/workspaces/${wsA}/share/${token_id}`, 'DELETE', who)).status).toBe(404);
    }
    expect((await api(`/workspaces/${wsB}/share/${token_id}`, 'DELETE', b.headers)).status).toBe(404);
    expect(await readContent(h, wsA, fA)).toBe(SECRET);

    const member = await joinOrg(a, 'member@example.com');
    expect((await json<unknown[]>(await api(`/workspaces/${wsA}/share`, 'GET', member))).length).toBe(1);
    expect((await api(`/workspaces/${wsA}/share/${token_id}`, 'DELETE', member)).status).toBe(200);

    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', h)).status).toBe(401);
    expect((await api(`/workspaces/${wsA}/files/${fA}`, 'PUT', h, { content: 'pwned' })).status).toBe(401);
    expect((await api(`/token-info/${token}`, 'GET', {})).status).toBe(401);
    expect(await readContent(a.headers, wsA, fA)).toBe(SECRET);
    const after = await json<Array<{ revoked: boolean }>>(await api(`/workspaces/${wsA}/share`, 'GET', a.headers));
    expect(after.map((t) => t.revoked)).toEqual([true]);
  });

  it('counts uses beside the token record, so uses racing the revocation cannot restore it', async () => {
    const { token, token_id } = await createShare(a.headers, wsA, { permission: 'view' });
    const record = await env.KV.get(`token:${token_id}`);
    const use = () => api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', { 'X-Share-Token': token });

    let uses = 0;
    for (let i = 0; i < 20 && uses === 0; i++) {
      expect((await use()).status).toBe(200);
      const listed = await json<Array<{ use_count: number }>>(await api(`/workspaces/${wsA}/share`, 'GET', a.headers));
      uses = listed[0]!.use_count;
    }
    expect(uses).toBeGreaterThan(0);
    expect(await env.KV.get(`token:${token_id}`)).toBe(record);

    await Promise.all([
      ...Array.from({ length: 5 }, use),
      api(`/workspaces/${wsA}/share/${token_id}`, 'DELETE', a.headers),
      ...Array.from({ length: 5 }, use),
    ]);
    for (let i = 0; i < 5; i++) expect((await use()).status).toBe(401);
    expect((await env.KV.get<ShareTokenMeta>(`token:${token_id}`, 'json'))!.revoked).toBe(true);
  });

  it('still enforces max_uses', async () => {
    const h = { 'X-Share-Token': await shareToken(a.headers, wsA, { permission: 'view', max_uses: 2 }) };
    const usesLeft = async () => ((await (await api(`/token-info/${h['X-Share-Token']}`, 'GET', {})).json()) as { data: { uses_left: number | null } }).data.uses_left;
    expect(await usesLeft()).toBe(2);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', h)).status);
    expect(statuses.slice(0, 2)).toEqual([200, 200]);
    expect(statuses.at(-1)).toBe(401);
    expect(await usesLeft()).toBe(0);

    expect((await api(`/workspaces/${wsA}/share`, 'POST', a.headers, { permission: 'view', max_uses: 1.5 })).status).toBe(400);
    const gated = await shareToken(a.headers, wsA, { permission: 'view', max_uses: 3, email: 'someone@example.com' });
    const info = (await (await api(`/token-info/${gated}`, 'GET', {})).json()) as { data: { uses_left: number | null } };
    expect(info.data.uses_left).toBeNull();
  });
});

describe('removing a member', () => {
  it('ends the share links and role grants made with their keys, and only theirs', async () => {
    await upgradeToTeam(a);
    const alice = await joinOrg(a, 'alice@example.com');
    const aliceKey = await mintKey(alice);
    const bob = await joinOrg(a, 'bob@example.com');
    const bobKey = await mintKey(bob);

    const aliceLink = { 'X-Share-Token': await shareToken(aliceKey, wsA, { permission: 'edit' }) };
    const bobLink = { 'X-Share-Token': await shareToken(bobKey, wsA, { permission: 'view' }) };
    const founderLink = { 'X-Share-Token': await shareToken(a.headers, wsA, { permission: 'view' }) };
    expect((await api(`/workspaces/${wsA}/roles`, 'POST', aliceKey, { email: 'alias@example.com', permission: 'edit' })).status).toBe(201);
    expect((await api(`/workspaces/${wsA}/roles`, 'POST', bobKey, { email: 'bob-guest@example.com', permission: 'view' })).status).toBe(201);
    expect((await api(`/workspaces/${wsA}/roles`, 'POST', a.headers, { email: 'founder-guest@example.com', permission: 'view' })).status).toBe(201);
    const alias = await signIn('alias@example.com');
    const bobGuest = await signIn('bob-guest@example.com');
    const founderGuest = await signIn('founder-guest@example.com');

    expect(await readContent(aliceLink, wsA, fA)).toBe(SECRET);
    expect(await readContent(alias, wsA, fA)).toBe(SECRET);
    expect((await api(`/workspaces/${wsA}/files/${fA}`, 'PUT', aliceLink, { content: 'v2' })).status).toBe(200);

    expect((await api('/org/members/alice%40example.com', 'DELETE', a.headers)).status).toBe(200);

    expect((await api(`/workspaces/${wsA}/files`, 'GET', aliceKey)).status).toBe(401);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', aliceLink)).status).toBe(401);
    expect((await api(`/workspaces/${wsA}/files/${fA}`, 'PUT', aliceLink, { content: 'pwned' })).status).toBe(401);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', alias)).status).toBe(404);
    expect((await api(`/workspaces/${wsA}/files`, 'POST', alias, { path: 'alias.md', content: 'x' })).status).toBe(404);

    for (const who of [bobLink, founderLink, bobGuest, founderGuest]) {
      expect(await readContent(who, wsA, fA)).toBe('v2');
    }
  });
});

describe("a member's share link", () => {
  type Activity = { action: string; actor_type: string; actor_id: string; target_id: string };

  it('opens its file without login, is described by token-info, and records the member as issuer', async () => {
    const alice = await joinOrg(a, 'alice@example.com');
    const { token, token_id } = await createShare(alice, wsA, { permission: 'view', file_id: fA });

    const h = { 'X-Share-Token': token };
    expect(await readContent(h, wsA, fA)).toBe(SECRET);
    const info = await json<{ workspace_id: string; file_id: string; permission: string }>(await api(`/token-info/${token}`, 'GET', {}));
    expect(info).toMatchObject({ workspace_id: wsA, file_id: fA, permission: 'view' });

    expect((await env.KV.get<ShareTokenMeta>(`token:${token_id}`, 'json'))!.issuer).toBe('member:alice@example.com');
    // The payload travels in the URL to whoever holds the link, so it must not name the member.
    expect(atob(token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('alice');
    const events = await json<Activity[]>(await api(`/workspaces/${wsA}/activity`, 'GET', a.headers));
    expect(events.find((e) => e.action === 'share.create' && e.target_id === token_id))
      .toMatchObject({ actor_type: 'human', actor_id: 'alice@example.com' });
  });

  it('stops working, with the role it granted, once the member is removed', async () => {
    const alice = await joinOrg(a, 'alice@example.com');
    const fileLink = await shareToken(alice, wsA, { permission: 'view', file_id: fA });
    const { token_id: gatedId } = await createShare(alice, wsA, { permission: 'view', email: 'guest@example.com' });
    expect((await env.KV.get<{ assigned_by: string }>(`role:${wsA}:guest@example.com`, 'json'))!.assigned_by).toBe('member:alice@example.com');
    expect((await env.KV.get<ShareTokenMeta>(`token:${gatedId}`, 'json'))!.issuer).toBe('member:alice@example.com');
    const guest = await signIn('guest@example.com');
    expect(await readContent(guest, wsA, fA)).toBe(SECRET);

    expect((await api('/org/members/alice%40example.com', 'DELETE', a.headers)).status).toBe(200);
    // An agent record under the member issuer's name must not bring the link back.
    await env.KV.put(`org_agent:${a.org_id}:member:alice@example.com`, JSON.stringify({ agent_id: 'member:alice@example.com', org_id: a.org_id }));

    const res = await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', { 'X-Share-Token': fileLink });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('Token revoked');
    expect((await api(`/token-info/${fileLink}`, 'GET', {})).status).toBe(401);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', guest)).status).toBe(404);
  });

  it('stays dead, with its role grant, when the removed member is invited back', async () => {
    const alice = await joinOrg(a, 'alice@example.com');
    const oldLink = { 'X-Share-Token': await shareToken(alice, wsA, { permission: 'view' }) };
    await createShare(alice, wsA, { permission: 'view', email: 'guest@example.com' });
    const guest = await signIn('guest@example.com');
    expect((await api('/org/members/alice%40example.com', 'DELETE', a.headers)).status).toBe(200);

    const aliceAgain = await joinOrg(a, 'alice@example.com');
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', oldLink)).status).toBe(401);
    expect((await api(`/token-info/${oldLink['X-Share-Token']}`, 'GET', {})).status).toBe(401);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', guest)).status).toBe(404);
    const newLink = { 'X-Share-Token': await shareToken(aliceAgain, wsA, { permission: 'view' }) };
    expect(await readContent(newLink, wsA, fA)).toBe(SECRET);
  });

  it('fails closed on a member record with no issue time, and leaves agent records alone', async () => {
    const alice = await joinOrg(a, 'alice@example.com');
    const memberLink = await createShare(alice, wsA, { permission: 'view' });
    const agentLink = await createShare(a.headers, wsA, { permission: 'view' });
    for (const { token_id } of [memberLink, agentLink]) {
      const { created_at: _drop, ...rest } = (await env.KV.get<ShareTokenMeta>(`token:${token_id}`, 'json'))!;
      await env.KV.put(`token:${token_id}`, JSON.stringify(rest));
    }
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', { 'X-Share-Token': memberLink.token })).status).toBe(401);
    expect(await readContent({ 'X-Share-Token': agentLink.token }, wsA, fA)).toBe(SECRET);
  });

  it('dies when the membership record is gone, even with the role grant left behind', async () => {
    const alice = await joinOrg(a, 'alice@example.com');
    const link = { 'X-Share-Token': await shareToken(alice, wsA, { permission: 'view' }) };
    expect(await readContent(link, wsA, fA)).toBe(SECRET);
    await env.KV.delete(`org_member:${a.org_id}:alice@example.com`);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', link)).status).toBe(401);
  });

  it('is never issued to a session outside the owning org or to a share token', async () => {
    const bob = await joinOrg(b, 'bob@example.com');
    const kept = await signIn('kept@example.com');
    const link = { 'X-Share-Token': await shareToken(a.headers, wsA, { permission: 'edit' }) };
    const before = (await env.KV.list({ prefix: 'token:' })).keys.length;
    for (const who of [bob, kept, link]) {
      expect((await api(`/workspaces/${wsA}/share`, 'POST', who, { permission: 'view' })).status).toBe(404);
    }
    expect((await env.KV.list({ prefix: 'token:' })).keys.length).toBe(before);
  });

  it("leaves an agent's link issued by its agent id", async () => {
    const { token_id } = await createShare(a.headers, wsA, { permission: 'view' });
    expect((await env.KV.get<ShareTokenMeta>(`token:${token_id}`, 'json'))!.issuer).toBe(a.agent_id);
    const events = await json<Activity[]>(await api(`/workspaces/${wsA}/activity`, 'GET', a.headers));
    expect(events.find((e) => e.action === 'share.create' && e.target_id === token_id))
      .toMatchObject({ actor_type: 'agent', actor_id: a.agent_id });
  });
});

describe('revoking an API key', () => {
  it('ends the share links and role grants it made, and leaves those of other keys', async () => {
    const minted = await mintKeyRecord(a.headers);
    const link = { 'X-Share-Token': await shareToken(minted.headers, wsA, { permission: 'view' }) };
    const founderLink = { 'X-Share-Token': await shareToken(a.headers, wsA, { permission: 'view' }) };
    expect((await api(`/workspaces/${wsA}/roles`, 'POST', minted.headers, { email: 'guest@example.com', permission: 'view' })).status).toBe(201);
    const guest = await signIn('guest@example.com');
    const kept = await signIn('kept@example.com');
    expect(await readContent(link, wsA, fA)).toBe(SECRET);
    expect(await readContent(guest, wsA, fA)).toBe(SECRET);

    expect((await api(`/keys/${minted.key_id}`, 'DELETE', minted.headers)).status).toBe(200);

    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', link)).status).toBe(401);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', guest)).status).toBe(404);
    expect(await readContent(founderLink, wsA, fA)).toBe(SECRET);
    expect(await readContent(kept, wsA, fA)).toBe(SECRET);
  });
});

describe('an email-gated share link', () => {
  it('works only alongside a session for that email, and only for its file', async () => {
    const other = await writeFile(a.headers, wsA, 'other.md', 'other content');
    const token = await shareToken(a.headers, wsA, { permission: 'view', file_id: fA, email: 'Bob@Example.com' });
    const read = (who: Headers) => api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', who);

    expect((await read({ 'X-Share-Token': token })).status).toBe(401);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true&token=${token}`, 'GET', {})).status).toBe(401);
    const stranger = await signIn('stranger@example.com');
    expect((await read({ ...stranger, 'X-Share-Token': token })).status).toBe(401);

    const bob = await signIn('bob@example.com');
    expect(await readContent({ ...bob, 'X-Share-Token': token }, wsA, fA)).toBe(SECRET);
    expect((await api(`/workspaces/${wsA}/files/${other}?content=true`, 'GET', { ...bob, 'X-Share-Token': token })).status).toBe(404);
    expect((await api(`/workspaces/${wsA}/files`, 'GET', bob)).status).toBe(404);
  });

  it('takes the role it granted with it when a workspace-wide one is revoked', async () => {
    const { token, token_id } = await createShare(a.headers, wsA, { permission: 'view', email: 'bob@example.com' });
    const bob = await signIn('bob@example.com');
    expect(await readContent(bob, wsA, fA)).toBe(SECRET);
    expect(await readContent({ ...bob, 'X-Share-Token': token }, wsA, fA)).toBe(SECRET);

    expect((await api(`/workspaces/${wsA}/share/${token_id}`, 'DELETE', a.headers)).status).toBe(200);

    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', bob)).status).toBe(404);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', { ...bob, 'X-Share-Token': token })).status).toBe(401);
    expect(await env.KV.get(`role:${wsA}:kept@example.com`)).not.toBeNull();
  });

  it('takes the role it granted with it when a workspace-wide one expires', async () => {
    const { token } = await createShare(a.headers, wsA, { permission: 'edit', email: 'bob@example.com', expires_in: 60 });
    const bob = await signIn('bob@example.com');
    expect(await readContent(bob, wsA, fA)).toBe(SECRET);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 120_000);
      expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', bob)).status).toBe(404);
      expect((await api(`/workspaces/${wsA}/files/${fA}`, 'PUT', bob, { content: 'after expiry' })).status).toBe(404);
      expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', { ...bob, 'X-Share-Token': token })).status).toBe(401);
      expect(await readContent(await signIn('kept@example.com'), wsA, fA)).toBe(SECRET);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('review follow-ups', () => {
  it('a role granted to a capitalised email works for that person', async () => {
    const a = await registerAgent('A');
    const wsA = await createWorkspace(a.headers);
    expect((await api(`/workspaces/${wsA}/roles`, 'POST', a.headers, { email: 'Guest@Example.com', permission: 'view' })).status).toBe(201);
    const guest = await signIn('guest@example.com');
    expect((await api(`/workspaces/${wsA}`, 'GET', guest)).status).toBe(200);
  });

  it('a malformed write to a new workspace name leaves no empty workspace behind', async () => {
    const a = await registerAgent('A');
    const before = (await env.KV.list({ prefix: 'ws:' })).keys.length;
    expect((await api('/workspaces/scratch-notes/files', 'POST', a.headers, { path: '../escape', content: 'x' })).status).toBe(400);
    expect((await api('/workspaces/scratch-notes/files', 'POST', a.headers, { nope: true })).status).toBe(400);
    expect((await env.KV.list({ prefix: 'ws:' })).keys.length).toBe(before);
  });
});

describe('share-link review follow-ups', () => {
  it('a link on a workspace from before orgs keeps working until the workspace is claimed', async () => {
    const token = await shareToken(a.headers, wsA, { permission: 'view' });
    const { org_id: _drop, ...rest } = (await env.KV.get<WorkspaceMeta>(`ws:${wsA}`, 'json'))!;
    await env.KV.put(`ws:${wsA}`, JSON.stringify(rest));
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', { 'X-Share-Token': token })).status).toBe(200);
  });

  it('token-info no longer describes a link whose issuing key was revoked', async () => {
    await upgradeToTeam(a);
    const creator = await mintKeyRecord(a.headers);
    const token = await shareToken(creator.headers, wsA, { permission: 'view' });
    expect((await api(`/token-info/${token}`, 'GET', {})).status).toBe(200);
    expect((await api(`/keys/${creator.key_id}`, 'DELETE', creator.headers)).status).toBe(200);
    expect((await api(`/token-info/${token}`, 'GET', {})).status).toBe(401);
  });

  it('an email-gated link never replaces a manual role, and revoking it removes only the role it created', async () => {
    const role = async (email: string) => env.KV.get<{ permission: string }>(`role:${wsA}:${email}`, 'json');
    expect((await api(`/workspaces/${wsA}/roles`, 'POST', a.headers, { email: 'dave@example.com', permission: 'edit' })).status).toBe(201);
    const daveLink = await createShare(a.headers, wsA, { permission: 'view', email: 'dave@example.com' });
    expect((await role('dave@example.com'))!.permission).toBe('edit');
    expect((await api(`/workspaces/${wsA}/share/${daveLink.token_id}`, 'DELETE', a.headers)).status).toBe(200);
    expect((await role('dave@example.com'))!.permission).toBe('edit');

    const erinLink = await createShare(a.headers, wsA, { permission: 'view', email: 'erin@example.com' });
    expect(await role('erin@example.com')).not.toBeNull();
    expect((await api(`/workspaces/${wsA}/share/${erinLink.token_id}`, 'DELETE', a.headers)).status).toBe(200);
    expect(await role('erin@example.com')).toBeNull();
  });
});

describe('share-link use counting', () => {
  it('spends a use only when the link serves content or writes', async () => {
    const h = { 'X-Share-Token': await shareToken(a.headers, wsA, { permission: 'view', max_uses: 1 }) };
    expect((await api(`/workspaces/${wsA}/files`, 'GET', h)).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/files`, 'GET', h)).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', h)).status).toBe(200);
    expect((await api(`/workspaces/${wsA}/files/${fA}?content=true`, 'GET', h)).status).toBe(401);
  });
});
