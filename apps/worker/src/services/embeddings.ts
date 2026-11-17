import type { Env } from '../env.js';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIMS = 768;
// Vectorize v2 permits at most 50 matches when fetching complete metadata.
// Search/context may request more internally to over-fetch before deduping.
const MAX_FULL_METADATA_RESULTS = 50;

// BGE retrieval sweet spot: ~1500-char windows with 200-char overlap. The
// 16-chunk cap bounds Workers AI inference per write; a longer file keeps its
// first and last ~11 KB, so search sees how a session started and how it ended.
// gstack-shortcut(dec-9f7be218): middle of files over ~21 KB stays unindexed, upgrade when Pro users report missing mid-session hits or median transcript passes 100 KB
export const CHUNK_SIZE = 1500;
export const CHUNK_OVERLAP = 200;
export const MAX_CHUNKS = 16;

// Snippet shown in search/context results — pulled from the matched chunk so
// the UI doesn't need a second R2 fetch.
const CHUNK_TEXT_PREVIEW = 400;

export interface EmbeddingMetadata {
  ws_id: string;
  path: string;
  agent_id: string;
  agent_platform?: string;
  org_id: string;
  mime?: string;
  created_at: number;
  content_hash: string;
  chunk_idx?: number;
  chunk_text?: string;
}

export interface EmbeddingHit {
  id: string;
  score: number;
  metadata: EmbeddingMetadata;
}

export interface Chunk {
  idx: number;
  text: string;
}

function zeroVector(): number[] {
  return new Array(EMBEDDING_DIMS).fill(0);
}

// Indices stay dense (0..15) because deleteEmbedding removes ids 0..MAX_CHUNKS-1.
export function chunkText(text: string): Chunk[] {
  if (!text || text.length === 0) return [{ idx: 0, text: '' }];
  if (text.length <= CHUNK_SIZE) return [{ idx: 0, text }];
  const stride = CHUNK_SIZE - CHUNK_OVERLAP;
  const natural = Math.ceil((text.length - CHUNK_SIZE) / stride) + 1;
  const half = MAX_CHUNKS / 2;
  const starts = natural <= MAX_CHUNKS
    ? Array.from({ length: natural }, (_, i) => i * stride)
    : [
        ...Array.from({ length: half }, (_, i) => i * stride),
        ...Array.from({ length: half }, (_, j) => text.length - CHUNK_SIZE - (half - 1 - j) * stride),
      ];
  return starts.map((start, idx) => ({ idx, text: text.slice(start, start + CHUNK_SIZE) }));
}

// How many chunks chunkText makes of a text this long. Callers that only know a
// byte size get an overcount for multibyte text, which is fine for quota counting.
export function chunkCountFor(length: number): number {
  if (length <= CHUNK_SIZE) return 1;
  return Math.min(MAX_CHUNKS, Math.ceil((length - CHUNK_SIZE) / (CHUNK_SIZE - CHUNK_OVERLAP)) + 1);
}

// Vectorize id is capped at 64 bytes. SHA-256 hex is 64 chars; we trim to
// 60 to leave room for the chunk suffix. The authoritative full content_hash
// lives in metadata.content_hash so callers can still resolve back to R2.
const HASH_PREFIX_LEN = 60;

export function chunkIdFor(contentHash: string, idx: number): string {
  const prefix = contentHash.slice(0, HASH_PREFIX_LEN);
  return `${prefix}c${idx}`;
}

type EmbeddingScope = Pick<EmbeddingMetadata, 'org_id' | 'ws_id' | 'path'>;

