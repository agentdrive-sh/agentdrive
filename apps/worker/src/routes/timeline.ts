import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AuthContext } from '../env.js';
import { flexAuth } from '../middleware/auth.js';
import { getOrgTimeline, TIMELINE_HARD_LIMIT } from '../services/timeline.js';

// GET /v1/org/timeline?since=&limit= — cross-workspace activity stream for
// the caller's org. Scan-at-read; bounded by TIMELINE_HARD_LIMIT (1000).
// Per E6: 30s cache; new events bust by virtue of the timeline being
// scanned freshly each request when no Cache header survives.

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const app = new Hono<AppType>();
app.use('*', flexAuth);

const querySchema = z.object({
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(TIMELINE_HARD_LIMIT).optional(),
});

app.get('/', async (c) => {
  const auth = c.get('auth');
  if (auth.type === 'share') {
    return c.json({ success: false, error: 'Share tokens cannot read the org timeline' }, 403);
  }
  const orgId = auth.type === 'agent' ? auth.org_id : auth.org_id;
  if (!orgId) {
    return c.json({ success: false, error: 'No organization' }, 403);
  }

  const parsed = querySchema.safeParse({
    since: c.req.query('since'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json({ success: false, error: 'since must be ISO datetime; limit must be 1-1000' }, 400);
  }

  const page = await getOrgTimeline(c.env, {
    orgId,
    since: parsed.data.since,
    limit: parsed.data.limit,
  });

  // 30s edge cache (E6). Cache-Control private since the body is org-scoped
  // and varies by auth principal.
  c.header('Cache-Control', 'private, max-age=30');
  return c.json({
    success: true,
    data: page.items,
    cursor: page.cursor,
    truncated: page.items.length === (parsed.data.limit ?? Math.min(200, TIMELINE_HARD_LIMIT)),
  });
});

export default app;
