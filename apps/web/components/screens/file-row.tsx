import Link from 'next/link';
import { PlatformChip } from '../platform-glyph';
import { FileIcon, type FileKind } from '../shared';
import { humanTime } from '../../lib/time';
import type { FileSummary } from '../../lib/api-client';

// File metadata extended with the fields a row needs. The worker's FileSummary
// is the minimum surface; richer fields (hash, refs, embedding) are optional
// so we degrade gracefully when the backend hasn't surfaced them yet.
export interface FileRowData extends FileSummary {
  kind?: FileKind | string;
  agent_platform?: string;
  content_hash?: string;
  refs?: number;
  embedding?: 'pending' | 'ready' | 'failed';
  starred?: boolean;
}

interface FileRowProps {
  file: FileRowData;
  href: string;
  layout?: 'wide' | 'compact';
}

function kindFromPath(path: string): FileKind | string {
  if (path.endsWith('.md') || path.endsWith('.mdx')) return 'markdown';
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
  if (path.endsWith('.json')) return 'json';
  return 'text';
}

export function FileRow({ file, href, layout = 'wide' }: FileRowProps) {
  const kind = file.kind ?? kindFromPath(file.path);
  if (layout === 'compact') {
    return (
      <Link
        href={href}
        className="row-item clickable"
        style={{ gridTemplateColumns: '24px 1fr auto', gap: 12 }}
      >
        <FileIcon kind={kind} />
        <div
          className="col"
          style={{ lineHeight: 1.25, minWidth: 0 }}
        >
          <span
            className="mono t-sm fg-0"
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.path}
          </span>
          <span className="t-xs muted">
            v{file.version} · {humanTime(file.updated_at)}
          </span>
        </div>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="row-item clickable"
      style={{
        gridTemplateColumns: '28px 2.2fr 120px 90px 100px 80px 130px',
        gap: 14,
        padding: '12px 16px',
      }}
    >
      <FileIcon kind={kind} />
      <div
        className="col"
        style={{ minWidth: 0, lineHeight: 1.25 }}
      >
        <div className="row gap-2">
          <span className="mono fg-0">{file.path}</span>
          {file.embedding === 'pending' && (
            <span
              className="pill info"
              style={{ height: 16, padding: '0 6px', fontSize: 10 }}
            >
              indexing
            </span>
          )}
        </div>
        {file.content_hash && (
          <span className="t-xs mono dim">#{file.content_hash.slice(0, 10)}</span>
        )}
      </div>
      <PlatformChip platform={file.agent_platform ?? 'mcp'} />
      <span className="mono t-sm muted">v{file.version}</span>
      <span className="mono t-sm muted">
        {(file.size / 1024).toFixed(1)} KB
      </span>
      <span className="mono t-sm muted">{file.refs ?? '—'}</span>
      <span
        className="t-xs muted mono"
        style={{ textAlign: 'right' }}
      >
        {humanTime(file.updated_at)}
      </span>
    </Link>
  );
}
