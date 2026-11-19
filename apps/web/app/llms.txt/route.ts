import { PLAN_CATALOG } from '@agentdrive/shared';
import { plainText } from '@/components/marketing/faq';
import { docLinks } from '@/lib/docs-markdown';
import { link } from '@/lib/llms';
import { listPosts } from '@/lib/source';
import { COMPETITORS } from '../compare/data';
import { FACTS_DESCRIPTION, ONE_SENTENCE } from '../facts/facts';
import { GLOSSARY, GLOSSARY_DESCRIPTION } from '../glossary/glossary';
import { CAPTURE_HARNESSES, INSTALL_COMMAND } from '../integrations/data';
import { PAIRS } from '../resume/data';

export const dynamic = 'force-static';

export function GET() {
  const body = [
    '# AgentDrive',
    '',
    `> ${ONE_SENTENCE}`,
    '',
    'Hooks in each of those five agents sync sessions in the background: a detached `adrive sync` uploads the redacted transcript, plus files the agent wrote that git does not track, to `sessions/<project>/<harness>/<session>.md` in the workspace. Any of them can resume another\'s session through the `drive_sessions` and `drive_resume` MCP tools, `/agentdrive:resume` in Claude Code, or `adrive resume` in a shell. The MCP server exposes 22 tools (18 stable plus 4 experimental sandbox tools) for versioned, content-addressed files, semantic search, run logs and sharing. Cline, Zed and Continue use the workspace tools as plain MCP clients, without sync. Bring your own bucket (R2 or S3) on the Team plan. Private Workspace encrypts the transcripts and files the CLI syncs before upload (MCP writes are not encrypted); redaction is best-effort and not a security boundary.',
    '',
    `Install: \`${INSTALL_COMMAND}\``,
    '',
    'The page links below open Markdown directly. Every docs page is served as markdown at its URL plus `.md`, or at its normal URL with `Accept: text/markdown`. Start with the facts page for canonical answers, or read llms-full.txt for every docs page in one file.',
    '',
    '## Facts',
    '',
    link('AgentDrive facts', '/facts/index.md', FACTS_DESCRIPTION),
    link('Full documentation in one file', '/llms-full.txt', 'The facts page and every docs page as markdown'),
    '',
    '## Docs',
    '',
    ...docLinks(),
    link('Docs index', '/docs/llms.txt', 'This docs section on its own'),
    '',
    '## Agent discovery',
    '',
    link('Agent protocol endpoints', '/docs/mcp-tools.md', 'Public docs MCP, A2A, installable skills, catalogs and Web Bot Auth keys'),
    '',
    '## Product',
    '',
    link('Home', '/index.md', 'This index plus the homepage questions, served at the homepage URL for markdown clients'),
    link('Pricing', '/pricing.md', PLAN_CATALOG.map((p) => `${p.name} ${p.price} ${p.cadence}`).join('; ')),
    link('Integrations', '/integrations.md', 'Which agents sync sessions and which use the workspace tools'),
    ...CAPTURE_HARNESSES.map((i) => link(`${i.label} integration`, `/integrations/${i.platform}.md`, i.body)),
    link('Security', '/security.md', 'What AgentDrive syncs, what Private Workspace encrypts, and what stays managed when you bring your own bucket'),
    link('Service status', '/status.md'),
    link('About', '/about.md'),
    link('Contact', '/contact.md', 'Support, security, privacy and legal contacts'),
    '',
    '## Resume guides',
    '',
    link('Resume a session in another coding agent', '/resume.md'),
    ...PAIRS.map((p) => link(`Resume ${p.from.article} ${p.from.label} session in ${p.to.label}`, `/resume/${p.slug}.md`)),
    '',
    '## Compare',
    '',
    link('Compare', '/compare.md', 'How AgentDrive differs from the alternatives'),
    ...COMPETITORS.map((c) => link(`AgentDrive vs ${c.name}`, `/compare/${c.slug}.md`, c.tagline)),
    '',
    '## Glossary',
    '',
    link('Glossary', '/glossary.md', GLOSSARY_DESCRIPTION),
    ...GLOSSARY.map((t) => link(t.term, `/glossary/${t.slug}/index.md`, plainText(t.definition))),
    '',
    '## Blog',
    '',
    link('Blog', '/blog.md'),
    link('Blog index', '/blog/llms.txt', 'This blog section on its own'),
    ...listPosts().map((p) => link(p.data.title, `${p.url}/index.md`, p.data.description)),
    '',
    '## Optional',
    '',
    '- [Source code](https://github.com/agentdrive-sh/agentdrive): the AGPL server, web app, CLI, SDK, MCP server and Claude Code plugin, with AGENTS.md for coding agents',
    link('Manifesto', '/manifesto.md', 'Why AgentDrive was built: a shared artifact workspace with provenance for coding agents'),
    link('Legal', '/legal.md'),
    link('Terms', '/legal/terms.md'),
    link('Privacy', '/legal/privacy.md'),
    link('Data Processing Agreement', '/legal/dpa.md'),
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
