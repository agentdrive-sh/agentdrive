import type { Env } from '../env.js';
import { resolveLocator, type AgentPlatform, type FileMeta } from '@agentdrive/shared';
import { StorageService } from './storage.js';
import { resolveDriverForRead } from './bucket-driver/resolve.js';

// Hybrid fallback for when Vectorize returns zero hits. BM25-lite over path +
// content matches. Capped at 200 candidate files for one round-trip; the
// frontend gets a `match_kind: 'keyword'` marker so users see that this came
// from the lexical path rather than embeddings.

const MAX_CANDIDATES = 200;
const SMALL_FILE_BYTES = 5_000;
const PREVIEW_CHARS = 240;

export interface KeywordHit {
  ws_id: string;
  path: string;
  content_hash: string;
  score: number;
  snippet: string;
  agent_id?: string;
  agent_platform?: string;
  created_at: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\- ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

interface SearchFilter { agent_platform?: AgentPlatform; agent_id?: string; path_prefix?: string }

export async function keywordSearch(
  env: Env,
  args: { orgId: string; workspaceId?: string; query: string; limit: number; filter?: SearchFilter },
): Promise<KeywordHit[]> {
  const queryTokens = tokenize(args.query);
  if (queryTokens.length === 0) return [];

  const store = new StorageService(env.KV, env.R2);
  let workspaces: string[];
  if (args.workspaceId) {
    workspaces = [args.workspaceId];
  } else {
    const page = await store.listWorkspaces(args.orgId, undefined, 4);
    workspaces = page.items.map(ws => ws.id);
  }
  const candidates: FileMeta[] = [];
  for (const wid of workspaces) {
    const page = await store.listFiles(wid, args.filter?.path_prefix, undefined, args.workspaceId ? MAX_CANDIDATES : 50);
    candidates.push(...page.items.filter(meta =>
      (!args.filter?.agent_id || meta.updated_by === args.filter.agent_id) &&
      (!args.filter?.agent_platform || (meta.updated_by_platform ?? 'unknown') === args.filter.agent_platform),
    ));
  }

  // Copies of a blob in the same workspace and bucket reuse its content for
  // this request. A bucket switch or distinct object key gets its own read.
  let unavailableContents = 0;
  const contents = new Map<string, Promise<string | undefined>>();
  function readContent(meta: FileMeta) {
    const locator = resolveLocator(meta, meta.content_hash);
    const key = JSON.stringify([meta.workspace_id, locator.provider, locator.bucket_config_id, locator.object_key, locator.key_version]);
    let pending = contents.get(key);
    if (!pending) {
      pending = resolveDriverForRead(env, meta)
        .then(async ({ driver, objectKey }) => (await driver.get(objectKey))?.text())
        .catch(() => {
          unavailableContents++;
          return undefined;
        });
      contents.set(key, pending);
    }
    return pending;
  }

  async function scoreCandidate(meta: FileMeta) {
    const pathTokens = tokenize(meta.path);
    const pathTf = termFreq(pathTokens);
    const pathScore = queryTokens.reduce((s, t) => s + (pathTf.get(t) ?? 0), 0);

    let contentScore = 0;
    let snippet = meta.path;
    if (meta.size <= SMALL_FILE_BYTES) {
      const content = await readContent(meta);
      if (content !== undefined) {
        const contentTokens = tokenize(content);
        const contentTf = termFreq(contentTokens);
        contentScore = queryTokens.reduce(
          (s, t) => s + Math.log(1 + (contentTf.get(t) ?? 0)),
          0,
        );
        // Pick a snippet around the first matched token.
        const lower = content.toLowerCase();
        let firstHit = -1;
        for (const t of queryTokens) {
          const i = lower.indexOf(t);
          if (i !== -1 && (firstHit === -1 || i < firstHit)) firstHit = i;
        }
        if (firstHit !== -1) {
          const start = Math.max(0, firstHit - 80);
          snippet = content.slice(start, start + PREVIEW_CHARS);
        } else {
          snippet = content.slice(0, PREVIEW_CHARS);
        }
      }
    }
    const score = pathScore * 2 + contentScore;
    return { meta, score, snippet };
  }

  const scored: { meta: FileMeta; score: number; snippet: string }[] = [];
  // Bound concurrent bucket connections and preserve candidate order for ties.
  for (let offset = 0; offset < candidates.length; offset += 4) {
    const group = await Promise.all(candidates.slice(offset, offset + 4).map(scoreCandidate));
    scored.push(...group.filter(hit => hit.score > 0));
  }

  if (unavailableContents) {
    console.warn(JSON.stringify({ event: 'keyword_content_unavailable', count: unavailableContents }));
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, args.limit).map(({ meta, score, snippet }) => ({
    ws_id: meta.workspace_id,
    path: meta.path,
    content_hash: meta.content_hash,
    score,
    snippet,
    agent_id: meta.updated_by,
    agent_platform: meta.updated_by_platform,
    created_at: Date.parse(meta.updated_at),
  }));
}
