import { describe, it, expect } from 'vitest';
import type { EmbeddingHit } from '../src/services/embeddings.js';
import {
  recencyScore,
  dedupeByPath,
  rerankWithPlatformDiversity,
  PLATFORM_DIVERSITY_DECAY,
  SEMANTIC_WEIGHT,
  RECENCY_WEIGHT,
  type ScoredHit,
} from '../src/services/context-rerank.js';

// Unit tests for the drive_context Phase 1 excellence pass — these run without
// any Cloudflare bindings (no Vectorize, no KV) so they pin the pure ranking
// behavior. The HTTP-level keyword-fallback path is covered in context.test.ts.

function makeHit(id: string, score: number, partial: Partial<EmbeddingHit['metadata']> = {}): EmbeddingHit {
  return {
    id,
    score,
    metadata: {
      ws_id: 'ws_test',
      path: `notes/${id}.md`,
      agent_id: 'ag_one',
      agent_platform: 'claude-code',
      org_id: 'org_test',
      created_at: Date.now(),
      content_hash: id,
      ...partial,
    },
  };
}

function makeScored(hit: EmbeddingHit, semantic: number, recency: number): ScoredHit {
  return { hit, semantic, recency, blended: SEMANTIC_WEIGHT * semantic + RECENCY_WEIGHT * recency };
}

describe('recencyScore', () => {
  it('returns 1 for an artifact created right now', () => {
    const now = Date.now();
    expect(recencyScore(now, now)).toBeCloseTo(1, 5);
  });

  it('decays toward 0 as age grows', () => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const young = recencyScore(now - oneDay, now);
    const middle = recencyScore(now - 30 * oneDay, now);
    const old = recencyScore(now - 365 * oneDay, now);
    expect(young).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(old);
    expect(middle).toBeCloseTo(Math.exp(-1), 3);
  });

  it('floors at 0 for future timestamps (no negative ages)', () => {
    const now = Date.now();
    expect(recencyScore(now + 60_000, now)).toBeCloseTo(1, 5);
  });
});

describe('dedupeByPath', () => {
  it('keeps the highest-scored hit per (ws_id, path) pair', () => {
    const a1 = makeHit('a', 0.6, { path: 'notes/a.md', content_hash: 'h1' });
    const a2 = makeHit('a', 0.9, { path: 'notes/a.md', content_hash: 'h2' });
    const b = makeHit('b', 0.5, { path: 'notes/b.md' });
    const out = dedupeByPath([a1, a2, b]);
    expect(out.length).toBe(2);
    expect(out[0]!.metadata.content_hash).toBe('h2');
    expect(out[0]!.score).toBe(0.9);
  });

  it('does not collapse the same path under different workspaces', () => {
    const a = makeHit('a', 0.5, { ws_id: 'ws_one', path: 'shared.md' });
    const b = makeHit('b', 0.6, { ws_id: 'ws_two', path: 'shared.md' });
    expect(dedupeByPath([a, b]).length).toBe(2);
  });
});

describe('rerankWithPlatformDiversity', () => {
  it('returns the top-N in score order when only one platform is present', () => {
    const scored = [
      makeScored(makeHit('a', 0.9), 0.9, 0.5),
      makeScored(makeHit('b', 0.8), 0.8, 0.5),
      makeScored(makeHit('c', 0.7), 0.7, 0.5),
    ];
    const picked = rerankWithPlatformDiversity(scored, 3);
    expect(picked.map((p) => p.hit.id)).toEqual(['a', 'b', 'c']);
  });

  it('promotes a lower-scored hit from a different platform when ties are close', () => {
    // Two near-tied claude hits + one codex hit slightly behind. With diversity
    // reranking, codex should beat the second claude.
    const scored = [
      makeScored(makeHit('cc1', 0.9, { agent_platform: 'claude-code' }), 0.9, 0.5),
      makeScored(makeHit('cc2', 0.85, { agent_platform: 'claude-code' }), 0.85, 0.5),
      makeScored(makeHit('cx1', 0.8, { agent_platform: 'codex' }), 0.8, 0.5),
    ];
    const picked = rerankWithPlatformDiversity(scored, 2);
    const platforms = picked.map((p) => p.hit.metadata.agent_platform);
    expect(platforms).toContain('claude-code');
    expect(platforms).toContain('codex');
  });

  it('does not flip a clear semantic winner just because of diversity', () => {
    // claude wins by a wide margin even after the diversity decay applies.
    const scored = [
      makeScored(makeHit('cc1', 0.95, { agent_platform: 'claude-code' }), 0.95, 0.6),
      makeScored(makeHit('cc2', 0.92, { agent_platform: 'claude-code' }), 0.92, 0.6),
      makeScored(makeHit('cx1', 0.40, { agent_platform: 'codex' }), 0.40, 0.6),
    ];
    const picked = rerankWithPlatformDiversity(scored, 2);
    expect(picked[0]!.hit.id).toBe('cc1');
    expect(picked[1]!.hit.id).toBe('cc2');
  });

  it('marks the diversity_penalty when a repeat-platform pick took a hit', () => {
    const scored = [
      makeScored(makeHit('cc1', 0.9, { agent_platform: 'claude-code' }), 0.9, 0.5),
      makeScored(makeHit('cc2', 0.88, { agent_platform: 'claude-code' }), 0.88, 0.5),
    ];
    const picked = rerankWithPlatformDiversity(scored, 2);
    expect(picked[0]!.diversityPenalty).toBe(0);
    expect(picked[1]!.diversityPenalty).toBeGreaterThan(0);
  });

  it('reasons array carries at least one explanation per pick', () => {
    const scored = [
      makeScored(makeHit('a', 0.9), 0.9, 0.95),
      makeScored(makeHit('b', 0.4), 0.4, 0.3),
    ];
    const picked = rerankWithPlatformDiversity(scored, 2);
    for (const p of picked) {
      expect(p.reasons.length).toBeGreaterThan(0);
    }
    // First pick (high semantic + recent) gets multiple positive reasons.
    expect(picked[0]!.reasons.join(' ')).toMatch(/semantic|recently/);
  });

  it('returns at most `limit` items even when more are scored', () => {
    const scored: ScoredHit[] = [];
    for (let i = 0; i < 10; i++) {
      scored.push(makeScored(makeHit(`x${i}`, 0.5 + i * 0.01), 0.5 + i * 0.01, 0.5));
    }
    const picked = rerankWithPlatformDiversity(scored, 3);
    expect(picked.length).toBe(3);
  });
});

describe('PLATFORM_DIVERSITY_DECAY constant', () => {
  it('is between 0 and 1 (penalty, not boost)', () => {
    expect(PLATFORM_DIVERSITY_DECAY).toBeGreaterThan(0);
    expect(PLATFORM_DIVERSITY_DECAY).toBeLessThan(1);
  });
});
