import { PLAN_CATALOG, PLAN_QUOTAS, TEAM_SEATS, catalogIdForPlan, type CatalogPlanId, type OrgMeta, type Plan, type PlanQuota } from '@agentdrive/shared';
import type { Context } from 'hono';
import type { Env } from '../env.js';
import { StorageService, type Usage } from './storage.js';
import { selfHosted } from '../lib/self-hosted.js';

// Plan usage against quota, the wording every surface shows (API, MCP, CLI,
// hooks, web), and the one refusal shape for a write that would exceed it.

// resume_count is counted from month markers on read, never stored in Usage.
export type UsageMetric = keyof Usage | 'resume_count';
export type UsageLevel = 'ok' | 'warn80' | 'warn90' | 'warn99' | 'paused';

export interface MetricStatus {
  used: number;
  limit: number;
  pct: number;
  level: UsageLevel;
}

export interface UsageStatus {
  plan: Plan;
  plan_name: string;
  level: UsageLevel;
  metric?: UsageMetric;
  message?: string;
  metrics: Record<keyof Usage, MetricStatus> & { resume_count?: MetricStatus };
  next_plan: CatalogPlanId;
  upgrade_url: string;
}

export interface UsageWarning {
  metric: UsageMetric;
  level: UsageLevel;
  message: string;
  upgrade_url: string;
}

export interface PlanLimitBody {
  success: false;
  error: string;
  code: 'plan_limit';
  metric: UsageMetric;
  used: number;
  limit: number;
  plan: Plan;
  upgrade_url: string;
}

const QUOTA_KEY: Record<keyof Usage, Exclude<keyof PlanQuota, 'max_resumes_month'>> = {
  storage_bytes: 'storage_bytes',
  embedding_count: 'embedding_count',
  agent_count: 'max_agents',
  workspace_count: 'max_workspaces',
  member_count: 'max_human_seats',
};

// Consumables only warn, on every plan: nothing pauses at 100%. Free allows 1
// workspace and 1 seat, so a solo account sits at 100% of those; the count caps
// bite only when adding one.
const CONSUMABLES: UsageMetric[] = ['storage_bytes', 'embedding_count'];
const STORED: Array<keyof Usage> = ['storage_bytes', 'embedding_count', 'agent_count', 'workspace_count', 'member_count'];

const LABEL: Record<UsageMetric, { noun: string; plural: boolean; blocked: string }> = {
  storage_bytes: { noun: 'storage', plural: false, blocked: "New files and sessions won't sync" },
  embedding_count: { noun: 'embeddings', plural: true, blocked: "New files and sessions won't sync" },
  agent_count: { noun: 'agents', plural: true, blocked: "New agent keys can't be created" },
  workspace_count: { noun: 'workspaces', plural: true, blocked: "New workspaces can't be created" },
  member_count: { noun: 'seats', plural: true, blocked: "New members can't join" },
  resume_count: { noun: 'cross-agent resumes this month', plural: true, blocked: "New sessions can't be resumed in another agent" },
};

const RANK: UsageLevel[] = ['ok', 'warn80', 'warn90', 'warn99', 'paused'];
const NEXT_PLAN: Record<Plan, CatalogPlanId> = { trial: 'pro', starter: 'pro', pro: 'team', team: 'enterprise' };
const ENTERPRISE_URL = 'mailto:hello@agentdrive.sh?subject=AgentDrive%20Enterprise';

function levelFor(used: number, limit: number, pausesAtLimit: boolean): UsageLevel {
  const ratio = limit > 0 ? used / limit : 1;
  if (ratio >= 1) return pausesAtLimit ? 'paused' : 'warn99';
  if (ratio >= 0.99) return 'warn99';
  if (ratio >= 0.9) return 'warn90';
  if (ratio >= 0.8) return 'warn80';
  return 'ok';
}

