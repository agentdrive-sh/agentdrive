import { Hono } from 'hono';
import { z } from 'zod';
import { generateId } from '@agentdrive/shared';
import type { Env } from '../env.js';
import { flexAuth, workspaceAccess, workspaceId, type Variables } from '../middleware/auth.js';
import { canManageOrg, storage } from '../lib/route-helpers.js';
import { BucketConfigStore } from '../services/bucket-config.js';
import { planLimitError, planLimitFor } from '../services/limits.js';
import { selfHosted } from '../lib/self-hosted.js';

// /v1/workspaces — create, list, get. Mounts at /v1/workspaces in index.ts.

type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();
app.use('*', flexAuth);

// Paginated list endpoints keep `data` as the items array (backwards-compatible
// with existing MCP and frontend consumers) and expose `cursor` as a sibling.
// Pass `?cursor=<value>` to fetch the next page; `cursor: null` means done.
app.get('/', async (c) => {
  const auth = c.get('auth');
  if (auth.type === 'share') return c.json({ success: false, error: 'Not available for share tokens' }, 403);
  const orgId = auth.type === 'agent' ? auth.org_id : auth.org_id;
  if (!orgId) return c.json({ success: true, data: [], cursor: null });
  const cursor = c.req.query('cursor');
  const s = storage(c);
  const page = await s.listWorkspaces(orgId, cursor);
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

app.post('/', async (c) => {
  const auth = c.get('auth');
  if (auth.type === 'share') return c.json({ success: false, error: 'Forbidden' }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'name is required (1-100 chars)' }, 400);

  let orgId: string | undefined;
  let creatorId: string;
  let actorType: 'agent' | 'human';
  if (auth.type === 'agent') {
    orgId = auth.org_id;
    creatorId = auth.agent_id;
    actorType = 'agent';
  } else {
    orgId = auth.org_id;
    creatorId = auth.email;
    actorType = 'human';
  }
  // workspaceAccess admits org principals by org_id, so an org-less workspace would be unreachable.
  if (!orgId) return c.json({ success: false, error: 'No organization' }, 403);

  const refusal = await planLimitFor(c.env, orgId, 'workspace_count');
  if (refusal) return planLimitError(c, refusal);
  const s = storage(c);

  const wid = generateId('ws');
  const ws = await s.createWorkspace(wid, parsed.data.name, creatorId, orgId);
  const platform = auth.type === 'agent' ? auth.agent_platform : undefined;
  await s.recordActivity(wid, actorType, creatorId, 'workspace.create', 'workspace', wid, undefined, undefined, platform);
  await s.incrementUsage(orgId, 'workspace_count', 1);

  return c.json({ success: true, data: ws }, 201);
});

app.get('/:wid', workspaceAccess(), async (c) => {
  const ws = c.get('workspace') ?? await storage(c).getWorkspace(c.req.param('wid'));
  if (!ws) return c.json({ success: false, error: 'Workspace not found' }, 404);
  return c.json({ success: true, data: ws });
});

// Phase 4 — assign / clear the workspace's bucket_config_id. New writes
// in this workspace land in that bucket; existing files keep reading
// from wherever they were originally written (recorded on FileMeta).
//
// PUT to set, DELETE to clear (back to AgentDrive default).
const assignSchema = z.object({ bucket_config_id: z.string().min(1).max(120) });

app.put('/:wid/bucket-config', workspaceAccess(), async (c) => {
  const auth = c.get('auth');
  const ws = c.get('workspace')!;
  // Workspace access can come from an external view/edit grant. Storage
  // management still belongs to the organization that owns this workspace.
  if (auth.type === 'share' || !ws.org_id || auth.org_id !== ws.org_id || !(await canManageOrg(storage(c), auth, ws.org_id))) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  const wid = workspaceId(c);
  const body = await c.req.json().catch(() => null);
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'bucket_config_id is required' }, 400);
  }
  // Verify the config exists and belongs to this org. 'default' is the
  // implicit AgentDrive bucket — never materialized, always permitted.
  if (parsed.data.bucket_config_id !== 'default') {
    const cfg = await new BucketConfigStore(c.env.KV).get(ws.org_id, parsed.data.bucket_config_id);
    if (!cfg) {
      return c.json({ success: false, error: 'bucket_config not found' }, 404);
    }
    if (cfg.provider !== 'agentdrive-r2' && !selfHosted(c.env) && (await storage(c).getOrg(ws.org_id))?.plan !== 'team') {
      return c.json({ success: false, code: 'plan_required', error: 'Bring your own bucket requires Team', required_plan: 'team' }, 403);
    }
  }

  const updated: typeof ws = { ...ws, bucket_config_id: parsed.data.bucket_config_id };
  await c.env.KV.put(`ws:${wid}`, JSON.stringify(updated));
  return c.json({ success: true, data: updated });
});

app.delete('/:wid/bucket-config', workspaceAccess(), async (c) => {
  const auth = c.get('auth');
  const ws = c.get('workspace')!;
  if (auth.type === 'share' || !ws.org_id || auth.org_id !== ws.org_id || !(await canManageOrg(storage(c), auth, ws.org_id))) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  const wid = workspaceId(c);
  const { bucket_config_id: _drop, ...rest } = ws;
  await c.env.KV.put(`ws:${wid}`, JSON.stringify(rest));
  return c.json({ success: true, data: rest });
});

export default app;