// Content addressing deduplicates bytes, not ownership. One vector per file
// reference preserves identical documents in different workspaces/tenants.
async function scopedHash(contentHash: string, scope: EmbeddingScope): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([scope.org_id, scope.ws_id, scope.path, contentHash]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function embedText(env: Env, text: string): Promise<number[]> {
  if (!text || text.length === 0) return zeroVector();
  const input = text.length > CHUNK_SIZE ? text.slice(0, CHUNK_SIZE) : text;
  try {
    const result = (await env.AI.run(EMBEDDING_MODEL, { text: [input] })) as {
      data?: number[][];
    };
    const vec = result?.data?.[0];
    if (!vec || vec.length !== EMBEDDING_DIMS) return zeroVector();
    return vec;
  } catch (err) {
    console.error('vectorize_error', 'embedText', err);
    return zeroVector();
  }
}

export async function embedChunks(env: Env, chunks: Chunk[], strict = false): Promise<number[][]> {
  if (chunks.length === 0) return [];
  try {
    const result = (await env.AI.run(EMBEDDING_MODEL, {
      text: chunks.map((c) => c.text),
    })) as { data?: number[][] };
    const vecs = result?.data ?? [];
    if (vecs.length !== chunks.length) {
      if (strict) throw new Error('Inference returned an incomplete embedding batch');
      return chunks.map(() => zeroVector());
    }
    return vecs.map((v) => {
      if (Array.isArray(v) && v.length === EMBEDDING_DIMS && v.every(Number.isFinite)) return v;
      if (strict) throw new Error('Inference returned an invalid embedding');
      return zeroVector();
    });
  } catch (err) {
    console.error('vectorize_error', 'embedChunks', err);
    if (strict) throw err;
    return chunks.map(() => zeroVector());
  }
}

export async function upsertEmbedding(
  env: Env,
  args: { contentHash: string; vector: number[]; metadata: EmbeddingMetadata },
): Promise<void> {
  try {
    const idHash = await scopedHash(args.contentHash, args.metadata);
    await env.VECTORIZE.upsert([
      {
        id: chunkIdFor(idHash, args.metadata.chunk_idx ?? 0),
        values: args.vector,
        metadata: args.metadata as unknown as Record<string, string | number | boolean>,
      },
    ]);
  } catch (err) {
    // advisory: write integrity > search integrity
    console.error('vectorize_error', 'upsertEmbedding', err);
  }
}

export interface ChunkUpsert {
  contentHash: string;
  chunks: Chunk[];
  baseMetadata: Omit<EmbeddingMetadata, 'chunk_idx' | 'chunk_text' | 'content_hash'>;
  // Maintenance must report actual provider failure, unlike advisory indexing
  // on a content write (where successful byte storage is the primary result).
  strict?: boolean;
}

export async function upsertFileEmbeddings(env: Env, args: ChunkUpsert): Promise<{ mutationId?: string; count?: number } | undefined> {
  if (args.chunks.length === 0) return;
  const vectors = await embedChunks(env, args.chunks, args.strict);
  const idHash = await scopedHash(args.contentHash, args.baseMetadata);
  const items = args.chunks.map((chunk, i) => {
    const metadata: EmbeddingMetadata = {
      ...args.baseMetadata,
      content_hash: args.contentHash,
      chunk_idx: chunk.idx,
      chunk_text: chunk.text.slice(0, CHUNK_TEXT_PREVIEW),
    };
    return {
      id: chunkIdFor(idHash, chunk.idx),
      values: vectors[i],
      metadata: metadata as unknown as Record<string, string | number | boolean>,
    };
  });
  try {
    const mutation = await env.VECTORIZE.upsert(items);
    // Vectorize v2 acknowledges an asynchronous mutation; older bindings return
    // a synchronous count/ids receipt. Never infer acceptance from no result.
    if (mutation && 'mutationId' in mutation && typeof mutation.mutationId === 'string' && mutation.mutationId) {
      return { mutationId: mutation.mutationId };
    }
    if (mutation?.count === items.length && mutation.ids?.length === items.length && items.every((item) => mutation.ids.includes(item.id))) return { count: mutation.count };
    if (args.strict) throw new Error('Vector index returned no complete mutation receipt');
  } catch (err) {
    console.error('vectorize_error', 'upsertFileEmbeddings', err);
    if (args.strict) throw err;
  }
}

export async function deleteEmbedding(env: Env, contentHash: string): Promise<void> {
  const ids: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i += 1) ids.push(chunkIdFor(contentHash, i));
  // Also include the legacy single-id form for backwards-compat with any
  // pre-Wave-5 embeddings written before chunking landed. The full sha256
  // is exactly 64 chars which is at the Vectorize id cap.
  ids.push(contentHash);
  try {
    await env.VECTORIZE.deleteByIds(ids);
  } catch (err) {
    console.error('vectorize_error', 'deleteEmbedding', err);
  }
}

export async function deleteFileEmbeddings(env: Env, contentHash: string, scope: EmbeddingScope): Promise<void> {
  await deleteEmbedding(env, await scopedHash(contentHash, scope));
}

// Test-visible export of the prefix length so tests can assert the 64-byte cap.
export const VECTORIZE_ID_HASH_PREFIX_LEN = HASH_PREFIX_LEN;

export async function queryEmbeddings(
  env: Env,
  args: { vector: number[]; topK?: number; filter?: Partial<EmbeddingMetadata> },
): Promise<EmbeddingHit[]> {
  try {
    const result = await env.VECTORIZE.query(args.vector, {
      topK: Math.min(args.topK ?? 10, MAX_FULL_METADATA_RESULTS),
      returnMetadata: 'all',
      filter: args.filter as unknown as Record<string, string | number | boolean> | undefined,
    });
    const matches = result?.matches ?? [];
    return matches.map((m) => ({
      id: m.id,
      score: m.score,
      metadata: (m.metadata ?? {}) as unknown as EmbeddingMetadata,
    }));
  } catch (err) {
    console.error('vectorize_error', 'queryEmbeddings', err);
    return [];
  }
}

// Dedupe chunks of the same file reference. Identical bytes at another path
// or in another workspace remain independently retrievable.
export function dedupeByContent(hits: EmbeddingHit[]): EmbeddingHit[] {
  const bestPerHash = new Map<string, EmbeddingHit>();
  for (const hit of hits) {
    const hash = `${hit.metadata.ws_id}\0${hit.metadata.path}\0${hit.metadata.content_hash ?? hit.id}`;
    const existing = bestPerHash.get(hash);
    if (!existing || hit.score > existing.score) {
      bestPerHash.set(hash, hit);
    }
  }
  return Array.from(bestPerHash.values()).sort((a, b) => b.score - a.score);
}
