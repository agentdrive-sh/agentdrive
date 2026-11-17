import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

// Phase 0.5 characterization tests for the files CRUD endpoints.
// Codex F4 flagged the existing test suite did not cover the core
// REST matrix; without these pins, splitting the 1042-LOC index.ts
// into routes/*.ts modules is high-risk. Tests cover:
//
//   POST   /v1/workspaces/:wid/files             (create / update by path)
//   GET    /v1/workspaces/:wid/files             (list)
//   GET    /v1/workspaces/:wid/files/:fid        (read meta; optional content)
//   PUT    /v1/workspaces/:wid/files/:fid        (update by id)
//   DELETE /v1/workspaces/:wid/files/:fid        (delete; agent-only)
//   GET    /v1/workspaces/:wid/files/:fid/versions (version list)
//
// Each endpoint gets at minimum a happy-path + auth-boundary + 404 test.

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

interface RegisterOk {
  success: true;
  data: { api_key: string; agent_id: string; org_id: string };
}

async function registerAgent(name = 'FileBot', org = 'FileOrg'): Promise<RegisterOk['data']> {
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

interface WsCreateOk {
  success: true;
  data: { id: string; name: string };
}

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
  data: {
    id: string;
    workspace_id: string;
    path: string;
    content_hash: string;
    size: number;
    version: number;
    created_by: string;
    updated_by: string;
  };
}

interface FileGetOk {
  success: true;
  data: {
    id: string;
    path: string;
    content_hash: string;
    version: number;
    content?: string;
  };
}

interface FileListOk {
  success: true;
  data: Array<{ id: string; path: string; version: number }>;
  cursor: string | null;
}

interface VersionsOk {
  success: true;
  data: Array<{ version: number; content_hash: string; created_at: string }>;
  cursor: string | null;
}

interface DeleteOk {
  success: true;
  data: { deleted: true };
}

interface ApiErr {
  success: false;
  error: string;
}

beforeEach(async () => {
  await clearKv();
});

describe('POST /v1/workspaces/:wid/files', () => {
  it('rejects unauthenticated with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_nope/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.md', content: 'hi' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when path is missing', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ content: 'hi' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when content is missing', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'a.md' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the path fails validatePath (e.g., absolute path)', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: '/etc/passwd', content: 'pwn' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 with a file id matching ^f_ on first write', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'plan.md', content: 'first' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as FileWriteOk;
    expect(body.data.id).toMatch(/^f_/);
    expect(body.data.path).toBe('plan.md');
    expect(body.data.version).toBe(1);
  });

  it('returns 200 (not 201) when writing to an existing path (= update)', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'plan.md', content: 'first' }),
    });
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'plan.md', content: 'second' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileWriteOk;
    expect(body.data.version).toBe(2);
  });
});

describe('GET /v1/workspaces/:wid/files', () => {
  it('rejects unauthenticated with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_nope/files');
    expect(res.status).toBe(401);
  });

  it('returns an empty list for a new workspace', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileListOk;
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.cursor).toBeNull();
  });

  it('lists files after they are written', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'a.md', content: 'A' }),
    });
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'b.md', content: 'B' }),
    });
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      headers: authHeader(agent.api_key),
    });
    const body = (await res.json()) as FileListOk;
    expect(body.data.length).toBe(2);
    const paths = body.data.map((f) => f.path).sort();
    expect(paths).toEqual(['a.md', 'b.md']);
  });
});

describe('GET /v1/workspaces/:wid/files/:fid', () => {
  it('rejects unauthenticated with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_x/files/f_x');
    expect(res.status).toBe(401);
  });

  it('returns 404 for a missing file id', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/f_nope`, {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(404);
  });

  it('returns file meta (no content) by default', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const writeRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'plan.md', content: 'hi there' }),
    });
    const written = (await writeRes.json()) as FileWriteOk;

    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/${written.data.id}`, {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as FileGetOk;
    expect(body.data.id).toBe(written.data.id);
    expect(body.data.path).toBe('plan.md');
    expect(body.data.content).toBeUndefined();
  });

  it('includes content when ?content=true', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const writeRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'plan.md', content: 'inline content' }),
    });
    const written = (await writeRes.json()) as FileWriteOk;
    const res = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${written.data.id}?content=true`,
      { headers: authHeader(agent.api_key) },
    );
    const body = (await res.json()) as FileGetOk;
    expect(body.data.content).toBe('inline content');
  });
});

describe('PUT /v1/workspaces/:wid/files/:fid', () => {
  it('returns 404 if file does not exist', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/f_nope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ content: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('updates content and bumps version', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const writeRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'plan.md', content: 'v1' }),
    });
    const written = (await writeRes.json()) as FileWriteOk;
    const putRes = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${written.data.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
        body: JSON.stringify({ content: 'v2' }),
      },
    );
    expect(putRes.status).toBe(200);
    const body = (await putRes.json()) as FileWriteOk;
    expect(body.data.version).toBe(2);
    expect(body.data.path).toBe('plan.md');
  });
});

describe('DELETE /v1/workspaces/:wid/files/:fid', () => {
  it('returns 404 if file does not exist', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files/f_nope`, {
      method: 'DELETE',
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(404);
  });

  it('deletes an existing file (agent auth)', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    const writeRes = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'gone.md', content: 'bye' }),
    });
    const written = (await writeRes.json()) as FileWriteOk;

    const delRes = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${written.data.id}`,
      { method: 'DELETE', headers: authHeader(agent.api_key) },
    );
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as DeleteOk;
    expect(body.data.deleted).toBe(true);

    const getRes = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${written.data.id}`,
      { headers: authHeader(agent.api_key) },
    );
    expect(getRes.status).toBe(404);
  });
});

describe('GET /v1/workspaces/:wid/files/:fid/versions', () => {
  it('returns the version list after multiple writes (cursor pagination shape)', async () => {
    const agent = await registerAgent();
    const wid = await createWorkspace(agent.api_key);
    await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'plan.md', content: 'v1' }),
    });
    const writeRes2 = await SELF.fetch(`http://localhost/v1/workspaces/${wid}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ path: 'plan.md', content: 'v2' }),
    });
    const written = (await writeRes2.json()) as FileWriteOk;

    const res = await SELF.fetch(
      `http://localhost/v1/workspaces/${wid}/files/${written.data.id}/versions`,
      { headers: authHeader(agent.api_key) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as VersionsOk;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect('cursor' in body).toBe(true);
  });
});
