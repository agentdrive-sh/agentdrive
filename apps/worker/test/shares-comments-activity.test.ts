import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

// Phase 0.5 characterization tests for the share-token + role + comment +
// activity surfaces. These pin status / auth / response-shape behavior
// before the route-split moves these handlers out of index.ts.
//
// Covered endpoints:
//
//   POST   /v1/workspaces/:wid/share
//   POST   /v1/workspaces/:wid/roles
//   GET    /v1/workspaces/:wid/roles
//   DELETE /v1/workspaces/:wid/roles/:email
//   POST   /v1/workspaces/:wid/files/:fid/comments
//   GET    /v1/workspaces/:wid/files/:fid/comments
//   GET    /v1/workspaces/:wid/activity

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

interface RegisterOk {
  success: true;
  data: { api_key: string; agent_id: string; org_id: string };
}

async function registerAgent(name = 'ShareBot', org = 'ShareOrg'): Promise<RegisterOk['data']> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: name, org_name: org }),
  });
  const body = (await res.json()) as RegisterOk;
  if (!body.success) throw new Error('register failed');
  return body.data;
}

function authHeader(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

interface WsCreateOk { success: true; data: { id: string; name: string } }
async function createWorkspace(apiKey: string, name = 'WS'): Promise<string> {
  const res = await SELF.fetch('http://localhost/v1/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as WsCreateOk;
  return body.data.id;
}

interface FileWriteOk {
  success: true;
  data: { id: string; path: string };
}
async function writeFile(apiKey: string, wid: string, path: string, content = 'hello'): Promise<string> {
  const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
    body: JSON.stringify({ path, content }),
  });
  const body = (await res.json()) as FileWriteOk;
  return body.data.id;
}

interface ApiErr { success: false; error: string }

interface ShareOk {
  success: true;
  data: {
    token_id: string;
    url: string;
    permission: 'view' | 'comment' | 'edit';
    email_gated: boolean;
    expires_at?: string;
  };
}

interface RoleOk {
  success: true;
  data: { workspace_id: string; email: string; permission: string; assigned_by: string };
}

interface RolesListOk {
  success: true;
  data: Array<{ email: string; permission: string }>;
  cursor: string | null;
}

interface CommentOk {
  success: true;
  data: {
    id: string;
    body: string;
    author_type: string;
    author_id: string;
    line_start?: number;
    line_end?: number;
  };
}

interface CommentsListOk {
  success: true;
  data: Array<{ id: string; body: string }>;
  cursor: string | null;
}

interface ActivityListOk {
  success: true;
  data: Array<{
    id: string;
    action: string;
    actor_type: string;
    actor_id: string;
    target_type?: string;
    target_id?: string;
  }>;
  cursor: string | null;
}

beforeEach(async () => {
  await clearKv();
});

describe('POST /v1/workspaces/:wid/share', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_x/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission: 'view' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when permission is missing or invalid', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ permission: 'admin' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErr;
    expect(body.success).toBe(false);
    expect(body.error.toLowerCase()).toMatch(/permission/);
  });

  it('returns 404 when workspace does not exist', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_missing/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ permission: 'view' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when file_id points to a non-existent file', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ permission: 'view', file_id: 'file_does_not_exist' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 201 + token_id + url + email_gated=false for a workspace-scoped link', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ permission: 'comment' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ShareOk;
    expect(body.success).toBe(true);
    expect(body.data.token_id).toMatch(/^tk_/);
    expect(body.data.permission).toBe('comment');
    expect(body.data.email_gated).toBe(false);
    expect(typeof body.data.url).toBe('string');
    expect(body.data.url).toMatch(/^https?:\/\//);
  });

  it('sets email_gated=true when email is provided and assigns role to that email', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const shareRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ permission: 'view', email: 'invitee@example.com' }),
    });
    expect(shareRes.status).toBe(201);
    const shareBody = (await shareRes.json()) as ShareOk;
    expect(shareBody.data.email_gated).toBe(true);

    const rolesRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles`, {
      headers: authHeader(agent.api_key),
    });
    const rolesBody = (await rolesRes.json()) as RolesListOk;
    expect(rolesBody.data.some((r) => r.email === 'invitee@example.com')).toBe(true);
  });
});

describe('POST /v1/workspaces/:wid/roles', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_x/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', permission: 'view' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing fields', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 + role payload on success', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ email: 'collab@example.com', permission: 'edit' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as RoleOk;
    expect(body.success).toBe(true);
    expect(body.data.workspace_id).toBe(wid);
    expect(body.data.email).toBe('collab@example.com');
    expect(body.data.permission).toBe('edit');
  });
});

describe('GET /v1/workspaces/:wid/roles', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_x/roles');
    expect(res.status).toBe(401);
  });

  it('returns the previously-assigned roles', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ email: 'a@example.com', permission: 'view' }),
    });
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ email: 'b@example.com', permission: 'comment' }),
    });

    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles`, {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RolesListOk;
    const emails = body.data.map((r) => r.email).sort();
    expect(emails).toEqual(['a@example.com', 'b@example.com']);
    expect(body.cursor).toBeNull();
  });
});

