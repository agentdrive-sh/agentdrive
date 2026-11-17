import type { ReactNode } from 'react';
import { ProgressBar } from '../shared';

// used is undefined when the count is unavailable; a null total is unlimited.
export interface Quota {
  used?: number;
  total: number | null;
}

interface Bar {
  label: string;
  q?: Quota;
  format?: (n: number) => string;
}

interface Props {
  bars: Bar[];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

function Head({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      className="row"
      style={{ justifyContent: 'space-between', marginBottom: 6 }}
    >
      <span className="t-sm muted">{label}</span>
      {value}
    </div>
  );
}

function Row({ label, q, format = fmt }: Bar) {
  if (!q || q.used === undefined) {
    return (
      <div>
        <Head label={label} value={<span className="t-xs faint">{q ? 'unavailable' : 'unknown'}</span>} />
        <ProgressBar value={0} max={100} />
      </div>
    );
  }
  const pct = q.total ? (q.used / q.total) * 100 : 0;
  const color = pct > 80 ? 'var(--warning)' : 'var(--accent)';
  return (
    <div>
      <Head
        label={label}
        value={
          <span className="mono t-sm fg-0">
            {format(q.used)}
            <span className="muted">
              {' / '}
              {q.total === null ? 'Unlimited' : format(q.total)}
            </span>
          </span>
        }
      />
      <ProgressBar value={pct} max={100} color={color} />
    </div>
  );
}

export function UsageBars({ bars }: Props) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 16,
      }}
    >
      {bars.map((b) => (
        <Row key={b.label} {...b} />
      ))}
    </div>
  );
}
