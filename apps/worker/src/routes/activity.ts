import { Hono } from 'hono';
import type { Env } from '../env.js';
import { flexAuth, workspaceAccess, workspaceId, type Variables } from '../middleware/auth.js';
import { storage } from '../lib/route-helpers.js';

// /v1/workspaces/:wid/activity. Mounts at /v1/workspaces/:wid/activity.

type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();
app.use('*', flexAuth, workspaceAccess());

app.get('/', async (c) => {
  const wid = workspaceId(c);
  // `?limit=` is intentionally dropped; page size is a server-side constant.
  // Clients page via `?cursor=`.
  const cursor = c.req.query('cursor');
  const s = storage(c);
  const page = await s.getActivity(wid, cursor);
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

export default app;
