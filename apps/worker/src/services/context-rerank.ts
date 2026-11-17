import type { EmbeddingHit } from './embeddings.js';

// drive_context Phase 1 excellence pass — ranking helpers extracted so the
// behavior is unit-testable without a Vectorize binding.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECENCY_HALF_LIFE_DAYS = 30;
export const SEMANTIC_WEIGHT = 0.7;
export const RECENCY_WEIGHT = 0.3;
// Per-platform diversity penalty applied multiplicatively on the blended score
// each time a platform repeats in the top-N. 0.85 ≈ "you need to be 18% better
// to beat a same-platform tie-breaker."
export const PLATFORM_DIVERSITY_DECAY = 0.85;

export function recencyScore(createdAtMs: number, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - createdAtMs) / MS_PER_DAY);
  return Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
}

export function dedupeByPath(hits: EmbeddingHit[]): EmbeddingHit[] {
  const bestPerPath = new Map<string, EmbeddingHit>();
  for (const hit of hits) {
    const key = `${hit.metadata.ws_id} ${hit.metadata.path}`;
    const existing = bestPerPath.get(key);
    if (!existing || hit.score > existing.score) {
      bestPerPath.set(key, hit);
    }
  }
  return Array.from(bestPerPath.values()).sort((a, b) => b.score - a.score);
}

export interface ScoredHit {
  hit: EmbeddingHit;
  semantic: number;
  recency: number;
  blended: number;
}

export interface RankedHit extends ScoredHit {
  diversityPenalty: number;
  reasons: string[];
}

export function rerankWithPlatformDiversity(scored: ScoredHit[], limit: number): RankedHit[] {
  // MMR-flavored greedy pick: at each step take the candidate with the
  // highest blended score AFTER applying a per-platform decay equal to the
  // number of already-picked items from the same platform.
  const remaining = [...scored];
  const picked: RankedHit[] = [];
  const platformCounts = new Map<string, number>();

  while (picked.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestAdjusted = -Infinity;
    let bestPenalty = 0;
    let bestPlatform = 'unknown';

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const platform = candidate.hit.metadata.agent_platform ?? 'unknown';
      const repeats = platformCounts.get(platform) ?? 0;
      const decay = Math.pow(PLATFORM_DIVERSITY_DECAY, repeats);
      const adjusted = candidate.blended * decay;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIdx = i;
        bestPenalty = candidate.blended - adjusted;
        bestPlatform = platform;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0]!;
    platformCounts.set(bestPlatform, (platformCounts.get(bestPlatform) ?? 0) + 1);

    const reasons: string[] = [];
    if (chosen.semantic >= 0.7) reasons.push('high semantic match');
    else if (chosen.semantic >= 0.5) reasons.push('moderate semantic match');
    if (chosen.recency >= 0.9) reasons.push('written recently');
    else if (chosen.recency >= 0.5) reasons.push('still fresh');
    if (bestPenalty > 0.01) reasons.push(`surfaced via diversity (${bestPlatform})`);
    if (reasons.length === 0) reasons.push('top blended score');

    picked.push({ ...chosen, diversityPenalty: bestPenalty, reasons });
  }

  return picked;
}
