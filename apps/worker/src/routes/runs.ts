import { Hono } from 'hono';
import { z } from 'zod';
import { generateId, AGENT_PLATFORMS } from '@agentdrive/shared';
import type { AgentPlatform, AgentRun, RunStatus, ToolCall, ToolCallStatus } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { flexAuth, resolveWorkspace } from '../middleware/auth.js';
import { putRun, getRun, listRunsByAgent, listRunsByProject, DEFAULT_PAGE_SIZE } from '../services/runs.js';
import { orgUsageStatus, usageWarning } from '../services/limits.js';
import { storage } from '../lib/route-helpers.js';

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const RUN_STATUSES = ['success', 'failure', 'partial', 'in_progress'] as const;
const TOOL_CALL_STATUSES = ['success', 'failure', 'partial', 'pending'] as const;
const MAX_TOOL_CALLS = 100;
const MAX_SUMMARY_CHARS = 500;
const DEFAULT_PROJECT_PAGE = 50;
const MAX_PROJECT_PAGE = 100;
// Bounds the KV reads a platform-filtered project listing may spend.
const MAX_FILTERED_PAGES = 5;
// `<harness>:<session id>` for harness-synced sessions; `run_<id>` is the
// server-generated form, accepted so drive_log_run can update its own runs.
const RUN_ID_REGEX = /^(?:[a-z-]+:[A-Za-z0-9._-]{1,128}|run_[a-z0-9]{1,64})$/;
const PROJECT_REGEX = /^[a-z0-9._-]{1,200}$/;
// Client clocks drift; a far-future activity time would pin a run to the top.
const MAX_ACTIVITY_SKEW_MS = 5 * 60_000;

const toolCallSchema = z.object({
  tool: z.string().min(1).max(128),
  args_summary: z.string().optional(),
  result_summary: z.string().optional(),
  status: z.enum(TOOL_CALL_STATUSES),
  duration_ms: z.number().nonnegative().optional(),
  time_offset_ms: z.number().nonnegative(),
});

const runSchema = z.object({
  run_id: z.string().regex(RUN_ID_REGEX).optional(),
  workspace_id: z.string().optional(),
  task: z.string().min(1),
  artifacts_referenced: z.array(z.string()).optional(),
  artifacts_produced: z.array(z.string()).optional(),
  duration_ms: z.number().nonnegative().optional(),
  status: z.enum(RUN_STATUSES),
  metadata: z
    .object({
      project: z.string().regex(PROJECT_REGEX).optional(),
      last_activity_at: z.number().int().nonnegative().optional(),
    })
    .passthrough()
    .optional(),
  tool_calls: z.array(toolCallSchema).optional(),
});

function truncateSummary(value?: string): string | undefined {
  if (!value) return undefined;
  return value.length > MAX_SUMMARY_CHARS ? value.slice(0, MAX_SUMMARY_CHARS) : value;
}

function sanitizeToolCalls(raw: ToolCall[] | undefined): ToolCall[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.slice(0, MAX_TOOL_CALLS).map((tc) => ({
    tool: tc.tool,
    args_summary: truncateSummary(tc.args_summary),
    result_summary: truncateSummary(tc.result_summary),
    status: tc.status as ToolCallStatus,
    duration_ms: tc.duration_ms,
    time_offset_ms: tc.time_offset_ms,
  }));
}

