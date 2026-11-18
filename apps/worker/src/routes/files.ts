import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { validatePath, validateFileSize, hashContent, AGENT_PLATFORMS } from '@agentdrive/shared';
import type { Env } from '../env.js';
import { flexAuth, requirePermission, shareFileScope, workspaceAccess, workspaceId, type Variables } from '../middleware/auth.js';
import { canManageOrg, storage, requireAgent } from '../lib/route-helpers.js';
import { searchRateLimit } from '../middleware/rate-limit.js';
import { chunkText, deleteFileEmbeddings, upsertFileEmbeddings } from '../services/embeddings.js';
import {
  metricWarning, orgQuota, orgUsageStatus, planLimitBody, planLimitError, resumeEnforced, usageStatus, usageWarning,
  type PlanLimitBody, type UsageWarning,
} from '../services/limits.js';
import { monthlyMeter } from '../durable-objects/resume-meter.js';
import { resumeMarkerKey, resumeMonth } from '../services/storage.js';
import { selfHosted } from '../lib/self-hosted.js';

// File CRUD + version list + per-file run list. Mounts at
// /v1/workspaces/:wid/files in index.ts.

type AppType = { Bindings: Env; Variables: Variables };

const writeSchema = z.object({
  path: z.string(),
  content: z.string(),
  message: z.string().optional(),
});

// Runs before workspaceAccess: a write to a new workspace name creates it, so a
// rejected write must fail first or it leaves an empty workspace behind.
const validateWrite = createMiddleware<AppType>(async (c, next) => {
  const parsed = writeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: 'path and content are required' }, 400);
  const error = validatePath(parsed.data.path) || validateFileSize(new TextEncoder().encode(parsed.data.content).length);
  if (error) return c.json({ success: false, error }, 400);
  await next();
});

// sessions/<project>/<harness>/<id>.md, as sessionPath in packages/mcp-server
// writes it. Uploads under sessions/<project>/files/ never match: "files" is no harness.
const SESSION_TRANSCRIPT = /^sessions\/([^/]+)\/([^/]+)\/[^/]+\.md$/;
const HARNESSES = new Set<string>(AGENT_PLATFORMS.filter((p) => p !== 'unknown'));

// gstack-shortcut(dec-9013b25a): hosted-MCP reads with platform unknown are never counted, upgrade when enforcement turns on or hosted-MCP traffic appears
// The meter must never break a read, so any KV error serves the content.
async function meterResume(
  c: Context<AppType>, orgId: string, path: string, from: string, to: string,
): Promise<{ refusal?: PlanLimitBody; warning?: UsageWarning }> {
  const s = storage(c);
  const enforced = resumeEnforced(c.env);
  try {
    const month = resumeMonth(new Date());
    const key = await resumeMarkerKey(orgId, month, path, to);
    const [org, usage] = await Promise.all([s.getOrg(orgId), s.getUsage(orgId)]);
    if (!org) return {};
    const quota = orgQuota(org);
    const { meter, prefix } = monthlyMeter(c.env, orgId, month);
    const { count, outcome } = await meter.record(prefix, key, enforced ? quota.max_resumes_month : null);
    const status = usageStatus(org.plan, usage, c.env.SITE_URL, quota, { count, enforced });
    console.log(JSON.stringify({
      event: 'resume_meter', org_id: orgId, from, to, count, limit: quota.max_resumes_month, enforced, outcome,
    }));
    return outcome === 'refused'
      ? { refusal: planLimitBody(status, 'resume_count') }
      : { warning: metricWarning(status, 'resume_count') };
  } catch (err) {
    console.error(JSON.stringify({ event: 'resume_meter_error', org_id: orgId, from, to }), err);
    return {};
  }
}

const app = new Hono<AppType>();
app.use('*', flexAuth);

app.post('/', validateWrite, workspaceAccess({ createOnPost: true, fileScope: true }), requirePermission('edit'), async (c) => {
  const auth = c.get('auth');
  const wid = workspaceId(c);
  const parsed = { data: writeSchema.parse(await c.req.json()) };

  let actorType: 'agent' | 'human';
  let actorId: string;
  if (auth.type === 'agent') {
    actorType = 'agent';
    actorId = auth.agent_id;
  } else if (auth.type === 'session') {
    actorType = 'human';
    actorId = auth.email;
  } else {
    actorType = 'human';
    actorId = `share:${auth.token_id}`;
  }

  const s = storage(c);
  const existing = await s.getFileByPath(wid, parsed.data.path);
  if (auth.type === 'share' && auth.file_id && existing?.id !== auth.file_id) {
    return c.json({ success: false, error: 'File not found' }, 404);
  }
  const action = existing ? 'file.update' as const : 'file.write' as const;

  // Content is indexed under the workspace's org, not the writer's, so an outside
  // collaborator's writes never surface in their own org's search.
  const orgId = c.get('workspace')?.org_id;
  const agentPlatform = auth.type === 'agent' ? auth.agent_platform : undefined;

  const file = await s.writeFile(
    wid,
    parsed.data.path,
    parsed.data.content,
    actorType,
    actorId,
    parsed.data.message,
    orgId ? c.env : undefined,
    orgId ? c.executionCtx : undefined,
    orgId ? { agent_platform: agentPlatform, org_id: orgId, mime: 'text/markdown' } : undefined,
  );
  await s.recordActivity(wid, actorType, actorId, action, 'file', file.id, file.path, undefined, agentPlatform);
  const usage_warning = orgId ? usageWarning(await orgUsageStatus(c.env, orgId)) : undefined;
  return c.json({ success: true, data: file, usage_warning }, existing ? 200 : 201);
});

