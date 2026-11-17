'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PLATFORMS, PlatformChip, displayPlatform, type PlatformId } from '../platform-glyph';
import { StatusPill } from '../shared';
import { Icon } from '../icon';
import { humanTime } from '../../lib/time';
import type { RunRecord } from '../../lib/api-client';

interface RunsTableProps {
  runs: RunRecord[];
}

type Filter = 'all' | 'success' | 'partial' | 'failed';

const platformOf = (r: RunRecord): string => r.agent_platform ?? (r.metadata?.agent_platform as string | undefined) ?? 'mcp';
const platformLabel = (p: string): string => PLATFORMS[p as PlatformId]?.label ?? p;

const STATUS_MAP: Record<RunRecord['status'], 'success' | 'partial' | 'failed' | 'running'> = {
  success: 'success',
  partial: 'partial',
  failure: 'failed',
  in_progress: 'running',
};

export function RunsTable({ runs }: RunsTableProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [platform, setPlatform] = useState('all');
  const platforms = useMemo(() => [...new Set(runs.map((r) => displayPlatform(platformOf(r))))].sort(), [runs]);

  const counts = useMemo(() => {
    return {
      all: runs.length,
      success: runs.filter((r) => r.status === 'success').length,
      partial: runs.filter((r) => r.status === 'partial').length,
      failed: runs.filter((r) => r.status === 'failure').length,
    };
  }, [runs]);

  const filtered = useMemo(() => {
    const onPlatform = platform === 'all' ? runs : runs.filter((r) => displayPlatform(platformOf(r)) === platform);
    if (filter === 'all') return onPlatform;
    if (filter === 'failed') return onPlatform.filter((r) => r.status === 'failure');
    return onPlatform.filter((r) => r.status === filter);
  }, [runs, filter, platform]);

  return (
    <>
      <div className="row gap-1" style={{ marginBottom: 16 }}>
        {(
          [
            ['all', 'All'],
            ['success', 'Success'],
            ['partial', 'Partial'],
            ['failed', 'Failed'],
          ] as Array<[Filter, string]>
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            className={'btn sm' + (filter === k ? ' primary' : '')}
            onClick={() => setFilter(k)}
          >
            {l}{' '}
            <span
              className="mono"
              style={{ opacity: 0.7, marginLeft: 2 }}
            >
              {counts[k]}
            </span>
          </button>
        ))}
        <div className="grow" />
        <select className="input" style={{ width: 160 }} value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Filter by agent">
          <option value="all">All agents</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {platformLabel(p)}
            </option>
          ))}
        </select>
      </div>

      <div className="surface table-scroll">
        <div
          className="row-item"
          style={{
            gridTemplateColumns: '120px 2.4fr 130px 110px 100px 90px 120px',
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
          <span>Run ID</span>
          <span>Task</span>
          <span>Agent</span>
          <span>Duration</span>
          <span>Artifacts</span>
          <span>Cost</span>
          <span style={{ textAlign: 'right' }}>Status · time</span>
        </div>

        {filtered.map((r) => {
          const runPlatform = platformOf(r);
          const dur =
            r.duration_ms != null
              ? `${(r.duration_ms / 1000).toFixed(1)}s`
              : '—';
          const cost =
            typeof r.metadata?.cost_usd === 'number'
              ? `$${(r.metadata.cost_usd as number).toFixed(2)}`
              : '—';
          const produced = r.artifacts_produced?.length ?? 0;
          const referenced = r.artifacts_referenced?.length ?? 0;
          return (
            <Link
              key={r.run_id}
              href={`/runs/${encodeURIComponent(r.run_id)}`}
              className="row-item clickable"
              style={{
                gridTemplateColumns: '120px 2.4fr 130px 110px 100px 90px 120px',
                gap: 14,
                padding: '14px 16px',
              }}
            >
              <span className="mono t-sm faint">
                {r.run_id.slice(0, 11)}…
              </span>
              <div className="col" style={{ minWidth: 0, lineHeight: 1.3 }}>
                <span
                  className="t-sm fg-0"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.task}
                </span>
              </div>
              <PlatformChip platform={runPlatform} />
              <span className="mono t-sm muted">{dur}</span>
              <span className="mono t-sm muted">
                <span className="fg-success">+{produced}</span>
                {' / '}
                <span className="muted">↪{referenced}</span>
              </span>
              <span className="mono t-sm muted">{cost}</span>
              <div
                className="col"
                style={{ alignItems: 'flex-end', lineHeight: 1.2 }}
              >
                <StatusPill status={STATUS_MAP[r.status] ?? r.status} />
                <span
                  className="t-xs faint mono"
                  style={{ marginTop: 4 }}
                >
                  {humanTime(r.created_at)}
                </span>
              </div>
            </Link>
          );
        })}

        {filtered.length === 0 && (
          <div className="empty">
            <Icon name="play" size={24} />
            <h3>No runs yet</h3>
            <p>
              Once any agent logs a run via{' '}
              <span className="mono">drive_log_run</span>, it appears here
              with task, artifacts touched, and cross-platform provenance.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
