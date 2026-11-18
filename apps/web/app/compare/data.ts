export const LAST_CHECKED = '2026-11-18';

export const ROWS = ['Unit of storage', 'Where it runs', 'Coding-agent sessions', 'Storage location', 'Availability'] as const;
type Row = (typeof ROWS)[number];

export const AGENTDRIVE_ROW: Record<Row, string> = {
  'Unit of storage': 'Sessions and files, versioned, with provenance',
  'Where it runs': 'Hosted workspace plus a local CLI and MCP server',
  'Coding-agent sessions': 'Synced by hooks in Claude Code, Codex, OpenCode, Cursor and Antigravity; resumable from any of them',
  'Storage location': 'AgentDrive R2 by default; your own R2 or S3 bucket on Team',
  Availability: 'Free plan; Pro $20/mo, Team $30/seat/mo',
};

export interface Competitor {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  row: Record<Row, string>;
  facts: { text: string; source: string }[];
  sections?: { title: string; body: string[] }[];
  goodAt: string[];
  different: string[];
  pickThem: string;
  pickUs: string;
  together: string;
}

export const COMPETITORS: Competitor[] = [
  {
    slug: 'mem0',
    name: 'Mem0',
    tagline: 'Mem0 is memory for AI agents and apps. AgentDrive is the shared workspace that lets coding agents resume each other\'s sessions.',
    description: 'Mem0 stores memories extracted from conversations for apps you build. AgentDrive syncs whole coding-agent sessions so another agent can resume them.',
    row: {
      'Unit of storage': 'Memories extracted from conversation messages',
      'Where it runs': 'Library, self-hosted server, or hosted cloud platform',
      'Coding-agent sessions': 'Agent skills for Claude Code, Codex, Cursor, OpenCode and others',
      'Storage location': 'Your infrastructure when self-hosted, or Mem0 Cloud',
      Availability: 'Open source (Apache 2.0) plus a hosted platform',
    },
    facts: [
      { text: 'Describes itself as "The Memory Layer for AI Agents" and is licensed Apache 2.0.', source: 'https://github.com/mem0ai/mem0' },
      { text: 'Ships as a library, a self-hosted server (Docker Compose) and a hosted cloud platform.', source: 'https://github.com/mem0ai/mem0' },
      { text: 'Retains user, session and agent state: you add conversation messages and later search the memories extracted from them.', source: 'https://github.com/mem0ai/mem0' },
      { text: 'A Python package, an npm SDK and a CLI; agent skills for Claude Code, Codex, Cursor, Windsurf, OpenCode and OpenClaw; LangGraph and CrewAI examples.', source: 'https://github.com/mem0ai/mem0' },
    ],
    goodAt: [
      'Remembering user preferences and facts across conversations in an app or agent you build.',
      'Self-hosting under an open-source license.',
      'Broad SDK and framework coverage for application developers.',
    ],
    different: [
      'AgentDrive keeps whole sessions and the files agents wrote, not facts extracted from them, so the next agent sees the actual goal, recent turns and touched files.',
      'Sync is automatic: hooks in five agents upload each session in the background, and any of them can resume it with drive_resume.',
      'Every artifact shows which agent wrote it, so the workspace doubles as a provenance timeline.',
      'On Team, your files can live in your own R2 or S3 bucket.',
    ],
    pickThem: 'You are building a product or agent that needs to remember its users across conversations.',
    pickUs: 'You run several coding-agent CLIs and want work started in one to continue in another, with a record of who did what.',
    together: 'They hold different things: Mem0 keeps facts extracted from conversations, AgentDrive keeps whole sessions and the files agents wrote. An agent can call both.',
  },
  {
    slug: 'cloudflare-agent-memory',
    name: 'Cloudflare Agent Memory',
    tagline: 'Cloudflare Agent Memory is managed memory for agents you build on Cloudflare. AgentDrive syncs and hands off sessions between the coding agents you already use.',
    description: 'Cloudflare Agent Memory is managed memory for agents you build on Workers. AgentDrive syncs sessions between the coding agents you already use.',
    row: {
      'Unit of storage': 'Memories extracted and classified from agent conversations',
      'Where it runs': 'Managed service: Worker binding or REST API',
      'Coding-agent sessions': 'Your agent calls ingest, typically at context compaction',
      'Storage location': 'Cloudflare Durable Objects (SQLite) and Vectorize',
      Availability: 'Private beta; not billed during the beta',
    },
    facts: [
      { text: 'Announced in private beta on April 17, 2026, as a managed service that extracts information from agent conversations.', source: 'https://blog.cloudflare.com/introducing-agent-memory/' },
      { text: 'Accessed through a Worker binding or a REST API. A profile supports ingest, remember, recall, list and forget.', source: 'https://blog.cloudflare.com/introducing-agent-memory/' },
      { text: 'Built on Durable Objects with SQLite, Vectorize and Workers AI. Profiles can be shared across sessions, agents and users, and every memory is exportable.', source: 'https://blog.cloudflare.com/introducing-agent-memory/' },
      { text: 'Cloudflare is not billing for Agent Memory during the private beta.', source: 'https://developers.cloudflare.com/agent-memory/platform/pricing/' },
    ],
    goodAt: [
      'Agents you build on Workers: memory is one binding away.',
      'Managed extraction, classification and recall, with no memory pipeline to run yourself.',
      'Sharing one memory profile across a team or across several agents.',
    ],
    different: [
      'AgentDrive needs no code. It hooks into Claude Code, Codex, OpenCode, Cursor and Antigravity and syncs their sessions as they run.',
      'It stores the raw transcript and the files an agent wrote, versioned and content-addressed, rather than extracted memories.',
      'Each artifact carries provenance: which agent CLI wrote it, in which session.',
      'AgentDrive also runs on Cloudflare. The difference is that on Team your files can live in your own R2 or S3 bucket.',
    ],
    pickThem: 'You are building your own agent on Cloudflare Workers and want managed long-term memory for it.',
    pickUs: 'You want the coding agents you already use to pick up each other\'s sessions without writing integration code.',
    together: 'An agent you build on Workers can keep its long-term memory in Agent Memory, while the coding agents you use to build it hand sessions to each other through AgentDrive.',
  },
  {
    slug: 'filesystem-mcp',
    name: 'Filesystem MCP',
    tagline: 'Filesystem MCP gives one agent access to folders on one machine. AgentDrive is a shared, versioned workspace every agent can reach.',
    description: 'The Filesystem MCP server gives one agent access to local folders. AgentDrive is a shared, versioned workspace that every coding agent can reach.',
    row: {
      'Unit of storage': 'Files on your local disk',
      'Where it runs': 'Local process over stdio or local HTTP (npx or Docker)',
      'Coding-agent sessions': 'Not synced; it exposes file operations',
      'Storage location': 'Directories you allow on your machine',
      Availability: 'Open-source reference server',
    },
    facts: [
      { text: 'A Node.js MCP server for filesystem operations, published as @modelcontextprotocol/server-filesystem.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
      { text: 'Tools include read_text_file, write_file, edit_file, directory_tree, move_file and search_files (glob matching).', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
      { text: 'Every operation is restricted to the allowed directories passed on the command line.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
      { text: 'Runs locally via npx or Docker, over stdio by default or as a Streamable HTTP service on 127.0.0.1, and only accesses the local filesystem.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
    ],
    goodAt: [
      'Giving an MCP client that lacks file tools precise, local access to specific folders.',
      'No account and no network: nothing leaves your machine.',
      'Simple, auditable reference code.',
    ],
    different: [
      'AgentDrive lives off your machine, so an agent on another laptop or a CI runner reads the same workspace.',
      'Files are versioned and content-addressed, and every write keeps the name of the agent that made it.',
      'drive_search searches by meaning, not by file-name glob.',
      'Hooks sync each coding-agent session so another agent can resume it.',
    ],
    pickThem: 'One agent on one machine needs read and write access to local folders.',
    pickUs: 'The handoff crosses agents or machines, and you want history and provenance on what was written.',
    together: 'An agent can edit local files through Filesystem MCP and write the results it wants to keep, or hand off, to AgentDrive.',
  },
  {
    slug: 'claude-md-handoff-notes',
    name: 'CLAUDE.md and handoff notes',
    tagline: 'CLAUDE.md, AGENTS.md and handoff notes hold what you write down for the next session. AgentDrive keeps what each session actually did, so another agent can pick it up.',
    description: 'CLAUDE.md and AGENTS.md hold the rules you write for every session. AgentDrive keeps what each session did, so another coding agent can resume it.',
    row: {
      'Unit of storage': 'Markdown instructions and notes you write',
      'Where it runs': 'Read by the agent from disk at session start',
      'Coding-agent sessions': 'Not recorded; a handoff note is written by you, or by the agent when asked',
      'Storage location': 'Files in your repo or home directory, shared through git',
      Availability: 'CLAUDE.md is built into Claude Code; AGENTS.md is read by Codex, Cursor, OpenCode and others',
    },
    facts: [
      { text: 'CLAUDE.md files are markdown files you write, and Claude Code reads them at the start of every session. Claude treats them as context, not enforced configuration.', source: 'https://code.claude.com/docs/en/memory' },
      { text: 'A project CLAUDE.md is shared with your team through version control. ~/.claude/CLAUDE.md holds personal preferences for all projects, and CLAUDE.local.md holds personal notes for one project, kept out of git.', source: 'https://code.claude.com/docs/en/memory' },
      { text: '/init generates a starting CLAUDE.md from your codebase. The docs recommend under 200 lines per file and a periodic review to remove outdated or conflicting instructions.', source: 'https://code.claude.com/docs/en/memory' },
      { text: 'Claude Code also keeps auto memory: notes Claude writes itself, loaded at the start of each session (the first 200 lines or 25KB of MEMORY.md). Auto memory is machine-local and not shared across machines.', source: 'https://code.claude.com/docs/en/memory' },
      { text: 'Claude Code reads a repository\'s AGENTS.md in place of CLAUDE.md when the project has no CLAUDE.md.', source: 'https://code.claude.com/docs/en/memory' },
      { text: 'AGENTS.md is "a simple, open format for guiding coding agents", for build steps, tests and conventions. Agents read the nearest file in the directory tree, and the closest one takes precedence.', source: 'https://agents.md/' },
      { text: 'Codex builds its instruction chain from AGENTS.md files when it starts, from its home directory and from the project root down to the current directory, up to 32 KiB by default (project_doc_max_bytes).', source: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md' },
    ],
    sections: [
      {
        title: 'Who writes it, and when it goes stale',
        body: [
          'You write CLAUDE.md and AGENTS.md, or have the agent draft one with /init. They stay right until the code or the conventions change and nobody edits them, which is why the Claude Code docs suggest reviewing them for outdated instructions.',
          'A handoff note is written at the end of a session, by you or by the agent when you ask. It holds only what was written down at that moment, and it goes stale as soon as work continues without an update.',
          'An AgentDrive session record is written by the sync, from the agent\'s own transcript, each time its hooks fire. It describes a past session, so it ages too: the resume brief tells the next agent to check the files on disk before relying on it.',
        ],
      },
      {
        title: 'They work together',
        body: [
          'Keep rules that every session should follow in CLAUDE.md or AGENTS.md. Let AgentDrive carry the state of one task from agent to agent. The receiving agent loads its own instruction files at startup as usual, then reads the AgentDrive brief to see where the last session stopped.',
          'If an agent writes a handoff note to a file git doesn\'t track, AgentDrive uploads that file with the session, so the note travels with the transcript.',
        ],
      },
    ],
    goodAt: [
      'Standing rules for every session: build and test commands, conventions, architecture decisions.',
      'Living in the repo and getting reviewed in pull requests like any other file.',
      'No account and no service: the agent reads a file on disk.',
    ],
    different: [
      'AgentDrive records what a session did from the agent\'s transcript: the goal, the files touched and the recent turns. Nobody has to write it up first.',
      'Hooks in Claude Code, Codex, OpenCode, Cursor and Antigravity sync each session in the background, so the record is as current as the last sync, not the last edit to a note.',
      'The brief is fetched on demand with drive_resume, one session at a time, instead of growing a file that every agent loads at startup.',
      'Sessions live in your workspace by project, so you can resume one on another machine signed in to the same account.',
    ],
    pickThem: 'You want standing instructions every session should follow, or a short note for whoever picks up the task next.',
    pickUs: 'You switch agents mid-task and want the next one to see what the last session actually did, without writing it up first.',
    together: 'They cover different jobs: CLAUDE.md or AGENTS.md carries the project rules into every session, and AgentDrive carries the state of the current task from one agent to the next.',
  },
];

export function getCompetitor(slug: string): Competitor | undefined {
  return COMPETITORS.find((c) => c.slug === slug);
}