app.use('*', workspaceAccess({ fileScope: true }));
app.use('/:fid/*', shareFileScope);

app.get('/', async (c) => {
  const auth = c.get('auth');
  const wid = workspaceId(c);
  const prefix = c.req.query('prefix');
  const cursor = c.req.query('cursor');
  const s = storage(c);
  if (auth.type === 'share' && auth.file_id) {
    const file = await s.getFile(wid, auth.file_id);
    return c.json({ success: true, data: file && file.path.startsWith(prefix ?? '') ? [file] : [], cursor: null });
  }
  const page = await s.listFiles(wid, prefix ?? undefined, cursor);
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

app.get('/:fid', async (c) => {
  const wid = workspaceId(c);
  const fid = c.req.param('fid')!;
  const s = storage(c);
  const file = await s.getFile(wid, fid);
  if (!file) return c.json({ success: false, error: 'File not found' }, 404);

  const includeContent = c.req.query('content') === 'true';
  if (includeContent) {
    // Phase 4: locator-aware read so files written into a BYO bucket
    // resolve back to that bucket even after the workspace's
    // bucket_config changes.
    const content = await s.readFileContentForMeta(c.env, file);
    const auth = c.get('auth');
    const session = SESSION_TRANSCRIPT.exec(file.path);
    let usage_warning: UsageWarning | undefined;
    // An unknown platform (the CLI, or an MCP server without its harness set)
    // may well be the same harness, so it never counts as a cross-harness resume.
    if (content !== null && session && auth.type === 'agent' && auth.org_id
      && HARNESSES.has(session[2]!) && HARNESSES.has(auth.agent_platform) && auth.agent_platform !== session[2]) {
      if (!selfHosted(c.env)) {
        const meter = await meterResume(c, auth.org_id, file.path, session[2]!, auth.agent_platform);
        if (meter.refusal) return planLimitError(c, meter.refusal);
        usage_warning = meter.warning;
      }
      c.executionCtx.waitUntil(
        s.recordCrossHarnessResume(auth.org_id, auth.agent_id, session[2]!, auth.agent_platform, session[1]!)
          .catch((err) => console.error('xresume record failed', err)),
      );
    }
    return c.json({ success: true, data: { ...file, content }, usage_warning });
  }
  return c.json({ success: true, data: file });
});

// Operator maintenance: rebuild only the derived index. No content write,
// version, activity, resume counter or quota mutation accompanies this action.
app.post('/:fid/reindex', searchRateLimit, async (c) => {
  const auth = c.get('auth');
  const workspace = c.get('workspace')!;
  const orgId = workspace.org_id;
  const s = storage(c);
  if (!orgId || auth.type === 'share' || auth.org_id !== orgId || !(await canManageOrg(s, auth, orgId))) {
    return c.json({ success: false, error: 'Only an org owner or admin can rebuild the search index' }, 403);
  }
  const wid = workspaceId(c);
  const fid = c.req.param('fid')!;
  const file = await s.getFile(wid, fid);
  if (!file) return c.json({ success: false, error: 'File not found' }, 404);
  try {
    const content = await s.readFileContentForMeta(c.env, file);
    if (content === null) return c.json({ success: false, error: 'File content not found' }, 404);
    if (content.startsWith('agentdrive-encrypted:v0:')) {
      return c.json({ success: false, code: 'encrypted_content', error: 'Private Workspace content cannot be semantically indexed' }, 409);
    }
    if (await hashContent(content) !== file.content_hash) {
      return c.json({ success: false, code: 'content_mismatch', error: 'Stored bytes do not match the canonical content hash' }, 502);
    }
    const mutation = await upsertFileEmbeddings(c.env, {
      contentHash: file.content_hash,
      chunks: chunkText(content),
      baseMetadata: {
        org_id: orgId, ws_id: wid, path: file.path, agent_id: file.updated_by,
        mime: file.mime_type, created_at: Date.parse(file.updated_at),
      },
      strict: true,
    });
    if (!mutation) throw new Error('Vector index returned no mutation receipt');
    const current = await s.getFile(wid, fid);
    const currentWorkspace = await s.getWorkspace(wid);
    if (!current || JSON.stringify(current) !== JSON.stringify(file) || currentWorkspace?.org_id !== orgId) {
      // A same-content edit can change provenance too. Remove this snapshot's
      // derived record and ask for retry rather than keeping stale metadata.
      await deleteFileEmbeddings(c.env, file.content_hash, { org_id: orgId, ws_id: wid, path: file.path });
      return c.json({ success: false, code: 'file_changed', error: 'File metadata changed during indexing; retry the current version' }, 409);
    }
    // Vectorize mutations propagate asynchronously. The receipt acknowledges
    // acceptance; an operator must still poll search for actual availability.
    return c.json({ success: true, data: { status: 'accepted', file_id: fid, content_hash: file.content_hash, mutation_id: mutation.mutationId, count: mutation.count } });
  } catch (error) {
    console.error('file_reindex_failed', fid, error);
    return c.json({ success: false, code: 'reindex_failed', error: 'Search indexing failed; no file versions or usage were changed' }, 502);
  }
});

app.put('/:fid', requirePermission('edit'), async (c) => {
  const auth = c.get('auth');
  const wid = workspaceId(c);
  const fid = c.req.param('fid')!;

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ content: z.string(), message: z.string().optional() }).safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: 'content is required' }, 400);

  const encoder = new TextEncoder();
  const sizeError = validateFileSize(encoder.encode(parsed.data.content).length);
  if (sizeError) return c.json({ success: false, error: sizeError }, 400);

  const s = storage(c);
  const existing = await s.getFile(wid, fid);
  if (!existing) return c.json({ success: false, error: 'File not found' }, 404);

  let actorType: 'agent' | 'human';
  let actorId: string;
  if (auth.type === 'agent') {
    actorType = 'agent';
    actorId = auth.agent_id;
  } else if (auth.type === 'session') {
    actorType = 'human';
    actorId = auth.email;
  } else {
    actorType = 'human';
    actorId = `share:${auth.token_id}`;
  }

  const orgId = c.get('workspace')?.org_id;
  const agentPlatform = auth.type === 'agent' ? auth.agent_platform : undefined;

  const file = await s.writeFile(
    wid,
    existing.path,
    parsed.data.content,
    actorType,
    actorId,
    parsed.data.message,
    orgId ? c.env : undefined,
    orgId ? c.executionCtx : undefined,
    orgId ? { agent_platform: agentPlatform, org_id: orgId, mime: 'text/markdown' } : undefined,
  );
  await s.recordActivity(wid, actorType, actorId, 'file.update', 'file', file.id, file.path, undefined, agentPlatform);
  const usage_warning = orgId ? usageWarning(await orgUsageStatus(c.env, orgId)) : undefined;
  return c.json({ success: true, data: file, usage_warning });
});

