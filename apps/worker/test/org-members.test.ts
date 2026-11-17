import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

async function registerAgent(): Promise<string> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: 'MemBot', org_name: 'MemCo' }),
  });
  const body = (await res.json()) as { data: { api_key: string } };
  return body.data.api_key;
}

function auth(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

beforeEach(clearKv);

describe('org member invite + remove', () => {
  it('invites a member as pending, then revokes the invite', async () => {
    const key = await registerAgent();

    const inviteRes = await SELF.fetch('http://localhost/v1/org/invite', {
      method: 'POST',
      headers: auth(key),
      body: JSON.stringify({ email: 'teammate@example.com', role: 'member' }),
    });
    expect(inviteRes.status).toBe(201);

    type OrgBody = { data: { members: Array<{ email: string }>; invites: Array<{ email: string }> } };
    const org = (await (await SELF.fetch('http://localhost/v1/org', { headers: auth(key) })).json()) as OrgBody;
    expect(org.data.members.some((m) => m.email === 'teammate@example.com')).toBe(false);
    expect(org.data.invites.some((i) => i.email === 'teammate@example.com')).toBe(true);

    const delRes = await SELF.fetch(
      `http://localhost/v1/org/members/${encodeURIComponent('teammate@example.com')}`,
      { method: 'DELETE', headers: auth(key) },
    );
    expect(delRes.status).toBe(200);

    const after = (await (await SELF.fetch('http://localhost/v1/org', { headers: auth(key) })).json()) as OrgBody;
    expect(after.data.invites.some((i) => i.email === 'teammate@example.com')).toBe(false);
  });

  it('returns 404 removing a member that does not exist', async () => {
    const key = await registerAgent();
    const res = await SELF.fetch(
      `http://localhost/v1/org/members/${encodeURIComponent('ghost@example.com')}`,
      { method: 'DELETE', headers: auth(key) },
    );
    expect(res.status).toBe(404);
  });
});
