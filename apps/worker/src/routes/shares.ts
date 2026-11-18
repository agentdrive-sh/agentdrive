import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { signToken, buildShareUrl, generateId } from '@agentdrive/shared';
import type { Permission, TokenPayload, ShareTokenMeta } from '@agentdrive/shared';
import type { Env, AgentAuth, SessionAuth } from '../env.js';
import { flexAuth, workspaceAccess, workspaceId, type Variables } from '../middleware/auth.js';
import { storage } from '../lib/route-helpers.js';

// Create, list and revoke share links. Mounts at /v1/workspaces/:wid/share.

type AppType = { Bindings: Env; Variables: Variables };

export const shareSchema = z.object({
  permission: z.enum(['view', 'comment', 'edit']),
  file_id: z.string().optional().describe('Scope the link to this one file; omit for the whole workspace.'),
  expires_in: z.number().positive().optional().describe('Seconds until the link expires; omit for no expiry.'),
  max_uses: z.number().int().positive().optional().describe('Content reads and writes the link allows; omit for unlimited.'),
  email: z.string().email().optional().describe('Gate the link to this email: it then also needs a session signed in as that email.'),
});

const app = new Hono<AppType>();
app.use('*', flexAuth, workspaceAccess());

// Only the org that owns the workspace creates, sees or revokes its links: a share
// link or an outside email's role grant opens files, never the workspace's links.
function ownerAuth(c: Context<AppType>): AgentAuth | SessionAuth | null {
  const auth = c.get('auth');
  return auth.type !== 'share' && auth.org_id && auth.org_id === c.get('workspace')?.org_id ? auth : null;
}

const notFound = { success: false, error: 'Workspace not found' } as const;

app.post('/', async (c) => {
  const auth = ownerAuth(c);
  if (!auth) return c.json(notFound, 404);
  const wid = workspaceId(c);
  const agent = auth.type === 'agent';
  const issuer = agent ? auth.agent_id : `member:${auth.email.toLowerCase()}`;

  const body = await c.req.json().catch(() => null);
  const parsed = shareSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'permission is required (view/comment/edit)' }, 400);

  const s = storage(c);
  if (parsed.data.file_id) {
    const file = await s.getFile(wid, parsed.data.file_id);
    if (!file) return c.json({ success: false, error: 'File not found' }, 404);
  }

  const tokenId = generateId('tk');
  const now = Math.floor(Date.now() / 1000);
  const exp = parsed.data.expires_in ? now + parsed.data.expires_in : undefined;

  const payload: TokenPayload = {
    v: 1, tid: tokenId, wid,
    fid: parsed.data.file_id,
    permission: parsed.data.permission as Permission,
    // The payload rides in the URL, readable by anyone holding the link, so a member's
    // email stays in the stored record, which is the one liveness is checked against.
    issuer: agent ? issuer : 'member', exp,
    max_uses: parsed.data.max_uses,
    email: parsed.data.email,
  };

  const token = await signToken(payload, c.env.TOKEN_SIGNING_SECRET);

  const tokenMeta: ShareTokenMeta = {
    token_id: tokenId, workspace_id: wid,
    file_id: parsed.data.file_id,
    permission: parsed.data.permission as Permission,
    issuer,
    created_at: new Date().toISOString(),
    expires_at: exp ? new Date(exp * 1000).toISOString() : undefined,
    max_uses: parsed.data.max_uses,
    use_count: 0, revoked: false,
    email: parsed.data.email,
  };
  await s.saveShareToken(tokenMeta);

  const url = buildShareUrl(c.env.SITE_URL, token);
  await s.recordActivity(wid, agent ? 'agent' : 'human', agent ? auth.agent_id : auth.email, 'share.create', 'share', tokenId, undefined, {
    permission: parsed.data.permission,
    ...(parsed.data.email ? { email: parsed.data.email } : {}),
  }, agent ? auth.agent_platform : undefined);

  // A workspace-wide email-gated link also grants its email a role, so that person can
  // reach the workspace signed in. A file-scoped one does not: the role would open
  // every file, so the link is used together with the person's session instead.
  if (parsed.data.email && !parsed.data.file_id) {
    const existing = await s.getRole(wid, parsed.data.email);
    // A link never replaces a role someone granted directly.
    if (!existing || existing.granted_via) {
      await s.assignRole(wid, parsed.data.email, parsed.data.permission as Permission, issuer, tokenId);
    }
  }

  return c.json({
    success: true,
    data: {
      token_id: tokenId, url,
      permission: parsed.data.permission,
      email_gated: !!parsed.data.email,
      expires_at: tokenMeta.expires_at,
    },
  }, 201);
});

app.get('/', async (c) => {
  if (!ownerAuth(c)) return c.json(notFound, 404);
  const page = await storage(c).listShareTokens(workspaceId(c), c.req.query('cursor'));
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

app.delete('/:tid', async (c) => {
  const auth = ownerAuth(c);
  if (!auth) return c.json(notFound, 404);
  const wid = workspaceId(c);
  const tid = c.req.param('tid');
  const s = storage(c);
  if (!(await s.revokeShareToken(wid, tid))) return c.json({ success: false, error: 'Share not found' }, 404);
  const agent = auth.type === 'agent';
  await s.recordActivity(
    wid, agent ? 'agent' : 'human', agent ? auth.agent_id : auth.email, 'share.revoke', 'share', tid,
    undefined, undefined, agent ? auth.agent_platform : undefined,
  );
  return c.json({ success: true, data: { revoked: true } });
});

export default app;
