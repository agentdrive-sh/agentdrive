import { PlatformChip } from '../platform-glyph';
import { Spark } from '../shared';
import type { PlatformId } from '../platform-glyph';

interface AgentSparkCardProps {
  platform: PlatformId | string;
  data: number[];
}

// Cross-platform spark card row used inside the dashboard's "Cross-platform
// activity" panel. Renders the platform chip, a sparkline and the run count
// for the window.
export function AgentSparkCard({ platform, data }: AgentSparkCardProps) {
  const total = data.reduce((a, b) => a + b, 0);
  return (
    <div className="row gap-4">
      <div style={{ width: 130 }}>
        <PlatformChip platform={platform} />
      </div>
      <div className="grow" style={{ height: 32 }}>
        <Spark data={data} height={32} />
      </div>
      <div style={{ width: 72, textAlign: 'right' }}>
        <span className="mono t-sm fg-0">{total}</span>{' '}
        <span className="t-xs muted">{total === 1 ? 'run' : 'runs'}</span>
      </div>
    </div>
  );
}
