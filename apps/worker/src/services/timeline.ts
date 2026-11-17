import type { ActivityEvent, Paginated } from '@agentdrive/shared';
import type { Env } from '../env.js';

// Cross-workspace org timeline. Scan-at-read per CEO plan D13 — rebuild as
// an org-keyed index when first paying customer hits the scale. Hard
// LIMIT_EVENTS=1000 cap per E6; clients page via `?since=`.

export const TIMELINE_HARD_LIMIT = 1000;
const KV_LIST_PAGE = 1000;

interface ListWorkspacesOpts {
  orgId: string;
  cursor?: string;
}

async function listWorkspaceIdsAll(env: Env, orgId: string): Promise<string[]> {
  // Walk all pages of `idx:org_workspaces:<org_id>:*` — workspaces per org
  // are bounded by plan quota, well under 10k for any v1 customer, so
  // unbounded iteration is fine here.
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const list = await env.KV.list({
      prefix: `idx:org_workspaces:${orgId}:`,
      limit: KV_LIST_PAGE,
      cursor,
    });
    for (const k of list.keys) {
      const id = k.name.slice(`idx:org_workspaces:${orgId}:`.length);
      if (id) out.push(id);
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out;
}

async function readWorkspaceActivity(
  env: Env,
  workspaceId: string,
  sinceIso: string | undefined,
  perWorkspaceCap: number,
): Promise<ActivityEvent[]> {
  // Activity keys are `activity:<wid>:<invertedTimestamp>:<eventId>` — newer
  // events sort first. We page-list until we exhaust the prefix OR hit the
  // per-workspace cap OR hit the first event older than `since`.
  const collected: ActivityEvent[] = [];
  let cursor: string | undefined;
  while (collected.length < perWorkspaceCap) {
    const list = await env.KV.list({
      prefix: `activity:${workspaceId}:`,
      limit: Math.min(KV_LIST_PAGE, perWorkspaceCap - collected.length),
      cursor,
    });
    if (list.keys.length === 0) break;
    const events = await Promise.all(
      list.keys.map((k) => env.KV.get<ActivityEvent>(k.name, 'json')),
    );

    let hitFloor = false;
    for (const ev of events) {
      if (!ev) continue;
      if (sinceIso && ev.created_at <= sinceIso) {
        hitFloor = true;
        break;
      }
      collected.push(ev);
      if (collected.length >= perWorkspaceCap) break;
    }
    if (hitFloor || list.list_complete) break;
    cursor = list.cursor;
  }
  return collected;
}

export interface OrgTimelineOptions {
  orgId: string;
  since?: string;
  limit?: number;
}

export async function getOrgTimeline(
  env: Env,
  opts: OrgTimelineOptions,
): Promise<Paginated<ActivityEvent>> {
  const limit = Math.min(opts.limit ?? 200, TIMELINE_HARD_LIMIT);

  const workspaceIds = await listWorkspaceIdsAll(env, opts.orgId);
  if (workspaceIds.length === 0) return { items: [], cursor: null };

  // Cap per-workspace fetch so a single noisy workspace can't starve the
  // budget. limit*2 + small floor gives newer events from other workspaces
  // a chance after the cross-workspace merge.
  const perWorkspaceCap = Math.max(50, limit * 2);
  const perWorkspace = await Promise.all(
    workspaceIds.map((wid) => readWorkspaceActivity(env, wid, opts.since, perWorkspaceCap)),
  );

  const merged: ActivityEvent[] = [];
  for (const events of perWorkspace) merged.push(...events);
  merged.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const items = merged.slice(0, limit);
  // Scan-at-read has no opaque cursor — clients page via `?since=<oldest>`
  // when they want more. Return null cursor so the contract is clear.
  return { items, cursor: null };
}
