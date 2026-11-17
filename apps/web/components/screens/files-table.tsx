'use client';

import { useMemo, useState } from 'react';
import { ApiClient } from '@/lib/api-client';
import { useSession } from '../session-provider';
import { workspaceFileHref } from '@/lib/workspace-selection';
import { Icon } from '../icon';
import { PLATFORMS, displayPlatform, type PlatformId, GlyphSVG } from '../platform-glyph';
import { FileRow, type FileRowData } from './file-row';

interface FilesTableProps {
  initialFiles: FileRowData[];
  workspaceId: string;
  initialCursor: string | null;
}

const PLATFORM_FILTERS: PlatformId[] = [
  'claude-code',
  'codex',
  'cursor',
  'opencode',
  'antigravity',
];

export function FilesTable({ initialFiles, workspaceId, initialCursor }: FilesTableProps) {
  const [files, setFiles] = useState(initialFiles);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useSession();
  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await ApiClient.fromSession(session).listFiles(workspaceId, undefined, cursor);
      if (page.cursor === cursor) throw new Error('The server repeated a page. Please retry.');
      setFiles((previous) => [...previous, ...page.items.filter((item) => !previous.some((file) => file.id === item.id))]);
      setCursor(page.cursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load more artifacts.');
    } finally { setLoading(false); }
  }
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | string>('all');

  const filtered = useMemo(() => {
    return files.filter((f) => {
      if (q && ![f.path, f.content_hash ?? ''].some((value) => value.toLowerCase().includes(q.toLowerCase().replace(/^#/, '')))) return false;
      if (filter !== 'all' && displayPlatform(f.agent_platform ?? 'mcp') !== filter)
        return false;
      return true;
    });
  }, [files, q, filter]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of files) {
      const p = displayPlatform(f.agent_platform ?? 'mcp');
      m[p] = (m[p] ?? 0) + 1;
    }
    return m;
  }, [files]);

  return (
    <>
      <div className="row gap-2" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <input
            className="input"
            aria-label="Filter loaded artifacts"
            placeholder="Filter loaded artifacts by path or hash…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 30 }}
          />
          <div
            style={{
              position: 'absolute',
              left: 10,
              top: 9,
              color: 'var(--text-3)',
              pointerEvents: 'none',
            }}
          >
            <Icon name="search" size={13} />
          </div>
        </div>
        <div className="row gap-1">
          <button
            type="button"
            className={'btn sm' + (filter === 'all' ? ' primary' : '')}
            onClick={() => setFilter('all')}
          >
            All{' '}
            <span
              className="mono"
              style={{ opacity: 0.7, marginLeft: 4 }}
            >
              {files.length}
            </span>
          </button>
          {PLATFORM_FILTERS.map((p) => {
            const count = counts[p] ?? 0;
            if (!count) return null;
            return (
              <button
                key={p}
                type="button"
                className={'btn sm' + (filter === p ? ' primary' : '')}
                onClick={() => setFilter(p)}
              >
                <span style={{ display: 'inline-flex' }}>
                  <GlyphSVG platform={p} size={11} />
                </span>
                {PLATFORMS[p].label}
                <span
                  className="mono"
                  style={{ opacity: 0.7, marginLeft: 2 }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="grow" />

      </div>

      <div className="surface table-scroll">
        <div
          className="row-item"
          style={{
            gridTemplateColumns: '28px 2.2fr 120px 90px 100px 80px 130px',
            gap: 14,
            padding: '8px 16px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-3)',
            fontWeight: 600,
          }}
        >
          <span />
          <span>Path</span>
          <span>Author</span>
          <span>Versions</span>
          <span>Size</span>
          <span>Refs</span>
          <span style={{ textAlign: 'right' }}>Updated</span>
        </div>

        {filtered.map((f) => (
          <FileRow
            key={f.id}
            file={f}
            href={workspaceFileHref(workspaceId, f.id)}
          />
        ))}

        {filtered.length === 0 && (
          <div className="empty">
            <Icon name="folder" size={24} />
            <h3>No matches</h3>
            <p>Try a different path or clear filters.</p>
          </div>
        )}
      </div>
      <div className="row gap-3" style={{ marginTop: 16, flexWrap: 'wrap' }}>
        <span className="t-xs muted">{files.length} artifacts loaded{cursor ? '. Filters apply to loaded artifacts; load more to search later pages.' : '.'}</span>
        {cursor && <button type="button" className="btn" onClick={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more artifacts'}</button>}
      </div>
      {error && <p role="alert" className="t-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
    </>
  );
}
