import { Hono } from 'hono';
import { z } from 'zod';
import type { OrgInvite } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { flexAuth } from '../middleware/auth.js';
import { storage, callerIsOwner, canManageOrg } from '../lib/route-helpers.js';
import { orgQuota, planLimitError, planLimitFor } from '../services/limits.js';
import { selfHosted } from '../lib/self-hosted.js';
import { sendMagicCode } from '../services/magic-codes.js';
import { ORG_INVITE_TTL_SECONDS } from '../services/storage.js';

// /v1/org, /v1/org/invite and the invitee's /v1/org/invites. Mounts at /v1/org.

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();
app.use('*', flexAuth);

export const renameSchema = z.object({ name: z.string().min(1).max(100) });

export const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
});

const ownerOnly = { success: false as const, error: 'Only an org owner can invite or remove an owner' };
const adminOnly = { success: false as const, error: 'Only an org owner or admin can invite an admin' };
const renameAdminOnly = { success: false as const, error: 'Only an org owner or admin can rename the organization' };

app.get('/', async (c) => {
  const auth = c.get('auth');
  let orgId: string | undefined;
  if (auth.type === 'agent') orgId = auth.org_id;
  else if (auth.type === 'session') orgId = auth.org_id;

  if (!orgId) return c.json({ success: false, error: 'No organization found' }, 404);

  const s = storage(c);
  const org = await s.getOrg(orgId);
  if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);

  const agentsCursor = c.req.query('agents_cursor');
  const membersCursor = c.req.query('members_cursor');
  const [agentsPage, membersPage, invitesPage, usage] = await Promise.all([
    s.getOrgAgents(orgId, agentsCursor),
    s.getOrgMembers(orgId, membersCursor),
    s.listInvitesForOrg(orgId, c.req.query('invites_cursor')),
    s.getUsage(orgId),
  ]);

  // Unlimited on a self-hosted instance, sent as null.
  const quota = selfHosted(c.env) ? Object.fromEntries(Object.keys(orgQuota(org)).map((k) => [k, null])) : orgQuota(org);

  return c.json({
    success: true,
    data: {
      ...org,
      agents: agentsPage.items,
      members: membersPage.items,
      invites: invitesPage.items,
      usage,
      quota,
    },
    agents_cursor: agentsPage.cursor,
    members_cursor: membersPage.cursor,
    invites_cursor: invitesPage.cursor,
  });
});

app.patch('/', async (c) => {
  const auth = c.get('auth');
  let orgId: string | undefined;
  if (auth.type === 'agent') orgId = auth.org_id;
  else if (auth.type === 'session') orgId = auth.org_id;
  if (!orgId) return c.json({ success: false, error: 'No organization found' }, 404);

  const s = storage(c);
  if (!(await canManageOrg(s, auth, orgId))) return c.json(renameAdminOnly, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'name is required (1-100 chars)' }, 400);

  const org = await s.getOrg(orgId);
  if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);

  await s.updateOrg(orgId, { name: parsed.data.name });
  return c.json({ success: true, data: { ...org, name: parsed.data.name } });
});

app.post('/invite', async (c) => {
  // An invitee would have to sign in to accept, and sign-in creates no orgs on a self-hosted instance.
  if (selfHosted(c.env)) {
    return c.json({ success: false, code: 'invites_disabled', error: 'Invites are disabled on this self-hosted instance; mint a key for a teammate with POST /v1/keys' }, 501);
  }
  const auth = c.get('auth');
  // Agents (drive_invite) and signed-in humans can invite; share tokens cannot.
  // An invite grants nothing until the invitee's own session accepts it.
  let orgId: string | undefined;
  let invitedBy: string | undefined;
  if (auth.type === 'agent') { orgId = auth.org_id; invitedBy = auth.agent_id; }
  else if (auth.type === 'session') { orgId = auth.org_id; invitedBy = auth.email; }
  if (!orgId || !invitedBy) return c.json({ success: false, error: 'Forbidden' }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'valid email and role required' }, 400);

  const s = storage(c);
  const org = await s.getOrg(orgId);
  if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);
  if (parsed.data.role === 'owner' && !(await callerIsOwner(s, auth, orgId))) return c.json(ownerOnly, 403);
  if (parsed.data.role === 'admin' && !(await canManageOrg(s, auth, orgId))) return c.json(adminOnly, 403);

  const refusal = await planLimitFor(c.env, orgId, 'member_count');
  if (refusal) return planLimitError(c, refusal);

  const now = Date.now();
  const invite: OrgInvite = {
    org_id: orgId,
    org_name: org.name,
    email: parsed.data.email.toLowerCase(),
    role: parsed.data.role,
    invited_by: invitedBy,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ORG_INVITE_TTL_SECONDS * 1000).toISOString(),
  };
  await s.createOrgInvite(invite);

  // The code only lets the invitee sign in; joining happens when they accept. It shares the
  // address's send cap, so invites can't flood an inbox, and a refused send leaves the invite.
  await sendMagicCode(c.env, parsed.data.email, 'verify');

  return c.json({ success: true, data: invite }, 201);
});

