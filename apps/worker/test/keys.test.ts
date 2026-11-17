import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashApiKey } from '@agentdrive/shared';
import { deliveredCode } from './magic-code-helper';

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

async function registerAgent(name = 'KeysBot', org = 'KeysCo'): Promise<{ api_key: string; org_id: string }> {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: name, org_name: org }),
  });
  const body = (await res.json()) as { success: boolean; data: { api_key: string; org_id: string } };
  if (!body.success) throw new Error('register failed');
  return body.data;
}

function auth(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

interface KeyRecord {
  key_id: string;
  name: string;
  prefix: string;
  created_at: string;
  api_key?: string;
}

interface ListOk { success: true; data: KeyRecord[]; cursor: string | null }

beforeEach(clearKv);

describe('GET /v1/keys', () => {
  it('lists the registration key as a managed key', async () => {
    const { api_key } = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/keys', { headers: auth(api_key) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListOk;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('KeysBot');
    expect(body.data[0].prefix).toContain('agentdrive_live_');
    expect(body.data[0].prefix).not.toContain(api_key.slice(20)); // secret tail not leaked whole
  });

  it('rejects callers without an org-scoped principal', async () => {
    const res = await SELF.fetch('http://localhost/v1/keys');
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/keys', () => {
  it('mints a new working key and returns the secret exactly once', async () => {
    const { api_key } = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/keys', {
      method: 'POST',
      headers: auth(api_key),
      body: JSON.stringify({ name: 'ci-runner' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: true; data: KeyRecord };
    expect(body.data.api_key).toMatch(/^agentdrive_live_/);
    expect(body.data.name).toBe('ci-runner');

    // The new key authenticates and now two keys are listed.
    const listRes = await SELF.fetch('http://localhost/v1/keys', { headers: auth(body.data.api_key as string) });
    const list = (await listRes.json()) as ListOk;
    expect(list.data).toHaveLength(2);
    expect(list.data.some((k) => k.name === 'ci-runner')).toBe(true);
  });

  it('rejects a missing name', async () => {
    const { api_key } = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/keys', {
      method: 'POST',
      headers: auth(api_key),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/keys/:key_id', () => {
  it('revokes a key so it no longer authenticates', async () => {
    const { api_key } = await registerAgent();
    const mintRes = await SELF.fetch('http://localhost/v1/keys', {
      method: 'POST',
      headers: auth(api_key),
      body: JSON.stringify({ name: 'throwaway' }),
    });
    const minted = (await mintRes.json()) as { data: KeyRecord };
    const newKey = minted.data.api_key as string;

    const delRes = await SELF.fetch(`http://localhost/v1/keys/${minted.data.key_id}`, {
      method: 'DELETE',
      headers: auth(newKey),
    });
    expect(delRes.status).toBe(200);

    // Revoked key is now invalid.
    const reuse = await SELF.fetch('http://localhost/v1/keys', { headers: auth(newKey) });
    expect(reuse.status).toBe(401);

    // The original key still works and now lists only itself.
    const listRes = await SELF.fetch('http://localhost/v1/keys', { headers: auth(api_key) });
    const list = (await listRes.json()) as ListOk;
    expect(list.data).toHaveLength(1);
  });

  it('records last use without rewriting the key record, so a request racing a revocation cannot restore the key', async () => {
    const { api_key } = await registerAgent();
    const recordKey = `api_key:${await hashApiKey(api_key)}`;
    const before = await env.KV.get(recordKey);

    let lastUsed: string | undefined;
    for (let i = 0; i < 20 && !lastUsed; i++) {
      const list = (await (await SELF.fetch('http://localhost/v1/keys', { headers: auth(api_key) })).json()) as { data: Array<{ last_used_at?: string }> };
      lastUsed = list.data[0]?.last_used_at;
    }
    expect(lastUsed).toBeDefined();
    expect(await env.KV.get(recordKey)).toBe(before);
  });

  it('returns 404 for an unknown key_id', async () => {
    const { api_key } = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/keys/kid_does_not_exist', {
      method: 'DELETE',
      headers: auth(api_key),
    });
    expect(res.status).toBe(404);
  });
});

describe('who may revoke a key', () => {
  let ipSeq = 0;
  function api(path: string, method: string, headers: Record<string, string>, body?: unknown): Promise<Response> {
    ipSeq += 1;
    return SELF.fetch(`http://localhost/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `10.7.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function signIn(email: string): Promise<{ headers: Record<string, string>; org_id: string }> {
    const code = await deliveredCode(email);
    const res = await api('/auth/verify-code', 'POST', {}, { email, code });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { session_id: string; org_id: string } };
    return { headers: { 'X-Session-Token': data.session_id }, org_id: data.org_id };
  }

  async function mint(who: Record<string, string>, name: string): Promise<{ key_id: string; headers: Record<string, string> }> {
    const res = await api('/keys', 'POST', who, { name });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: KeyRecord };
    return { key_id: data.key_id, headers: { Authorization: `Bearer ${data.api_key}` } };
  }

  const revoke = (who: Record<string, string>, keyId: string) => api(`/keys/${keyId}`, 'DELETE', who);

  async function orgWithMember(): Promise<{ owner: Record<string, string>; member: Record<string, string> }> {
    const owner = await signIn('owner@example.com');
    const meta = (await env.KV.get<Record<string, unknown>>(`org:${owner.org_id}`, 'json'))!;
    await env.KV.put(`org:${owner.org_id}`, JSON.stringify({ ...meta, plan: 'team' }));
    expect((await api('/org/invite', 'POST', owner.headers, { email: 'member@example.com', role: 'member' })).status).toBe(201);
    const member = await signIn('member@example.com');
    expect((await api(`/org/invites/${owner.org_id}/accept`, 'POST', member.headers)).status).toBe(200);
    return { owner: owner.headers, member: member.headers };
  }

  it('an agent key can revoke itself and keys it created, never the founding key', async () => {
    const { api_key } = await registerAgent();
    const founder = auth(api_key);
    const founderKeyId = ((await (await api('/keys', 'GET', founder)).json()) as ListOk).data[0].key_id;
    const second = await mint(founder, 'second');

    const third = await mint(founder, 'third');
    expect((await revoke(second.headers, founderKeyId)).status).toBe(403);
    expect((await revoke(second.headers, third.key_id)).status).toBe(403);
    expect((await revoke(founder, third.key_id)).status).toBe(200);
    expect((await api('/keys', 'GET', founder)).status).toBe(200);

    expect((await revoke(second.headers, second.key_id)).status).toBe(200);
    expect((await api('/keys', 'GET', second.headers)).status).toBe(401);
  });

  it("a member session can revoke only keys it created; an owner session can revoke any", async () => {
    const { owner, member } = await orgWithMember();
    const ownersKey = await mint(owner, 'owner key');
    const membersKey = await mint(member, 'member key');
    const membersOther = await mint(member, 'member key 2');

    const denied = await revoke(member, ownersKey.key_id);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toMatch(/owner/i);
    expect((await revoke(member, membersKey.key_id)).status).toBe(200);
    expect((await revoke(owner, membersOther.key_id)).status).toBe(200);
    expect((await revoke(owner, ownersKey.key_id)).status).toBe(200);
  });

  it('a key a member minted with their own agent key still counts as theirs', async () => {
    const { owner, member } = await orgWithMember();
    const membersKey = await mint(member, 'member key');
    const minted = await mint(membersKey.headers, 'minted by agent');
    const ownersKey = await mint(owner, 'owner key');
    expect((await revoke(member, minted.key_id)).status).toBe(200);
    expect((await revoke(membersKey.headers, ownersKey.key_id)).status).toBe(403);
  });
});

describe('PATCH /v1/org', () => {
  it('updates the org name', async () => {
    const { api_key } = await registerAgent();
    const res = await SELF.fetch('http://localhost/v1/org', {
      method: 'PATCH',
      headers: auth(api_key),
      body: JSON.stringify({ name: 'Renamed Co' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: true; data: { name: string } };
    expect(body.data.name).toBe('Renamed Co');

    const orgRes = await SELF.fetch('http://localhost/v1/org', { headers: auth(api_key) });
    const org = (await orgRes.json()) as { data: { name: string } };
    expect(org.data.name).toBe('Renamed Co');
  });
});
