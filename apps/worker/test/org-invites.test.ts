import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { deliveredCode } from './magic-code-helper';

async function clearKv(): Promise<void> {
  const list = await env.KV.list();
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
}

beforeEach(clearKv);

let ipSeq = 0;
function freshIp(): Record<string, string> {
  ipSeq += 1;
  return { 'cf-connecting-ip': `10.1.${Math.floor(ipSeq / 250)}.${ipSeq % 250}` };
}

type Headers = Record<string, string>;

function api(path: string, method: string, headers: Headers, body?: unknown): Promise<Response> {
  return SELF.fetch(`http://localhost/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...freshIp(), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(email: string): Promise<{ headers: Headers; org_id: string }> {
  const code = await deliveredCode(email);
  const res = await api('/auth/verify-code', 'POST', {}, { email, code });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: { session_id: string; org_id: string } };
  return { headers: { 'X-Session-Token': data.session_id }, org_id: data.org_id };
}

async function registerOrg(): Promise<{ headers: Headers; org_id: string }> {
  const res = await api('/register', 'POST', {}, { agent_name: 'InviteBot', org_name: 'InviterCo' });
  const { data } = (await res.json()) as { data: { api_key: string; org_id: string } };
  return { headers: { Authorization: `Bearer ${data.api_key}` }, org_id: data.org_id };
}

async function invite(from: Headers, email: string, role = 'member'): Promise<Response> {
  return api('/org/invite', 'POST', from, { email, role });
}

interface InviteRow { org_id: string; org_name: string; email: string; role: string; invited_by: string }

async function myInvites(who: Headers): Promise<InviteRow[]> {
  const res = await api('/org/invites', 'GET', who);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: InviteRow[] }).data;
}

interface OrgView { members: Array<{ email: string; role: string }>; invites: InviteRow[]; usage: { member_count: number }; quota: { max_human_seats: number } }

async function orgView(who: Headers): Promise<OrgView> {
  return ((await (await api('/org', 'GET', who)).json()) as { data: OrgView }).data;
}

describe('org invites need the invitee to accept', () => {
  it('an invite does not change the invitee sign-in org until they accept', async () => {
    const alice = await signIn('alice@example.com');
    const attacker = await registerOrg();

    expect((await invite(attacker.headers, 'alice@example.com')).status).toBe(201);

    const again = await signIn('alice@example.com');
    expect(again.org_id).toBe(alice.org_id);
    const attackerOrg = await orgView(attacker.headers);
    expect(attackerOrg.members.some((m) => m.email === 'alice@example.com')).toBe(false);
    expect(attackerOrg.invites.map((i) => i.email)).toEqual(['alice@example.com']);
  });

  it('only the invitee session can list, accept or decline the invite', async () => {
    const inviter = await registerOrg();
    await invite(inviter.headers, 'alice@example.com');
    const bob = await signIn('bob@example.com');

    expect(await myInvites(bob.headers)).toEqual([]);
    expect((await api(`/org/invites/${inviter.org_id}/accept`, 'POST', bob.headers)).status).toBe(404);
    expect((await api(`/org/invites/${inviter.org_id}/decline`, 'POST', bob.headers)).status).toBe(404);

    expect((await api('/org/invites', 'GET', inviter.headers)).status).toBe(403);
    expect((await api(`/org/invites/${inviter.org_id}/accept`, 'POST', inviter.headers)).status).toBe(403);
    expect((await api(`/org/invites/${inviter.org_id}/decline`, 'POST', inviter.headers)).status).toBe(403);

    const alice = await signIn('alice@example.com');
    const pending = await myInvites(alice.headers);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ org_id: inviter.org_id, org_name: 'InviterCo', email: 'alice@example.com', role: 'member' });
    expect((await orgView(inviter.headers)).members.some((m) => m.email === 'bob@example.com')).toBe(false);
  });

  it('matches the invite to the session email case-insensitively', async () => {
    const inviter = await registerOrg();
    await invite(inviter.headers, 'Alice@Example.com');
    const alice = await signIn('alice@example.com');
    expect((await myInvites(alice.headers)).map((i) => i.org_id)).toEqual([inviter.org_id]);
  });

  it('accepting makes the invitee a member and moves their sign-in org', async () => {
    const alice = await signIn('alice@example.com');
    const inviter = await registerOrg();
    await invite(inviter.headers, 'alice@example.com', 'admin');

    const res = await api(`/org/invites/${inviter.org_id}/accept`, 'POST', alice.headers);
    expect(res.status).toBe(200);

    const org = await orgView(inviter.headers);
    expect(org.members).toEqual([expect.objectContaining({ email: 'alice@example.com', role: 'admin' })]);
    expect(org.invites).toEqual([]);
    expect(org.usage.member_count).toBe(1);
    expect(await myInvites(alice.headers)).toEqual([]);

    const me = (await (await api('/auth/me', 'GET', alice.headers)).json()) as { data: { org_id: string } };
    expect(me.data.org_id).toBe(inviter.org_id);
    expect((await signIn('alice@example.com')).org_id).toBe(inviter.org_id);
  });

  it('enforces the seat limit when the invite is accepted', async () => {
    const inviter = await registerOrg();
    expect((await invite(inviter.headers, 'alice@example.com')).status).toBe(201);
    expect((await invite(inviter.headers, 'bob@example.com')).status).toBe(201);

    const alice = await signIn('alice@example.com');
    expect((await api(`/org/invites/${inviter.org_id}/accept`, 'POST', alice.headers)).status).toBe(200);

    const bob = await signIn('bob@example.com');
    const res = await api(`/org/invites/${inviter.org_id}/accept`, 'POST', bob.headers);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; code: string; metric: string; upgrade_url: string };
    expect(body).toMatchObject({ code: 'plan_limit', metric: 'member_count', upgrade_url: 'http://localhost:3001/billing/upgrade?plan=pro' });
    expect(body.error).toMatch(/seats/i);
    expect((await invite(inviter.headers, 'carol@example.com')).status).toBe(402);

    expect((await signIn('bob@example.com')).org_id).toBe(bob.org_id);
    expect((await orgView(inviter.headers)).members.map((m) => m.email)).toEqual(['alice@example.com']);
  });

  it('caps a team org at its purchased seats, or 3 when none are recorded', async () => {
    const inviter = await registerOrg();
    const setOrg = async (fields: Record<string, unknown>) => {
      const org = await env.KV.get<Record<string, unknown>>(`org:${inviter.org_id}`, 'json');
      await env.KV.put(`org:${inviter.org_id}`, JSON.stringify({ ...org, ...fields }));
    };
    await setOrg({ plan: 'team' });
    const join = async (email: string) => {
      await invite(inviter.headers, email);
      return api(`/org/invites/${inviter.org_id}/accept`, 'POST', (await signIn(email)).headers);
    };
    for (const name of ['a', 'b', 'c']) expect((await join(`${name}@example.com`)).status).toBe(200);
    expect((await invite(inviter.headers, 'd@example.com')).status).toBe(402);

    await setOrg({ seats: 4 });
    expect((await join('d@example.com')).status).toBe(200);
    expect((await invite(inviter.headers, 'e@example.com')).status).toBe(402);
    expect((await orgView(inviter.headers)).quota.max_human_seats).toBe(4);
  });

  it('declining deletes the invite and leaves the sign-in org alone', async () => {
    const alice = await signIn('alice@example.com');
    const inviter = await registerOrg();
    await invite(inviter.headers, 'alice@example.com');

    expect((await api(`/org/invites/${inviter.org_id}/decline`, 'POST', alice.headers)).status).toBe(200);
    expect(await myInvites(alice.headers)).toEqual([]);
    expect((await orgView(inviter.headers)).invites).toEqual([]);
    expect((await api(`/org/invites/${inviter.org_id}/accept`, 'POST', alice.headers)).status).toBe(404);
    expect((await signIn('alice@example.com')).org_id).toBe(alice.org_id);
  });

  it('lets the inviting org revoke a pending invite', async () => {
    const inviter = await registerOrg();
    await invite(inviter.headers, 'alice@example.com');

    const del = await api(`/org/members/${encodeURIComponent('alice@example.com')}`, 'DELETE', inviter.headers);
    expect(del.status).toBe(200);

    const alice = await signIn('alice@example.com');
    expect(await myInvites(alice.headers)).toEqual([]);
    expect((await api(`/org/invites/${inviter.org_id}/accept`, 'POST', alice.headers)).status).toBe(404);
  });

  it('a removed member signs back in to an org they still belong to', async () => {
    const alice = await signIn('alice@example.com');
    const inviter = await registerOrg();
    await invite(inviter.headers, 'alice@example.com');
    await api(`/org/invites/${inviter.org_id}/accept`, 'POST', alice.headers);

    const del = await api(`/org/members/${encodeURIComponent('alice@example.com')}`, 'DELETE', inviter.headers);
    expect(del.status).toBe(200);

    expect((await signIn('alice@example.com')).org_id).toBe(alice.org_id);
  });

  it('falls back to an own org whose membership predates the membership index', async () => {
    const legacyOrg = 'org_legacyowned';
    await env.KV.put(`org:${legacyOrg}`, JSON.stringify({ id: legacyOrg, name: 'Legacy', plan: 'trial', created_at: new Date().toISOString(), created_by: 'alice@example.com' }));
    await env.KV.put(`org_member:${legacyOrg}:alice@example.com`, JSON.stringify({ org_id: legacyOrg, email: 'alice@example.com', role: 'owner', joined_at: new Date().toISOString(), invited_by: 'alice@example.com' }));
    await env.KV.put('idx:email_org:alice@example.com', legacyOrg);

    const alice = await signIn('alice@example.com');
    expect(alice.org_id).toBe(legacyOrg);
    const inviter = await registerOrg();
    await invite(inviter.headers, 'alice@example.com');
    await api(`/org/invites/${inviter.org_id}/accept`, 'POST', alice.headers);
    await api(`/org/members/${encodeURIComponent('alice@example.com')}`, 'DELETE', inviter.headers);

    expect((await signIn('alice@example.com')).org_id).toBe(legacyOrg);
  });

  it('stores an accepted membership under the lowercased email so a mixed-case sign-in resolves to it', async () => {
    const inviter = await registerOrg();
    await invite(inviter.headers, 'bob@example.com');
    const bob = await signIn('Bob@Example.com');

    expect((await api(`/org/invites/${inviter.org_id}/accept`, 'POST', bob.headers)).status).toBe(200);

    expect(await env.KV.get(`org_member:${inviter.org_id}:bob@example.com`)).not.toBeNull();
    expect(await env.KV.get(`org_member:${inviter.org_id}:Bob@Example.com`)).toBeNull();
    expect(await env.KV.get('idx:email_org:bob@example.com')).toBe(inviter.org_id);
    expect((await orgView(inviter.headers)).members.map((m) => m.email)).toEqual(['bob@example.com']);
    expect((await api('/org', 'GET', bob.headers)).status).toBe(200);
    expect((await signIn('Bob@Example.com')).org_id).toBe(inviter.org_id);
    expect((await signIn('bob@example.com')).org_id).toBe(inviter.org_id);
  });
});

async function joinOrg(email: string, inviter: Headers, orgId: string, role = 'member'): Promise<Headers> {
  expect((await invite(inviter, email, role)).status).toBe(201);
  const who = await signIn(email);
  expect((await api(`/org/invites/${orgId}/accept`, 'POST', who.headers)).status).toBe(200);
  return who.headers;
}

async function mintKey(who: Headers, name: string): Promise<{ headers: Headers; org_id: string }> {
  const res = await api('/keys', 'POST', who, { name });
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: { api_key: string; org_id: string } };
  return { headers: { Authorization: `Bearer ${data.api_key}` }, org_id: data.org_id };
}

async function cliLogin(who: Headers): Promise<Headers> {
  const start = (await (await api('/auth/cli/start', 'POST', {}, { shows_user_code: true })).json()) as { data: { id: string; user_code: string; device_code: string } };
  expect((await api('/auth/cli/complete', 'POST', who, { id: start.data.id, user_code: start.data.user_code })).status).toBe(200);
  const poll = (await (await api('/auth/cli/poll', 'POST', {}, { id: start.data.id, device_code: start.data.device_code })).json()) as { data: { api_key: string } };
  return { Authorization: `Bearer ${poll.data.api_key}` };
}

function removeMember(by: Headers, email: string): Promise<Response> {
  return api(`/org/members/${encodeURIComponent(email)}`, 'DELETE', by);
}

describe('removing a member ends their access to the org', () => {
  it("drops the org from the removed member's existing session and their next sign-in lands elsewhere", async () => {
    const alice = await signIn('alice@example.com');
    const inviter = await registerOrg();
    const aliceInOrg = await joinOrg('alice@example.com', inviter.headers, inviter.org_id);
    expect((await api('/org', 'GET', aliceInOrg)).status).toBe(200);

    expect((await removeMember(inviter.headers, 'alice@example.com')).status).toBe(200);

    expect((await api('/org', 'GET', aliceInOrg)).status).toBe(404);
    expect((await api('/keys', 'POST', aliceInOrg, { name: 'after removal' })).status).toBe(403);
    const me = (await (await api('/auth/me', 'GET', aliceInOrg)).json()) as { data: { org_id?: string } };
    expect(me.data.org_id).toBeUndefined();
    expect((await signIn('alice@example.com')).org_id).toBe(alice.org_id);
  });

  it('gives a removed member with no other org a fresh one at next sign-in', async () => {
    const alice = await signIn('alice@example.com');
    const inviter = await registerOrg();
    await joinOrg('alice@example.com', inviter.headers, inviter.org_id);
    await env.KV.delete(`org_member:${alice.org_id}:alice@example.com`);
    await env.KV.delete(`idx:member_orgs:alice@example.com:${alice.org_id}`);

    expect((await removeMember(inviter.headers, 'alice@example.com')).status).toBe(200);

    const next = await signIn('alice@example.com');
    expect(next.org_id).not.toBe(inviter.org_id);
    expect(next.org_id).not.toBe(alice.org_id);
    expect((await api('/org', 'GET', next.headers)).status).toBe(200);
  });

  it('revokes the keys the removed member created in that org, and only those', async () => {
    const alice = await signIn('alice@example.com');
    const ownKey = await mintKey(alice.headers, 'alice own org');
    expect(ownKey.org_id).toBe(alice.org_id);

    const inviter = await registerOrg();
    // This test mints more agent keys than the Free plan's agent limit allows.
    const org = JSON.parse((await env.KV.get(`org:${inviter.org_id}`))!) as Record<string, unknown>;
    await env.KV.put(`org:${inviter.org_id}`, JSON.stringify({ ...org, plan: 'team' }));
    const aliceInOrg = await joinOrg('alice@example.com', inviter.headers, inviter.org_id);
    const sessionKey = await mintKey(aliceInOrg, 'alice laptop');
    expect(sessionKey.org_id).toBe(inviter.org_id);
    const childKey = await mintKey(sessionKey.headers, 'minted by alice key');
    const cliKey = await cliLogin(aliceInOrg);
    const orgKey = await mintKey(inviter.headers, 'org agent');

    for (const k of [sessionKey.headers, childKey.headers, cliKey]) {
      expect((await api('/org', 'GET', k)).status).toBe(200);
    }

    expect((await removeMember(inviter.headers, 'alice@example.com')).status).toBe(200);

    for (const k of [sessionKey.headers, childKey.headers, cliKey]) {
      expect((await api('/org', 'GET', k)).status).toBe(401);
    }
    expect((await api('/org', 'GET', inviter.headers)).status).toBe(200);
    expect((await api('/org', 'GET', orgKey.headers)).status).toBe(200);
    expect((await api('/org', 'GET', ownKey.headers)).status).toBe(200);
  });
});

describe('only owners can remove an owner or invite one', () => {
  async function teamOrg(): Promise<{ headers: Headers; org_id: string }> {
    const owner = await signIn('owner@example.com');
    const org = JSON.parse((await env.KV.get(`org:${owner.org_id}`))!) as Record<string, unknown>;
    await env.KV.put(`org:${owner.org_id}`, JSON.stringify({ ...org, plan: 'team' }));
    return owner;
  }

  it('refuses a non-owner session or an agent key', async () => {
    const owner = await teamOrg();
    const bob = await joinOrg('bob@example.com', owner.headers, owner.org_id, 'admin');
    const agent = await mintKey(owner.headers, 'owner agent');

    expect((await invite(bob, 'carol@example.com', 'owner')).status).toBe(403);
    expect((await invite(agent.headers, 'carol@example.com', 'owner')).status).toBe(403);
    expect((await removeMember(bob, 'owner@example.com')).status).toBe(403);
    expect((await removeMember(agent.headers, 'owner@example.com')).status).toBe(403);
    expect((await orgView(owner.headers)).members.map((m) => m.email)).toContain('owner@example.com');

    expect((await invite(bob, 'carol@example.com', 'member')).status).toBe(201);
    expect((await removeMember(agent.headers, 'bob@example.com')).status).toBe(403);
    expect((await removeMember(owner.headers, 'bob@example.com')).status).toBe(200);
  });

  it('lets an owner invite and remove another owner', async () => {
    const owner = await teamOrg();
    await joinOrg('dave@example.com', owner.headers, owner.org_id, 'owner');
    expect((await orgView(owner.headers)).members).toContainEqual(expect.objectContaining({ email: 'dave@example.com', role: 'owner' }));

    expect((await removeMember(owner.headers, 'dave@example.com')).status).toBe(200);
    expect((await orgView(owner.headers)).members.map((m) => m.email)).toEqual(['owner@example.com']);
  });

  it("won't let the last owner leave the org without an owner", async () => {
    const owner = await teamOrg();
    expect((await removeMember(owner.headers, 'owner@example.com')).status).toBe(409);
    await joinOrg('dave@example.com', owner.headers, owner.org_id, 'owner');
    expect((await removeMember(owner.headers, 'owner@example.com')).status).toBe(200);
  });

  it('refuses an owner invite from the founding agent key of a registered org', async () => {
    const inviter = await registerOrg();
    expect((await invite(inviter.headers, 'alice@example.com', 'owner')).status).toBe(403);
  });

  it('lets only an owner or admin, or their keys, invite an admin', async () => {
    const owner = await teamOrg();
    const org = JSON.parse((await env.KV.get(`org:${owner.org_id}`))!) as Record<string, unknown>;
    await env.KV.put(`org:${owner.org_id}`, JSON.stringify({ ...org, seats: 10 }));
    const admin = await joinOrg('adm@example.com', owner.headers, owner.org_id, 'admin');
    const member = await joinOrg('m1@example.com', owner.headers, owner.org_id, 'member');
    const memberKey = await mintKey(member, 'member agent');

    expect((await invite(member, 'mallory@example.com', 'admin')).status).toBe(403);
    expect((await invite(memberKey.headers, 'mallory@example.com', 'admin')).status).toBe(403);
    expect((await orgView(owner.headers)).invites.map((i) => i.email)).not.toContain('mallory@example.com');
    expect((await invite(member, 'mallory@example.com', 'member')).status).toBe(201);

    expect((await invite(admin, 'erin@example.com', 'admin')).status).toBe(201);
    expect((await invite((await mintKey(owner.headers, 'owner agent')).headers, 'carol@example.com', 'admin')).status).toBe(201);
  });
});

describe('who can revoke keys and remove members', () => {
  async function newKey(who: Headers, name: string): Promise<{ headers: Headers; key_id: string }> {
    const res = await api('/keys', 'POST', who, { name });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { api_key: string; key_id: string } };
    return { headers: { Authorization: `Bearer ${data.api_key}` }, key_id: data.key_id };
  }
  async function toTeam(orgId: string): Promise<void> {
    const org = JSON.parse((await env.KV.get(`org:${orgId}`))!) as Record<string, unknown>;
    await env.KV.put(`org:${orgId}`, JSON.stringify({ ...org, plan: 'team', seats: 5 }));
  }

  it('an agent-created org can still revoke the keys its agents created', async () => {
    const founder = await registerOrg();
    const ci = await newKey(founder.headers, 'ci');
    const child = await newKey(ci.headers, 'child');
    expect((await api(`/keys/${child.key_id}`, 'DELETE', ci.headers)).status).toBe(200);

    const other = await newKey(founder.headers, 'other');
    expect((await api(`/keys/${other.key_id}`, 'DELETE', ci.headers)).status).toBe(403);
    expect((await api(`/keys/${other.key_id}`, 'DELETE', founder.headers)).status).toBe(200);

    // Keys from before keys recorded their creator: the founding agent can still revoke them.
    const legacy = await newKey(founder.headers, 'legacy');
    const hash = (await env.KV.get(`idx:org_keys:${founder.org_id}:${legacy.key_id}`))!;
    const meta = JSON.parse((await env.KV.get(`api_key:${hash}`))!) as Record<string, unknown>;
    delete meta.minted_by;
    await env.KV.put(`api_key:${hash}`, JSON.stringify(meta));
    expect((await api(`/keys/${legacy.key_id}`, 'DELETE', ci.headers)).status).toBe(403);
    expect((await api(`/keys/${legacy.key_id}`, 'DELETE', founder.headers)).status).toBe(200);
  });

  it("a key minted by a minted key stays revocable by the founding agent after its parent is revoked", async () => {
    const founder = await registerOrg();
    const parent = await newKey(founder.headers, 'leaked');
    const backup = await newKey(parent.headers, 'backup');
    expect((await api(`/keys/${parent.key_id}`, 'DELETE', founder.headers)).status).toBe(200);
    expect((await api(`/keys/${backup.key_id}`, 'DELETE', founder.headers)).status).toBe(200);
    expect((await api('/keys', 'GET', backup.headers)).status).toBe(401);
  });

  it('a member can leave but not remove others; an admin can remove members', async () => {
    const owner = await signIn('lead@example.com');
    await toTeam(owner.org_id);
    const m1 = await joinOrg('m1@example.com', owner.headers, owner.org_id);
    await joinOrg('m2@example.com', owner.headers, owner.org_id);
    const admin = await joinOrg('adm@example.com', owner.headers, owner.org_id, 'admin');
    const m1Key = await newKey(m1, 'm1 agent');

    expect((await removeMember(m1, 'm2@example.com')).status).toBe(403);
    expect((await removeMember(m1Key.headers, 'm2@example.com')).status).toBe(403);
    expect((await removeMember(admin, 'm2@example.com')).status).toBe(200);
    expect((await removeMember(m1, 'm1@example.com')).status).toBe(200);
  });

  it('the founding agent of an agent-created org can remove members', async () => {
    const founder = await registerOrg();
    await toTeam(founder.org_id);
    await joinOrg('crew@example.com', founder.headers, founder.org_id);
    expect((await removeMember(founder.headers, 'crew@example.com')).status).toBe(200);
  });
});