// An invite is addressed to an email, so only a session that proved that
// email may see or answer it. Agent keys and share tokens never can.
function inviteeEmail(auth: AuthContext): string | null {
  return auth.type === 'session' ? auth.email.toLowerCase() : null;
}

const notInvitee = { success: false as const, error: 'Sign in as the invited person to see or answer invites' };
const inviteNotFound = { success: false as const, error: 'Invite not found' };
const ORG_ID_PATTERN = /^org_[A-Za-z0-9]{1,64}$/;

app.get('/invites', async (c) => {
  const email = inviteeEmail(c.get('auth'));
  if (!email) return c.json(notInvitee, 403);
  const page = await storage(c).listInvitesForEmail(email, c.req.query('cursor'));
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

app.post('/invites/:org_id/accept', async (c) => {
  const auth = c.get('auth');
  if (auth.type !== 'session') return c.json(notInvitee, 403);
  const email = auth.email.toLowerCase();
  const orgId = c.req.param('org_id');
  if (!ORG_ID_PATTERN.test(orgId)) return c.json(inviteNotFound, 404);

  const s = storage(c);
  const invite = await s.getOrgInvite(email, orgId);
  if (!invite) return c.json(inviteNotFound, 404);
  const org = await s.getOrg(orgId);
  if (!org) {
    await s.deleteOrgInvite(email, orgId);
    return c.json(inviteNotFound, 404);
  }

  let member = await s.getOrgMember(orgId, email);
  if (!member) {
    const refusal = await planLimitFor(c.env, orgId, 'member_count');
    if (refusal) return planLimitError(c, refusal);
    member = await s.addOrgMember(orgId, email, invite.role, invite.invited_by);
    await s.incrementUsage(orgId, 'member_count', 1);
  }

  await s.setSignInOrg(email, orgId);
  await s.setSessionOrg(auth.session_id, orgId);
  await s.deleteOrgInvite(email, orgId);
  return c.json({ success: true, data: member });
});

app.post('/invites/:org_id/decline', async (c) => {
  const email = inviteeEmail(c.get('auth'));
  if (!email) return c.json(notInvitee, 403);
  const orgId = c.req.param('org_id');
  if (!ORG_ID_PATTERN.test(orgId)) return c.json(inviteNotFound, 404);

  const s = storage(c);
  if (!(await s.getOrgInvite(email, orgId))) return c.json(inviteNotFound, 404);
  await s.deleteOrgInvite(email, orgId);
  return c.json({ success: true, data: { declined: true } });
});

async function countOwners(s: ReturnType<typeof storage>, orgId: string): Promise<number> {
  let owners = 0;
  let cursor: string | undefined;
  do {
    const page = await s.getOrgMembers(orgId, cursor);
    owners += page.items.filter((m) => m.role === 'owner').length;
    cursor = page.cursor ?? undefined;
  } while (cursor && owners < 2);
  return owners;
}

async function canRemoveMembers(s: ReturnType<typeof storage>, auth: AuthContext, orgId: string): Promise<boolean> {
  if (auth.type === 'session') {
    const role = (await s.getOrgMember(orgId, auth.email.toLowerCase()))?.role;
    return role === 'owner' || role === 'admin';
  }
  return auth.type === 'agent' && (await s.getOrg(orgId))?.created_by === auth.agent_id;
}

// Removes a member, revokes a pending invite to that email, or both.
app.delete('/members/:email', async (c) => {
  const auth = c.get('auth');
  let orgId: string | undefined;
  if (auth.type === 'agent') orgId = auth.org_id;
  else if (auth.type === 'session') orgId = auth.org_id;
  if (!orgId) return c.json({ success: false, error: 'Forbidden' }, 403);

  const email = c.req.param('email');
  const s = storage(c);
  const targetRole = (await s.getOrgMember(orgId, email))?.role;
  // Removal revokes the member's keys, links and grants, so it follows key revocation:
  // owners remove anyone, admins and an agent-created org's founding agent remove
  // non-owners, and anyone may leave.
  const leaving = auth.type === 'session' && auth.email.toLowerCase() === email.toLowerCase();
  if (!leaving && targetRole !== 'owner' && !(await canRemoveMembers(s, auth, orgId))) {
    return c.json({ success: false, error: 'Only an org owner or admin can remove other members' }, 403);
  }
  if (targetRole === 'owner') {
    if (!leaving && !(await callerIsOwner(s, auth, orgId))) return c.json(ownerOnly, 403);
    if ((await countOwners(s, orgId)) <= 1) {
      return c.json({ success: false, error: "Can't remove the org's last owner" }, 409);
    }
  }
  const removed = await s.removeOrgMember(orgId, email);
  if (removed) await s.incrementUsage(orgId, 'member_count', -1);
  const invite = await s.getOrgInvite(email.toLowerCase(), orgId);
  if (invite) await s.deleteOrgInvite(invite.email, orgId);
  if (!removed && !invite) return c.json({ success: false, error: 'member not found' }, 404);
  return c.json({ success: true, data: { removed: true } });
});

export default app;
