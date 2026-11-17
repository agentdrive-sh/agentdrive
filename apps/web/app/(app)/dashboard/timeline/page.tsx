import Link from 'next/link';
import { serverApiClient } from '../../../../lib/server-api';
import { requireServerSession } from '../../../../lib/server-session';
import { PageHead } from '../../../../components/shared';
import { PLATFORMS, type PlatformId } from '../../../../components/platform-glyph';
import { TimelineHead, TimelineRow } from '../../../../components/screens/timeline-row';
import { TimelineEmpty } from '../../../../components/screens/timeline-empty';
import type { ActivityEvent } from '../../../../lib/api-client';

// Phase 3 /dashboard/timeline route — the screenshot moment.
//
// Design decisions locked in the CEO plan:
//   D3  → 1A "dense Linear-style table"
//   D8  → dashboard stays as home, timeline is the focused deep view
//   D9  → inline error block (no toast, no silent fallback)
//   D10 → empty state with faded platform glyph row
//   D12 → mobile + a11y inline below

interface SearchParams {
  since?: string;
  platform?: string;
  limit?: string;
}

const FILTER_WINDOWS: Array<{ id: string; label: string; sinceFn: () => string }> = [
  {
    id: 'today',
    label: 'Today',
    sinceFn: () => {
      const d = new Date();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    },
  },
  {
    id: '7d',
    label: '7 days',
    sinceFn: () => new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: '30d',
    label: '30 days',
    sinceFn: () => new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
  },
  { id: 'all', label: 'All', sinceFn: () => '' },
];

function resolveSince(rawSince: string | undefined): string | undefined {
  if (!rawSince) return undefined;
  const preset = FILTER_WINDOWS.find((w) => w.id === rawSince);
  if (preset) {
    const v = preset.sinceFn();
    return v || undefined;
  }
  // Assume the user passed an ISO string directly.
  return rawSince;
}

export default async function TimelinePage(props: { searchParams?: Promise<SearchParams> }) {
  const sp = (await props.searchParams) ?? {};
  const session = await requireServerSession();
  const client = serverApiClient(session);

  const since = resolveSince(sp.since);
  const limit = sp.limit ? Number.parseInt(sp.limit, 10) : 200;
  const platformFilter = sp.platform;
  const activeWindowId = sp.since && FILTER_WINDOWS.some((w) => w.id === sp.since) ? sp.since : '7d';
  const effectiveSince = since ?? resolveSince(activeWindowId);

  let items: ActivityEvent[] = [];
  let truncated = false;
  let errorMessage: string | null = null;

  if (session?.api_key) {
    try {
      const page = await client.listOrgTimeline({
        since: effectiveSince,
        limit: Math.min(Math.max(limit, 1), 1000),
      });
      items = page.items;
      truncated = page.truncated;
    } catch (err) {
      // D9: surface the error inline, no toast, no silent fallback.
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  const filteredItems = platformFilter
    ? items.filter((e) => (e.agent_platform ?? '') === platformFilter)
    : items;

  const PLATFORM_CHIPS: PlatformId[] = ['claude-code', 'codex', 'opencode', 'cursor', 'gemini-cli', 'antigravity'];

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead sub="Every read, write, and handoff across every connected agent, newest first." />

      <div className="row gap-3" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="row gap-1" role="tablist" aria-label="Date window">
          {FILTER_WINDOWS.map((w) => {
            const active = w.id === activeWindowId;
            const href = new URLSearchParams({ since: w.id });
            if (platformFilter) href.set('platform', platformFilter);
            return (
              <Link
                key={w.id}
                href={`/dashboard/timeline?${href}`}
                className={`btn sm${active ? ' primary' : ' ghost'}`}
                aria-pressed={active}
                role="tab"
              >
                {w.label}
              </Link>
            );
          })}
        </div>
        <div className="row gap-1" role="tablist" aria-label="Platform filter">
          <Link
            href={`/dashboard/timeline?since=${activeWindowId}`}
            className={`btn sm${!platformFilter ? ' primary' : ' ghost'}`}
            aria-pressed={!platformFilter}
            role="tab"
          >
            All agents
          </Link>
          {PLATFORM_CHIPS.map((p) => {
            const active = platformFilter === p;
            const params = new URLSearchParams({ since: activeWindowId, platform: p });
            return (
              <Link
                key={p}
                href={`/dashboard/timeline?${params}`}
                className={`btn sm${active ? ' primary' : ' ghost'}`}
                aria-pressed={active}
                role="tab"
              >
                {PLATFORMS[p].label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="surface" style={{ overflow: 'hidden' }}>
        {errorMessage ? (
          <div
            role="alert"
            className="empty"
            style={{ padding: 24, borderBottom: '1px solid var(--border)' }}
          >
            <h3 style={{ marginBottom: 6 }}>Timeline failed to load</h3>
            <p className="t-sm muted" style={{ marginBottom: 14 }}>{errorMessage}</p>
            <div className="row gap-2" style={{ justifyContent: 'center' }}>
              <Link href="/dashboard/timeline" className="btn primary">Retry</Link>
              <Link href="https://github.com/agentdrive-sh/agentdrive-mcp/issues" className="btn ghost">
                Report bug
              </Link>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <TimelineEmpty filtered={!!platformFilter || !!sp.since} />
        ) : (
          <div role="table" aria-label="Cross-agent timeline">
            <TimelineHead />
            {filteredItems.map((ev) => (
              <TimelineRow key={ev.id} event={ev} />
            ))}
          </div>
        )}
      </div>

      {truncated && filteredItems.length > 0 && (
        <div className="t-xs faint" style={{ marginTop: 12, textAlign: 'center' }}>
          Showing {filteredItems.length} events; capped by --limit. Tighten the date window to page back.
        </div>
      )}
    </div>
  );
}
