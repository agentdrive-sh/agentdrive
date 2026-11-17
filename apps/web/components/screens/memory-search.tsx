'use client';

import { useState, useTransition } from 'react';
import { ApiClient, ApiError } from '../../lib/api-client';
import { useSession } from '../session-provider';
import { Icon } from '../icon';
import { CopyableCode, PageHead } from '../shared';
import { SearchHit } from './search-hit';
import { PLATFORMS, displayPlatform, type PlatformId } from '../platform-glyph';
import type { SearchHit as SearchHitType } from '../../lib/api-client';

interface MemorySearchProps {
  workspaceId: string | null;
}

type Tab = 'search' | 'context';

const RECENT: string[] = [
  'cross-agent identity',
  'embedding queue',
  'session handoff',
  'pagination cursor',
];

export function MemorySearch({ workspaceId }: MemorySearchProps) {
  const session = useSession();
  const [q, setQ] = useState('cross-agent identity');
  const [tab, setTab] = useState<Tab>('search');
  const [hits, setHits] = useState<SearchHitType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hasSearched, setHasSearched] = useState(false);
  const [platform, setPlatform] = useState('all');

  const client = ApiClient.fromSession(session);
  const platforms = [...new Set(hits.map((h) => displayPlatform(h.agent_platform)))];
  const shown = platform === 'all' ? hits : hits.filter((h) => displayPlatform(h.agent_platform) === platform);

  const runSearch = (text: string) => {
    setError(null);
    setHasSearched(true);
    startTransition(async () => {
      try {
        const res = await client.search({
          query: text,
          workspace_id: workspaceId ?? undefined,
          top_k: 10,
        });
        setHits(res.hits);
        setPlatform('all');
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Search failed');
        setHits([]);
      }
    });
  };

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead sub="Semantic search across every agent's artifacts, and the recency-reranked context drive_context hands an agent." />

      <div className="surface" style={{ padding: 18, marginBottom: 18 }}>
        <form
          className="row gap-3 search-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) runSearch(q.trim());
          }}
        >
          <div style={{ color: 'var(--accent)' }}>
            <Icon name="search" size={20} />
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input"
            placeholder="What did my agents work on…"
            style={{
              height: 44,
              fontSize: 17,
              border: 0,
              background: 'transparent',
              padding: 0,
            }}
          />
          <div className="vdivider" style={{ height: 24 }} />
          <select
            className="input"
            aria-label="Filter results by agent"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            disabled={platforms.length < 2}
            style={{ width: 180, height: 36 }}
          >
            <option value="all">All agents</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {(PLATFORMS[p as PlatformId] ?? PLATFORMS.unknown).label} only
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn primary lg"
            disabled={pending}
          >
            {pending ? 'Searching…' : 'Search'}
          </button>
        </form>
        <div
          className="row gap-2"
          style={{ marginTop: 12, flexWrap: 'wrap' }}
        >
          <span className="t-xs muted">Try:</span>
          {RECENT.map((s) => (
            <button
              key={s}
              type="button"
              className="pill"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setQ(s);
                runSearch(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="tabs">
        <div
          className={'tab' + (tab === 'search' ? ' active' : '')}
          onClick={() => setTab('search')}
        >
          <Icon name="search" size={12} /> drive_search
          <span className="count">{shown.length}</span>
        </div>
        <div
          className={'tab' + (tab === 'context' ? ' active' : '')}
          onClick={() => setTab('context')}
        >
          <Icon name="brain" size={12} /> drive_context
          <span className="count">preview</span>
        </div>
      </div>

      {tab === 'search' && (
        <SearchTab
          hits={shown}
          query={q}
          error={error}
          pending={pending}
          hasSearched={hasSearched}
        />
      )}
      {tab === 'context' && (
        <ContextTab workspaceId={workspaceId} client={client} />
      )}
    </div>
  );
}

interface SearchTabProps {
  hits: SearchHitType[];
  query: string;
  error: string | null;
  pending: boolean;
  hasSearched: boolean;
}

function SearchTab({ hits, query, error, pending, hasSearched }: SearchTabProps) {
  const [sort, setSort] = useState<'score' | 'recent'>('score');
  const sorted = [...hits].sort((a, b) => {
    if (sort === 'recent') return b.created_at - a.created_at;
    if (a.score === null) return b.score === null ? b.created_at - a.created_at : 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });
  return (
    <div>
      <div
        className="row gap-3"
        style={{ marginBottom: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <div className="t-sm muted">
          <span className="fg-0 wt-500">{hits.length} results</span> ·{' '}
          {hits.some((hit) => hit.score === null)
            ? 'Semantic and keyword matches; keyword matches have no similarity score'
            : 'cosine similarity, re-ranked by recency'}
        </div>
        <div className="row gap-1" role="group" aria-label="Sort results">
          <button
            type="button"
            className={sort === 'score' ? 'btn sm' : 'btn sm ghost'}
            aria-pressed={sort === 'score'}
            onClick={() => setSort('score')}
          >
            Relevance
          </button>
          <button
            type="button"
            className={sort === 'recent' ? 'btn sm' : 'btn sm ghost'}
            aria-pressed={sort === 'recent'}
            onClick={() => setSort('recent')}
          >
            Most recent
          </button>
        </div>
      </div>
      <div className="surface">
        {error && (
          <div className="empty">
            <Icon name="x" size={24} />
            <h3>Search failed</h3>
            <p>{error}</p>
          </div>
        )}
        {!error && pending && (
          <div className="empty">
            <Icon name="clock" size={24} />
            <h3>Searching…</h3>
            <p>Embedding the query and searching the vector index.</p>
          </div>
        )}
        {!error && !pending && hits.length === 0 && hasSearched && (
          <div className="empty">
            <Icon name="search" size={24} />
            <h3>No hits</h3>
            <p>
              Nothing in this workspace matched. Wire more agents or wait for
              the embedding queue to drain.
            </p>
          </div>
        )}
        {!error && !pending && hits.length === 0 && !hasSearched && (
          <div className="empty">
            <Icon name="search" size={24} />
            <h3>Run a search</h3>
            <p>
              Type any natural-language query above. Every artifact written
              through drive_write is indexed on write.
            </p>
          </div>
        )}
        {sorted.map((h) => (
          <SearchHit key={JSON.stringify([h.ws_id, h.path, h.content_hash])} hit={h} query={query} />
        ))}
      </div>
    </div>
  );
}

interface ContextTabProps {
  workspaceId: string | null;
  client: ApiClient;
}

function ContextTab({ workspaceId, client }: ContextTabProps) {
  const [task, setTask] = useState('');
  const [items, setItems] = useState<SearchHitType[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);

  const runContext = () => {
    setError(null);
    setHasRun(true);
    startTransition(async () => {
      try {
        const res = await client.context({
          task,
          workspace_id: workspaceId ?? undefined,
          limit: 5,
        });
        setItems(res.artifacts);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Context failed');
        setItems([]);
      }
    });
  };

  return (
    <div>
      <div className="surface" style={{ padding: 18, marginBottom: 16 }}>
        <div className="t-sm muted wt-500" style={{ marginBottom: 8 }}>
          This is what{' '}
          <span className="mono fg-0">drive_context(task)</span> returns when
          called by any agent.
        </div>
        <textarea
          className="input"
          rows={2}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          aria-label="Task"
          placeholder="Describe the task an agent is about to start"
          style={{ height: 64, padding: 12, resize: 'vertical' }}
        />
        <div className="row gap-2" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn primary"
            onClick={runContext}
            disabled={pending || !task.trim()}
          >
            <Icon name="sparkle" size={12} />{' '}
            {pending ? 'Querying…' : 'Run context query'}
          </button>
          <span className="t-xs muted">
            limit=5 · rerank=0.7·sem + 0.3·exp(-age/30)
          </span>
        </div>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: '2fr 1fr', gap: 16 }}
      >
        <div className="surface">
          <div
            className="row"
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div className="t-sm wt-600 fg-0">Top artifacts</div>
            <div
              className="t-xs muted"
              style={{ marginLeft: 'auto' }}
            >
              {items.length === 0 ? '—' : `${items.length} hits`}
            </div>
          </div>
          {error && (
            <div className="empty">
              <Icon name="x" size={24} />
              <h3>Context failed</h3>
              <p>{error}</p>
            </div>
          )}
          {!error && !hasRun && (
            <div className="empty">
              <Icon name="brain" size={24} />
              <h3>Press Run</h3>
              <p>
                Paste a task above and see what drive_context returns.
              </p>
            </div>
          )}
          {!error && hasRun && items.length === 0 && !pending && (
            <div className="empty">
              <Icon name="brain" size={24} />
              <h3>No artifacts</h3>
              <p>
                Nothing semantically matched this task yet. Try writing or
                wiring more agents.
              </p>
            </div>
          )}
          {items.map((it, i) => (
            <div
              key={JSON.stringify([it.ws_id, it.path, it.content_hash])}
              className="row-item"
              style={{
                gridTemplateColumns: '32px 1fr 90px',
                gap: 14,
                padding: '14px 18px',
              }}
            >
              <div style={{ position: 'relative' }}>
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    left: -4,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    color: 'var(--accent-fg)',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {i + 1}
                </span>
              </div>
              <div
                className="col"
                style={{ minWidth: 0, lineHeight: 1.3 }}
              >
                <span className="mono t-sm fg-0">{it.path}</span>
                {it.snippet && (
                  <span className="t-xs muted" style={{ marginTop: 2 }}>
                    {it.snippet.slice(0, 140)}
                    {it.snippet.length > 140 ? '…' : ''}
                  </span>
                )}
              </div>
              <div className="col" style={{ alignItems: 'flex-end' }}>
                <span className="mono fg-accent t-sm wt-600">
                  {it.score === null ? 'Keyword match' : it.score.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="surface" style={{ padding: 18 }}>
          <div
            className="t-xs muted wt-600"
            style={{
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            How this is computed
          </div>
          <div
            className="t-sm"
            style={{ lineHeight: 1.65, color: 'var(--text-2)' }}
          >
            <p style={{ margin: '0 0 12px' }}>
              For each artifact in the workspace, compute:
            </p>
            <div className="code" style={{ fontSize: 12, lineHeight: 1.7 }}>
              {`score = 0.7 * cosine(q, embed)
      + 0.3 * exp(-age_days / 30)`}
            </div>
            <p style={{ margin: '14px 0 0' }}>
              Return top-N, each with a snippet pulled live from the artifact
              store. The agent decides what to do with the context.
              {' '}Keyword matches do not carry a semantic score.
            </p>
          </div>
          <div className="divider" style={{ margin: '18px 0' }} />
          <div
            className="t-xs muted wt-600"
            style={{
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            MCP call
          </div>
          <CopyableCode>
            {`drive_context({
  task: "${task.slice(0, 36)}${task.length > 36 ? '…' : ''}",
  limit: 5
})`}
          </CopyableCode>
        </div>
      </div>
    </div>
  );
}
