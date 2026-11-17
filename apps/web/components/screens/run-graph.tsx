import { GlyphSVG, PLATFORMS } from '../platform-glyph';
import type { PlatformId } from '../platform-glyph';

export interface GraphFile {
  id: string;
  path: string;
  hash: string;
  size: number;
  version?: number;
  platform?: PlatformId | string;
}

interface Props {
  platform: PlatformId | string;
  role?: string;
  referenced: GraphFile[];
  produced: GraphFile[];
  contextHitsLabel?: string;
}

const COL_REF = 24;
const COL_CTX = 200;
const COL_AGENT = 380;
const COL_WRITE = 560;
const COL_PROD = 740;
const NODE_W_REF = 140;
const NODE_W_CTX = 130;
const NODE_W_AGENT = 120;
const NODE_W_WRITE = 130;
const NODE_W_PROD = 160;
const ROW_H = 60;

function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

function ellide(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function RunGraph({
  platform,
  role,
  referenced,
  produced,
  contextHitsLabel,
}: Props) {
  const platMeta = PLATFORMS[platform as PlatformId] ?? PLATFORMS.unknown;
  const lanes = Math.max(referenced.length, produced.length, 2);
  const height = Math.max(280, ROW_H * lanes + 60);
  const centerY = height / 2;

  const refY = (i: number) =>
    referenced.length <= 1
      ? centerY - 18
      : 40 + (i * (height - 80)) / Math.max(referenced.length - 1, 1);
  const prodY = (i: number) =>
    produced.length <= 1
      ? centerY - 18
      : 40 + (i * (height - 80)) / Math.max(produced.length - 1, 1);

  return (
    <div className="surface" style={{ padding: 24, overflowX: 'auto' }}>
      <svg
        width="100%"
        viewBox={`0 0 920 ${height + 60}`}
        style={{ display: 'block', minWidth: 740 }}
      >
        <defs>
          <pattern
            id="adrive-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke="var(--grid-line)"
              strokeWidth="1"
            />
          </pattern>
          <marker
            id="adrive-arr-accent"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
          <marker
            id="adrive-arr-success"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--success)" />
          </marker>
        </defs>

        <rect width="100%" height="100%" fill="url(#adrive-grid)" />

        <text
          x={COL_REF + 70}
          y={20}
          fill="var(--text-4)"
          fontSize="10"
          fontFamily="var(--font-mono)"
          textAnchor="middle"
        >
          REFERENCED
        </text>
        <text
          x={COL_AGENT + 60}
          y={20}
          fill="var(--text-4)"
          fontSize="10"
          fontFamily="var(--font-mono)"
          textAnchor="middle"
        >
          AGENT · {platMeta.short}
        </text>
        <text
          x={COL_PROD + 70}
          y={20}
          fill="var(--text-4)"
          fontSize="10"
          fontFamily="var(--font-mono)"
          textAnchor="middle"
        >
          PRODUCED
        </text>

        {referenced.map((f, i) => (
          <path
            key={'rl-' + f.id}
            d={`M ${COL_REF + NODE_W_REF} ${refY(i) + 18} C ${COL_CTX} ${refY(i) + 18}, ${COL_CTX} ${centerY}, ${COL_CTX + 50} ${centerY}`}
            stroke="var(--border-strong)"
            strokeWidth="1.2"
            fill="none"
          />
        ))}
        <path
          d={`M ${COL_CTX + NODE_W_CTX} ${centerY} L ${COL_AGENT} ${centerY}`}
          stroke="var(--accent)"
          strokeWidth="1.4"
          markerEnd="url(#adrive-arr-accent)"
          fill="none"
        />
        <path
          d={`M ${COL_AGENT + NODE_W_AGENT} ${centerY} L ${COL_WRITE} ${centerY}`}
          stroke="var(--accent)"
          strokeWidth="1.4"
          markerEnd="url(#adrive-arr-accent)"
          fill="none"
        />
        {produced.map((f, i) => (
          <path
            key={'pl-' + f.id}
            d={`M ${COL_WRITE + NODE_W_WRITE} ${centerY} C ${COL_PROD} ${centerY}, ${COL_PROD} ${prodY(i) + 18}, ${COL_PROD} ${prodY(i) + 18}`}
            stroke="var(--success)"
            strokeWidth="1.4"
            fill="none"
            markerEnd="url(#adrive-arr-success)"
          />
        ))}

        {referenced.length === 0 && (
          <g>
            <rect
              x={COL_REF}
              y={centerY - 18}
              width={NODE_W_REF}
              height="36"
              rx="6"
              fill="var(--bg-2)"
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text
              x={COL_REF + 10}
              y={centerY + 4}
              fill="var(--text-3)"
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              no refs
            </text>
          </g>
        )}
        {referenced.map((f, i) => (
          <g key={'rn-' + f.id}>
            <rect
              x={COL_REF}
              y={refY(i)}
              width={NODE_W_REF}
              height="36"
              rx="6"
              fill="var(--bg-2)"
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={COL_REF + 10}
              y={refY(i) + 15}
              fill="var(--text-0)"
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              {ellide(fileName(f.path), 18)}
            </text>
            <text
              x={COL_REF + 10}
              y={refY(i) + 28}
              fill="var(--text-3)"
              fontSize="9"
              fontFamily="var(--font-mono)"
            >
              #{f.hash.slice(0, 8)}
            </text>
          </g>
        ))}

        <g>
          <rect
            x={COL_CTX}
            y={centerY - 18}
            width={NODE_W_CTX}
            height="36"
            rx="6"
            fill="var(--bg-2)"
            stroke="var(--border-strong)"
            strokeWidth="1"
          />
          <text
            x={COL_CTX + 12}
            y={centerY - 3}
            fill="var(--accent)"
            fontSize="12"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            drive_context
          </text>
          <text
            x={COL_CTX + 12}
            y={centerY + 10}
            fill="var(--text-3)"
            fontSize="10"
            fontFamily="var(--font-mono)"
          >
            {contextHitsLabel ?? `→ ${referenced.length} hits`}
          </text>
        </g>

        <g>
          <rect
            x={COL_AGENT}
            y={centerY - 24}
            width={NODE_W_AGENT}
            height="48"
            rx="8"
            fill={platMeta.bg}
            stroke={platMeta.color}
            strokeWidth="1.5"
          />
          <foreignObject
            x={COL_AGENT + 10}
            y={centerY - 14}
            width="28"
            height="28"
          >
            <GlyphSVG platform={platform} size={24} />
          </foreignObject>
          <text
            x={COL_AGENT + 42}
            y={centerY - 2}
            fill="var(--text-0)"
            fontSize="12"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            {platMeta.label}
          </text>
          {role && (
            <text
              x={COL_AGENT + 42}
              y={centerY + 12}
              fill="var(--text-3)"
              fontSize="10"
              fontFamily="var(--font-mono)"
            >
              role={role}
            </text>
          )}
        </g>

        <g>
          <rect
            x={COL_WRITE}
            y={centerY - 18}
            width={NODE_W_WRITE}
            height="36"
            rx="6"
            fill="var(--bg-2)"
            stroke="var(--border-strong)"
            strokeWidth="1"
          />
          <text
            x={COL_WRITE + 12}
            y={centerY - 3}
            fill="var(--success)"
            fontSize="12"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            drive_write
          </text>
          <text
            x={COL_WRITE + 12}
            y={centerY + 10}
            fill="var(--text-3)"
            fontSize="10"
            fontFamily="var(--font-mono)"
          >
            → embed queued
          </text>
        </g>

        {produced.length === 0 && (
          <g>
            <rect
              x={COL_PROD}
              y={centerY - 20}
              width={NODE_W_PROD}
              height="40"
              rx="6"
              fill="var(--bg-2)"
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text
              x={COL_PROD + 10}
              y={centerY + 4}
              fill="var(--text-3)"
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              no artifacts produced
            </text>
          </g>
        )}
        {produced.map((f, i) => (
          <g key={'pn-' + f.id}>
            <rect
              x={COL_PROD}
              y={prodY(i)}
              width={NODE_W_PROD}
              height="40"
              rx="6"
              fill="var(--success-soft)"
              stroke="var(--success)"
              strokeOpacity="0.4"
              strokeWidth="1"
            />
            <text
              x={COL_PROD + 10}
              y={prodY(i) + 16}
              fill="var(--text-0)"
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              {ellide(fileName(f.path), 20)}
            </text>
            <text
              x={COL_PROD + 10}
              y={prodY(i) + 30}
              fill="var(--text-3)"
              fontSize="9"
              fontFamily="var(--font-mono)"
            >
              {f.version ? `v${f.version} · ` : ''}
              {(f.size / 1024).toFixed(1)} KB
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
