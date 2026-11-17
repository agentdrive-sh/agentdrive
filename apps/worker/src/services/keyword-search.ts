import type { Env } from '../env.js';
import type { FileMeta } from '@agentdrive/shared';
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

export async function keywordSearch(
  env: Env,
  args: { orgId: string; workspaceId?: string; query: string; limit: number },
): Promise<KeywordHit[]> {
  const queryTokens = tokenize(args.query);
  if (queryTokens.length === 0) return [];

  const candidates: FileMeta[] = [];

  if (args.workspaceId) {
    const list = await env.KV.list({
      prefix: `idx:ws_files:${args.workspaceId}:`,
      limit: MAX_CANDIDATES,
    });
    const fids = await Promise.all(list.keys.map((k) => env.KV.get(k.name)));
    const metas = await Promise.all(
      fids
        .filter((fid): fid is string => Boolean(fid))
        .map((fid) => env.KV.get<FileMeta>(`file:${args.workspaceId}:${fid}`, 'json')),
    );
    for (const m of metas) {
      if (m) candidates.push(m);
    }
  } else {
    // No workspace scope — best-effort: scan workspaces in the org and merge.
    // Capped at 4 workspaces for one round-trip; larger orgs accept a partial
    // keyword-tier result rather than blocking.
    const orgWs = await env.KV.list({
      prefix: `idx:org_workspaces:${args.orgId}:`,
      limit: 4,
    });
    const wsIds = await Promise.all(orgWs.keys.map((k) => env.KV.get(k.name)));
    for (const wsId of wsIds) {
      if (!wsId) continue;
      const list = await env.KV.list({
        prefix: `idx:ws_files:${wsId}:`,
        limit: 50,
      });
      const fids = await Promise.all(list.keys.map((k) => env.KV.get(k.name)));
      const metas = await Promise.all(
        fids
          .filter((fid): fid is string => Boolean(fid))
          .map((fid) => env.KV.get<FileMeta>(`file:${wsId}:${fid}`, 'json')),
      );
      for (const m of metas) {
        if (m) candidates.push(m);
      }
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  }

  if (candidates.length === 0) return [];

  // Score by token frequency in path + small-file content.
  const scored: { meta: FileMeta; score: number; snippet: string }[] = [];
  for (const meta of candidates) {
    const pathTokens = tokenize(meta.path);
    const pathTf = termFreq(pathTokens);
    const pathScore = queryTokens.reduce((s, t) => s + (pathTf.get(t) ?? 0), 0);

    let contentScore = 0;
    let snippet = meta.path;
    if (meta.size <= SMALL_FILE_BYTES) {
      const { driver, objectKey } = await resolveDriverForRead(env, meta);
      const obj = await driver.get(objectKey);
      if (obj) {
        const content = await obj.text();
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
    if (score > 0) scored.push({ meta, score, snippet });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, args.limit).map(({ meta, score, snippet }) => ({
    ws_id: meta.workspace_id,
    path: meta.path,
    content_hash: meta.content_hash,
    score,
    snippet,
    agent_id: meta.updated_by,
    agent_platform: undefined,
    created_at: Date.parse(meta.updated_at),
  }));
}
