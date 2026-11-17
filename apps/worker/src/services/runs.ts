import type { AgentRun, Paginated } from '@agentdrive/shared';
import type { Env } from '../env.js';

export const DEFAULT_PAGE_SIZE = 50;

// `created_at` is folded into the index key as an inverted timestamp so newest
// runs sort first within a (org, agent) pair without a separate sort pass.
function invertedTs(createdAt: number): string {
  const inverted = 9_999_999_999_999 - createdAt;
  return inverted.toString().padStart(13, '0');
}

function projectOf(run: AgentRun): string | undefined {
  const project = run.metadata?.project;
  return typeof project === 'string' ? project : undefined;
}

// Synced sessions report when the agent was last active; server write time is
// only a fallback, since a backfill would otherwise float old sessions to the top.
function activityTs(run: AgentRun): number {
  const ts = run.metadata?.last_activity_at;
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : run.updated_at ?? run.created_at;
}

function projectIndexKey(run: AgentRun, project: string): string {
  return `idx:project_runs:${run.org_id}:${project}:${invertedTs(activityTs(run))}:${run.run_id}`;
}

function indexKeys(run: AgentRun): string[] {
  const keys = [`idx:agent_runs:${run.agent_id}:${invertedTs(run.created_at)}:${run.run_id}`];

  // Artifact → run reverse index. Lets us answer "which runs touched this
  // file?" with a single prefix scan, no per-run scan. We index every file id
  // referenced or produced by the run.
  if (run.workspace_id) {
    const fileIds = new Set<string>([...run.artifacts_referenced, ...run.artifacts_produced]);
    for (const fid of fileIds) {
      keys.push(`idx:artifact_runs:${run.workspace_id}:${fid}:${invertedTs(run.created_at)}:${run.run_id}`);
    }
  }

  const project = projectOf(run);
  if (project) keys.push(projectIndexKey(run, project));
  return keys;
}

// `previous` is the stored record being replaced on upsert; its index keys
// that no longer apply are dropped so each run appears once per index.
export async function putRun(env: Env, run: AgentRun, previous?: AgentRun | null): Promise<void> {
  await env.KV.put(`run:${run.org_id}:${run.run_id}`, JSON.stringify(run));
  const next = indexKeys(run);
  const stale = previous ? indexKeys(previous).filter((k) => !next.includes(k)) : [];
  await Promise.all([
    ...next.map((k) => env.KV.put(k, run.run_id)),
    ...stale.map((k) => env.KV.delete(k)),
  ]);
}

export async function getRun(env: Env, orgId: string, runId: string): Promise<AgentRun | null> {
  return env.KV.get<AgentRun>(`run:${orgId}:${runId}`, 'json');
}

export async function listRunsByAgent(
  env: Env,
  orgId: string,
  agentId: string,
  cursor?: string,
): Promise<Paginated<AgentRun>> {
  const list = await env.KV.list({
    prefix: `idx:agent_runs:${agentId}:`,
    limit: DEFAULT_PAGE_SIZE,
    cursor,
  });

  // Two-stage parallel fetch eliminates the prior 1+2N sequential round-trip
  // pattern. Per page worst-case is now ~2 round-trips: one batch of N reads
  // for the run-id pointers, one batch for the AgentRun bodies.
  const runIds = await Promise.all(list.keys.map((k) => env.KV.get(k.name)));
  const runs = await Promise.all(
    runIds
      .filter((id): id is string => Boolean(id))
      .map((id) => env.KV.get<AgentRun>(`run:${orgId}:${id}`, 'json')),
  );

  // Drop cross-org leakage: idx is per-agent, but an agent can only ever
  // belong to one org so this is defensive.
  const items = runs.filter((r): r is AgentRun => r !== null && r.org_id === orgId);

  return { items, cursor: list.list_complete ? null : list.cursor };
}

export async function listRunsByArtifact(
  env: Env,
  orgId: string,
  workspaceId: string,
  fileId: string,
  cursor?: string,
): Promise<Paginated<AgentRun>> {
  const list = await env.KV.list({
    prefix: `idx:artifact_runs:${workspaceId}:${fileId}:`,
    limit: DEFAULT_PAGE_SIZE,
    cursor,
  });

  const runIds = await Promise.all(list.keys.map((k) => env.KV.get(k.name)));
  const runs = await Promise.all(
    runIds
      .filter((id): id is string => Boolean(id))
      .map((id) => env.KV.get<AgentRun>(`run:${orgId}:${id}`, 'json')),
  );

  const items = runs.filter((r): r is AgentRun => r !== null && r.org_id === orgId);

  return { items, cursor: list.list_complete ? null : list.cursor };
}

export async function listRunsByProject(
  env: Env,
  orgId: string,
  project: string,
  limit: number,
  cursor?: string,
): Promise<Paginated<AgentRun>> {
  const list = await env.KV.list({ prefix: `idx:project_runs:${orgId}:${project}:`, limit, cursor });

  const runs = await Promise.all(
    list.keys.map(async (k) => {
      const id = await env.KV.get(k.name);
      if (!id) return null;
      const run = await env.KV.get<AgentRun>(`run:${orgId}:${id}`, 'json');
      // KV is eventually consistent, so a superseded index key can outlive its
      // delete; only the key matching the run's current state counts.
      return run && run.org_id === orgId && projectIndexKey(run, project) === k.name ? run : null;
    }),
  );

  return {
    items: runs.filter((r): r is AgentRun => r !== null),
    cursor: list.list_complete ? null : list.cursor,
  };
}
