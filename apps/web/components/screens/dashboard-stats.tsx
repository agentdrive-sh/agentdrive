import { ProgressBar } from '../shared';

export interface StatProps {
  label: string;
  val: string;
  unit?: string;
  delta?: string;
  sub?: string;
  pct?: number;
}

export function Stat({ label, val, unit, delta, sub, pct }: StatProps) {
  return (
    <div className="stat">
      <div className="lbl">{label}</div>
      <div className="val">
        {val}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {pct != null ? (
        <div style={{ marginTop: 12 }}>
          <ProgressBar value={pct * 100} max={100} />
        </div>
      ) : delta ? (
        <div className="delta">{delta}</div>
      ) : sub ? (
        <div className="t-xs faint" style={{ marginTop: 6 }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

interface DashboardStatsProps {
  artifactCount: string;
  artifactSub: string;
  runsLabel: string;
  runsVal: string;
  runsSub: string;
  storageUsedGb: number;
  storageTotalGb: number;
  embeddingsUsed: number;
  embeddingsTotal: number;
}

export function DashboardStats({
  artifactCount,
  artifactSub,
  runsLabel,
  runsVal,
  runsSub,
  storageUsedGb,
  storageTotalGb,
  embeddingsUsed,
  embeddingsTotal,
}: DashboardStatsProps) {
  const fmt = (n: number) =>
    n >= 1_000_000
      ? (n / 1_000_000).toFixed(1) + 'M'
      : n >= 1000
        ? (n / 1000).toFixed(0) + 'k'
        : n.toString();
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 18 }}
    >
      <Stat
        label="Artifacts"
        val={artifactCount}
        sub={artifactSub}
      />
      <Stat label={runsLabel} val={runsVal} sub={runsSub} />
      <Stat
        label="Storage"
        val={storageUsedGb.toFixed(1)}
        unit={`/ ${storageTotalGb} GB`}
        pct={storageTotalGb > 0 ? storageUsedGb / storageTotalGb : 0}
      />
      <Stat
        label="Embeddings indexed"
        val={fmt(embeddingsUsed)}
        unit={`/ ${fmt(embeddingsTotal)}`}
        pct={embeddingsTotal > 0 ? embeddingsUsed / embeddingsTotal : 0}
      />
    </div>
  );
}
