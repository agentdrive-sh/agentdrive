import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

async function clearKv() {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

type RegisterOk = {
  success: true;
  data: {
    agent_id: string;
    api_key: string;
    org_id: string;
    org_name: string;
    plan: string;
    trial_ends_at?: string;
    agent_email?: string;
    agent_claim_url?: string;
  };
};

type RegisterErr = { success: false; error: string };

beforeEach(async () => {
  await clearKv();
});

describe('POST /v1/register', () => {
  it('returns 201 with an agent_id, api_key, org_id for a valid request', async () => {
    const res = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'TestBot', org_name: 'TestCo' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as RegisterOk;
    expect(body.success).toBe(true);
    expect(body.data.agent_id).toMatch(/^ag_/);
    expect(body.data.org_id).toMatch(/^org_/);
    expect(body.data.org_name).toBe('TestCo');
    expect(body.data.plan).toBe('trial');
    expect(typeof body.data.trial_ends_at).toBe('string');
  });

  it('api_key has the agentdrive_live_ prefix', async () => {
    const res = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'PrefixBot' }),
    });
    const body = (await res.json()) as RegisterOk;
    expect(body.data.api_key.startsWith('agentdrive_live_')).toBe(true);
  });

  it('defaults org_name to "<agent_name>\'s org" when omitted', async () => {
    const res = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'Solo' }),
    });
    const body = (await res.json()) as RegisterOk;
    expect(body.data.org_name).toBe("Solo's org");
  });

  it('produces distinct orgs, agents and keys across repeated calls', async () => {
    const mk = async () => {
      const r = await SELF.fetch('http://localhost/v1/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: 'Dup' }),
      });
      return (await r.json()) as RegisterOk;
    };
    const a = await mk();
    const b = await mk();
    expect(a.data.agent_id).not.toBe(b.data.agent_id);
    expect(a.data.org_id).not.toBe(b.data.org_id);
    expect(a.data.api_key).not.toBe(b.data.api_key);
  });

  it('rejects a missing body with 400', async () => {
    const res = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as RegisterErr;
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  it('rejects a body missing agent_name with 400', async () => {
    const res = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_name: 'OrgOnly' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects agent_name longer than 100 chars with 400', async () => {
    const res = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'x'.repeat(101) }),
    });
    expect(res.status).toBe(400);
  });

  it('succeeds gracefully when the inbox provider key is unset (agent_email fields omitted)', async () => {
    const res = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'NoInbox' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as RegisterOk;
    expect(body.data.agent_email).toBeUndefined();
    expect(body.data.agent_claim_url).toBeUndefined();
  });

  it('issued api_key authenticates against an authenticated endpoint', async () => {
    const reg = await SELF.fetch('http://localhost/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_name: 'AuthRound' }),
    });
    const body = (await reg.json()) as RegisterOk;
    const me = await SELF.fetch('http://localhost/v1/auth/me', {
      headers: { Authorization: `Bearer ${body.data.api_key}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { success: boolean; data: { type: string; agent_id: string } };
    expect(meBody.data.type).toBe('agent');
    expect(meBody.data.agent_id).toBe(body.data.agent_id);
  });
});
