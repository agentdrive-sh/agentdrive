import Link from 'next/link';
import { workspaceFileHref } from '../../../lib/workspace-selection';
import { serverApiClient } from '../../../lib/server-api';
import { requireServerSession } from '../../../lib/server-session';
import { resolveActiveWorkspace } from '../../../lib/workspace';
import { Icon } from '../../../components/icon';
import { PageHead } from '../../../components/shared';
import { PLAN_QUOTAS } from '@agentdrive/shared';
import { ActivityFeed } from '../../../components/screens/activity-feed';
import { AgentSparkCard } from '../../../components/screens/agent-spark-card';
import { BusDiagram } from '../../../components/screens/bus-diagram';
import { DashboardStats } from '../../../components/screens/dashboard-stats';
import { FileRow } from '../../../components/screens/file-row';
import type {
  ActivityEvent,
  FileSummary,
  OrgDetail,
  RunRecord,
} from '../../../lib/api-client';

const HOUR = 3600 * 1000;
const RANGES = {
  '24h': { label: 'last 24 hours', buckets: 24, bucketMs: HOUR, unit: 'hourly' },
  '7d': { label: 'last 7 days', buckets: 7, bucketMs: 24 * HOUR, unit: 'daily' },
  '30d': { label: 'last 30 days', buckets: 30, bucketMs: 24 * HOUR, unit: 'daily' },
} as const;
type Range = keyof typeof RANGES;
// GET /v1/runs without params returns at most this many of the org's newest runs, no cursor.
const RUNS_PAGE = 50;

