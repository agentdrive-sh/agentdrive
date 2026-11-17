import { PLAN_CATALOG } from '@agentdrive/shared';
import { listPosts, source } from '@/lib/source';
import { COMPETITORS } from '../compare/data';
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
    "> The shared workspace that lets Claude Code, Codex, OpenCode, Cursor, and Antigravity pick up each other's sessions, with provenance on every artifact and portable storage.",
    '',
    'Hooks in each of those five agents sync sessions in the background: a detached `adrive sync` uploads the redacted transcript, plus files the agent wrote that git does not track, to `sessions/<project>/<harness>/<session>.md` in the workspace. With artifact sync on, `adrive watch` also uploads every file under a folder except .gitignore and .adriveignore matches. Any of them can resume another\'s session through the `drive_sessions` and `drive_resume` MCP tools, `/agentdrive:resume` in Claude Code, or `adrive resume` in a shell. The MCP server exposes 22 tools (18 stable plus 4 experimental sandbox tools) for versioned, content-addressed files, semantic search, run logs and sharing. Cline, Zed and Continue use the workspace tools as plain MCP clients, without sync. Bring your own bucket (R2 or S3) on the Team plan. Private Workspace encrypts content on the client; redaction is best-effort and not a security boundary.',
    '',
    `Install: \`${INSTALL_COMMAND}\``,
    '',
    '## Docs',
    '',
    ...source.getPages().map((p) => link(p.data.title, p.url, p.data.description)),
    '',
    '## Product',
    '',
    link('Pricing', '/pricing', PLAN_CATALOG.map((p) => `${p.name} ${p.price} ${p.cadence}`).join('; ')),
    link('Integrations', '/integrations', 'Which agents sync sessions and which use the workspace tools'),
    ...CAPTURE_HARNESSES.map((i) => link(`${i.label} integration`, `/integrations/${i.platform}`)),
    link('Security', '/security'),
    '',
    '## Compare',
    '',
    ...COMPETITORS.map((c) => link(`AgentDrive vs ${c.name}`, `/compare/${c.slug}`, c.tagline)),
    '',
    '## Optional',
    '',
    ...listPosts().map((p) => link(p.data.title, p.url, p.data.description)),
    link('Manifesto', '/manifesto'),
    link('Terms', '/legal/terms'),
    link('Privacy', '/legal/privacy'),
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
