import { PlatformChip } from '../platform-glyph';
import type { PlatformId } from '../platform-glyph';

export interface VersionEntry {
  v: number;
  platform: PlatformId | string;
  author?: string;
  at: string;
  hash: string;
  note?: string;
  diffAdd?: number;
  diffDel?: number;
}

interface Props {
  versions: VersionEntry[];
  humanRelative: (iso: string) => string;
}

export function VersionTimeline({ versions, humanRelative }: Props) {
  if (versions.length === 0) {
    return (
      <div className="empty">
        <h3>No versions yet</h3>
        <p>The first <span className="mono">drive_write</span> creates v1.</p>
      </div>
    );
  }
  return (
    <div className="tl">
      {versions.map((v, i) => (
        <div
          key={`${v.v}-${v.hash}`}
          className={'tl-item' + (i === 0 ? ' accent' : '')}
        >
          <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="row gap-2">
                <span className="mono fg-0 wt-600">v{v.v}</span>
                <PlatformChip platform={v.platform} />
                <span className="t-xs faint">·</span>
                <span className="t-xs muted">{humanRelative(v.at)}</span>
              </div>
              {v.note && (
                <div
                  className="t-sm"
                  style={{ marginTop: 6, color: 'var(--text-1)' }}
                >
                  {v.note}
                </div>
              )}
              <div className="row gap-3 t-xs" style={{ marginTop: 8 }}>
                <span className="mono faint">
                  #{v.hash.slice(0, 10)}
                </span>
                {typeof v.diffAdd === 'number' && (
                  <span
                    className="mono"
                    style={{ color: 'var(--success)' }}
                  >
                    +{v.diffAdd}
                  </span>
                )}
                {typeof v.diffDel === 'number' && (
                  <span className="mono" style={{ color: 'var(--danger)' }}>
                    −{v.diffDel}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
