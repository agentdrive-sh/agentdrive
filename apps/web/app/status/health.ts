import { getCloudflareContext } from '@opennextjs/cloudflare';

interface Health {
  status?: string;
  version?: string;
  checks?: { kv?: string; r2?: string };
}

async function readHealth(): Promise<Health | null> {
  const url = `${process.env.NEXT_PUBLIC_API_URL || 'https://app.agentdrive.sh'}/v1/health`;
  const init = { cache: 'no-store' as const, signal: AbortSignal.timeout(5000) };
  try {
    let api: { fetch(input: string, init: RequestInit): Promise<Response> } | undefined;
    try {
      api = (getCloudflareContext().env as { API?: typeof api }).API;
    } catch {
      // Local Next runs reach only the explicitly configured API origin.
    }
    const response = await (api ? api.fetch(url, init) : fetch(url, init));
    if (response.status !== 200 && response.status !== 503) return null;
    return await response.json() as Health;
  } catch {
    return null;
  }
}

export const STATUS_SCOPE = 'These are current read checks, not an uptime history. Email delivery, sign-in providers, payments, semantic indexing and customer-owned buckets are not independently tested by this page.';
export const ISSUE_TRACKER = 'https://github.com/agentdrive-sh/agentdrive-mcp/issues';

export async function serviceStatus() {
  const health = await readHealth();
  const label = (state?: string) => state === 'ok' ? 'Responding' : state === 'unavailable' ? 'Unavailable' : 'Not checked';
  return {
    summary: health?.status === 'ok' ? 'The API is responding. Storage results are listed below.' : 'We could not confirm that all core services are responding.',
    checked: new Date().toISOString(),
    version: health?.version,
    checks: [
      ['API', health ? label(health.status) : 'Could not reach the API'],
      ['Workspace metadata (KV)', label(health?.checks?.kv)],
      ['File storage (R2)', label(health?.checks?.r2)],
    ],
  };
}
