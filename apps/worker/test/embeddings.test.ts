import { describe, it, expect } from 'vitest';
import {
  embedText,
  upsertFileEmbeddings,
  queryEmbeddings,
  chunkText,
  chunkIdFor,
  dedupeByContent,
  deleteEmbedding,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  MAX_CHUNKS,
  type EmbeddingMetadata,
  type EmbeddingHit,
} from '../src/services/embeddings.js';
import type { Env } from '../src/env.js';

type UpsertCall = Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>;

function makeEnv(opts: {
  aiRun?: (model: string, inputs: { text: string[] }) => Promise<{ data: number[][] }> | { data: number[][] };
  upsertSpy?: { calls: UpsertCall[] };
  queryResult?: { matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> };
  deleteSpy?: { ids: string[] };
} = {}): Env {
  const aiRun = opts.aiRun ?? ((_m: string, inputs: { text: string[] }) => ({
    data: inputs.text.map(() => new Array(768).fill(0.1)),
  }));
  const env = {
    KV: {} as KVNamespace,
    R2: {} as R2Bucket,
    FILE_COLLAB: {} as DurableObjectNamespace,
    AI: {
      run: async (model: string, inputs: { text: string[] }) => aiRun(model, inputs),
    } as unknown as Ai,
    VECTORIZE: {
      upsert: async (vectors: UpsertCall) => {
        opts.upsertSpy?.calls.push(vectors);
        return { mutationId: 'mut_test' };
      },
      query: async () => opts.queryResult ?? { matches: [], count: 0 },
      deleteByIds: async (ids: string[]) => {
        opts.deleteSpy?.ids.push(...ids);
        return { mutationId: 'mut_del' };
      },
    } as unknown as VectorizeIndex,
    ENVIRONMENT: 'test',
    APP_URL: 'http://localhost:8787',
    TOKEN_SIGNING_SECRET: 'test-secret',
  } as Env;
  return env;
}

const baseMeta: Omit<EmbeddingMetadata, 'chunk_idx' | 'chunk_text' | 'content_hash'> = {
  ws_id: 'ws_test',
  path: 'notes/plan.md',
  agent_id: 'ag_test',
  agent_platform: 'claude-code',
  org_id: 'org_test',
  mime: 'text/markdown',
  created_at: 1700000000,
};

describe('chunkText', () => {
  it('returns a single chunk for short input', () => {
    const chunks = chunkText('hello world');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].idx).toBe(0);
    expect(chunks[0].text).toBe('hello world');
  });

  it('returns one chunk when input is exactly CHUNK_SIZE', () => {
    const text = 'a'.repeat(CHUNK_SIZE);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
  });

  it('splits a 5000-char input into multiple overlapping chunks', () => {
    const text = 'x'.repeat(5000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
    expect(chunks[0].text.length).toBe(CHUNK_SIZE);
  });

  it('caps at MAX_CHUNKS for very large input', () => {
    const text = 'y'.repeat(100_000);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(MAX_CHUNKS);
  });

  it('returns single empty chunk for empty input', () => {
    expect(chunkText('')).toEqual([{ idx: 0, text: '' }]);
  });

  const numbered = (length: number) => Array.from({ length }, (_, i) => String.fromCharCode(33 + (i % 90))).join('');
  const stride = CHUNK_SIZE - CHUNK_OVERLAP;

  it('keeps the first 8 and the last 8 windows of a file past 16 chunks', () => {
    const text = numbered(60_000);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(MAX_CHUNKS);
    expect(chunks.map((c) => c.idx)).toEqual(Array.from({ length: MAX_CHUNKS }, (_, i) => i));
    expect(chunks[7]!.text).toBe(text.slice(7 * stride, 7 * stride + CHUNK_SIZE));
    expect(7 * stride).toBe(9100);
    expect(chunks[15]!.text).toBe(text.slice(text.length - CHUNK_SIZE));
    expect(chunks[8]!.text).toBe(text.slice(text.length - CHUNK_SIZE - 7 * stride, text.length - 7 * stride));
  });

  it('windows a file of 16 chunks or fewer from the start, unchanged', () => {
    const text = numbered(21_000);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(MAX_CHUNKS);
    chunks.forEach((c, i) => expect(c.text).toBe(text.slice(i * stride, i * stride + CHUNK_SIZE)));
    expect(chunks[15]!.text.endsWith(text.slice(-10))).toBe(true);
  });
});

describe('deleteEmbedding', () => {
  it('removes every vector a long file was indexed under', async () => {
    const spy = { ids: [] as string[] };
    await deleteEmbedding(makeEnv({ deleteSpy: spy }), 'h'.repeat(64));
    const indexed = chunkText('w'.repeat(80_000)).map((c) => chunkIdFor('h'.repeat(64), c.idx));
    expect(indexed).toHaveLength(MAX_CHUNKS);
    expect(spy.ids).toEqual(expect.arrayContaining(indexed));
  });
});

