import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';

export const metadata: Metadata = {
  title: 'Service status',
  description: 'Current API and storage checks for AgentDrive, with support contacts.',
  alternates: { canonical: '/status' },
};

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

export default async function StatusPage() {
  await connection();
  const health = await readHealth();
  const label = (state?: string) => state === 'ok' ? 'Responding' : state === 'unavailable' ? 'Unavailable' : 'Not checked';
  return (
    <MarketingPageShell screenLabel="marketing/status">
      <PageHero title="Service status"
        lede={health?.status === 'ok' ? 'The API is responding. Storage results are listed below.' : 'We could not confirm that all core services are responding.'}
        meta={`Checked ${new Date().toISOString()}`} />
      <ProseSection>
        <h2>Current checks</h2>
        <dl>
          <dt>API</dt><dd>{health ? label(health.status) : 'Could not reach the API'}</dd>
          <dt>Workspace metadata (KV)</dt><dd>{label(health?.checks?.kv)}</dd>
          <dt>File storage (R2)</dt><dd>{label(health?.checks?.r2)}</dd>
        </dl>
        {health?.version && <p>API package version: <code>{health.version}</code>.</p>}
        <p>These are current read checks, not an uptime history. Email delivery, sign-in providers, payments, semantic indexing and customer-owned buckets are not independently tested by this page.</p>
        <h2>Need help?</h2>
        <p>Email <a href="mailto:hello@agentdrive.sh">hello@agentdrive.sh</a> with your operating system, CLI version and a sanitized error. Do not include API keys or private transcripts.</p>
        <p>This page runs on the same infrastructure as AgentDrive. During a wider outage, use <a href="https://github.com/agentdrive-sh/agentdrive-mcp/issues">the public issue tracker</a> for updates and sanitized reports.</p>
      </ProseSection>
    </MarketingPageShell>
  );
}
