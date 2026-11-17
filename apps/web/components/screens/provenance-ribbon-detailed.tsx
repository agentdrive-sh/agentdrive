import { PlatformChip, PlatformGlyph } from '../platform-glyph';
import type { PlatformId } from '../platform-glyph';

interface RibbonProps {
  authorPlatform: PlatformId | string;
  authorRole?: string;
  lastEditPlatform: PlatformId | string;
  lastEditRelative: string;
  referencedPlatforms: Array<PlatformId | string>;
  refsCount: number;
}

export function ProvenanceRibbonDetailed({
  authorPlatform,
  authorRole,
  lastEditPlatform,
  lastEditRelative,
  referencedPlatforms,
  refsCount,
}: RibbonProps) {
  return (
    <div
      className="surface-2 fade-in"
      style={{
        padding: 16,
        marginBottom: 20,
        background: 'linear-gradient(180deg, var(--bg-2), var(--bg-1))',
      }}
    >
      <div
        className="t-xs muted"
        style={{
          marginBottom: 12,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        Cross-agent provenance
      </div>
      <div
        className="row gap-3"
        style={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        <div className="row gap-2">
          <span className="t-xs muted">authored by</span>
          <PlatformChip platform={authorPlatform} lg />
          {authorRole && (
            <span className="mono t-xs faint">role={authorRole}</span>
          )}
        </div>
        <span style={{ color: 'var(--text-4)' }}>{'→'}</span>
        <div className="row gap-2">
          <span className="t-xs muted">last edit</span>
          <PlatformChip platform={lastEditPlatform} lg />
          <span className="mono t-xs faint">{lastEditRelative}</span>
        </div>
        <span style={{ color: 'var(--text-4)' }}>{'→'}</span>
        <div className="row gap-2">
          <span className="t-xs muted">referenced by</span>
          <div className="row gap-1">
            {referencedPlatforms.length === 0 ? (
              <span className="t-xs faint">no other agents yet</span>
            ) : (
              referencedPlatforms.map((p, i) => (
                <PlatformGlyph key={`${p}-${i}`} platform={p} size={13} />
              ))
            )}
          </div>
          <span className="mono t-xs faint">{refsCount} runs</span>
        </div>
      </div>
    </div>
  );
}
