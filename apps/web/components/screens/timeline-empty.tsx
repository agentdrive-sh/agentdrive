import Link from 'next/link';
import { GlyphSVG, PLATFORMS } from '../platform-glyph';

// Phase 3 empty state — design decision D10. Friendly prose + single CTA,
// with a faded row of platform glyphs that teaches the cross-agent value
// on the first impression at zero cost.

const FADED_PLATFORMS = ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as const;

interface TimelineEmptyProps {
  filtered?: boolean;
}

export function TimelineEmpty({ filtered = false }: TimelineEmptyProps) {
  return (
    <div className="empty" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          gap: 14,
          opacity: 0.45,
          marginBottom: 18,
        }}
      >
        {FADED_PLATFORMS.map((p) => (
          <span
            key={p}
            style={{
              width: 32,
              height: 32,
              borderRadius: 7,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: PLATFORMS[p].bg,
              border: `1px solid ${PLATFORMS[p].color}33`,
            }}
          >
            <GlyphSVG platform={p} size={18} />
          </span>
        ))}
      </div>
      {filtered ? (
        <>
          <h3 style={{ marginBottom: 6 }}>No events in this window</h3>
          <p className="t-sm muted" style={{ maxWidth: 360, margin: '0 auto' }}>
            Try a wider date range, or clear the platform filter.
          </p>
        </>
      ) : (
        <>
          <h3 style={{ marginBottom: 6 }}>The narrative starts here</h3>
          <p className="t-sm muted" style={{ maxWidth: 420, margin: '0 auto 18px' }}>
            Wire your first agent and every read, write, and handoff between
            Claude Code, Codex, OpenCode, Cursor and Antigravity shows up here.
          </p>
          <Link href="/onboarding" className="btn primary">
            Wire your first agent
          </Link>
        </>
      )}
    </div>
  );
}
