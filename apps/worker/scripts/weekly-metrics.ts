// Prints the weekly growth table for the last 8 ISO weeks (UTC), read-only:
// new orgs, new activations (an org's first cross-harness resume), and
// cross-harness resumers (distinct API-key principals and orgs), then the
// current paid orgs by plan and how many activated orgs pay.
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
//     node apps/worker/scripts/weekly-metrics.ts <kv-namespace-id>
//
// Resumes are recorded from the worker's file read route, so weeks before that
// shipped show none; resumers are API keys, not people, so one developer with
// two keys counts twice.

import { mapLimit, restKv, type KvReader } from './backfill-usage.ts';

// Mirrors PAID_PLANS in packages/shared and isoWeek in src/services/storage.ts;
// the weekly-metrics test holds them together.
export const PAID_PLANS = ['pro', 'team'];

export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function lastIsoWeeks(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => isoWeek(new Date(now.getTime() - (count - 1 - i) * 7 * 86_400_000)));
}

export interface MetricsInput {
  orgs: Array<{ id: string; created_at: string; plan: string }>;
  activations: Array<{ org_id: string; at: string }>;
  resumes: Array<{ week: string; org_id: string; principal: string }>;
}

export interface WeekRow {
  week: string;
  new_orgs: number;
  new_activations: number;
  resumers: number;
  resumer_orgs: number;
}

export interface WeeklyMetrics {
  weeks: WeekRow[];
  paid_by_plan: Record<string, number>;
  activated_orgs: number;
  activated_paid: number;
}

export function weeklyMetrics(input: MetricsInput, weeks: string[]): WeeklyMetrics {
  const rows = new Map(weeks.map((week) => [week, { week, new_orgs: 0, new_activations: 0, resumers: 0, resumer_orgs: 0 }]));
  for (const org of input.orgs) {
    const row = rows.get(isoWeek(new Date(org.created_at)));
    if (row) row.new_orgs++;
  }
  for (const a of input.activations) {
    const row = rows.get(isoWeek(new Date(a.at)));
    if (row) row.new_activations++;
  }
  for (const row of rows.values()) {
    const inWeek = input.resumes.filter((r) => r.week === row.week);
    row.resumers = new Set(inWeek.map((r) => `${r.org_id}:${r.principal}`)).size;
    row.resumer_orgs = new Set(inWeek.map((r) => r.org_id)).size;
  }

  const paid_by_plan = Object.fromEntries(PAID_PLANS.map((p) => [p, 0]));
  const paid = new Set<string>();
  for (const org of input.orgs) {
    if (!PAID_PLANS.includes(org.plan)) continue;
    paid_by_plan[org.plan] = (paid_by_plan[org.plan] ?? 0) + 1;
    paid.add(org.id);
  }
  const activated = new Set(input.activations.map((a) => a.org_id));
  return {
    weeks: [...rows.values()],
    paid_by_plan,
    activated_orgs: activated.size,
    activated_paid: [...activated].filter((id) => paid.has(id)).length,
  };
}

export async function loadMetricsInput(kv: KvReader, weeks: string[], concurrency = 8): Promise<MetricsInput> {
  const read = async <T>(key: string): Promise<T | null> => {
    const raw = await kv.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  };
  const orgs = (await mapLimit(await kv.list('org:'), concurrency, (key) => read<MetricsInput['orgs'][number]>(key)))
    .filter((o): o is MetricsInput['orgs'][number] => o !== null);
  const activations = (await mapLimit(await kv.list('activation:'), concurrency, async (key) => {
    const a = await read<{ at: string }>(key);
    return a && { org_id: key.slice('activation:'.length), at: a.at };
  })).filter((a): a is MetricsInput['activations'][number] => a !== null);
  const resumes: MetricsInput['resumes'] = [];
  for (const week of weeks) {
    const prefix = `metric:xresume:${week}:`;
    for (const key of await kv.list(prefix)) {
      const rest = key.slice(prefix.length);
      const sep = rest.indexOf(':');
      resumes.push({ week, org_id: rest.slice(0, sep), principal: rest.slice(sep + 1) });
    }
  }
  return { orgs, activations, resumes };
}

export function formatMetrics(m: WeeklyMetrics): string {
  const head = ['week', 'new orgs', 'activations', 'xh resumers', 'xh orgs'];
  const body = m.weeks.map((r) => [r.week, r.new_orgs, r.new_activations, r.resumers, r.resumer_orgs].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
  const paid = Object.entries(m.paid_by_plan).map(([plan, n]) => `${plan} ${n}`).join(', ');
  return [
    line(head),
    ...body.map(line),
    '',
    `paid orgs now: ${paid}`,
    `activated orgs: ${m.activated_orgs}, of which paid: ${m.activated_paid}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const namespaceId = process.argv[2];
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!namespaceId || !accountId || !token) {
    console.error('usage: CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node apps/worker/scripts/weekly-metrics.ts <kv-namespace-id>');
    process.exit(1);
  }
  const weeks = lastIsoWeeks(new Date(), 8);
  const input = await loadMetricsInput(restKv(accountId, token, namespaceId), weeks);
  console.log(formatMetrics(weeklyMetrics(input, weeks)));
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('weekly-metrics.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
