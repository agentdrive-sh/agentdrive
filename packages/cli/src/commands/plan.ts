import kleur from 'kleur';
import { CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';

const LABELS: Record<string, string> = {
  storage_bytes: 'storage',
  embedding_count: 'embeddings',
  agent_count: 'agents',
  workspace_count: 'workspaces',
  member_count: 'seats',
  resume_count: 'cross-agent resumes this month',
};

function bytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${Number(n.toFixed(1))} ${units[i]}`;
}

// A worker from before usage status sends raw counters keyed by their own names.
function legacyTable(usage: Record<string, number>, quota: Record<string, number>): string[][] {
  const n = (v = 0) => (Number.isFinite(v) ? v.toLocaleString('en-US') : '-');
  const keys = [...new Set([...Object.keys(usage), ...Object.keys(quota)])];
  return [['metric', 'usage', 'quota'], ...keys.map((k) => [k, n(usage[k]), n(quota[k])])];
}

export async function cmdPlan(): Promise<void> {
  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });

  const plan = await client.billingPlan();
  const status = plan.status;
  process.stdout.write(`${kleur.bold('Plan')}: ${status?.plan_name ?? plan.plan}\n`);
  const fmt = (metric: string, n: number) => (metric === 'storage_bytes' ? bytes(n) : n.toLocaleString('en-US'));
  const table = status
    ? [
        ['metric', 'used', 'limit', 'pct', 'level'],
        ...Object.entries(status.metrics).map(([metric, m]) => [
          LABELS[metric] ?? metric,
          fmt(metric, m.used),
          fmt(metric, m.limit),
          `${m.pct}%`,
          // A count cap that is reached stops adding more; nothing else pauses.
          m.level === 'paused' ? 'full' : m.level,
        ]),
      ]
    : legacyTable(plan.usage ?? {}, plan.quota ?? {});
  if (table.length < 2) return;
  const widths = table[0]!.map((_, i) => Math.max(...table.map((r) => r[i]!.length)));
  const line = (r: string[]) => `${r.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd()}\n`;
  process.stdout.write(`\n${line(table[0]!)}${line(widths.map((w) => '-'.repeat(w)))}${table.slice(1).map(line).join('')}`);

  if (status?.message) {
    process.stdout.write(`\n${kleur.yellow(status.message)}\nUpgrade: ${status.upgrade_url}\n`);
  }
}
