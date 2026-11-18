import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env.js';
import { flexAuth, requirePermission, shareFileScope, workspaceAccess, workspaceId, type Variables } from '../middleware/auth.js';
import { storage } from '../lib/route-helpers.js';

// /v1/workspaces/:wid/files/:fid/comments — add + list.
// Mounts at /v1/workspaces/:wid/files/:fid/comments.

type AppType = { Bindings: Env; Variables: Variables };

export const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  author_name: z.string().max(100).optional(),
  line_start: z.number().int().positive().optional(),
  line_end: z.number().int().positive().optional(),
});

const app = new Hono<AppType>();
app.use('*', flexAuth, workspaceAccess({ fileScope: true }), shareFileScope);

app.post('/', requirePermission('comment'), async (c) => {
  const auth = c.get('auth');
  const wid = workspaceId(c);
  const fid = c.req.param('fid')!;

  const body = await c.req.json().catch(() => null);
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'body is required (1-5000 chars)' }, 400);

  const s = storage(c);
  const file = await s.getFile(wid, fid);
  if (!file) return c.json({ success: false, error: 'File not found' }, 404);

  let actorType: 'agent' | 'human';
  let actorId: string;
  let authorName = parsed.data.author_name;
  if (auth.type === 'agent') {
    actorType = 'agent';
    actorId = auth.agent_id;
  } else if (auth.type === 'session') {
    actorType = 'human';
    actorId = auth.email;
    authorName = authorName || auth.email;
  } else {
    actorType = 'human';
    actorId = `share:${auth.token_id}`;
  }

  const comment = await s.addComment(wid, fid, actorType, actorId, parsed.data.body, authorName, parsed.data.line_start, parsed.data.line_end);
  const platform = auth.type === 'agent' ? auth.agent_platform : undefined;
  await s.recordActivity(wid, actorType, actorId, 'comment.add', 'file', fid, file.path, undefined, platform);
  return c.json({ success: true, data: comment }, 201);
});

app.get('/', async (c) => {
  const wid = workspaceId(c);
  const fid = c.req.param('fid')!;
  const cursor = c.req.query('cursor');
  const s = storage(c);
  // Comments are keyed by file id alone; the file must be in the gated workspace.
  if (!(await s.getFile(wid, fid))) return c.json({ success: false, error: 'File not found' }, 404);
  const page = await s.getComments(fid, cursor);
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

export default app;
