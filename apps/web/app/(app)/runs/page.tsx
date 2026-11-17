import { collectPages } from '../../../lib/pagination';
import { serverApiClient } from '../../../lib/server-api';
import { requireServerSession } from '../../../lib/server-session';
import { PageHead } from '../../../components/shared';
import { Stat } from '../../../components/screens/dashboard-stats';
import { RunsTable } from '../../../components/screens/runs-table';
import type { RunRecord } from '../../../lib/api-client';

export default async function RunsPage() {
  const session = await requireServerSession();
  const client = serverApiClient(session);

  const runs: RunRecord[] = session?.api_key ? await collectPages((cursor) => client.listRuns(cursor)) : [];

  const total = runs.length;
  const success = runs.filter((r) => r.status === 'success').length;
  const costs = runs.map((r) => r.metadata?.cost_usd).filter((c): c is number => typeof c === 'number');
  const costReported = costs.length > 0;
  const totalUsd = costs.reduce((s, c) => s + c, 0);
  const medianDuration = median(
    runs
      .map((r) => r.duration_ms)
      .filter((d): d is number => typeof d === 'number'),
  );
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead
        sub={
          <>
            Every <span className="mono fg-0">drive_log_run()</span> call
            captures task, artifacts touched, and cross-platform provenance.
          </>
        }
      />

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 18 }}
      >
        <Stat label="Runs · latest 50" val={total.toString()} sub="all platforms" />
        <Stat
          label="Success rate"
          val={`${successRate}%`}
          sub={`${success} / ${total || '—'}`}
        />
        <Stat
          label="Median duration"
          val={medianDuration != null ? `${(medianDuration / 1000).toFixed(1)}s` : '—'}
          sub="p50"
        />
        <Stat
          label="Spend · latest 50"
          val={costReported ? `$${totalUsd.toFixed(2)}` : '—'}
          sub="inference + embeddings"
        />
      </div>

      <RunsTable runs={runs} />
    </div>
  );
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}