describe('chunkIdFor', () => {
  it('truncates the hash to fit Vectorize 64-byte id cap', () => {
    const full = 'a'.repeat(64);
    const id = chunkIdFor(full, 0);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.endsWith('c0')).toBe(true);
  });

  it('stays under 64 bytes for the highest chunk index', () => {
    const full = 'b'.repeat(64);
    const id = chunkIdFor(full, 15);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.endsWith('c15')).toBe(true);
  });

  it('returns distinct ids for distinct chunks of the same hash', () => {
    const full = 'c'.repeat(64);
    expect(chunkIdFor(full, 0)).not.toBe(chunkIdFor(full, 1));
  });
});

describe('embedText', () => {
  it('returns a 768-element number array for normal text', async () => {
    const env = makeEnv();
    const vec = await embedText(env, 'hello world');
    expect(vec).toHaveLength(768);
    expect(vec.every((n) => typeof n === 'number')).toBe(true);
  });

  it('returns a zero-vector for empty string', async () => {
    const env = makeEnv();
    const vec = await embedText(env, '');
    expect(vec).toHaveLength(768);
    expect(vec.every((n) => n === 0)).toBe(true);
  });

  it('does not throw when AI binding throws — degrades to zero-vector', async () => {
    const env = makeEnv({
      aiRun: () => {
        throw new Error('upstream inference failure');
      },
    });
    const vec = await embedText(env, 'some content');
    expect(vec).toHaveLength(768);
    expect(vec.every((n) => n === 0)).toBe(true);
  });
});

describe('upsertFileEmbeddings', () => {
  it('upserts one item per chunk in a single batch', async () => {
    const spy = { calls: [] as UpsertCall[] };
    const env = makeEnv({ upsertSpy: spy });
    const text = 'z'.repeat(5000);
    const chunks = chunkText(text);
    await upsertFileEmbeddings(env, {
      contentHash: 'sha_aaa',
      chunks,
      baseMetadata: baseMeta,
    });

    expect(spy.calls).toHaveLength(1);
    const batch = spy.calls[0];
    expect(batch).toHaveLength(chunks.length);
    expect(batch[0].id).toMatch(/^[0-9a-f]{60}c0$/);
    expect(batch[1].id).toMatch(/^[0-9a-f]{60}c1$/);
    expect(batch[0].id.slice(0, 60)).toBe(batch[1].id.slice(0, 60));
    expect(batch[0].metadata).toMatchObject({
      ws_id: 'ws_test',
      path: 'notes/plan.md',
      content_hash: 'sha_aaa',
      chunk_idx: 0,
    });
    expect(batch[0].metadata?.chunk_text).toBeDefined();
  });

  it('no-ops when chunks is empty', async () => {
    const spy = { calls: [] as UpsertCall[] };
    const env = makeEnv({ upsertSpy: spy });
    await upsertFileEmbeddings(env, {
      contentHash: 'sha_bbb',
      chunks: [],
      baseMetadata: baseMeta,
    });
    expect(spy.calls).toHaveLength(0);
  });
});

describe('queryEmbeddings', () => {
  it('returns mapped EmbeddingHit[] with score + metadata', async () => {
    const meta = { ...baseMeta, content_hash: 'sha_111' };
    const env = makeEnv({
      queryResult: {
        matches: [
          { id: 'sha_111:c0', score: 0.91, metadata: meta as unknown as Record<string, unknown> },
          { id: 'sha_222:c0', score: 0.83, metadata: meta as unknown as Record<string, unknown> },
        ],
      },
    });
    const hits = await queryEmbeddings(env, { vector: new Array(768).fill(0.1), topK: 5 });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ id: 'sha_111:c0', score: 0.91 });
  });
});

describe('dedupeByContent', () => {
  const mk = (id: string, hash: string, score: number, chunkIdx = 0): EmbeddingHit => ({
    id,
    score,
    metadata: { ...baseMeta, content_hash: hash, chunk_idx: chunkIdx } as EmbeddingMetadata,
  });

  it('keeps only the highest-score chunk per content_hash', () => {
    const hits = [
      mk('sha_ac0', 'sha_a', 0.6, 0),
      mk('sha_ac1', 'sha_a', 0.9, 1),
      mk('sha_ac2', 'sha_a', 0.7, 2),
      mk('sha_bc0', 'sha_b', 0.85, 0),
    ];
    const out = dedupeByContent(hits);
    expect(out).toHaveLength(2);
    expect(out[0].score).toBe(0.9);
    expect(out[0].id).toBe('sha_ac1');
    expect(out[1].score).toBe(0.85);
  });

  it('sorts deduped results by score descending', () => {
    const hits = [
      mk('sha_ac0', 'sha_a', 0.2),
      mk('sha_bc0', 'sha_b', 0.8),
      mk('sha_cc0', 'sha_c', 0.5),
    ];
    const out = dedupeByContent(hits);
    expect(out.map((h) => h.score)).toEqual([0.8, 0.5, 0.2]);
  });
});
