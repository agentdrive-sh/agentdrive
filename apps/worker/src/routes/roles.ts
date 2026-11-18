import { Hono } from 'hono';
import { z } from 'zod';
import type { Permission } from '@agentdrive/shared';
import type { Env } from '../env.js';
import { flexAuth, workspaceAccess, workspaceId, type Variables } from '../middleware/auth.js';
import { storage, requireAgent } from '../lib/route-helpers.js';

// /v1/workspaces/:wid/roles — assign, list, remove. Mounts at
// /v1/workspaces/:wid/roles.

type AppType = { Bindings: Env; Variables: Variables };

export const roleSchema = z.object({
  email: z.string().email(),
  permission: z.enum(['view', 'comment', 'edit']),
});

const app = new Hono<AppType>();
app.use('*', flexAuth, workspaceAccess());

app.post('/', async (c) => {
  const auth = c.get('auth');
  const agentCheck = requireAgent(auth);
  if (agentCheck) return c.json(agentCheck, 403);
  if (auth.type !== 'agent') return c.json({ success: false, error: 'Forbidden' }, 403);
  const wid = workspaceId(c);

  const body = await c.req.json().catch(() => null);
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'email and permission are required' }, 400);

  const s = storage(c);
  const role = await s.assignRole(wid, parsed.data.email, parsed.data.permission as Permission, auth.agent_id);
  await s.recordActivity(wid, 'agent', auth.agent_id, 'role.assign', 'role', parsed.data.email, undefined, { permission: parsed.data.permission }, auth.agent_platform);

  return c.json({ success: true, data: role }, 201);
});

app.get('/', async (c) => {
  const auth = c.get('auth');
  const wid = workspaceId(c);
  const agentCheck = requireAgent(auth);
  if (agentCheck) return c.json(agentCheck, 403);
  if (auth.type !== 'agent') return c.json({ success: false, error: 'Forbidden' }, 403);

  const cursor = c.req.query('cursor');
  const s = storage(c);
  const page = await s.getRoles(wid, cursor);
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

app.delete('/:email', async (c) => {
  const auth = c.get('auth');
  const agentCheck = requireAgent(auth);
  if (agentCheck) return c.json(agentCheck, 403);
  if (auth.type !== 'agent') return c.json({ success: false, error: 'Forbidden' }, 403);
  const wid = workspaceId(c);
  const email = decodeURIComponent(c.req.param('email')!);

  const s = storage(c);
  const deleted = await s.removeRole(wid, email);
  if (!deleted) return c.json({ success: false, error: 'Role not found' }, 404);

  await s.recordActivity(wid, 'agent', auth.agent_id, 'role.remove', 'role', email, undefined, undefined, auth.agent_platform);
  return c.json({ success: true, data: { deleted: true } });
});

export default app;
