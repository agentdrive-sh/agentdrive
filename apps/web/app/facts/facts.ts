import { ALL_PLANS_INCLUDE, PLAN_CATALOG } from '@agentdrive/shared';
import { formatPostDate } from '@/lib/date';
import { faqMarkdown, type FaqItem } from '@/components/marketing/faq';
import cli from '../../../../packages/cli/package.json';
import mcp from '../../../../packages/mcp-server/package.json';
import sdk from '../../../../packages/sdk-ts/package.json';
import { CAPTURE_HARNESSES, INSTALL_COMMAND, MCP_CLIENTS } from '../integrations/data';

// Bump when a fact below changes; it is shown on the page and in every mirror.
export const FACTS_AS_OF = '2026-11-18';

export const FACTS_LEDE = 'The canonical facts about AgentDrive, for people and for the tools that answer questions about it.';

export const FACTS_DESCRIPTION =
  'Canonical AgentDrive facts: what it is, who makes it, supported agents, resume, local mode, pricing, license, self-hosting, privacy and official links.';

export const list = (items: string[]) => `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
export const lower = (s: string) => s[0].toLowerCase() + s.slice(1);

export const SYNC_AGENTS = list(CAPTURE_HARNESSES.map((h) => h.label));
export const MCP_ONLY_AGENTS = list(MCP_CLIENTS.map((h) => h.label));

export const ONE_SENTENCE = `AgentDrive is a shared workspace for coding agents that syncs each session from ${SYNC_AGENTS} in the background, so any of those agents can resume work another one started, with provenance on every artifact and storage you can move to your own bucket.`;

export const FACTS: FaqItem[] = [
  {
    q: 'What is AgentDrive?',
    a: [
      ONE_SENTENCE,
      'When you hit a usage limit in one agent, or want a different agent for the next step, open the other agent in the same project directory and resume. It gets a handoff brief with the goal, the files touched and the recent turns, so you do not explain the task again. The MCP server exposes 22 tools (18 stable plus 4 experimental sandbox tools) for versioned, content-addressed files, semantic search, run logs, sharing and session resume.',
    ],
  },
  {
    q: 'Who makes AgentDrive?',
    a: [
      'AgentDrive is made by Roushan Inc, which operates the hosted service at agentdrive.sh, owns the AgentDrive name and logo as trademarks and holds the copyright in the code; its founder, Rakesh Roushan, builds the product and writes the AgentDrive blog and manifesto.',
      'Licensing, trademark and commercial-license questions go to licensing@agentdrive.sh. Everything else goes to hello@agentdrive.sh.',
    ],
  },
  {
    q: 'Which coding agents does AgentDrive support?',
    a: [
      `AgentDrive syncs and resumes sessions in ${SYNC_AGENTS}, while ${MCP_ONLY_AGENTS} connect as plain MCP clients: they can read and write the workspace and resume another agent's session through the MCP tools, but their own sessions are not synced.`,
      `Claude Code is set up through its plugin: \`/plugin marketplace add agentdrive-sh/agentdrive-mcp\`, then \`/plugin install agentdrive@agentdrive\`. The other agents are wired by the installer, \`${INSTALL_COMMAND}\`, which installs \`@adrive/cli\` and runs \`adrive init\`; if the \`claude\` command is on your PATH, it also installs the Claude Code plugin. One Antigravity setup covers the \`agy\` CLI, the Antigravity app and the IDE.`,
    ],
  },
  {
    q: 'How does cross-agent resume work?',
    a: [
      'Each supported agent runs `adrive hook` on session events, which starts a detached `adrive sync` that redacts the transcript and uploads it to `sessions/<project>/<harness>/<session-id>.md` in your workspace; another agent opened in the same project then loads that session as a handoff brief.',
      'You can resume three ways: the `drive_sessions` and `drive_resume` MCP tools from any connected agent; slash commands (`/agentdrive:resume` in Claude Code, `/agentdrive-resume` in OpenCode and Cursor, and an `agentdrive-resume` skill in Antigravity); or `adrive resume` in a shell. Codex has no AgentDrive command: ask it in plain words, or start the request with `$agentdrive` to call the AgentDrive skill. MCP resume prefers a recent session in this project from a different agent.',
      'The hook exits right away, so it never blocks the agent. Turn-end events re-sync a session at most every two minutes, and session-end and compaction events always sync. Sessions are grouped by a project key, the normalized git remote when there is one, so every agent files the same repo in the same place.',
    ],
  },
  {
    q: 'What does the handoff brief contain?',
    a: [
      "The handoff brief contains the source session's metadata, the goal taken from its first user message, the files touched with the ids of their uploaded copies, and as many recent turns as fit in a budget of 12,000 characters by default, which can be raised to 50,000.",
      'The receiving agent is told to check file state on disk before relying on the brief. Set the budget with `max_chars` on `drive_resume` or `--max-chars` on `adrive resume`.',
    ],
  },
  {
    q: 'Can I use AgentDrive without an account?',
    a: [
      "Yes: in local mode the `adrive` CLI reads each agent's own transcripts on disk and builds the handoff brief on your machine, so nothing is uploaded, no network is needed, and local resumes are unlimited and do not count toward the Free plan's monthly cloud resume limit.",
      'Run `adrive init --local` to wire the hooks without signing in, then `adrive resume --list` and `adrive resume` in your project directory. Claude Code, Codex and OpenCode need no setup. Cursor and Antigravity need the hooks from `adrive init --local`, because their transcripts do not record the project directory. The MCP server\'s `drive_sessions` and `drive_resume` tools also work without an API key.',
      'Local mode stays on one machine: sessions do not sync to your other machines, cannot be shared with teammates, are not available to hosted MCP in claude.ai or ChatGPT, and nothing is recorded in the provenance timeline.',
    ],
  },
  {
    q: 'How much does AgentDrive cost?',
    a: [
      `AgentDrive has ${PLAN_CATALOG.length} plans, ${list(PLAN_CATALOG.map((p) => `${p.name} (${p.price}, ${p.cadence})`))}, and Free has no expiry, needs no card and runs the whole sync and resume loop on one machine.`,
      ...PLAN_CATALOG.map((p) => `${p.name}: ${p.features.map(lower).join('; ')}.`),
      `Every plan includes ${list(ALL_PLANS_INCLUDE.map(lower))}.`,
      `Seat, workspace and agent limits are enforced when you add one. Storage is a soft limit: warnings start at 80%, and syncing never pauses. A cloud resume counts once per session and reading agent each month, so re-opening a session in the agent that already resumed it that month does not count again.`,
    ],
  },
  {
    q: 'How is AgentDrive licensed?',
    a: [
      'AgentDrive is open source under two licenses: the server, meaning the Cloudflare Worker API, the hosted MCP server and the Next.js site and dashboard, is AGPL-3.0-only, and the client packages, meaning the `adrive` CLI, the MCP server, the TypeScript SDK, the shared types, the installer and the Claude Code plugin, are Apache-2.0.',
      'Calling the server over its network API, hosted or self-hosted, does not make your code AGPL. If you run a modified server as a network service, you must offer its source to your users. Roushan Inc sells a commercial license to organizations that cannot use AGPL software, and contributions require a signed CLA. The AgentDrive name and logo are trademarks of Roushan Inc and are not covered by the code licenses.',
    ],
  },
  {
    q: 'Can I self-host AgentDrive?',
    a: [
      'Yes: `pnpm selfhost`, run from a clone of https://github.com/agentdrive-sh/agentdrive, deploys the AgentDrive API to your own Cloudflare account on KV, R2, Vectorize and Workers AI, as a single organization that is API-key only, with no dashboard, no email sign-in, no billing and no plan limits.',
      'Self-hosting needs the Cloudflare Workers Paid plan ($5/month), R2 enabled on the account, a workers.dev subdomain, Node.js 22.18 or later and pnpm 10. It is community-supported through GitHub issues and discussions, with no SLA; the hosted service at agentdrive.sh is the supported product. The script prints an owner API key once, and `adrive auth login --with-key` connects the CLI to your instance.',
    ],
  },
  {
    q: 'What data leaves my machine, and how do I control it?',
    a: [
      'By default AgentDrive syncs session transcripts and the files an agent wrote that git does not track, after redacting common secret shapes, and you can switch transcript sync, artifact sync, auto-context and Private Workspace on or off at any time with `adrive privacy`.',
      "A built-in deny list keeps `.env` files, `.dev.vars`, SSH and cloud credentials, key and certificate files, shell history and similar files out of hook sync, and a project's `.adriveignore` excludes more. Hook sync uploads only files of 1 MB or smaller that are not binary. `adrive watch` is meant to upload a folder. In CLI 1.4.0 it uploads nothing, because of a bug fixed in the next release, so use hook sync or `adrive push` meanwhile. In 1.4.0's watch, the deny list, `.adriveignore` and `.gitignore` are merged and the last matching rule wins. From `@adrive/cli` 1.5.0, watch works: it skips links and hard-linked files, applies the deny list in any letter case so no ignore rule can re-include a denied file, and reads only the folder's top-level ignore files.",
      'Redaction is best-effort, not a security boundary, and ignore rules cover files, not transcript text. With Private Workspace on (`adrive privacy --private-workspace on`), the `adrive` CLI encrypts the session transcripts and files it syncs with AES-256-GCM before upload, and that content is not searchable by meaning. Files saved through MCP tools such as `drive_write` are not encrypted, `adrive watch --no-encrypt` and `adrive push --plaintext` skip encryption, and run metadata, storage paths and version messages are stored unencrypted. On Team, a workspace can use your own Cloudflare R2 or S3-compatible bucket. Roushan Inc does not train any model on your data.',
    ],
  },
  {
    q: 'What are the official AgentDrive links?',
    a: [
      'The official AgentDrive sources are the website at https://agentdrive.sh, the docs at https://agentdrive.sh/docs, the source code at https://github.com/agentdrive-sh/agentdrive, the Claude Code plugin marketplace at https://github.com/agentdrive-sh/agentdrive-mcp, the npm packages `@adrive/cli`, `@adrive/mcp-server` and `@adrive/sdk`, the MCP Registry entry `sh.agentdrive/agentdrive`, the YouTube channel https://www.youtube.com/@agentdrive-sh, LinkedIn at https://www.linkedin.com/company/agentdrive, Bluesky at https://bsky.app/profile/agentdrive.sh, dev.to at https://dev.to/agentdrive-sh and this fact sheet at https://agentdrive.sh/facts.',
      `npm: https://www.npmjs.com/package/@adrive/cli (CLI, v${cli.version}), https://www.npmjs.com/package/@adrive/mcp-server (MCP server, v${mcp.version}) and https://www.npmjs.com/package/@adrive/sdk (TypeScript SDK, v${sdk.version}).`,
      'MCP Registry listing: https://registry.modelcontextprotocol.io/v0/servers?search=sh.agentdrive/agentdrive. Hosted MCP endpoint: https://mcp.agentdrive.sh/mcp. REST API: https://app.agentdrive.sh.',
      'Blog: https://agentdrive.sh/blog. For language models: https://agentdrive.sh/llms.txt and https://agentdrive.sh/llms-full.txt.',
    ],
  },
];

export function factsMarkdown(): string {
  return [
    '# AgentDrive facts',
    `> ${FACTS_LEDE}`,
    `As of ${formatPostDate(FACTS_AS_OF)}.`,
    'Source: https://agentdrive.sh/facts.',
    faqMarkdown(FACTS),
  ].join('\n\n');
}
