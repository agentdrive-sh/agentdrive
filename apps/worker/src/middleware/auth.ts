import type { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { planLimitFor } from '../services/limits.js';
import { hashApiKey, hashContent, verifyToken, hasPermission, AGENT_PLATFORMS, PLAN_QUOTAS } from '@agentdrive/shared';
import type { Env, AuthContext, AgentAuth, SessionAuth, ShareAuth } from '../env.js';
import type { Permission, ApiKeyMeta, ShareTokenMeta, SessionMeta, AgentPlatform, RoleAssignment, WorkspaceMeta, OrgAgent, OrgMember } from '@agentdrive/shared';
import { StorageService } from '../services/storage.js';
import { principalRateLimit } from './rate-limit.js';
import { idempotent } from './idempotency.js';

export type Variables = {
  auth: AuthContext;
  workspace?: WorkspaceMeta;
};

const PLATFORM_SET = new Set<string>(AGENT_PLATFORMS);
const AGENT_ROLE_MAX = 64;

function readAgentHeaders(req: Request): { platform: AgentPlatform; role?: string } {
  // Header lookups via hono c.req.header are case-insensitive; here we receive
  // either a Hono context-style accessor or the raw Headers object.
  const get = (name: string) => req.headers.get(name) || req.headers.get(name.toLowerCase());
  const rawPlatform = (get('X-Agent-Platform') ?? '').trim().toLowerCase();
  const platform: AgentPlatform = PLATFORM_SET.has(rawPlatform) ? (rawPlatform as AgentPlatform) : 'unknown';
  const rawRole = (get('X-Agent-Role') ?? '').trim();
  const role = rawRole ? rawRole.slice(0, AGENT_ROLE_MAX) : undefined;
  return { platform, role };
}

// Last use lives beside the key record, never in it: rewriting the record from a
// read taken before a revocation would bring the revoked key back.
function touchApiKey(kv: KVNamespace, keyHash: string): Promise<void> {
  return kv.put(`api_key_used:${keyHash}`, new Date().toISOString());
}

export const agentAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing Authorization header' }, 401);
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey.startsWith('agentdrive_')) {
    return c.json({ success: false, error: 'Invalid API key format' }, 401);
  }

  const keyHash = await hashApiKey(apiKey);
  const meta = await c.env.KV.get<ApiKeyMeta>(`api_key:${keyHash}`, 'json');
  if (!meta) {
    return c.json({ success: false, error: 'Invalid API key' }, 401);
  }

  c.executionCtx.waitUntil(touchApiKey(c.env.KV, keyHash));

  const { platform, role } = readAgentHeaders(c.req.raw);
  c.set('auth', {
    type: 'agent',
    agent_id: meta.agent_id,
    agent_name: meta.agent_name,
    org_id: meta.org_id,
    agent_platform: platform,
    agent_role: role,
    created_by: meta.created_by,
  });
  await next();
});

// Uses are counted beside the token record, never in it: rewriting the record from
// a read taken before a revocation would bring the revoked link back.
export async function shareTokenAuth(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  token: string,
  sessionToken?: string,
): Promise<{ auth: ShareAuth; countUse: () => void } | { error: string }> {
  const payload = await verifyToken(token, env.TOKEN_SIGNING_SECRET);
  if (!payload) return { error: 'Invalid or expired token' };

  const [meta, used, ws] = await Promise.all([
    env.KV.get<ShareTokenMeta>(`token:${payload.tid}`, 'json'),
    env.KV.get(`token_used:${payload.tid}`),
    env.KV.get<WorkspaceMeta>(`ws:${payload.wid}`, 'json'),
  ]);
  if (!meta || meta.revoked) return { error: 'Token revoked' };
  // shortcut: concurrent uses can each pass this check before any count lands, so
  // max_uses is overshot in proportion to concurrency; move the counter to a Durable
  // Object if a hard limit matters.
  const uses = used === null ? meta.use_count : Number(used);
  if (meta.max_uses && uses >= meta.max_uses) return { error: 'Token usage limit reached' };
  if (!ws || !(await linkIssuerActive(env, ws, meta))) return { error: 'Token revoked' };

  const email = payload.email ?? meta.email;
  if (email) {
    const session = sessionToken ? await env.KV.get<SessionMeta>(`session:${sessionToken}`, 'json') : null;
    if (!session || new Date(session.expires_at) < new Date() || session.email.toLowerCase() !== email.toLowerCase()) {
      return { error: 'This link is for one email address: sign in as it to open the link' };
    }
  }

  return {
    auth: {
      type: 'share',
      token_id: payload.tid,
      workspace_id: payload.wid,
      file_id: payload.fid,
      permission: payload.permission,
      email,
    },
    countUse: () => ctx.waitUntil(env.KV.put(`token_used:${payload.tid}`, String(uses + 1))),
  };
}

