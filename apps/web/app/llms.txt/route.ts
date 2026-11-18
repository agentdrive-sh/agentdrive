import { PLAN_CATALOG } from '@agentdrive/shared';
import { listPosts, source } from '@/lib/source';
import { COMPETITORS } from '../compare/data';
import { FACTS_DESCRIPTION, ONE_SENTENCE } from '../facts/facts';
import { CAPTURE_HARNESSES, INSTALL_COMMAND } from '../integrations/data';

export const dynamic = 'force-static';

const SITE = 'https://agentdrive.sh';

function link(title: string, path: string, description?: string): string {
  return `- [${title}](${SITE}${path})${description ? `: ${description}` : ''}`;
}

export function GET() {
  const body = [
    '# AgentDrive',
    '',
    `> ${ONE_SENTENCE}`,
    '',
    'Hooks in each of those five agents sync sessions in the background: a detached `adrive sync` uploads the redacted transcript, plus files the agent wrote that git does not track, to `sessions/<project>/<harness>/<session>.md` in the workspace. With artifact sync on, `adrive watch` also uploads every file under a folder except .gitignore and .adriveignore matches. Any of them can resume another\'s session through the `drive_sessions` and `drive_resume` MCP tools, `/agentdrive:resume` in Claude Code, or `adrive resume` in a shell. The MCP server exposes 22 tools (18 stable plus 4 experimental sandbox tools) for versioned, content-addressed files, semantic search, run logs and sharing. Cline, Zed and Continue use the workspace tools as plain MCP clients, without sync. Bring your own bucket (R2 or S3) on the Team plan. Private Workspace encrypts content on the client; redaction is best-effort and not a security boundary.',
    '',
    `Install: \`${INSTALL_COMMAND}\``,
    '',
    'Links below point to markdown versions where one exists. Start with the facts page for canonical answers, or read llms-full.txt for every docs page in one file.',
    '',
    '## Facts',
    '',
    link('AgentDrive facts', '/facts/index.md', FACTS_DESCRIPTION),
    link('Full documentation in one file', '/llms-full.txt', 'The facts page and every docs page as markdown'),
    '',
    '## Docs',
    '',
    ...source.getPages().map((p) => link(p.data.title, `/llms.mdx${p.url}`, p.data.description)),
    '',
    '## Product',
    '',
    link('Pricing', '/pricing', PLAN_CATALOG.map((p) => `${p.name} ${p.price} ${p.cadence}`).join('; ')),
    link('Integrations', '/integrations', 'Which agents sync sessions and which use the workspace tools'),
    ...CAPTURE_HARNESSES.map((i) => link(`${i.label} integration`, `/integrations/${i.platform}`, i.body)),
    link('Security', '/security', 'What AgentDrive syncs, what Private Workspace encrypts, and what stays managed when you bring your own bucket'),
    '',
    '## Compare',
    '',
    ...COMPETITORS.map((c) => link(`AgentDrive vs ${c.name}`, `/compare/${c.slug}`, c.tagline)),
    '',
    '## Blog',
    '',
    ...listPosts().map((p) => link(p.data.title, `${p.url}/index.md`, p.data.description)),
    '',
    '## Optional',
    '',
    link('Manifesto', '/manifesto', 'Why AgentDrive was built: a shared artifact workspace with provenance for coding agents'),
    link('Terms', '/legal/terms'),
    link('Privacy', '/legal/privacy'),
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
