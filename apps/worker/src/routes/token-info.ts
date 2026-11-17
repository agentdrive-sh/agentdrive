import { Hono } from 'hono';
import { verifyToken } from '@agentdrive/shared';
import type { ShareTokenMeta, WorkspaceMeta } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { linkIssuerActive } from '../middleware/auth.js';

// GET /v1/token-info/:token — public, no-auth metadata readout used by the
// frontend before prompting for the email gate.

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
}

app.get('/:token', async (c) => {
  const tokenStr = c.req.param('token');
  const payload = await verifyToken(tokenStr, c.env.TOKEN_SIGNING_SECRET);
  if (!payload) return c.json({ success: false, error: 'Invalid token' }, 401);

  const [tokenMeta, ws, used] = await Promise.all([
    c.env.KV.get<ShareTokenMeta>(`token:${payload.tid}`, 'json'),
    c.env.KV.get<WorkspaceMeta>(`ws:${payload.wid}`, 'json'),
    c.env.KV.get(`token_used:${payload.tid}`),
  ]);
  if (!tokenMeta || tokenMeta.revoked || !ws || !(await linkIssuerActive(c.env, ws, tokenMeta))) {
    return c.json({ success: false, error: 'Token revoked' }, 401);
  }

  return c.json({
    success: true,
    data: {
      workspace_id: payload.wid,
      file_id: payload.fid,
      permission: payload.permission,
      email_gated: !!payload.email,
      email_hint: payload.email ? maskEmail(payload.email) : undefined,
      // Mirrors the count in shareTokenAuth; null means unlimited. Withheld on
      // email-gated links so anyone holding the URL can't watch it being opened.
      uses_left: payload.email || !tokenMeta.max_uses ? null : Math.max(0, tokenMeta.max_uses - (used === null ? tokenMeta.use_count : Number(used))),
    },
  });
});

export default app;
