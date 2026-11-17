import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

// Phase 0.5 characterization tests for /v1/workspaces.
// Pins request -> status, auth boundary, and response shape so the
// Phase 0.5 route-split can refactor index.ts safely. Codex F4: the
// existing test suite did not cover this surface; without these
// pins, the mechanical split is high-risk.

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

interface RegisterOk {
  success: true;
  data: { api_key: string; agent_id: string; org_id: string };
}

async function registerAgent(name = 'CharBot', org = 'CharOrg'): Promise<RegisterOk['data']> {
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

interface WorkspacesListOk {
  success: true;
  data: Array<{ id: string; name: string; created_by: string }>;
  cursor: string | null;
}

interface WorkspaceCreateOk {
  success: true;
  data: { id: string; name: string; created_by: string; org_id?: string };
}

interface WorkspaceGetOk {
  success: true;
  data: { id: string; name: string };
}

interface ApiErr {
  success: false;
  error: string;
}

beforeEach(async () => {
  await clearKv();
});

describe('GET /v1/workspaces', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces');
    expect(res.status).toBe(401);
  });

  it('returns empty list + null cursor for a new agent with no workspaces', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/workspaces', {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspacesListOk;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.cursor).toBeNull();
  });

  it('returns workspaces created by the same org after creation', async () => {
    const agent = await registerAgent();
    await SELF.fetch('http://localhost/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ name: 'Alpha' }),
    });
    const res = await SELF.fetch('http://localhost/v1/workspaces', {
      headers: authHeader(agent.api_key),
    });
    const body = (await res.json()) as WorkspacesListOk;
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.name).toBe('Alpha');
  });
});

describe('POST /v1/workspaces', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErr;
    expect(body.success).toBe(false);
    expect(body.error.toLowerCase()).toMatch(/name/);
  });

  it('returns 400 when name is too long (>100 chars)', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ name: 'x'.repeat(101) }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 with a workspace id matching ^ws_', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ name: 'Beta' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as WorkspaceCreateOk;
    expect(body.success).toBe(true);
    expect(body.data.id).toMatch(/^ws_/);
    expect(body.data.name).toBe('Beta');
  });
});

describe('GET /v1/workspaces/:wid', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_nope');
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent workspace', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/workspaces/ws_does_not_exist', {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiErr;
    expect(body.success).toBe(false);
    expect(body.error.toLowerCase()).toMatch(/not found/);
  });

  it('returns 200 + data for an existing workspace', async () => {
    const agent = await registerAgent();
    const createRes = await SELF.fetch('http://localhost/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ name: 'Gamma' }),
    });
    const created = (await createRes.json()) as WorkspaceCreateOk;
    const wid = created.data.id;

    const res = await SELF.fetch(`http://localhost/v1/workspaces/${wid}`, {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspaceGetOk;
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(wid);
    expect(body.data.name).toBe('Gamma');
  });
});
