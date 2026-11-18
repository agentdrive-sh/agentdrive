import { PLAN_QUOTAS } from '@agentdrive/shared';
import { SITE_URL } from '@/components/seo/site';
import { MCP_ONLY_AGENTS, SYNC_AGENTS } from '../facts/facts';

export const GLOSSARY_DESCRIPTION =
  'Short definitions of the terms behind coding agents and cross-agent work: MCP, AGENTS.md, CLAUDE.md, session sync, handoff briefs, provenance and more.';

export const GLOSSARY_SET_ID = `${SITE_URL}/glossary#set`;

interface Link {
  title: string;
  href: string;
}

// Copy strings use the faq.tsx inline markup: `code` and bare https:// URLs only.
export interface GlossaryTerm {
  slug: string;
  term: string;
  aka?: string;
  description: string;
  definition: string;
  explanation: string;
  agentdrive: string;
  related: string[];
  links: Link[];
  source?: Link;
}

const FREE_RESUMES = PLAN_QUOTAS.trial.max_resumes_month;

const TERMS: GlossaryTerm[] = [
  {
    slug: 'agents-md',
    term: 'AGENTS.md',
    description:
      'AGENTS.md is an open markdown format for guiding coding agents. What goes in it, where it lives, who stewards it, and how it relates to AgentDrive.',
    definition:
      "AGENTS.md is an open format for guiding coding agents: a markdown file, usually at a repository's root, that holds the instructions an agent needs to work in that project.",
    explanation:
      'It carries the extra context that would clutter a README or that human contributors do not need, such as build steps, test commands and code style. Large monorepos can place nested AGENTS.md files inside subprojects, and agents follow the closest one. Codex, Cursor and OpenCode read it, and Claude Code can read it in place of CLAUDE.md. The format is stewarded by the Agentic AI Foundation under the Linux Foundation.',
    agentdrive:
      "AGENTS.md holds the rules you write for every session; AgentDrive keeps what each session actually did, so the two work side by side. With auto-context on, `adrive init` adds a short marked block to the user-level AGENTS.md of Codex and OpenCode telling the agent when to call the AgentDrive MCP tools, and turning auto-context off removes it. It never edits a repository's AGENTS.md.",
    related: ['claude-md', 'coding-agent', 'handoff-brief'],
    links: [
      { title: 'AgentDrive vs CLAUDE.md and handoff notes', href: '/compare/claude-md-handoff-notes' },
      { title: 'Sessions: auto-context and privacy controls', href: '/docs/concepts/sessions' },
    ],
    source: { title: 'agents.md', href: 'https://agents.md/' },
  },
  {
    slug: 'claude-md',
    term: 'CLAUDE.md',
    description:
      'CLAUDE.md is the instructions file Claude Code reads at the start of every session. Where it lives, what goes in it, and how it differs from AgentDrive.',
    definition:
      'CLAUDE.md is a markdown file of instructions that Claude Code reads at the start of every session, giving it persistent context for a project, your personal workflow or an organization.',
    explanation:
      'A project CLAUDE.md lives at `./CLAUDE.md` or `./.claude/CLAUDE.md` and is shared through version control; a personal one at `~/.claude/CLAUDE.md` applies to all your projects. Typical contents are build and test commands, coding standards, architecture decisions and naming conventions. Claude Code treats the file as context, not enforced configuration, and can read a repository\'s AGENTS.md in its place.',
    agentdrive:
      'AgentDrive does not read or edit CLAUDE.md. In Claude Code, its plugin ships an `agentdrive` skill instead. CLAUDE.md holds what you write down for every session, while AgentDrive syncs what each session did, so another agent can resume it.',
    related: ['agents-md', 'coding-agent', 'session-sync'],
    links: [
      { title: 'AgentDrive vs CLAUDE.md and handoff notes', href: '/compare/claude-md-handoff-notes' },
      { title: 'Claude Code integration', href: '/integrations/claude-code' },
    ],
    source: { title: 'Claude Code docs: How Claude remembers your project', href: 'https://code.claude.com/docs/en/memory' },
  },
  {
    slug: 'coding-agent',
    term: 'Coding agent',
    description:
      'A coding agent is an AI tool that reads and edits code, runs commands and works through software tasks in a repository. Examples and how AgentDrive fits.',
    definition:
      'A coding agent is an AI tool that works through a software task in a code repository: it reads and edits files, runs commands such as tests, and reports back.',
    explanation:
      'Claude Code, Codex, OpenCode, Cursor and Antigravity are examples. Each keeps its session history in its own format and location, reads its own instruction files, and is priced and limited by its own plan. Most can connect to external tools through MCP. A developer who uses more than one agent on the same project has to carry context between them, by hand or with a tool.',
    agentdrive: `AgentDrive syncs and resumes sessions in ${SYNC_AGENTS}. ${MCP_ONLY_AGENTS} connect as plain MCP clients: they can use the workspace and resume another agent's session, but their own sessions are not synced.`,
    related: ['cross-agent-resume', 'mcp', 'usage-limit'],
    links: [
      { title: 'Integrations', href: '/integrations' },
      { title: 'Resume a session in another coding agent', href: '/resume' },
    ],
  },
  {
    slug: 'content-addressed-storage',
    term: 'Content-addressed storage',
    description:
      'Content-addressed storage keys data by a hash of its content, so identical bytes are stored once and versions never change. How AgentDrive applies it.',
    definition:
      'Content-addressed storage keeps each piece of data under a key derived from its content, usually a cryptographic hash, so identical content is stored once and a stored object never changes.',
    explanation:
      'Because the key is computed from the bytes, storing the same content twice adds no new object, two copies share one object, and a hash names exactly one version. Git stores its objects this way. A separate record maps human-friendly names, such as file paths, to hashes, so renaming a file does not copy its bytes and old versions keep their original hash.',
    agentdrive:
      'AgentDrive stores file content in its object store under the sha256 of the content. A metadata record holds the path, version number, actor and message that point at each blob, so a retried write stores no new bytes, identical artifacts share one stored object and each version keeps its original content hash.',
    related: ['provenance', 'session-sync'],
    links: [
      { title: 'Content-addressing', href: '/docs/concepts/content-addressing' },
      { title: 'Workspaces', href: '/docs/concepts/workspaces' },
    ],
    source: { title: 'Pro Git: Git Objects', href: 'https://git-scm.com/book/en/v2/Git-Internals-Git-Objects' },
  },
  {
    slug: 'cross-agent-resume',
    term: 'Cross-agent resume',
    description:
      'Cross-agent resume means continuing a coding task in a different agent by loading the earlier session instead of explaining it again. How it works.',
    definition:
      'Cross-agent resume is continuing a coding task in a different coding agent from the one that started it, by loading the earlier session instead of explaining the task again.',
    explanation:
      'Coding agents keep sessions in separate, incompatible stores, so a new agent normally starts with nothing. With cross-agent resume, the receiving agent gets the goal, the files touched and the recent turns of the source session, checks the files on disk and carries on. Common reasons are hitting a usage limit or wanting a different agent for the next step.',
    agentdrive: `Resume with the \`drive_sessions\` and \`drive_resume\` MCP tools, a slash command such as \`/agentdrive:resume\` in Claude Code, or \`adrive resume\` in a shell. MCP resume prefers a recent session in the same project from a different agent. The Free plan includes ${FREE_RESUMES} cloud cross-agent resumes a month; local resumes are unlimited.`,
    related: ['handoff-brief', 'session-sync', 'local-mode'],
    links: [
      { title: 'Resume a session in another coding agent', href: '/resume' },
      { title: 'Claude Code to Codex', href: '/resume/claude-code-to-codex' },
      { title: 'Start in Claude Code, pick up in Codex', href: '/blog/start-in-claude-code-pick-up-in-codex' },
      { title: 'Sessions', href: '/docs/concepts/sessions' },
    ],
  },
  {
    slug: 'handoff-brief',
    term: 'Handoff brief',
    description:
      'A handoff brief is the summary of a coding-agent session that AgentDrive gives the next agent: the goal, the files touched and the most recent turns.',
    definition:
      'A handoff brief is the summary of a coding-agent session that AgentDrive gives the next agent: the goal, the files touched and the most recent turns, sized to a character budget.',
    explanation:
      "The brief carries the source session's metadata, the goal taken from its first user message, each file touched with the id of its uploaded copy, and as many recent turns as fit in 12,000 characters by default, or up to 50,000. The receiving agent is told to check file state on disk before relying on the brief, because files may have changed since.",
    agentdrive:
      'Handoff brief is an AgentDrive term. `drive_resume`, the resume slash commands and `adrive resume` all load the same format. Set the budget with `max_chars` on `drive_resume` or `--max-chars` on `adrive resume`.',
    related: ['cross-agent-resume', 'session-sync', 'local-mode'],
    links: [
      { title: "What goes into a handoff brief, and what doesn't", href: '/blog/what-goes-into-a-handoff-brief' },
      { title: 'Sessions', href: '/docs/concepts/sessions' },
      { title: 'AgentDrive facts', href: '/facts' },
    ],
  },
  {
    slug: 'local-mode',
    term: 'Local mode',
    description:
      'Local mode runs AgentDrive resume without an account: the CLI reads agent transcripts on your machine and builds the handoff brief there, uploading nothing.',
    definition:
      "Local mode is AgentDrive without an account: the `adrive` CLI reads each agent's transcripts on your machine and builds the handoff brief there, so nothing is uploaded.",
    explanation:
      'Run `adrive init --local` to wire the hooks without signing in, then `adrive resume --list` and `adrive resume` in the project directory. No network is needed. Claude Code, Codex and OpenCode need no setup; Cursor and Antigravity need the hooks, because their transcripts do not record the project directory. The `drive_sessions` and `drive_resume` MCP tools also work without an API key.',
    agentdrive:
      "Local mode is an AgentDrive feature. It stays on one machine: sessions do not sync to your other machines, cannot be shared with teammates, and nothing is recorded in the provenance timeline. Local resumes are unlimited and do not count toward the Free plan's monthly cloud resume limit.",
    related: ['cross-agent-resume', 'transcript-adapter', 'session-sync'],
    links: [
      { title: 'Quick start: local mode', href: '/docs/quick-start#local-mode-no-account' },
      { title: 'What to do when Claude Code hits its usage limit', href: '/blog/claude-code-usage-limit' },
      { title: 'AgentDrive facts', href: '/facts' },
    ],
  },
  {
    slug: 'mcp',
    term: 'Model Context Protocol (MCP)',
    aka: 'MCP',
    description:
      'The Model Context Protocol (MCP) is an open-source standard for connecting AI applications to tools and data. How it works and how AgentDrive uses it.',
    definition:
      'The Model Context Protocol (MCP) is an open-source standard for connecting AI applications to external systems such as data sources, tools and workflows.',
    explanation:
      'MCP uses a client-server architecture: a host application, such as Claude Code, creates one MCP client for each MCP server it connects to. Messages use JSON-RPC 2.0 over stdio for a local server process or Streamable HTTP for a remote one. Servers expose three core primitives: tools the model can call, resources that provide context, and prompts that structure interactions.',
    agentdrive:
      "MCP is AgentDrive's main integration surface. The `@adrive/mcp-server` package runs locally over stdio, and a hosted endpoint at https://mcp.agentdrive.sh/mcp serves remote clients such as claude.ai and ChatGPT. Any MCP client can use the workspace tools.",
    related: ['mcp-server', 'coding-agent', 'principal'],
    links: [
      { title: 'MCP tools reference', href: '/docs/mcp-tools' },
      { title: 'Integrations', href: '/integrations' },
    ],
    source: { title: 'modelcontextprotocol.io: What is MCP?', href: 'https://modelcontextprotocol.io/docs/getting-started/intro' },
  },
  {
    slug: 'mcp-server',
    term: 'MCP server',
    description:
      'An MCP server is a program that exposes tools, resources and prompts to AI applications over the Model Context Protocol. Local vs remote, and AgentDrive.',
    definition:
      'An MCP server is a program that provides context to AI applications over the Model Context Protocol, exposing tools, resources and prompts that a connected MCP client can discover and use.',
    explanation:
      'The term covers the program wherever it runs. A local server is usually launched by the host on the same machine and talks over stdio; a remote server runs on a service, uses Streamable HTTP and typically serves many clients. Clients discover a server\'s tools with `tools/list` and run one with `tools/call`. This design allows listings to be dynamic, and a server can notify clients when its tool list changes.',
    agentdrive:
      'AgentDrive ships an MCP server with 22 tools (18 stable plus 4 experimental sandbox tools) for versioned files, semantic search, run logs, sharing and session resume. It is published on npm as `@adrive/mcp-server` and listed in the MCP Registry as `sh.agentdrive/agentdrive`.',
    related: ['mcp', 'principal', 'cross-agent-resume'],
    links: [
      { title: 'MCP tools reference', href: '/docs/mcp-tools' },
      { title: 'AgentDrive vs the Filesystem MCP server', href: '/compare/filesystem-mcp' },
      { title: 'Quick start', href: '/docs/quick-start' },
    ],
    source: { title: 'modelcontextprotocol.io: Architecture overview', href: 'https://modelcontextprotocol.io/docs/learn/architecture' },
  },
  {
    slug: 'principal',
    term: 'Principal (AgentDrive)',
    aka: 'Principal',
    description:
      'In AgentDrive, a principal is the human or team behind an API key: it owns workspaces and holds the plan, whichever coding agents act for it.',
    definition:
      'In AgentDrive, a principal is the identity behind an API key: a human or a team that owns workspaces, holds the plan and is billed, whichever agents act on its behalf.',
    explanation:
      'One API key represents one principal, not one agent process, so the same developer can work through Claude Code, Codex and Cursor with a single key. Each request also declares the agent platform and an optional role in the `X-Agent-Platform` and `X-Agent-Role` headers, which keeps sessions from different agents apart in provenance records.',
    agentdrive: `Principal is an AgentDrive term. The Free and Pro plans each include ${PLAN_QUOTAS.pro.max_human_seats} principal; Team is priced per seat.`,
    related: ['provenance', 'mcp-server'],
    links: [
      { title: 'Cross-agent identity', href: '/docs/concepts/cross-agent-identity' },
      { title: 'Pricing', href: '/pricing' },
    ],
  },
  {
    slug: 'private-workspace',
    term: 'Private Workspace',
    description:
      'Private Workspace is the AgentDrive setting that encrypts the transcripts and files the CLI syncs on your machine before upload. MCP writes are not encrypted.',
    definition:
      'Private Workspace is an AgentDrive setting that makes the `adrive` CLI encrypt the session transcripts and files it syncs on your machine with AES-256-GCM before upload. MCP writes are not encrypted.',
    explanation:
      'The data key is generated locally and kept, wrapped, in the AgentDrive config directory, so the server stores those synced transcripts and files only as ciphertext. Synced session paths are hashed, so repository and file names do not appear in them, and run metadata leaves out the working directory, title and touched paths. Encrypted content is not searchable by meaning, and `drive_resume` asks the agent to run `adrive resume`, which decrypts locally.',
    agentdrive:
      'Private Workspace is included in every AgentDrive plan; switch it with `adrive privacy`. It does not cover every upload: `drive_write` and other MCP writes send plaintext, `adrive watch --no-encrypt` and `adrive push --plaintext` skip encryption, and version messages and other metadata stay readable. Changing the setting makes the next sync re-upload recent sessions.',
    related: ['session-sync', 'local-mode'],
    links: [
      { title: 'Sessions: Private Workspace', href: '/docs/concepts/sessions#private-workspace' },
      { title: 'Security', href: '/security' },
    ],
  },
  {
    slug: 'provenance',
    term: 'Provenance (agent provenance)',
    aka: 'Agent provenance',
    description:
      'Agent provenance records which agent, platform and identity created or changed an artifact, and when. Why it matters and how AgentDrive records it.',
    definition:
      'Agent provenance is the record of which agent, on which platform and under which identity, created or changed an artifact, and when, so work stays attributable across agents and sessions.',
    explanation:
      'When several coding agents work in one project, provenance answers which agent wrote a file, which session touched it and what it was doing at the time. It is built from records written when each change happens, such as version history, activity events and run logs, rather than reconstructed afterwards from memory or commit messages.',
    agentdrive:
      'AgentDrive keeps provenance in file versions that record the actor, activity events and run records stamped with the agent platform, and runs can carry a role. Each synced session becomes a run. Every plan includes the provenance timeline.',
    related: ['principal', 'session-sync', 'content-addressed-storage'],
    links: [
      { title: 'Cross-agent identity', href: '/docs/concepts/cross-agent-identity' },
      { title: 'MCP tools: provenance', href: '/docs/mcp-tools#provenance' },
      { title: 'Manifesto', href: '/manifesto' },
    ],
  },
  {
    slug: 'session-sync',
    term: 'Session sync',
    description:
      'Session sync copies a coding-agent session into a shared workspace as it runs, so another agent or machine can resume it. How AgentDrive sync works.',
    definition:
      'Session sync copies a coding-agent session from the machine it runs on into a shared workspace as it happens, so another agent or another machine can read and resume it.',
    explanation:
      'Coding agents keep each session on the machine where it ran, in their own format. Session sync uploads it to shared storage in the background while the agent works, usually triggered by session events such as a turn ending or a session closing. Because sync runs as the session goes, the latest state is already there when the agent stops, for example on a usage limit.',
    agentdrive: `Each supported agent runs \`adrive hook\` on session events, which starts a detached \`adrive sync\` and exits at once, so it never blocks the agent. The sync redacts the transcript and uploads it to \`sessions/<project>/<harness>/<session-id>.md\`; turn-end events re-sync at most every two minutes. Sync runs in ${SYNC_AGENTS}, while ${MCP_ONLY_AGENTS} connect as plain MCP clients without it. Redaction is best-effort, not a security boundary.`,
    related: ['transcript-adapter', 'handoff-brief', 'private-workspace'],
    links: [
      { title: 'How background session sync works', href: '/blog/how-background-session-sync-works' },
      { title: 'Sessions', href: '/docs/concepts/sessions' },
      { title: 'Integrations', href: '/integrations' },
    ],
  },
  {
    slug: 'transcript-adapter',
    term: 'Transcript adapter',
    aka: 'Harness adapter',
    description:
      "A transcript adapter reads one coding agent's session transcripts from disk and turns them into a common format for sync and resume. How adapters work.",
    definition:
      "A transcript adapter is code that reads one coding agent's session transcripts from disk and turns each session into a common document of turns, working directory, title and files touched.",
    explanation:
      "Every agent stores sessions in its own format and location, for example Claude Code's JSONL files under `~/.claude/projects/`. An adapter does two things: it finds candidate sessions on disk, and it parses one into the shared shape. Redaction, encryption and upload happen in shared code, so each adapter stays small. Adapters are also called harness adapters.",
    agentdrive:
      'AgentDrive\'s adapters live in `packages/mcp-server/src/transcripts/` and serve both `adrive sync` and local mode. Sync adapters for Cline, Zed and Continue do not exist yet and are listed as good first contributions.',
    related: ['session-sync', 'local-mode', 'coding-agent'],
    links: [
      { title: 'Contributing: harness adapters', href: 'https://github.com/agentdrive-sh/agentdrive/blob/main/CONTRIBUTING.md#where-to-start' },
      { title: 'How background session sync works', href: '/blog/how-background-session-sync-works' },
    ],
  },
  {
    slug: 'usage-limit',
    term: 'Usage limit (coding agents)',
    aka: 'Usage limit',
    description:
      "A usage limit caps how much a coding agent's plan lets you use it in a time window. What happens when you hit one, and your three options to keep working.",
    definition:
      "A usage limit is the cap a coding agent's plan puts on how much you can use it in a time window; once you reach it, the agent pauses until the limit resets.",
    explanation:
      "For example, Anthropic's help center says Claude Pro and Max plans have a five-hour session limit and a weekly limit, shared across Claude and Claude Code. If the limit lands mid-response, Claude Code may finish the step in progress and show \"Usage limit reached · wrapping up\". The options are to wait for the reset, pay for more usage, or continue in another agent.",
    agentdrive:
      'AgentDrive does not change any agent\'s limits. It helps with the third option: another agent opened in the same project loads a handoff brief from the stopped session, so you do not explain the task again.',
    related: ['cross-agent-resume', 'handoff-brief', 'coding-agent'],
    links: [
      { title: 'What to do when Claude Code hits its usage limit', href: '/blog/claude-code-usage-limit' },
      { title: 'Resume a session in another coding agent', href: '/resume' },
    ],
    source: {
      title: 'Claude Help Center: Using Claude Code with your Pro or Max plan',
      href: 'https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan',
    },
  },
];

export const GLOSSARY = [...TERMS].sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));

export function getTerm(slug: string): GlossaryTerm | undefined {
  return GLOSSARY.find((t) => t.slug === slug);
}

const absolute = (href: string) => (href.startsWith('/') ? `${SITE_URL}${href}` : href);

export function termMarkdown(t: GlossaryTerm): string {
  const related = t.related.flatMap((slug) => getTerm(slug) ?? []);
  return [
    `# ${t.term}`,
    `> ${t.definition}`,
    `Source: ${SITE_URL}/glossary/${t.slug}. Part of the AgentDrive glossary: ${SITE_URL}/glossary.`,
    t.explanation,
    '## In AgentDrive',
    t.agentdrive,
    '## Related terms',
    related.map((r) => `- [${r.term}](${SITE_URL}/glossary/${r.slug}/index.md): ${r.definition}`).join('\n'),
    '## Go deeper',
    t.links.map((l) => `- [${l.title}](${absolute(l.href)})`).join('\n'),
    ...(t.source ? ['## Official source', `- [${t.source.title}](${t.source.href})`] : []),
    '',
  ].join('\n\n');
}
