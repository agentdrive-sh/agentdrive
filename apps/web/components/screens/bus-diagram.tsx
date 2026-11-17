import { AgentDriveLogo } from '../agentdrive-logo';
import { GlyphSVG, PLATFORMS, type PlatformId } from '../platform-glyph';

// Small visualization — agent platforms orbiting a central drive. Mirrors the
// design's BusDiagram component.
export function BusDiagram() {
  const platforms: PlatformId[] = ['claude-code', 'codex', 'cursor', 'langgraph'];
  const radius = 78;
  const cx = 140;
  const cy = 110;
  return (
    <svg
      width="100%"
      viewBox="0 0 280 220"
      style={{ display: 'block', maxHeight: 220 }}
    >
      {platforms.map((p, i) => {
        const a = (i / platforms.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        return (
          <line
            key={p}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="var(--border-strong)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        );
      })}
      <circle
        cx={cx}
        cy={cy}
        r={28}
        fill="var(--bg-2)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <circle
        cx={cx}
        cy={cy}
        r={36}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1"
        opacity="0.25"
      />
      <g
        transform={`translate(${cx - 11} ${cy - 11})`}
        style={{ color: 'var(--accent)' }}
      >
        <AgentDriveLogo size={22} />
      </g>
      {platforms.map((p, i) => {
        const a = (i / platforms.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        const info = PLATFORMS[p];
        return (
          <g key={p}>
            <rect
              x={x - 16}
              y={y - 16}
              width={32}
              height={32}
              rx="7"
              fill={info.bg}
              stroke={info.color}
              strokeOpacity={0.4}
              strokeWidth="1"
            />
            <g transform={`translate(${x - 9} ${y - 9})`}>
              <GlyphSVG platform={p} size={18} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
