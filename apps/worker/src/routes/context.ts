import { Hono } from 'hono';
import { z } from 'zod';
import type {
  AgentPlatform,
  ContextArtifact,
  ContextArtifactAttribution,
  ContextArtifactRunSummary,
} from '@agentdrive/shared';
import type { Env, AuthContext } from '../env.js';
import { flexAuth, resolveWorkspace } from '../middleware/auth.js';
import { searchRateLimit } from '../middleware/rate-limit.js';
import {
  embedText,
  queryEmbeddings,
  dedupeByContent,
} from '../services/embeddings.js';
import { keywordSearch } from '../services/keyword-search.js';
import { currentEmbeddingHits } from '../services/retrieval.js';
import { listRunsByArtifact } from '../services/runs.js';
import { StorageService } from '../services/storage.js';
import { orgUsageStatus, usageWarning } from '../services/limits.js';
import {
  SEMANTIC_WEIGHT,
  RECENCY_WEIGHT,
  recencyScore,
  dedupeByPath,
  rerankWithPlatformDiversity,
  type ScoredHit,
} from '../services/context-rerank.js';

type Variables = { auth: AuthContext };
type AppType = { Bindings: Env; Variables: Variables };

const SNIPPET_CONTEXT_CHARS = 500;

const contextSchema = z
  .object({
    workspace_id: z.string().optional(),
    task: z.string().min(1),
    limit: z.number().int().positive().max(20).optional(),
  })
  .strict();

async function attachLastRun(
  env: Env,
  orgId: string,
  storage: StorageService,
  artifact: ContextArtifact,
): Promise<ContextArtifact> {
  try {
    const file = await storage.getFileByPath(artifact.ws_id, artifact.path);
    if (!file) return artifact;
    const page = await listRunsByArtifact(env, orgId, artifact.ws_id, file.id);
    if (page.items.length === 0) return artifact;
    // listRunsByArtifact returns runs in KV-list order (timestamp-keyed
    // ascending). Pick the most recent by created_at explicitly.
    const latest = page.items.reduce((a, b) => (a.created_at > b.created_at ? a : b));
    const last_run: ContextArtifactRunSummary = {
      run_id: latest.run_id,
      task: latest.task.slice(0, 200),
      status: latest.status,
      created_at: latest.created_at,
      agent_id: latest.agent_id,
      agent_platform: latest.agent_platform ?? 'unknown',
    };
    return { ...artifact, last_run };
  } catch {
    return artifact;
  }
}

const app = new Hono<AppType>();
app.use('*', flexAuth, searchRateLimit);

app.post('/', async (c) => {
  const auth = c.get('auth');
  if (auth.type === 'share') {
    return c.json({ success: false, error: 'Context requires agent or session auth' }, 403);
  }
  const orgId = auth.type === 'agent' ? auth.org_id : auth.org_id;
  if (!orgId) {
    return c.json({ success: false, error: 'No organization' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = contextSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'task is required' }, 400);
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

  const limit = parsed.data.limit ?? 5;
  const vector = await embedText(c.env, parsed.data.task);

  const filter: Record<string, string> = { org_id: indexOrg };
  if (parsed.data.workspace_id) filter.ws_id = parsed.data.workspace_id;

  // Over-fetch, validate current files, then collapse their duplicate chunks.
  // Copies at different workspace/path locations remain distinct artifacts.
  const raw = await queryEmbeddings(c.env, { vector, topK: limit * 8, filter });
  const currentHits = await currentEmbeddingHits(c.env, raw, indexOrg, parsed.data.workspace_id);
  const byHash = dedupeByContent(currentHits);
  const deduped = dedupeByPath(byHash);

  const now = Date.now();
  const storage = new StorageService(c.env.KV, c.env.R2);

  const scored: ScoredHit[] = deduped
    .filter((h) => h.metadata && h.metadata.org_id === indexOrg)
    .map((h) => {
      const ts = h.metadata.created_at ?? now;
      const rec = recencyScore(ts, now);
      const blended = SEMANTIC_WEIGHT * h.score + RECENCY_WEIGHT * rec;
      return { hit: h, semantic: h.score, recency: rec, blended };
    })
    .sort((a, b) => b.blended - a.blended);

  const picked = rerankWithPlatformDiversity(scored, limit);

  const artifacts: ContextArtifact[] = [];
  for (const { hit, semantic, recency, blended, diversityPenalty, reasons } of picked) {
    const meta = hit.metadata;
    const file = await storage.getFileByPath(meta.ws_id, meta.path);
    if (!file || file.content_hash !== meta.content_hash) continue;
    let snippet = meta.chunk_text;
    if (!snippet) {
      const content = await storage.readFileContentForMeta(c.env, file);
      snippet = content ? content.slice(0, SNIPPET_CONTEXT_CHARS) : undefined;
    }
    const attribution: ContextArtifactAttribution = {
      semantic_score: semantic,
      recency_score: recency,
      blended_score: blended - diversityPenalty,
      diversity_penalty: diversityPenalty > 0.001 ? -diversityPenalty : undefined,
      reasons,
    };
    artifacts.push({
      path: meta.path,
      ws_id: meta.ws_id,
      content_hash: meta.content_hash ?? hit.id.split(':c')[0],
      score: attribution.blended_score,
      snippet,
      agent_id: meta.agent_id,
      agent_platform: (meta.agent_platform as AgentPlatform | undefined) ?? 'unknown',
      created_at: meta.created_at,
      chunk_idx: meta.chunk_idx,
      match_kind: 'semantic',
      attribution,
    });
  }

  // Keyword fallback when semantic returns nothing — same logic as /v1/search.
  if (artifacts.length === 0) {
    const kwHits = await keywordSearch(c.env, {
      orgId,
      workspaceId: parsed.data.workspace_id,
      query: parsed.data.task,
      limit,
    });
    for (const k of kwHits) {
      artifacts.push({
        path: k.path,
        ws_id: k.ws_id,
        content_hash: k.content_hash,
        score: null,
        snippet: k.snippet,
        agent_id: k.agent_id ?? 'unknown',
        agent_platform: (k.agent_platform as AgentPlatform | undefined) ?? 'unknown',
        created_at: k.created_at,
        match_kind: 'keyword',
        attribution: {
          semantic_score: 0,
          recency_score: recencyScore(k.created_at, now),
          blended_score: 0,
          reasons: ['keyword fallback (semantic returned nothing)'],
        },
      });
    }
  }

  // Decorate each artifact with the most recent run that referenced it.
  // Done in parallel; failures are swallowed by attachLastRun.
  const decorated = await Promise.all(
    artifacts.map((a) => attachLastRun(c.env, orgId, storage, a)),
  );

  const usage_warning = usageWarning(await orgUsageStatus(c.env, orgId));
  return c.json({ success: true, data: { artifacts: decorated, retrieved_at: now }, usage_warning });
});

export default app;