app.delete('/:fid', async (c) => {
  const auth = c.get('auth');
  const agentCheck = requireAgent(auth);
  if (agentCheck) return c.json(agentCheck, 403);
  if (auth.type !== 'agent') return c.json({ success: false, error: 'Forbidden' }, 403);
  const wid = workspaceId(c);
  const fid = c.req.param('fid')!;

  const s = storage(c);
  const file = await s.getFile(wid, fid);
  if (!file) return c.json({ success: false, error: 'File not found' }, 404);

  await s.deleteFile(wid, fid, c.env, c.executionCtx);
  await s.recordActivity(wid, 'agent', auth.agent_id, 'file.delete', 'file', fid, file.path, undefined, auth.agent_platform);
  return c.json({ success: true, data: { deleted: true } });
});

app.get('/:fid/versions', async (c) => {
  const wid = workspaceId(c);
  const fid = c.req.param('fid')!;
  const cursor = c.req.query('cursor');
  const s = storage(c);
  const file = await s.getFile(wid, fid);
  if (!file) return c.json({ success: false, error: 'File not found' }, 404);
  const page = await s.getVersions(fid, cursor);
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

app.get('/:fid/runs', async (c) => {
  const auth = c.get('auth');
  const wid = workspaceId(c);
  const fid = c.req.param('fid')!;
  if (auth.type === 'share') {
    return c.json({ success: false, error: 'Share tokens cannot read runs' }, 403);
  }
  const orgId = auth.type === 'agent' || auth.type === 'session' ? auth.org_id : undefined;
  if (!orgId) return c.json({ success: false, error: 'No organization' }, 403);

  const s = storage(c);
  const file = await s.getFile(wid, fid);
  if (!file) return c.json({ success: false, error: 'File not found' }, 404);

  const cursor = c.req.query('cursor');
  const { listRunsByArtifact } = await import('../services/runs.js');
  const page = await listRunsByArtifact(c.env, orgId, wid, fid, cursor);
  return c.json({ success: true, data: page.items, cursor: page.cursor });
});

export default app;