type FlexContext = Context<{ Bindings: Env; Variables: Variables }>;

// Every authenticated route mounts flexAuth, so the per-principal limit and the
// Idempotency-Key claim run here, after auth and the limit, so neither refusal spends a key.
async function admit(c: FlexContext, auth: AuthContext, next: Next, onAdmitted?: () => void): Promise<Response | void> {
  c.set('auth', auth);
  const refusal = await principalRateLimit(c, auth);
  if (refusal) return refusal;
  return idempotent(c, auth, async () => {
    onAdmitted?.();
    await next();
  });
}

export const flexAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const shareToken = c.req.header('X-Share-Token') || c.req.query('token');
  const sessionToken = c.req.header('X-Session-Token');

  // 1. Agent API key auth
  if (authHeader?.startsWith('Bearer agentdrive_')) {
    const apiKey = authHeader.slice(7);
    const keyHash = await hashApiKey(apiKey);
    const meta = await c.env.KV.get<ApiKeyMeta>(`api_key:${keyHash}`, 'json');
    if (!meta) {
      return c.json({ success: false, error: 'Invalid API key' }, 401);
    }

    c.executionCtx.waitUntil(touchApiKey(c.env.KV, keyHash));

    const { platform, role } = readAgentHeaders(c.req.raw);
    return admit(c, {
      type: 'agent',
      agent_id: meta.agent_id,
      agent_name: meta.agent_name,
      org_id: meta.org_id,
      agent_platform: platform,
      agent_role: role,
      created_by: meta.created_by,
    }, next);
  }

  // 2. Share token. It comes before the session: a request that presents a link acts
  // as that link, and an email-gated link reads the session only to check whose it is.
  if (shareToken) {
    // A use is a content read or a write: listing and metadata let a viewer find the file.
    // Counted only once the rate limit admits it, so a 429 and its retry spend no use.
    const isUse = c.req.method !== 'GET' || c.req.query('content') === 'true';
    const share = await shareTokenAuth(c.env, c.executionCtx, shareToken, sessionToken);
    if ('error' in share) return c.json({ success: false, error: share.error }, 401);
    return admit(c, share.auth, next, isUse ? share.countUse : undefined);
  }

  // 3. Session auth (human with verified email)
  if (sessionToken) {
    const auth = await sessionAuth(c.env, c.executionCtx, sessionToken);
    if ('error' in auth) return c.json({ success: false, error: auth.error }, 401);
    return admit(c, auth, next);
  }

  return c.json({ success: false, error: 'Authentication required' }, 401);
});

export async function sessionAuth(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  sessionToken: string,
): Promise<SessionAuth | { error: string }> {
  const session = await env.KV.get<SessionMeta>(`session:${sessionToken}`, 'json');
  if (!session) return { error: 'Invalid or expired session' };
  if (new Date(session.expires_at) < new Date()) {
    ctx.waitUntil(env.KV.delete(`session:${sessionToken}`));
    return { error: 'Session expired' };
  }

  // Touch session (non-blocking)
  ctx.waitUntil(
    env.KV.put(`session:${sessionToken}`, JSON.stringify({ ...session, last_active_at: new Date().toISOString() }), {
      expirationTtl: 30 * 24 * 60 * 60,
    }),
  );

  // Removal deletes the membership, not the member's sessions, so the org a
  // session points at only counts while that membership still exists.
  const orgId = session.org_id
    && (await env.KV.get(`org_member:${session.org_id}:${session.email.toLowerCase()}`)) !== null
    ? session.org_id
    : undefined;
  return { type: 'session', session_id: session.session_id, email: session.email, org_id: orgId };
}

