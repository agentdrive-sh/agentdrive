import { GlyphSVG, PLATFORMS, type PlatformId } from '../platform-glyph';

// Compact horizontal: 1 principal → 4 agent platforms. Mirrors the design's
// PrincipalDiagram component.
export function PrincipalDiagram({ principalId }: { principalId: string }) {
  const platforms: PlatformId[] = ['claude-code', 'codex', 'cursor', 'langgraph'];
  return (
    <svg
      width="380"
      height="120"
      viewBox="0 0 380 120"
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
    >
      <rect
        x="8"
        y="38"
        width="120"
        height="44"
        rx="10"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <text
        x="22"
        y="58"
        fill="var(--text-0)"
        fontSize="12"
        fontFamily="var(--font-mono)"
        fontWeight="600"
      >
        principal
      </text>
      <text
        x="22"
        y="74"
        fill="var(--accent)"
        fontSize="10"
        fontFamily="var(--font-mono)"
      >
        {principalId}
      </text>
      {platforms.map((p, i) => {
        const y = 12 + i * 24;
        const info = PLATFORMS[p];
        return (
          <g key={p}>
            <path
              d={`M 128 60 C 180 60, 200 ${y + 12}, 240 ${y + 12}`}
              stroke={info.color}
              strokeOpacity="0.4"
              strokeWidth="1.2"
              fill="none"
            />
            <rect
              x="240"
              y={y}
              width="130"
              height="24"
              rx="6"
              fill={info.bg}
              stroke={info.color}
              strokeOpacity="0.4"
              strokeWidth="1"
            />
            <foreignObject x={246} y={y + 5} width="14" height="14">
              <GlyphSVG platform={p} size={14} />
            </foreignObject>
            <text
              x="266"
              y={y + 16}
              fill="var(--text-1)"
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              {info.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
