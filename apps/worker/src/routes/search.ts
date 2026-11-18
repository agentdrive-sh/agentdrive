import { Hono } from 'hono';
import { z } from 'zod';
import { AGENT_PLATFORMS } from '@agentdrive/shared';
import type { AgentPlatform, RetrievalResult } from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { flexAuth, resolveWorkspace } from '../middleware/auth.js';
import { searchRateLimit } from '../middleware/rate-limit.js';
import { embedText, queryEmbeddings, dedupeByContent } from '../services/embeddings.js';
import { keywordSearch } from '../services/keyword-search.js';
import { currentEmbeddingHits } from '../services/retrieval.js';

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

// Over-fetch from Vectorize so dedupe-by-content has room to move chunks of
// the same file out of the top-K before we cut.
const OVERFETCH_MULTIPLIER = 4;

export const searchSchema = z.object({
  workspace_id: z.string().optional(),
  query: z.string().min(1),
  top_k: z.number().int().positive().max(50).optional(),
  filter: z.object({
    agent_platform: z.enum(AGENT_PLATFORMS as readonly [AgentPlatform, ...AgentPlatform[]]).optional(),
    agent_id: z.string().optional(),
    path_prefix: z.string().optional(),
  }).optional(),
});

const app = new Hono<AppType>();
app.use('*', flexAuth, searchRateLimit);

app.post('/', async (c) => {
  const auth = c.get('auth');

  let orgId: string | undefined;
  if (auth.type === 'agent') orgId = auth.org_id;
  else if (auth.type === 'session') orgId = auth.org_id;

  if (auth.type === 'share') {
    return c.json({ success: false, error: 'Search requires agent or session auth' }, 403);
  }
  if (!orgId) {
    return c.json({ success: false, error: 'No organization' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'query is required' }, 400);
  }
  let indexOrg = orgId;
  // The keyword fallback lists the workspace's files directly, outside the org-filtered vector index.
  if (parsed.data.workspace_id) {
    const ws = await resolveWorkspace(c.env, auth, parsed.data.workspace_id);
    if (!ws) return c.json({ success: false, error: 'Workspace not found' }, 404);
    parsed.data.workspace_id = ws.id;
    // A role grant can open another org's workspace; its vectors carry that org.
    if (ws.org_id) indexOrg = ws.org_id;
  }

  const topK = parsed.data.top_k ?? 10;
  const vector = await embedText(c.env, parsed.data.query);

  const filter: Record<string, string> = { org_id: indexOrg };
  if (parsed.data.workspace_id) filter.ws_id = parsed.data.workspace_id;
  if (parsed.data.filter?.agent_platform) filter.agent_platform = parsed.data.filter.agent_platform;
  if (parsed.data.filter?.agent_id) filter.agent_id = parsed.data.filter.agent_id;

  const rawHits = await queryEmbeddings(c.env, {
    vector,
    topK: topK * OVERFETCH_MULTIPLIER,
    filter,
  });
  const currentHits = await currentEmbeddingHits(c.env, rawHits, indexOrg, parsed.data.workspace_id);
  const prefix = parsed.data.filter?.path_prefix;
  const hits = dedupeByContent(currentHits.filter(hit => !prefix || hit.metadata?.path?.startsWith(prefix))).slice(0, topK);

  const results: RetrievalResult[] = [];
  for (const hit of hits) {
    const meta = hit.metadata;
    if (!meta || meta.org_id !== indexOrg) continue;

    results.push({
      path: meta.path,
      ws_id: meta.ws_id,
      content_hash: meta.content_hash ?? hit.id.split(':c')[0],
      score: hit.score,
      snippet: meta.chunk_text,
      agent_id: meta.agent_id,
      agent_platform: (meta.agent_platform as AgentPlatform | undefined) ?? 'unknown',
      created_at: meta.created_at,
      chunk_idx: meta.chunk_idx,
      match_kind: 'semantic',
    });
  }

  // Hybrid keyword fallback: if semantic returned nothing, lexical-search at
  // a smaller candidate cap so we still return something useful.
  if (results.length === 0) {
    const kwHits = await keywordSearch(c.env, {
      orgId,
      workspaceId: parsed.data.workspace_id,
      query: parsed.data.query,
      limit: topK,
      filter: parsed.data.filter,
    });
    for (const k of kwHits) {
      results.push({
        path: k.path,
        ws_id: k.ws_id,
        content_hash: k.content_hash,
        score: null,
        snippet: k.snippet,
        agent_id: k.agent_id ?? 'unknown',
        agent_platform: (k.agent_platform as AgentPlatform | undefined) ?? 'unknown',
        created_at: k.created_at,
        match_kind: 'keyword',
      });
    }
  }

  return c.json({ success: true, data: { hits: results, total: results.length } });
});

export default app;