export default async function DashboardPage(props: { searchParams?: Promise<{ range?: string; workspace?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const range: Range = sp.range && sp.range in RANGES ? (sp.range as Range) : '24h';
  const session = await requireServerSession();
  const { current } = await resolveActiveWorkspace(sp.workspace);
  const client = serverApiClient(session);

  let org: OrgDetail | null = null;
  let activity: ActivityEvent[] = [];
  let recentFiles: FileSummary[] = [];
  let fileCount = 0;
  let moreFiles = false;
  let runs: RunRecord[] = [];

  if (session?.api_key) {
    const [orgRes, activityRes, filesRes, runsRes] = await Promise.all([
      client.getOrg(),
      current
        ? client.listActivity(current.id)
        : Promise.resolve({ items: [], cursor: null }),
      current
        ? client.listFiles(current.id)
        : Promise.resolve({ items: [], cursor: null }),
      client.listRuns(),
    ]);
    org = orgRes;
    activity = activityRes.items.slice(0, 8);
    recentFiles = filesRes.items.slice(0, 5);
    fileCount = filesRes.items.length;
    moreFiles = !!filesRes.cursor;
    runs = runsRes.items;
  }

  const win = RANGES[range];
  const cutoff = Date.now() - win.buckets * win.bucketMs;
  const inRange = runs.filter((r) => r.created_at >= cutoff);
  // A full page whose oldest run is still inside the range means older runs in range were cut off.
  const truncated = runs.length >= RUNS_PAGE && inRange.length === runs.length;
  const byPlatform = new Map<string, number[]>();
  for (const r of inRange) {
    const plat = r.agent_platform ?? 'unknown';
    const series = byPlatform.get(plat) ?? new Array<number>(win.buckets).fill(0);
    series[Math.min(Math.floor((r.created_at - cutoff) / win.bucketMs), win.buckets - 1)]++;
    byPlatform.set(plat, series);
  }
  const total = (data: number[]) => data.reduce((a, b) => a + b, 0);
  const platformSeries = [...byPlatform].sort((a, b) => total(b[1]) - total(a[1]));

  const storageUsedGb =
    org?.usage?.storage_bytes != null
      ? org.usage.storage_bytes / (1024 * 1024 * 1024)
      : 0;
  const storageTotalGb =
    org?.quota?.storage_bytes != null
      ? org.quota.storage_bytes / (1024 * 1024 * 1024)
      : PLAN_QUOTAS.trial.storage_bytes / (1024 * 1024 * 1024);
  const greeting = greetingFor(new Date(), session?.email);

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead
        heading={greeting}
        sub="Start in any agent, finish in any other. Sessions from Claude Code, Codex, OpenCode, Cursor, Gemini CLI and Antigravity are captured here, ready to resume in any of them."
        actions={
          <Link href="/onboarding" className="btn primary">
            <Icon name="plus" size={13} /> Wire a new agent
          </Link>
        }
      />

      <DashboardStats
        artifactCount={`${fileCount}${moreFiles ? '+' : ''}`}
        artifactSub={current ? `in ${current.name}` : 'no workspace yet'}
        runsLabel={`Agent runs · ${range}`}
        runsVal={`${inRange.length}${truncated ? '+' : ''}`}
        runsSub={
          runs.length === 0
            ? 'no runs logged yet'
            : truncated
              ? `latest ${RUNS_PAGE} runs only`
              : 'all platforms'
        }
        storageUsedGb={storageUsedGb}
        storageTotalGb={Math.max(storageTotalGb, 1)}
        embeddingsUsed={org?.usage?.embedding_count ?? 0}
        embeddingsTotal={org?.quota?.embedding_count ?? PLAN_QUOTAS.trial.embedding_count}
      />

      <div
        className="grid"
        style={{ gridTemplateColumns: '1.5fr 1fr', marginBottom: 18 }}
      >
        <div className="surface" style={{ padding: 22 }}>
          <div
            className="row gap-3"
            style={{
              justifyContent: 'space-between',
              marginBottom: 18,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="t-md wt-600 fg-0">Cross-platform activity</div>
              <div className="t-sm muted">
                Runs per agent platform · {win.label}, {win.unit}
                {truncated && ` · latest ${RUNS_PAGE} runs only`}
              </div>
            </div>
            <nav className="row gap-1" aria-label="Time range">
              {(Object.keys(RANGES) as Range[]).map((r) => (
                <Link
                  key={r}
                  href={`/dashboard?range=${r}`}
                  className={r === range ? 'btn sm' : 'btn sm ghost'}
                  aria-current={r === range ? 'true' : undefined}
                >
                  {r}
                </Link>
              ))}
            </nav>
          </div>
          <div className="col gap-4">
            {platformSeries.map(([plat, data]) => (
              <AgentSparkCard key={plat} platform={plat} data={data} />
            ))}
            {platformSeries.length === 0 && (
              <div className="t-sm faint">
                No runs in the {win.label}. Runs land here once a wired agent
                calls drive_log_run. Wire one from{' '}
                <Link href="/onboarding">Onboarding</Link>.
              </div>
            )}
          </div>
        </div>

        <div
          className="surface"
          style={{ padding: 22, position: 'relative', overflow: 'hidden' }}
        >
          <div className="t-md wt-600 fg-0">The bus</div>
          <div className="t-sm muted" style={{ marginBottom: 18 }}>
            One workspace, every agent.
          </div>
          <BusDiagram />
          <div
            className="t-xs muted"
            style={{ marginTop: 14, lineHeight: 1.55 }}
          >
            Every connected principal reads and writes against the same
            content-addressed store. Provenance is automatic.
          </div>
        </div>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: '1.4fr 1fr', gap: 18 }}
      >
        <div className="surface">
          <div
            className="row"
            style={{
              padding: '16px 18px',
              borderBottom: '1px solid var(--border)',
              justifyContent: 'space-between',
            }}
          >
            <div className="t-md wt-600 fg-0">
              Recent cross-agent activity
            </div>
            <Link href="/dashboard/timeline" className="btn ghost sm">
              See in Timeline <Icon name="arrow-right" size={11} />
            </Link>
          </div>
          <ActivityFeed events={activity} />
        </div>

        <div className="surface">
          <div
            className="row"
            style={{
              padding: '16px 18px',
              borderBottom: '1px solid var(--border)',
              justifyContent: 'space-between',
            }}
          >
            <div className="t-md wt-600 fg-0">Recently touched</div>
            <Link href="/files" className="btn ghost sm">
              All files <Icon name="arrow-right" size={11} />
            </Link>
          </div>
          {recentFiles.length === 0 ? (
            <div className="empty">
              <Icon name="folder" size={24} />
              <h3>No files yet</h3>
              <p>Once any wired agent calls drive_write, it lands here.</p>
            </div>
          ) : (
            recentFiles.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                href={workspaceFileHref(current!.id, f.id)}
                layout="compact"
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}


function greetingFor(now: Date, email?: string): string {
  const hour = now.getHours();
  const part =
    hour < 5
      ? 'evening'
      : hour < 12
        ? 'morning'
        : hour < 17
          ? 'afternoon'
          : 'evening';
  const name = email?.split('@')[0]?.split(/[.+_-]/)[0];
  const cap = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'there';
  return `Good ${part}, ${cap}`;
}
