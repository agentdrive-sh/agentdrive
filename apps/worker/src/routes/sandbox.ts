import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../env.js';
import { flexAuth, requirePermission, workspaceAccess, workspaceId, type Variables } from '../middleware/auth.js';
import {
  sandboxClone,
  sandboxExec,
  sandboxReadFile,
  sandboxCommit,
  SandboxUnavailableError,
} from '../services/sandbox.js';

type AppType = { Bindings: Env; Variables: Variables };

export const cloneSchema = z.object({
  url: z.string().url(),
  branch: z.string().optional(),
  depth: z.number().int().positive().max(50).optional(),
});

export const execSchema = z.object({
  cmd: z.string().min(1).max(2048),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().positive().max(60_000).optional(),
});

export const commitSchema = z.object({
  message: z.string().min(1).max(500),
  author: z
    .object({
      name: z.string().min(1).max(120),
      email: z.string().email(),
    })
    .optional(),
});

const app = new Hono<AppType>();
app.use('*', flexAuth, workspaceAccess());

function workspaceGate(c: Context<AppType>): { ok: true; orgId: string; actorId: string; platform?: import('@agentdrive/shared').AgentPlatform } | { ok: false; status: 403 | 404; error: string } {
  const auth = c.get('auth');
  if (auth.type === 'share') return { ok: false, status: 403, error: 'Share tokens cannot use the sandbox' };
  // A role grant opens a workspace's files to an outside email, never its sandbox.
  const orgId = c.get('workspace')?.org_id;
  if (!orgId || orgId !== auth.org_id) return { ok: false, status: 404, error: 'Workspace not found' };

  const actorId = auth.type === 'agent' ? auth.agent_id : auth.email;
  const platform = auth.type === 'agent' ? auth.agent_platform : undefined;
  return { ok: true, orgId, actorId, platform };
}

app.post('/clone', requirePermission('edit'), async (c) => {
  const gate = workspaceGate(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status);
  const body = await c.req.json().catch(() => null);
  const parsed = cloneSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'url is required' }, 400);
  const wid = workspaceId(c);
  try {
    const state = await sandboxClone(c.env, wid, parsed.data);
    return c.json({ success: true, data: state });
  } catch (err) {
    if (err instanceof SandboxUnavailableError) {
      return c.json({ success: false, error: err.message }, 503);
    }
    return c.json({ success: false, error: 'Sandbox clone failed' }, 500);
  }
});

app.post('/exec', requirePermission('edit'), async (c) => {
  const gate = workspaceGate(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status);
  const body = await c.req.json().catch(() => null);
  const parsed = execSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'cmd is required' }, 400);
  const wid = workspaceId(c);
  try {
    const result = await sandboxExec(c.env, wid, parsed.data.cmd, {
      cwd: parsed.data.cwd,
      timeoutMs: parsed.data.timeout_ms,
    });
    return c.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof SandboxUnavailableError) {
      return c.json({ success: false, error: err.message }, 503);
    }
    return c.json({ success: false, error: 'Sandbox exec failed' }, 500);
  }
});

app.get('/files/*', async (c) => {
  const gate = workspaceGate(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status);
  const wid = workspaceId(c);
  // Hono's * captures the rest of the path including a leading slash.
  const url = new URL(c.req.url);
  const prefix = `/v1/workspaces/${c.req.param('wid')}/sandbox/files`;
  const path = url.pathname.slice(prefix.length) || '/';
  try {
    const file = await sandboxReadFile(c.env, wid, path);
    if (!file) return c.json({ success: false, error: 'File not found' }, 404);
    return c.json({ success: true, data: file });
  } catch (err) {
    if (err instanceof SandboxUnavailableError) {
      return c.json({ success: false, error: err.message }, 503);
    }
    return c.json({ success: false, error: 'Sandbox read failed' }, 500);
  }
});

app.post('/commit', requirePermission('edit'), async (c) => {
  const gate = workspaceGate(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status);
  const body = await c.req.json().catch(() => null);
  const parsed = commitSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'message is required' }, 400);
  const wid = workspaceId(c);
  try {
    const result = await sandboxCommit(c.env, wid, {
      message: parsed.data.message,
      author: parsed.data.author,
      actorId: gate.actorId,
      actorAgentPlatform: gate.platform,
      orgId: gate.orgId,
    });
    return c.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof SandboxUnavailableError) {
      return c.json({ success: false, error: err.message }, 503);
    }
    return c.json({ success: false, error: 'Sandbox commit failed' }, 500);
  }
});

export default app;