// Workspaces created before every workspace had an org carry no org_id. One made
// by an agent belongs to that agent's org (an agent is in exactly one); one made
// by a person goes to the org that person next uses it from. Either is stamped
// with its org on first use.
export async function ownsWorkspace(env: Env, auth: AuthContext, ws: WorkspaceMeta): Promise<boolean> {
  if (auth.type === 'share' || !auth.org_id) return false;
  if (ws.org_id) return ws.org_id === auth.org_id;
  const self = auth.type === 'agent' ? auth.agent_id : auth.email;
  if (ws.created_by !== self && (await env.KV.get(`org_agent:${auth.org_id}:${ws.created_by}`)) === null) return false;
  ws.org_id = auth.org_id;
  await env.KV.put(`ws:${ws.id}`, JSON.stringify(ws));
  await env.KV.put(`idx:org_workspaces:${auth.org_id}:${ws.id}`, ws.id);
  return true;
}

// A role grant or share link counts only while its issuer is active in the workspace's
// own org: before the org check existed any org's agent could write a role, and revoking
// a key, or removing the member who issued it from a session (`member:<email>`), ends
// what it issued. The prefix keeps a member issuer from ever matching an agent record.
// A removed member who rejoins gets a new joined_at, so what they issued before stays dead.
async function issuerActive(env: Env, orgId: string | undefined, issuer: string, issuedAt: string | undefined): Promise<boolean> {
  if (!orgId) return false;
  if (issuer.startsWith('member:')) {
    const member = await env.KV.get<OrgMember>(`org_member:${orgId}:${issuer.slice('member:'.length)}`, 'json');
    return !!member?.joined_at && !!issuedAt && member.joined_at <= issuedAt;
  }
  const agent = await env.KV.get<OrgAgent>(`org_agent:${orgId}:${issuer}`, 'json');
  return agent !== null && !agent.revoked_at;
}

// A workspace from before orgs has no org to check the issuer against, so its links
// keep working as they did until an org claims the workspace on first use.
export async function linkIssuerActive(env: Env, ws: WorkspaceMeta, meta: ShareTokenMeta): Promise<boolean> {
  return !ws.org_id || issuerActive(env, ws.org_id, meta.issuer, meta.created_at);
}

// A role an email-gated link granted lasts as long as the link: revoking deletes the role,
// but nothing deletes it when the link expires.
async function grantingLinkLive(env: Env, tid: string): Promise<boolean> {
  const meta = await env.KV.get<ShareTokenMeta>(`token:${tid}`, 'json');
  return !!meta && !meta.revoked && (!meta.expires_at || Date.parse(meta.expires_at) > Date.now());
}

async function workspaceRole(env: Env, ws: WorkspaceMeta, email: string): Promise<RoleAssignment | null> {
  const role = await env.KV.get<RoleAssignment>(`role:${ws.id}:${email.toLowerCase()}`, 'json');
  if (!role || !(await issuerActive(env, ws.org_id, role.assigned_by, role.assigned_at))) return null;
  return !role.granted_via || (await grantingLinkLive(env, role.granted_via)) ? role : null;
}

// Agents may write to a workspace by name ("notes") before one exists. Names live
// in a per-org namespace: two orgs choosing the same name get separate workspaces,
// and no name can reach another org's workspace.
async function namedWorkspace(env: Env, auth: AgentAuth | SessionAuth, name: string, create: boolean): Promise<WorkspaceMeta | null> {
  if (!auth.org_id || name.startsWith('ws_') || name.length > 100) return null;
  const id = `ws_${(await hashContent(`${auth.org_id}:${name}`)).slice(0, 24)}`;
  const ws = await env.KV.get<WorkspaceMeta>(`ws:${id}`, 'json');
  if (ws) return ws.org_id === auth.org_id ? ws : null;
  if (!create || auth.type !== 'agent') return null;
  const refusal = await planLimitFor(env, auth.org_id, 'workspace_count');
  // Thrown, not returned: every other refusal here answers 404, and this one must
  // reach the agent as the plan_limit error it relays.
  if (refusal) throw new HTTPException(402, { res: Response.json(refusal, { status: 402 }) });
  const s = new StorageService(env.KV, env.R2);
  const created = await s.createWorkspace(id, name, auth.agent_id, auth.org_id);
  await s.incrementUsage(auth.org_id, 'workspace_count', 1);
  return created;
}

