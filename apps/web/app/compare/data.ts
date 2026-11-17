export const LAST_CHECKED = '2026-11-02';

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
  row: Record<Row, string>;
  facts: { text: string; source: string }[];
  goodAt: string[];
  different: string[];
  pickThem: string;
  pickUs: string;
}

export const COMPETITORS: Competitor[] = [
  {
    slug: 'mem0',
    name: 'Mem0',
    tagline: 'Mem0 is memory for AI agents and apps. AgentDrive is the shared workspace that lets coding agents resume each other\'s sessions.',
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
      { text: 'Python and TypeScript SDKs and a CLI; agent skills for Claude Code, Codex, Cursor, Windsurf, OpenCode and OpenClaw; LangGraph and CrewAI examples.', source: 'https://github.com/mem0ai/mem0' },
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
  },
  {
    slug: 'cloudflare-agent-memory',
    name: 'Cloudflare Agent Memory',
    tagline: 'Cloudflare Agent Memory is managed memory for agents you build on Cloudflare. AgentDrive syncs and hands off sessions between the coding agents you already use.',
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
  },
  {
    slug: 'filesystem-mcp',
    name: 'Filesystem MCP',
    tagline: 'Filesystem MCP gives one agent access to folders on one machine. AgentDrive is a shared, versioned workspace every agent can reach.',
    row: {
      'Unit of storage': 'Files on your local disk',
      'Where it runs': 'Local process over stdio (npx or Docker)',
      'Coding-agent sessions': 'Not synced; it exposes file operations',
      'Storage location': 'Directories you allow on your machine',
      Availability: 'Open-source reference server',
    },
    facts: [
      { text: 'A Node.js MCP server for filesystem operations, published as @modelcontextprotocol/server-filesystem.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
      { text: 'Tools include read_text_file, write_file, edit_file, directory_tree, move_file and search_files (glob matching).', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
      { text: 'Every operation is restricted to the allowed directories passed on the command line.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
      { text: 'Runs locally over stdio via npx or Docker and only accesses the local filesystem.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
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
  },
];

export function getCompetitor(slug: string): Competitor | undefined {
  return COMPETITORS.find((c) => c.slug === slug);
}
