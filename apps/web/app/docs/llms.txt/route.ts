import { docLinks, link } from '@/lib/llms';

export const dynamic = 'force-static';

export function GET() {
  const body = [
    '# AgentDrive Docs',
    '',
    '> Guides, concepts and API references for AgentDrive, the shared workspace that lets coding agents resume each other\'s sessions. Each link is the markdown version of the page.',
    '',
    '## Docs',
    '',
    ...docLinks(),
    '',
    '## Optional',
    '',
    link('Full docs in one file', '/llms-full.txt'),
    link('Site-wide index', '/llms.txt'),
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