// The workspace `wid` names for this caller, or null: callers answer 404 either way,
// so another org's workspace can't be told apart from a missing one. A session
// outside the org gets in only through a role grant from the workspace's own org.
export async function resolveWorkspace(env: Env, auth: AuthContext, wid: string, create = false): Promise<WorkspaceMeta | null> {
  if (auth.type === 'share') return null;
  const ws = await env.KV.get<WorkspaceMeta>(`ws:${wid}`, 'json');
  if (ws && ((await ownsWorkspace(env, auth, ws)) || (auth.type === 'session' && (await workspaceRole(env, ws, auth.email))))) {
    return ws;
  }
  return namedWorkspace(env, auth, wid, create);
}

// Gate for every /v1/workspaces/:wid route. Handlers read the resolved id through
// workspaceId(), since a named workspace's id differs from the path.
// Routes that hold a file-scoped share link to its one file pass fileScope; every
// other workspace route is closed to such a link.
export function workspaceAccess(opts: { createOnPost?: boolean; fileScope?: boolean } = {}) {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const auth = c.get('auth');
    const wid = c.req.param('wid');
    const notFound = () => c.json({ success: false, error: 'Workspace not found' }, 404);
    if (!wid) return notFound();

    if (auth.type === 'share') {
      if (auth.workspace_id !== wid || (auth.file_id && !opts.fileScope)) return notFound();
      // Set so writes through the link meter and pause against the workspace's org.
      // It grants nothing: requirePermission and every owner check branch on auth.type.
      const ws = await c.env.KV.get<WorkspaceMeta>(`ws:${wid}`, 'json');
      if (!ws) return notFound();
      c.set('workspace', ws);
      await next();
      return;
    }

    const ws = await resolveWorkspace(c.env, auth, wid, !!opts.createOnPost && c.req.method === 'POST');
    if (!ws) return notFound();
    c.set('workspace', ws);
    await next();
  });
}

export function workspaceId(c: { get(key: 'workspace'): WorkspaceMeta | undefined; req: { param(key: 'wid'): string | undefined } }): string {
  return c.get('workspace')?.id ?? c.req.param('wid')!;
}

// Mount where :fid is a matched param; a '*' middleware above it can't see it.
export const shareFileScope = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const auth = c.get('auth');
  if (auth.type === 'share' && auth.file_id && auth.file_id !== c.req.param('fid')) {
    return c.json({ success: false, error: 'File not found' }, 404);
  }
  await next();
});

export function requirePermission(required: Permission) {
  return createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
    const auth = c.get('auth');
    const ws = c.get('workspace');
    // Fails closed if a route forgets workspaceAccess.
    if (auth.type !== 'share' && !ws) {
      return c.json({ success: false, error: 'Workspace not found' }, 404);
    }
    // Inside its own org's workspace an agent holds every permission.
    if (auth.type === 'agent') {
      await next();
      return;
    }
    if (auth.type === 'session') {
      if (required === 'comment' && auth.org_id && auth.org_id === ws!.org_id) {
        const member = await c.env.KV.get<OrgMember>(`org_member:${auth.org_id}:${auth.email.toLowerCase()}`, 'json');
        if (member?.role === 'owner' || member?.role === 'admin') {
          await next();
          return;
        }
      }
      const role = await workspaceRole(c.env, ws!, auth.email);
      if (role && hasPermission(role.permission, required)) {
        await next();
        return;
      }
      return c.json({ success: false, error: `Requires ${required} permission` }, 403);
    }
    // Share tokens: check token permission
    if (!hasPermission(auth.permission, required)) {
      return c.json({ success: false, error: `Requires ${required} permission` }, 403);
    }
    await next();
  });
}
