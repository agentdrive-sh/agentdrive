// Recomputes each org's storage_bytes, embedding_count and agent_count from the
// KV records, for orgs whose content predates metering (and agent slots taken
// by keys revoked before a revoke freed them). Dry run by default.
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
//     node apps/worker/scripts/backfill-usage.ts <kv-namespace-id> [--apply]
//
// --apply merges only those three fields into usage:<org>. It races live
// writes the same way the counters themselves do (read-modify-write), so run
// it when traffic is quiet.

export interface KvReader {
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
}

export interface OrgCounts {
  storage_bytes: number;
  embedding_count: number;
  agent_count: number;
}

// Mirrors chunkCountFor in src/services/embeddings.ts (node cannot load the
// worker's .js-suffixed imports); the backfill test holds the two together.
function chunkCountFor(length: number): number {
  if (length <= 1500) return 1;
  return Math.min(16, Math.ceil((length - 1500) / 1300) + 1);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function getJson<T>(kv: KvReader, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

// Storage is every version's bytes of each live file; embeddings are the live
// content's chunks, as the worker meters them. Files of deleted workspaces or
// workspaces without an org are not counted.
export async function computeUsage(kv: KvReader, concurrency = 8): Promise<Map<string, OrgCounts>> {
  const counts = new Map<string, OrgCounts>();
  const of = (org: string) => {
    let c = counts.get(org);
    if (!c) counts.set(org, (c = { storage_bytes: 0, embedding_count: 0, agent_count: 0 }));
    return c;
  };

  for (const key of await kv.list('org:')) of(key.slice('org:'.length));

  const wsOrg = new Map<string, string>();
  await mapLimit(await kv.list('ws:'), concurrency, async (key) => {
    const ws = await getJson<{ id: string; org_id?: string }>(kv, key);
    if (ws?.org_id) wsOrg.set(key.slice('ws:'.length), ws.org_id);
  });

  await mapLimit(await kv.list('file:'), concurrency, async (key) => {
    const file = await getJson<{ id: string; workspace_id: string; size: number }>(kv, key);
    const org = file && wsOrg.get(file.workspace_id);
    if (!file || !org) return;
    const sizes = await mapLimit(await kv.list(`ver:${file.id}:`), concurrency, async (v) => (await getJson<{ size: number }>(kv, v))?.size ?? 0);
    const c = of(org);
    c.storage_bytes += sizes.reduce((a, b) => a + b, 0);
    c.embedding_count += chunkCountFor(file.size);
  });

  await mapLimit(await kv.list('org_agent:'), concurrency, async (key) => {
    const agent = await getJson<{ revoked_at?: string }>(kv, key);
    if (agent && !agent.revoked_at) of(key.split(':')[1]!).agent_count += 1;
  });

  return counts;
}

export function restKv(accountId: string, token: string, namespaceId: string) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      return res;
    }
  };
  return {
    async list(prefix: string): Promise<string[]> {
      const names: string[] = [];
      let cursor = '';
      do {
        const res = await call(`/keys?limit=1000&prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        const body = (await res.json()) as { success: boolean; errors?: unknown; result: Array<{ name: string }>; result_info?: { cursor?: string } };
        if (!body.success) throw new Error(`KV list ${prefix} failed: ${JSON.stringify(body.errors)}`);
        names.push(...body.result.map((k) => k.name));
        cursor = body.result_info?.cursor ?? '';
      } while (cursor);
      return names;
    },
    async get(key: string): Promise<string | null> {
      const res = await call(`/values/${encodeURIComponent(key)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`KV get ${key} failed: ${res.status}`);
      return res.text();
    },
    async put(key: string, value: string): Promise<void> {
      const res = await call(`/values/${encodeURIComponent(key)}`, { method: 'PUT', body: value, headers: { 'Content-Type': 'text/plain' } });
      if (!res.ok) throw new Error(`KV put ${key} failed: ${res.status} ${await res.text()}`);
    },
  };
}

function human(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${Number(bytes.toFixed(1))} ${units[i]}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const namespaceId = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!namespaceId || !accountId || !token) {
    console.error('usage: CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node apps/worker/scripts/backfill-usage.ts <kv-namespace-id> [--apply]');
    process.exit(1);
  }

  const kv = restKv(accountId, token, namespaceId);
  const counts = await computeUsage(kv);
  let changed = 0;
  for (const [org, computed] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    const current = (await getJson<Record<string, number>>(kv, `usage:${org}`)) ?? {};
    const same = (Object.keys(computed) as Array<keyof OrgCounts>).every((k) => current[k] === computed[k]);
    if (!same) changed++;
    console.log(
      `${org.slice(0, 10)}…  storage ${human(computed.storage_bytes)} (was ${human(current.storage_bytes ?? 0)})` +
        `  embeddings ${computed.embedding_count} (was ${current.embedding_count ?? 0})` +
        `  agents ${computed.agent_count} (was ${current.agent_count ?? 0})${same ? '' : '  *'}`,
    );
    if (apply && !same) await kv.put(`usage:${org}`, JSON.stringify({ ...current, ...computed }));
  }
  console.log(`\n${counts.size} orgs, ${changed} to change (*). ${apply ? 'Applied.' : 'Dry run: pass --apply to write.'}`);
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('backfill-usage.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
