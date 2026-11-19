import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Fragment } from 'react';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { serviceStatus, STATUS_SCOPE, ISSUE_TRACKER } from './health';
import { pageMetadata } from '@/components/seo/site';

export const metadata: Metadata = pageMetadata(
  'Service status',
  'Current read checks for the AgentDrive API, workspace metadata and file storage, what this page does not test, and how to reach support during an outage.',
  '/status',
);

export default async function StatusPage() {
  await connection();
  const status = await serviceStatus();
  return (
    <MarketingPageShell screenLabel="marketing/status">
      <PageHero title="Service status"
        lede={status.summary}
        meta={`Checked ${status.checked}`} />
      <ProseSection>
        <h2>Current checks</h2>
        <dl>
          {status.checks.map(([name, value]) => <Fragment key={name}><dt>{name}</dt><dd>{value}</dd></Fragment>)}
        </dl>
        {status.version && <p>API package version: <code>{status.version}</code>.</p>}
        <p>{STATUS_SCOPE}</p>
        <h2>Need help?</h2>
        <p>Email <a href="mailto:hello@agentdrive.sh">hello@agentdrive.sh</a> with your operating system, CLI version and a sanitized error. Do not include API keys or private transcripts.</p>
        <p>This page runs on the same infrastructure as AgentDrive. During a wider outage, use <a href={ISSUE_TRACKER}>the public issue tracker</a> for updates and sanitized reports.</p>
      </ProseSection>
    </MarketingPageShell>
  );
}