function trim(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

// Both numbers in the limit's unit: "0.92 of 1 GB", "9.2K of 10K", "3 of 3".
function amounts(metric: UsageMetric, used: number, limit: number): string {
  if (metric === 'storage_bytes') {
    const [div, unit] = limit >= 1024 ** 3 ? [1024 ** 3, 'GB'] : [1024 ** 2, 'MB'];
    return `${trim(used / div, 2)} of ${trim(limit / div, 2)} ${unit}`;
  }
  if (metric === 'embedding_count' && limit >= 1000) {
    const [div, unit] = limit >= 1_000_000 ? [1_000_000, 'M'] : [1000, 'K'];
    return `${trim(used / div, 1)}${unit} of ${trim(limit / div, 1)}${unit}`;
  }
  return `${used} of ${limit}`;
}

function planName(id: CatalogPlanId): string {
  return PLAN_CATALOG.find((p) => p.id === id)?.name ?? id;
}

function metricMessage(status: Omit<UsageStatus, 'level' | 'metric' | 'message'>, metric: UsageMetric): string {
  const { used, limit, pct, level } = status.metrics[metric]!;
  const { noun, plural, blocked } = LABEL[metric];
  const of = amounts(metric, used, limit);
  if (level === 'paused') {
    return `AgentDrive: your ${status.plan_name} plan's ${noun} ${plural ? 'are' : 'is'} full (${of}). ${blocked} until you upgrade: ${status.upgrade_url}.`;
  }
  return `AgentDrive: your ${status.plan_name} plan has used ${pct}% of its ${noun} (${of}). Upgrade to ${planName(status.next_plan)}: ${status.upgrade_url}`;
}

// Team's seat cap is what the org bought, never below the plan minimum: a
// portal plan switch or quantity edit can leave a Team subscription at 1.
export function orgQuota(org: Pick<OrgMeta, 'plan' | 'seats'>): PlanQuota {
  const quota = PLAN_QUOTAS[org.plan];
  return org.plan === 'team' && org.seats ? { ...quota, max_human_seats: Math.max(org.seats, TEAM_SEATS.min) } : quota;
}

function metricStatus(used: number, limit: number, level: UsageLevel): MetricStatus {
  const pct = Math.round(limit > 0 ? (used / limit) * 100 : 100);
  // Below a limit, never round up to a "100%" that reads as full.
  return { used, limit, pct: used >= limit ? pct : Math.min(pct, 99), level };
}

// Left out of usageStatus when the month's count is unknown. The hard block at
// the limit applies only while the meter is enforced.
export interface ResumeUsage {
  count: number;
  enforced: boolean;
}

export function resumeEnforced(env: Pick<Env, 'RESUME_METER_ENFORCE'>): boolean {
  return env.RESUME_METER_ENFORCE === 'true';
}

export function usageStatus(plan: Plan, usage: Usage, siteUrl: string, quota = PLAN_QUOTAS[plan], resumes?: ResumeUsage): UsageStatus {
  const metrics = {} as UsageStatus['metrics'];
  for (const metric of STORED) {
    const used = usage[metric] ?? 0;
    const limit = quota[QUOTA_KEY[metric]];
    metrics[metric] = metricStatus(used, limit, levelFor(used, limit, !CONSUMABLES.includes(metric)));
  }
  const resumeLimit = quota.max_resumes_month;
  // Unlimited is left out, not sent as null: CLI 1.3.2 formats every metric's limit as a number.
  if (resumes && resumeLimit !== null) {
    metrics.resume_count = metricStatus(resumes.count, resumeLimit, levelFor(resumes.count, resumeLimit, resumes.enforced));
  }
  const next_plan = NEXT_PLAN[plan];
  const base = {
    plan,
    plan_name: planName(catalogIdForPlan(plan)),
    metrics,
    next_plan,
    upgrade_url: next_plan === 'enterprise' ? ENTERPRISE_URL : `${siteUrl}/billing/upgrade?plan=${next_plan}`,
  };
  const ranked: UsageMetric[] = metrics.resume_count ? [...CONSUMABLES, 'resume_count'] : CONSUMABLES;
  const worst = ranked.reduce((a, b) => (RANK.indexOf(metrics[b]!.level) > RANK.indexOf(metrics[a]!.level) ? b : a));
  const level = metrics[worst]!.level;
  if (level === 'ok') return { ...base, level };
  return { ...base, level, metric: worst, message: metricMessage(base, worst) };
}

// Null on a self-hosted instance, so no usage warning or plan refusal is built from it.
export async function orgUsageStatus(env: Env, orgId: string): Promise<UsageStatus | null> {
  if (selfHosted(env)) return null;
  const s = new StorageService(env.KV, env.R2);
  const [org, usage] = await Promise.all([s.getOrg(orgId), s.getUsage(orgId)]);
  return org ? usageStatus(org.plan, usage, env.SITE_URL, orgQuota(org)) : null;
}

export function usageWarning(status: UsageStatus | null): UsageWarning | undefined {
  return status?.metric ? metricWarning(status, status.metric) : undefined;
}

export function metricWarning(status: UsageStatus, metric: UsageMetric): UsageWarning | undefined {
  const level = status.metrics[metric]?.level;
  if (!level || level === 'ok') return undefined;
  return { metric, level, message: metricMessage(status, metric), upgrade_url: status.upgrade_url };
}

export function planLimitBody(status: UsageStatus, metric: UsageMetric): PlanLimitBody {
  const { used, limit } = status.metrics[metric]!;
  return {
    success: false,
    error: metricMessage(status, metric),
    code: 'plan_limit',
    metric,
    used,
    limit,
    plan: status.plan,
    upgrade_url: status.upgrade_url,
  };
}

// The refusal for a write that would add to any of `metrics` while one is at
// or over its limit, or null when the write may go ahead. Reads the plan
// fresh, so an upgrade takes effect on the next request.
export async function planLimitFor(env: Env, orgId: string, ...metrics: Array<keyof Usage>): Promise<PlanLimitBody | null> {
  const status = await orgUsageStatus(env, orgId);
  if (!status) return null;
  const metric = metrics.find((m) => status.metrics[m].level === 'paused');
  return metric ? planLimitBody(status, metric) : null;
}

export function planLimitError(c: Context, refusal: PlanLimitBody): Response {
  return c.json(refusal, 402);
}