describe('DELETE /v1/workspaces/:wid/roles/:email', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_x/roles/a%40b.com', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when role is not assigned', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles/${encodeURIComponent('ghost@example.com')}`, {
      method: 'DELETE',
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 + deleted:true after a successful remove', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ email: 'gone@example.com', permission: 'view' }),
    });
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles/${encodeURIComponent('gone@example.com')}`, {
      method: 'DELETE',
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: true; data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);

    const listRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/roles`, {
      headers: authHeader(agent.api_key),
    });
    const listBody = (await listRes.json()) as RolesListOk;
    expect(listBody.data.some((r) => r.email === 'gone@example.com')).toBe(false);
  });
});

describe('POST /v1/workspaces/:wid/files/:fid/comments', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_x/files/file_y/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hi' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on empty body', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const fid = await writeFile(agent.api_key, wid, 'doc.md');
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/${fid}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ body: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when file does not exist', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/file_missing/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ body: 'hi' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 201 + comment payload with actor_type=agent', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const fid = await writeFile(agent.api_key, wid, 'doc.md');
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/${fid}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ body: 'looks good', line_start: 3, line_end: 5 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CommentOk;
    expect(body.success).toBe(true);
    expect(body.data.body).toBe('looks good');
    expect(body.data.author_type).toBe('agent');
    expect(body.data.line_start).toBe(3);
    expect(body.data.line_end).toBe(5);
  });
});

describe('GET /v1/workspaces/:wid/files/:fid/comments', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_x/files/file_y/comments');
    expect(res.status).toBe(401);
  });

  it('returns the prior comments on a file', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const fid = await writeFile(agent.api_key, wid, 'doc.md');
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/${fid}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ body: 'first' }),
    });
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/${fid}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ body: 'second' }),
    });
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/${fid}/comments`, {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CommentsListOk;
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2);
    const bodies = body.data.map((c) => c.body).sort();
    expect(bodies).toEqual(['first', 'second']);
  });
});

describe('GET /v1/workspaces/:wid/activity', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_x/activity');
    expect(res.status).toBe(401);
  });

  it('returns the activity feed for a workspace with prior writes', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    await writeFile(agent.api_key, wid, 'one.md', 'one');
    await writeFile(agent.api_key, wid, 'two.md', 'two');

    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/activity`, {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivityListOk;
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    const actions = body.data.map((e) => e.action);
    expect(actions.some((a) => a.startsWith('file.'))).toBe(true);
  });

  it('paginates with a cursor + returns null cursor on the last page', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    await writeFile(agent.api_key, wid, 'single.md');

    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/activity`, {
      headers: authHeader(agent.api_key),
    });
    const body = (await res.json()) as ActivityListOk;
    // With only one file written, all events fit on the first page.
    expect(body.cursor).toBeNull();
  });
});
