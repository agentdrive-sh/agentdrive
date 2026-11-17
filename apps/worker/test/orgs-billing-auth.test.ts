import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { deliveredCode } from './magic-code-helper';

// Phase 0.5 characterization tests for org, billing, magic-link auth,
// and token-info routes. These pin status / auth / response-shape
// behavior before the route-split moves these handlers out of index.ts.
//
// Covered endpoints:
//
//   POST /v1/auth/send-code
//   POST /v1/auth/verify-code
//   GET  /v1/token-info/:token
//   GET  /v1/auth/me
//   POST /v1/auth/logout
//   GET  /v1/org
//   POST /v1/org/invite
//   GET  /v1/billing/plan
//
// search / context / runs are already covered by their own dedicated
// test files; not re-pinned here.

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

interface RegisterOk {
  success: true;
  data: { api_key: string; agent_id: string; org_id: string };
}

async function registerAgent(name = 'OrgBot', org = 'OrgCo'): Promise<RegisterOk['data']> {
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

interface ApiErr { success: false; error: string }

interface OrgOk {
  success: true;
  data: {
    id: string;
    name: string;
    plan: string;
    agents: Array<{ agent_id: string; agent_name?: string }>;
    members: Array<{ email: string; role: string }>;
    usage: { storage_bytes: number; agent_count: number; workspace_count: number; member_count: number };
    quota: { storage_bytes: number; max_agents: number; max_workspaces: number; max_human_seats: number };
  };
  agents_cursor: string | null;
  members_cursor: string | null;
}

interface BillingOk {
  success: true;
  data: {
    plan: string;
    trial_ends_at?: string;
    usage: Record<string, number>;
    quota: Record<string, number>;
  };
}

interface AuthMeAgentOk {
  success: true;
  data: { type: 'agent'; agent_id: string; agent_name?: string; org_id?: string };
}

interface SendCodeOk { success: true; data: { message: string } }

interface VerifyCodeOk {
  success: true;
  data: { session_id: string; email: string; org_id?: string; expires_at: string };
}

interface InviteOk {
  success: true;
  data: { org_id: string; email: string; role: string; expires_at: string };
}

beforeEach(async () => {
  await clearKv();
});

describe('POST /v1/auth/send-code', () => {
  it('returns 400 on missing email', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErr;
    expect(body.success).toBe(false);
    expect(body.error.toLowerCase()).toMatch(/email/);
  });

  it('returns 400 on invalid email', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 + message for a valid email (test env stubs email send)', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'someone@example.com' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SendCodeOk;
    expect(body.success).toBe(true);
    expect(typeof body.data.message).toBe('string');
  });
});

describe('POST /v1/auth/verify-code', () => {
  it('returns 400 on missing fields', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on code that is not 6 chars', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', code: '12' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 on an unknown code', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', code: '000000' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiErr;
    expect(body.error.toLowerCase()).toMatch(/invalid|expired/);
  });

  it('returns 200 + session_id after sending then verifying the code', async () => {
    const email = 'session-user@example.com';
    await SELF.fetch('http://localhost/v1/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const mcode = { code: await deliveredCode(email) };
    const res = await SELF.fetch('http://localhost/v1/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: mcode.code }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as VerifyCodeOk;
    expect(body.success).toBe(true);
    expect(body.data.session_id).toMatch(/^sess_/);
    expect(body.data.email).toBe(email);
  });

  it('gives a first-time email its own org, like OAuth sign-in, so it can subscribe', async () => {
    const email = 'web-signup@example.com';
    await SELF.fetch('http://localhost/v1/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const code = await deliveredCode(email);
    const res = await SELF.fetch('http://localhost/v1/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    const { data } = (await res.json()) as { data: { session_id: string; org_id?: string } };
    expect(data.org_id).toMatch(/^org_/);
    const plan = await SELF.fetch('http://localhost/v1/billing/plan', { headers: { 'X-Session-Token': data.session_id } });
    expect(plan.status).toBe(200);
  });
});

describe('GET /v1/token-info/:token', () => {
  it('returns 401 on a garbage token', async () => {
    const res = await SELF.fetch('http://localhost/v1/token-info/this.is.not.a.token');
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/auth/me', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns type=agent payload for a Bearer API key', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/auth/me', {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthMeAgentOk;
    expect(body.success).toBe(true);
    expect(body.data.type).toBe('agent');
    expect(body.data.agent_id).toBe(agent.agent_id);
    expect(body.data.org_id).toBe(agent.org_id);
  });
});

describe('POST /v1/auth/logout', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/logout', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when the principal is an agent, not a session', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/auth/logout', {
      method: 'POST',
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErr;
    expect(body.error.toLowerCase()).toMatch(/session/);
  });
});

describe('GET /v1/org', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/org');
    expect(res.status).toBe(401);
  });

  it('returns the registered org with agents + members + usage + quota', async () => {
    const agent = await registerAgent('Alice', 'Acme');
    const res = await SELF.fetch('http://localhost/v1/org', {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrgOk;
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(agent.org_id);
    expect(body.data.name).toBe('Acme');
    expect(Array.isArray(body.data.agents)).toBe(true);
    expect(body.data.agents.some((a) => a.agent_id === agent.agent_id)).toBe(true);
    expect(Array.isArray(body.data.members)).toBe(true);
    expect(typeof body.data.usage.storage_bytes).toBe('number');
    expect(typeof body.data.quota.max_agents).toBe('number');
    expect(body.agents_cursor).toBeNull();
    expect(body.members_cursor).toBeNull();
  });
});

describe('POST /v1/org/invite', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/org/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing/invalid email', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/org/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 + pending invite record for a valid invite', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/org/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(agent.api_key) },
      body: JSON.stringify({ email: 'new-member@example.com', role: 'member' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as InviteOk;
    expect(body.success).toBe(true);
    expect(body.data.org_id).toBe(agent.org_id);
    expect(body.data.email).toBe('new-member@example.com');
    expect(body.data.role).toBe('member');
    expect(Date.parse(body.data.expires_at)).toBeGreaterThan(Date.now());
  });
});

describe('GET /v1/billing/plan', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await SELF.fetch('http://localhost/v1/billing/plan');
    expect(res.status).toBe(401);
  });

  it('returns plan/usage/quota for the registered org', async () => {
    const agent = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/billing/plan', {
      headers: authHeader(agent.api_key),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BillingOk;
    expect(body.success).toBe(true);
    expect(typeof body.data.plan).toBe('string');
    expect(typeof body.data.usage).toBe('object');
    expect(typeof body.data.quota).toBe('object');
    expect(typeof body.data.quota.max_agents).toBe('number');
  });
});
