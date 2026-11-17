import Link from 'next/link';
import { PlatformGlyph } from '../platform-glyph';
import { ProgressBar } from '../shared';
import { humanTime } from '../../lib/time';
import type { SearchHit as SearchHitType } from '../../lib/api-client';

interface SearchHitProps {
  hit: SearchHitType;
  query: string;
}

// Highlight every occurrence of the query terms (whitespace-split) in the
// snippet. We intentionally do not preserve <mark> tags from the API — the
// worker currently returns a raw substring, and any HTML in user content would
// leak through. Render-time highlighting keeps it safe.
function highlight(snippet: string, query: string): React.ReactNode {
  const terms = Array.from(
    new Set(
      query
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    ),
  );
  if (terms.length === 0) return snippet;
  const re = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
  const parts = snippet.split(re);
  return parts.map((part, i) =>
    re.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function SearchHit({ hit, query }: SearchHitProps) {
  const fileName = hit.path.split('/').pop() ?? hit.path;
  const href = `/files/by-path?workspace=${encodeURIComponent(hit.ws_id)}&path=${encodeURIComponent(hit.path)}`;
  const score = hit.score;
  return (
    <Link
      href={href}
      className="hit"
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div
        className="row"
        style={{
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="path">{hit.path}</div>
          <div className="title row gap-2">
            <span>{fileName}</span>
            <PlatformGlyph platform={hit.agent_platform} size={11} />
            <span className="t-xs muted">{humanTime(hit.created_at)}</span>
          </div>
          {hit.snippet && (
            <div className="snippet">{highlight(hit.snippet, query)}</div>
          )}
        </div>
        <div
          className="col"
          style={{ alignItems: 'flex-end', flexShrink: 0 }}
        >
          <div className="mono fg-accent t-sm wt-600">
            {score === null ? 'Keyword match' : score.toFixed(2)}
          </div>
          {score !== null && <>
            <div className="t-xs faint">score</div>
            <div style={{ marginTop: 8, width: 80 }}>
              <ProgressBar value={score * 100} max={100} />
            </div>
          </>}
        </div>
      </div>
    </Link>
  );
}
