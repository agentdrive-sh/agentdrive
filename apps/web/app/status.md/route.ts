import { SITE_URL } from '@/components/seo/site';
import { frontmatter, LLMS_DIRECTIVE, markdownResponse } from '@/lib/llms';
import { ISSUE_TRACKER, serviceStatus, STATUS_SCOPE } from '../status/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const status = await serviceStatus();
  const body = [
    '# Service status',
    LLMS_DIRECTIVE,
    status.summary,
    `Checked ${status.checked}`,
    '## Current checks',
    status.checks.map(([name, value]) => `- ${name}: ${value}`).join('\n'),
    ...(status.version ? [`API package version: \`${status.version}\`.`] : []),
    STATUS_SCOPE,
    '## Need help?',
    'Email [hello@agentdrive.sh](mailto:hello@agentdrive.sh) with your operating system, CLI version and a sanitized error. Do not include API keys or private transcripts.',
    `This page runs on the same infrastructure as AgentDrive. During a wider outage, use [the public issue tracker](${ISSUE_TRACKER}) for updates and sanitized reports.`,
  ];
  const meta = frontmatter({ title: 'Service status', canonical: `${SITE_URL}/status` });
  const response = markdownResponse(meta + body.join('\n\n') + '\n');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
