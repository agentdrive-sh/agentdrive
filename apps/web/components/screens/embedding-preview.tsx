interface Props {
  contentHash?: string;
  // Mocked vector preview values. TODO_BACKEND: replace with the real
  // embedding the worker stores once `GET /v1/embeddings/:content_hash`
  // ships. Until then we deterministically derive a preview from the hash
  // so two visits to the same artifact look stable.
  mockVector?: number[];
}

function hashSeed(hash: string): number {
  let h = 2166136261;
  for (let i = 0; i < hash.length; i++) {
    h ^= hash.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pseudoVector(hash: string, dims = 768): number[] {
  let s = hashSeed(hash || 'agentdrive');
  const out: number[] = [];
  for (let i = 0; i < dims; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out.push((s / 0xffffffff) * 2 - 1);
  }
  return out;
}

function cellColor(v: number): string {
  // -1 (cool) → 0 (faint) → +1 (warm). Maps onto the design tokens.
  const t = Math.max(-1, Math.min(1, v));
  if (t >= 0) {
    return `oklch(0.72 ${0.04 + t * 0.16} 45 / ${0.18 + t * 0.7})`;
  }
  return `oklch(0.62 ${0.04 + Math.abs(t) * 0.14} 240 / ${0.18 + Math.abs(t) * 0.65})`;
}

export function EmbeddingPreview({ contentHash, mockVector }: Props) {
  const vec = mockVector ?? pseudoVector(contentHash ?? 'agentdrive');
  const previewDims = vec.slice(0, 16);

  // 16 cols x 48 rows = 768 cells, exactly one BGE-base dim per cell.
  const cols = 16;
  const rows = 48;
  const cells = vec.slice(0, cols * rows);

  return (
    <div className="surface" style={{ padding: 24 }}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginBottom: 20,
        }}
      >
        <Stat label="Model" val="default" />
        <Stat label="Dimensions" val="768" />
        <Stat label="Chunks" val="1" />
      </div>

      <div
        className="t-xs muted wt-600"
        style={{
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 10,
        }}
      >
        Vector preview (first 16 dims)
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-2)',
          padding: 14,
          background: 'var(--bg-2)',
          borderRadius: 6,
          lineHeight: 1.9,
        }}
      >
        [
        {previewDims.map((n, i) => (
          <span key={i} style={{ marginRight: 12 }}>
            {n.toFixed(3)}
          </span>
        ))}
        , ...]
      </div>

      <div
        className="t-xs muted wt-600"
        style={{
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          margin: '20px 0 10px',
        }}
      >
        All 768 dims · {cols}×{rows} heatmap
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 1,
          padding: 8,
          background: 'var(--bg-2)',
          borderRadius: 6,
        }}
      >
        {cells.map((v, i) => (
          <div
            key={i}
            title={`dim ${i}: ${v.toFixed(3)}`}
            style={{
              height: 9,
              borderRadius: 1,
              background: cellColor(v),
            }}
          />
        ))}
      </div>

      <div className="t-xs muted" style={{ marginTop: 14 }}>
        Indexed on write via{' '}
        <span className="mono fg-0">ctx.waitUntil</span>. Content-addressed by
        sha256 — re-uploading the same bytes is a no-op.
        {!mockVector && (
          <>
            {' '}
            Preview is deterministic from the content_hash until{' '}
            <span className="mono">GET /v1/embeddings/:content_hash</span>{' '}
            lands.
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, val }: { label: string; val: string }) {
  return (
    <div className="stat">
      <div className="lbl">{label}</div>
      <div className="val">{val}</div>
    </div>
  );
}