const projectQuerySchema = z.object({
  project: z.string().regex(PROJECT_REGEX),
  platform: z.enum(AGENT_PLATFORMS as readonly [AgentPlatform, ...AgentPlatform[]]).optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

function issueSummary(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

const app = new Hono<AppType>();
app.use('*', flexAuth);

app.post('/', async (c) => {
  const auth = c.get('auth');
  if (auth.type !== 'agent') {
    return c.json({ success: false, error: 'Only agents can log runs' }, 403);
  }
  if (!auth.org_id) {
    return c.json({ success: false, error: 'Agent has no organization' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: `Invalid run: ${issueSummary(parsed.error)}` }, 400);
  }

  if (parsed.data.workspace_id) {
    const ws = await resolveWorkspace(c.env, auth, parsed.data.workspace_id);
    if (!ws) return c.json({ success: false, error: 'Workspace not found' }, 404);
    parsed.data.workspace_id = ws.id;
  }

  const now = Date.now();
  // run:<org>:<rid> is org-scoped, so an upsert can only ever replace a run
  // in the caller's own org.
  const previous = parsed.data.run_id ? await getRun(c.env, auth.org_id, parsed.data.run_id) : null;
  const runId = parsed.data.run_id ?? generateId('run');
  const createdAt = previous?.created_at ?? now;
  const metadata = parsed.data.metadata ?? {};
  if (metadata.last_activity_at !== undefined) {
    metadata.last_activity_at = Math.min(metadata.last_activity_at, now + MAX_ACTIVITY_SKEW_MS);
  }

  const run: AgentRun = {
    run_id: runId,
    org_id: auth.org_id,
    workspace_id: parsed.data.workspace_id,
    agent_id: auth.agent_id,
    agent_platform: auth.agent_platform,
    agent_role: auth.agent_role,
    task: parsed.data.task,
    artifacts_referenced: parsed.data.artifacts_referenced ?? [],
    artifacts_produced: parsed.data.artifacts_produced ?? [],
    duration_ms: parsed.data.duration_ms,
    status: parsed.data.status as RunStatus,
    metadata,
    tool_calls: sanitizeToolCalls(parsed.data.tool_calls as ToolCall[] | undefined),
    created_at: createdAt,
    updated_at: now,
  };

  await putRun(c.env, run, previous);

  const usage_warning = usageWarning(await orgUsageStatus(c.env, auth.org_id));
  return c.json({ success: true, data: { run_id: runId, created_at: createdAt, updated_at: now }, usage_warning }, previous ? 200 : 201);
});

app.get('/', async (c) => {
  const auth = c.get('auth');
  if (auth.type !== 'agent' && auth.type !== 'session') {
    return c.json({ success: false, error: 'Only agents and signed-in members can list runs' }, 403);
  }
  if (!auth.org_id) {
    return c.json({ success: false, error: 'No organization' }, 403);
  }
  const orgId = auth.org_id;

  if (c.req.query('project') !== undefined) {
    const q = projectQuerySchema.safeParse(c.req.query());
    if (!q.success) {
      return c.json({ success: false, error: `Invalid query: ${issueSummary(q.error)}` }, 400);
    }
    const limit = Math.min(q.data.limit ?? DEFAULT_PROJECT_PAGE, MAX_PROJECT_PAGE);
    const { platform } = q.data;
    const items: AgentRun[] = [];
    let cursor: string | null | undefined = q.data.cursor;
    for (let reads = 0; reads < (platform ? MAX_FILTERED_PAGES : 1); reads++) {
      const page = await listRunsByProject(c.env, auth.org_id, q.data.project, limit - items.length, cursor ?? undefined);
      items.push(...(platform ? page.items.filter((r) => r.agent_platform === platform) : page.items));
      cursor = page.cursor;
      if (!cursor || items.length >= limit) break;
    }
    return c.json({ success: true, data: items, cursor: cursor ?? null });
  }

  const newestPage = (agentId: string, cursor?: string) => listRunsByAgent(c.env, orgId, agentId, cursor);

  const agentId = c.req.query('agent_id') || (auth.type === 'agent' ? auth.agent_id : undefined);
  if (agentId) {
    const page = await newestPage(agentId, c.req.query('cursor') ?? undefined);
    return c.json({ success: true, data: page.items, cursor: page.cursor });
  }

  // A signed-in member sees the whole org: the newest page of each of its agents, merged.
  // Each agent's index is ordered by created_at, so merging on created_at keeps the top page exact.
  // shortcut: no cursor past that first page, only the first 50 agents, and about 100 KV reads per
  // agent; add an org-wide run index once orgs outgrow a handful of agents.
  const agents = (await storage(c).getOrgAgents(orgId)).items;
  const pages = await Promise.all(agents.map((a) => newestPage(a.agent_id)));
  const items = pages
    .flatMap((p) => p.items)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, DEFAULT_PAGE_SIZE);
  return c.json({ success: true, data: items, cursor: null });
});

app.get('/:rid', async (c) => {
  const auth = c.get('auth');
  if (auth.type === 'share') {
    return c.json({ success: false, error: 'Share tokens cannot read runs' }, 403);
  }
  const orgId = auth.type === 'agent' || auth.type === 'session' ? auth.org_id : undefined;
  if (!orgId) return c.json({ success: false, error: 'No organization' }, 403);

  const rid = c.req.param('rid');
  const run = await getRun(c.env, orgId, rid);
  if (!run) return c.json({ success: false, error: 'Run not found' }, 404);
  if (run.org_id !== orgId) {
    return c.json({ success: false, error: 'Run not found' }, 404);
  }
  return c.json({ success: true, data: run });
});

export default app;
