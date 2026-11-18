import { SITE_URL } from '@/components/seo/site';

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

export const MATRIX_COLS = [
  'Works across agents',
  'Works across machines',
  'Task context (goal, files, recent turns)',
  'Who maintains it',
  'Local or cloud',
  'Open source',
] as const;
type MatrixCol = (typeof MATRIX_COLS)[number];

export const AGENTDRIVE_MATRIX: Record<MatrixCol, string> = {
  'Works across agents': 'Yes: syncs and resumes Claude Code, Codex, OpenCode, Cursor and Antigravity sessions',
  'Works across machines': 'Yes, through the hosted workspace; local mode stays on one machine',
  'Task context (goal, files, recent turns)': 'Yes: a handoff brief with the goal, files touched and recent turns',
  'Who maintains it': 'Hooks sync each session in the background',
  'Local or cloud': 'Hosted by default, a local mode, or your own R2 or S3 bucket on Team',
  'Open source': 'Yes: server AGPL-3.0, clients Apache-2.0',
};

export interface Competitor {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  row: Record<Row, string>;
  matrix: Record<MatrixCol, string>;
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
    slug: 'built-in-resume',
    name: 'Built-in resume',
    tagline: 'Claude Code and Codex each resume their own sessions. AgentDrive syncs sessions so a different agent, or the same agent on another machine, can pick up the work.',
    description: 'Claude Code --resume and codex resume continue a session in the same agent. AgentDrive syncs sessions so another agent or machine can pick up the work.',
    row: {
      'Unit of storage': "The agent's own saved conversation",
      'Where it runs': 'Built into Claude Code (claude --continue, claude --resume) and Codex (codex resume, /resume)',
      'Coding-agent sessions': "Resumed in the agent that recorded them; Codex's /import brings in recent Claude Code and Cursor chats",
      'Storage location': 'Claude Code: JSONL transcripts under ~/.claude/projects, kept 30 days by default',
      Availability: 'Included with each agent; the Codex CLI is open source (Apache-2.0)',
    },
    matrix: {
      'Works across agents': "Partly: Codex's /import brings recent Claude Code and Cursor chats into Codex. Claude Code resumes only its own sessions",
      'Works across machines': 'Claude Code transcripts are local; --teleport pulls a cloud session into the terminal',
      'Task context (goal, files, recent turns)': 'Yes: the full conversation, in the same agent',
      'Who maintains it': 'The agent saves each session as you work',
      'Local or cloud': 'Local transcript files (Claude Code)',
      'Open source': 'Codex CLI: Apache-2.0. Claude Code: proprietary',
    },
    facts: [
      { text: 'Claude Code: `claude --continue` (`-c`) loads the most recent conversation in the current directory, and `claude --resume` (`-r`) resumes a session by ID or name, or opens an interactive picker.', source: 'https://code.claude.com/docs/en/cli-reference' },
      { text: 'Claude Code: `--fork-session` creates a new session ID when resuming, `--from-pr` opens the picker filtered to sessions linked to a pull request, and `--teleport` resumes a Claude Code on the web session in your local terminal.', source: 'https://code.claude.com/docs/en/cli-reference' },
      { text: 'Claude Code stores each session locally as JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`, with 30-day retention by default (`cleanupPeriodDays`). A resumed session restores the messages, tool calls and results.', source: 'https://code.claude.com/docs/en/sessions' },
      { text: 'Inside Claude Code, `/resume` switches to an earlier conversation, and `/remote-control` lets you continue the local session from another device.', source: 'https://code.claude.com/docs/en/commands' },
      { text: "Claude Code's `/import` brings configuration from Codex or Cursor on your machine: instruction files, MCP servers, commands, subagents and skills. Sessions are not on that list.", source: 'https://code.claude.com/docs/en/commands' },
      { text: 'Codex: `codex resume` continues a previous interactive session by ID or name, `--last` skips the picker and resumes the most recent chat from the current directory, and `--all` includes sessions from other directories. `/resume` does the same from inside a session, and `codex fork` copies a session into a new chat.', source: 'https://learn.chatgpt.com/docs/developer-commands?surface=cli' },
      { text: "Codex's `/import` brings in Claude Code or Cursor setup, projects and chats. The CLI looks for up to 50 chats from the last 30 days on the machine it runs on, and the desktop app can keep imported work in sync with the original agent.", source: 'https://learn.chatgpt.com/docs/import' },
      { text: 'The Codex CLI is open source under the Apache-2.0 license.', source: 'https://github.com/openai/codex' },
      { text: "Claude Code's license reads: \"All rights reserved. Use is subject to Anthropic's Commercial Terms of Service.\"", source: 'https://github.com/anthropics/claude-code/blob/main/LICENSE.md' },
    ],
    sections: [
      {
        title: 'Has either agent added cross-agent import?',
        body: [
          'Codex has. Its `/import` command copies recent Claude Code and Cursor chats into Codex, so you can open one there and continue. The CLI takes up to 50 chats from the last 30 days, and the desktop app can keep imported work updated from the original agent. Either way the work moves one way, into Codex, on the machine Codex runs on.',
          "Claude Code's `/import` brings configuration from Codex or Cursor, such as instruction files, MCP servers and skills, not their sessions.",
        ],
      },
      {
        title: 'What the next agent gets',
        body: [
          'Built-in resume restores the conversation itself, so the agent continues where it stopped. In Claude Code, a compacted session reopens from the compaction summary plus the messages after it.',
          "AgentDrive gives the receiving agent a handoff brief instead: the goal taken from the first user message, the files touched, and as many recent turns as fit in 12,000 characters by default. The agent is told to check the files on disk before relying on it. In local mode, AgentDrive builds that brief from the same transcripts the agents keep on disk.",
        ],
      },
    ],
    goodAt: [
      'No setup: resume ships with each agent and restores the full conversation, tool calls and results.',
      'Branching: `--fork-session` in Claude Code and `codex fork` let you try another approach without losing the original.',
      'Staying in one agent: when the next step happens in the same tool, nothing beats its own resume.',
    ],
    different: [
      "AgentDrive resumes in every direction: a session synced from Claude Code can be picked up in Codex, OpenCode, Cursor or Antigravity, and the other way round. Codex's /import only brings work into Codex.",
      'Sessions sync to your workspace, so you can resume one on another machine signed in to the same account.',
      'Resume from inside the agent with `drive_resume`, a slash command, or `adrive resume`. MCP resume prefers a recent session in this project from a different agent.',
      'Each synced session sits in a versioned workspace with provenance: which agent wrote what, in which session.',
    ],
    pickThem: 'You stay in one agent on one machine and want the full conversation back exactly as it was.',
    pickUs: 'You switch agents mid-task, for example when you hit a usage limit, or move to another machine, and want the next agent to know where the last one stopped.',
    together: "Use built-in resume to continue in the same agent, and AgentDrive when the next step happens in a different agent or on another machine. AgentDrive's hooks run alongside the agent and leave its own sessions and resume as they are.",
  },
  {
    slug: 'session-history-tools',
    name: 'Session history tools',
    tagline: 'SpecStory and Entire save coding-agent sessions as Markdown or Git history you can search, share and resume. AgentDrive syncs sessions to a shared workspace and briefs the next agent.',
    description: 'SpecStory and Entire save coding-agent sessions to Markdown or Git history. AgentDrive syncs sessions to a shared workspace and briefs the next agent.',
    row: {
      'Unit of storage': 'Full session transcripts: Markdown files (SpecStory) or Git checkpoints linked to commits (Entire)',
      'Where it runs': 'A CLI and editor extensions (SpecStory); a CLI with agent hooks plus entire.com (Entire)',
      'Coding-agent sessions': 'Saved from many agents; SpecStory can resume a session in a different agent, Entire restores a session in its agent',
      'Storage location': 'SpecStory: .specstory/history in your project, optional SpecStory Cloud. Entire: Git refs in your repo, pushed to your remote',
      Availability: 'SpecStory CLI (Apache-2.0) and extensions free, Cloud has a free plan; Entire CLI is MIT and free in early access',
    },
    matrix: {
      'Works across agents': 'Yes: both cover many agents, and SpecStory can resume a session in a different agent',
      'Works across machines': 'Yes, through SpecStory Cloud (Pro plan) or the Git remote Entire pushes to',
      'Task context (goal, files, recent turns)': 'Yes: full transcripts',
      'Who maintains it': 'The tool saves sessions as you work',
      'Local or cloud': 'Local Markdown or Git, with optional cloud',
      'Open source': 'Yes: the SpecStory CLI (Apache-2.0) and the Entire CLI (MIT)',
    },
    facts: [
      { text: 'SpecStory "saves the prompts and decisions from your coding agent sessions", with editor extensions for Cursor and VS Code with GitHub Copilot and a CLI for terminal agents. The extensions and CLI are free, and SpecStory Cloud has a free plan.', source: 'https://docs.specstory.com/' },
      { text: 'SpecStory lists support for Cursor, Copilot, Claude Code, Codex, Antigravity, OpenCode, Droid, Qwen, Pi, Grok and others.', source: 'https://specstory.com/specstory' },
      { text: 'The SpecStory CLI saves each session as Markdown in `.specstory/history/` in your project. Signed in, it can also upload to SpecStory Cloud; `--no-cloud-sync` keeps it local. The CLI is free and open source.', source: 'https://docs.specstory.com/integrations/terminal-coding-agents' },
      { text: '`specstory resume` can continue a session in a different agent, for example a Claude Code session in Codex: it reconstructs the conversation into the target agent\'s native format and launches it. Not every agent can be a target yet.', source: 'https://docs.specstory.com/integrations/terminal-coding-agents/resume' },
      { text: 'Resuming on another machine requires SpecStory Cloud and a Pro plan.', source: 'https://docs.specstory.com/integrations/terminal-coding-agents/resume' },
      { text: 'The Entire CLI hooks into your Git workflow to record agent sessions. It works with Claude Code, Codex, Cursor, Copilot CLI, OpenCode, Antigravity, Factory AI Droid, Pi and more, and is open source under the MIT license.', source: 'https://github.com/entireio/cli' },
      { text: 'Entire stores prompts, transcripts and session context as checkpoints in your own Git repository, separate from your source branches, and pushes them when you push. You can also keep them local or in another repository.', source: 'https://docs.entire.com/guides/checkpoints/checkpoint-storage' },
      { text: '`entire session resume` checks out the branch, restores the session log and asks whether to start the agent.', source: 'https://docs.entire.com/guides/sessions/resume-sessions' },
      { text: "Entire's integration table lists resume for Claude Code, Codex, Copilot CLI, OpenCode, Antigravity, Factory and Pi, but not Cursor.", source: 'https://docs.entire.com/agents/overview' },
      { text: 'The entire-brain plugin builds a project memory from saved sessions, checkpoints and docs that different agents can use, for example when you move from Claude Code to Codex.', source: 'https://docs.entire.com/guides/brain/overview' },
      { text: "Entire's early access pricing is pay-as-you-go; session storage, its memory and the Entire CLI have no charge, and its own agents are billed per token.", source: 'https://entire.com/pricing' },
    ],
    sections: [
      {
        title: 'Which agents each one covers',
        body: [
          'SpecStory and Entire both save sessions from most of the popular coding agents, through a CLI, editor extensions or agent hooks.',
          'AgentDrive syncs and resumes sessions in Claude Code, Codex, OpenCode, Cursor and Antigravity. Cline, Zed and Continue connect as MCP clients: they can read and write the workspace and resume another agent\'s session, but their own sessions are not synced.',
        ],
      },
      {
        title: 'Local or cloud',
        body: [
          'SpecStory writes Markdown into your project and syncs to SpecStory Cloud only when you sign in. Entire keeps sessions in Git and pushes them to your remote, so they travel with the repository.',
          'AgentDrive syncs to a hosted workspace by default, can run in local mode with nothing uploaded, and on Team can store files in your own R2 or S3 bucket.',
        ],
      },
      {
        title: 'Can another agent resume from it?',
        body: [
          'SpecStory: yes. It rebuilds the whole conversation in the target agent\'s native format and starts that agent.',
          'Entire: its resume restores a session and starts the agent, and its entire-brain plugin gives a different agent context from earlier work.',
          'AgentDrive: yes, from inside any connected agent. The agent you are already in loads a short handoff brief, the goal, files touched and recent turns, within 12,000 characters by default, and is told to check the files on disk. You trade the full replay for a small, bounded context.',
        ],
      },
    ],
    goodAt: [
      'A readable, searchable record of every coding-agent session, kept in your project as Markdown (SpecStory).',
      'Linking each session to the commits it produced, inside your own Git history (Entire).',
      'Replaying a whole conversation in another agent (SpecStory).',
    ],
    different: [
      'The handoff brief is short by design, so the next agent starts with a small context instead of a long replay.',
      'Resume works from inside any connected agent with `drive_sessions` and `drive_resume`, as well as slash commands and `adrive resume`.',
      'Files agents write live in a versioned, content-addressed workspace with provenance on every artifact, and `drive_search` searches them by meaning.',
      'The Free plan includes 10 cross-agent cloud resumes a month, local mode is unlimited, and Team adds your own R2 or S3 bucket.',
    ],
    pickThem: 'You want a searchable record of every coding-agent session in your project or your Git history, or a full replay of a conversation in another agent.',
    pickUs: 'You want any of your agents to pick up the current task from a short brief, with the files agents write versioned and attributed in a shared workspace.',
    together: 'They do different jobs, so you can run them side by side: SpecStory or Entire keeps the full record of each session, and AgentDrive hands the current task to the next agent.',
  },
  {
    slug: 'mem0',
    name: 'Mem0',
    tagline: 'Mem0 is memory for AI agents and apps. AgentDrive is the shared workspace that lets coding agents resume each other\'s sessions.',
    description: 'Mem0 stores memories extracted from conversations for apps you build. AgentDrive syncs whole coding-agent sessions so another agent can resume them.',
    row: {
      'Unit of storage': 'Memories extracted from conversation messages',
      'Where it runs': 'Library, self-hosted server, or hosted cloud platform',
      'Coding-agent sessions': 'Not synced; a coding agent saves and searches memories through the hosted Mem0 MCP server',
      'Storage location': 'Your infrastructure when self-hosted, or Mem0 Cloud',
      Availability: 'Open source (Apache 2.0) plus a hosted platform',
    },
    matrix: {
      'Works across agents': 'Through the hosted Mem0 MCP server, which Claude Code, Codex, Cursor, OpenCode and other MCP clients can connect to',
      'Works across machines': 'Yes, with the hosted platform or a shared self-hosted server',
      'Task context (goal, files, recent turns)': 'No: memories extracted from conversations, not sessions',
      'Who maintains it': 'Your app or agent adds messages; Mem0 extracts the memories',
      'Local or cloud': 'Library, self-hosted server or hosted cloud',
      'Open source': 'Yes, Apache 2.0',
    },
    facts: [
      { text: 'Describes itself as "The Memory Layer for AI Agents" and is licensed Apache 2.0.', source: 'https://github.com/mem0ai/mem0' },
      { text: 'Ships as a library, a self-hosted server (Docker Compose) and a hosted cloud platform.', source: 'https://github.com/mem0ai/mem0' },
      { text: 'Retains user, session and agent state: you add conversation messages and later search the memories extracted from them.', source: 'https://github.com/mem0ai/mem0' },
      { text: 'A Python package, an npm SDK and a CLI, plus LangGraph and CrewAI examples.', source: 'https://github.com/mem0ai/mem0' },
      { text: 'Mem0 MCP is a hosted server at mcp.mem0.ai that keeps memories in your Mem0 Platform account. It connects to Claude Code, Codex, Cursor, Windsurf, VS Code and OpenCode, with tools such as add_memory and search_memories.', source: 'https://docs.mem0.ai/platform/mem0-mcp' },
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
    matrix: {
      'Works across agents': 'Agents you build: a memory profile can be shared across agents',
      'Works across machines': 'Yes, as a managed service',
      'Task context (goal, files, recent turns)': 'No: extracted and classified memories',
      'Who maintains it': 'Your agent calls ingest; the service extracts memories',
      'Local or cloud': 'Cloud: Durable Objects and Vectorize',
      'Open source': 'Managed service, in private beta',
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
    slug: 'memory-mcp',
    name: 'Memory MCP',
    tagline: 'The Memory MCP server keeps a local knowledge graph of facts an agent chooses to save. AgentDrive syncs whole coding-agent sessions so another agent can resume the work.',
    description: 'The Memory MCP server keeps a local knowledge graph of facts an agent saves. AgentDrive syncs whole coding-agent sessions so another agent can resume them.',
    row: {
      'Unit of storage': 'Entities, relations and observations in a knowledge graph',
      'Where it runs': 'Local process over stdio (npx or Docker), or a Streamable HTTP service',
      'Coding-agent sessions': 'Not synced; the agent saves facts with tool calls',
      'Storage location': 'A memory.jsonl file, set with MEMORY_FILE_PATH',
      Availability: 'Open-source reference server (MIT, per its README)',
    },
    matrix: {
      'Works across agents': 'Any MCP client that connects to it',
      'Works across machines': 'Local by default: stdio and a memory.jsonl file',
      'Task context (goal, files, recent turns)': 'No: the facts the agent chose to save',
      'Who maintains it': 'The agent, through create_entities and add_observations calls',
      'Local or cloud': 'Local file',
      'Open source': 'Yes: MIT per its README; the repo is moving to Apache-2.0 for new contributions',
    },
    facts: [
      { text: 'Described as "a basic implementation of persistent memory using a local knowledge graph" and published as `@modelcontextprotocol/server-memory`.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory' },
      { text: 'Entities have a name, a type and a list of observations; relations are directed links between entities; observations are atomic facts stored as strings.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory' },
      { text: 'Tools include `create_entities`, `create_relations`, `add_observations`, `read_graph`, `search_nodes`, `open_nodes` and matching delete tools.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory' },
      { text: 'The graph is stored in `memory.jsonl` in the server directory unless you set `MEMORY_FILE_PATH`. The docs recommend an absolute path, because under npx the default sits inside `node_modules`.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory' },
      { text: 'It talks over stdio by default, runs with npx or the `mcp/memory` Docker image, and can run as a Streamable HTTP service. Its README says it is licensed under MIT.', source: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory' },
      { text: 'The servers repository is moving from MIT to Apache-2.0: new contributions are Apache-2.0, and existing code stays MIT until its authors agree to relicense.', source: 'https://github.com/modelcontextprotocol/servers/blob/main/LICENSE' },
      { text: 'The reference servers "are meant to serve as educational examples for developers building their own MCP servers", not production-ready solutions.', source: 'https://github.com/modelcontextprotocol/servers' },
    ],
    goodAt: [
      'Letting an agent remember a few facts, such as your preferences or the parts of a project, across sessions with no account.',
      'A simple, inspectable data model in one local file.',
      'Working with any MCP client.',
    ],
    different: [
      "AgentDrive syncs the whole session from the agent's transcript. Nothing depends on the agent deciding to save a fact.",
      'The next agent gets a handoff brief with the goal, the files touched and the recent turns.',
      'The workspace is hosted, so an agent on another machine reads the same sessions and files.',
      'Files are versioned and content-addressed, every write keeps the name of the agent that made it, and `drive_search` searches by meaning.',
    ],
    pickThem: 'You want an agent to keep a small set of facts, such as preferences or project entities, in a local file across sessions.',
    pickUs: 'You want the next coding agent, on this machine or another, to resume a task from what the last session did.',
    together: "They store different things: an agent can keep durable facts in the Memory server's knowledge graph and pick up task state from AgentDrive.",
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
    matrix: {
      'Works across agents': 'Any MCP client on the same machine',
      'Works across machines': 'No: it only accesses the local filesystem',
      'Task context (goal, files, recent turns)': 'No: file operations only',
      'Who maintains it': 'The agent reads and writes files when asked',
      'Local or cloud': 'Local',
      'Open source': 'Yes, a reference server',
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
    tagline: 'CLAUDE.md, AGENTS.md and handoff notes hold what you write down for the next session. AgentDrive keeps what each session did, so another agent can pick it up.',
    description: 'CLAUDE.md and AGENTS.md hold the rules you write for every session. AgentDrive keeps what each session did, so another coding agent can resume it.',
    row: {
      'Unit of storage': 'Markdown instructions and notes you write',
      'Where it runs': 'Read by the agent from disk at session start',
      'Coding-agent sessions': 'Not recorded; a handoff note is written by you, or by the agent when asked',
      'Storage location': 'Files in your repo or home directory, shared through git',
      Availability: 'CLAUDE.md is built into Claude Code; AGENTS.md is read by Codex, Cursor, OpenCode and others',
    },
    matrix: {
      'Works across agents': 'Yes for AGENTS.md, read by Codex, Cursor, OpenCode and others, and by Claude Code when the project has no CLAUDE.md',
      'Works across machines': 'Yes, through git',
      'Task context (goal, files, recent turns)': 'Only what someone writes down',
      'Who maintains it': 'You, or the agent when asked',
      'Local or cloud': 'Files in your repo or home directory',
      'Open source': 'Plain files; AGENTS.md is an open format',
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
    pickUs: 'You switch agents mid-task and want the next one to see what the last session did, without writing it up first.',
    together: 'They cover different jobs: CLAUDE.md or AGENTS.md carries the project rules into every session, and AgentDrive carries the state of the current task from one agent to the next.',
  },
];

export function getCompetitor(slug: string): Competitor | undefined {
  return COMPETITORS.find((c) => c.slug === slug);
}

export const COMPARE_LEDE =
  "AgentDrive is the right tool when one task moves between coding agents or machines: it syncs each session and hands the next agent the goal, files touched and recent turns. It is not the right tool if you stay in one agent, need memory for an app you build, or only need standing project rules.";

export const COMPARE_FAQ: { q: string; a: string }[] = [
  {
    q: 'When is AgentDrive the right tool?',
    a: 'When one task moves between coding agents or machines. AgentDrive syncs each session from Claude Code, Codex, OpenCode, Cursor and Antigravity, and the next agent resumes from a handoff brief with the goal, the files touched and the recent turns.',
  },
  {
    q: 'When is AgentDrive the wrong tool?',
    a: "When you stay in one agent, its built-in resume restores the full conversation. When you are building an app that remembers its users, use a memory layer such as Mem0 or Cloudflare Agent Memory. For rules every session should follow, write CLAUDE.md or AGENTS.md.",
  },
  {
    q: 'Which alternative is closest to AgentDrive?',
    a: 'Session history tools. SpecStory and Entire also save sessions from several coding agents, and SpecStory can resume a session in a different agent. AgentDrive differs in handing the next agent a short brief, and in keeping the files agents write in a versioned workspace with provenance.',
  },
  {
    q: 'Can I use AgentDrive alongside these tools?',
    a: 'Yes. Most of them hold something different: project rules, facts about users, or a full session record. AgentDrive carries the state of the current task from one agent to the next.',
  },
];

export function competitorFaq(c: Competitor): { q: string; a: string }[] {
  return [
    { q: `What is the difference between ${c.name} and AgentDrive?`, a: c.tagline },
    { q: `When should I use ${c.name}?`, a: c.pickThem },
    { q: 'When should I use AgentDrive instead?', a: c.pickUs },
    { q: `Can I use AgentDrive alongside ${c.name}?`, a: `Yes. ${c.together}` },
  ];
}

const cell = (text: string) => text.replace(/\|/g, '\\|');
const faqSection = (faq: { q: string; a: string }[]) => faq.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n');

export function compareIndexMarkdown(): string {
  const head = ['Tool', ...MATRIX_COLS];
  const rows = [
    ['AgentDrive', ...MATRIX_COLS.map((col) => AGENTDRIVE_MATRIX[col])],
    ...COMPETITORS.map((c) => [`[${c.name}](${SITE_URL}/compare/${c.slug}.md)`, ...MATRIX_COLS.map((col) => c.matrix[col])]),
  ];
  return [
    '# AgentDrive vs the alternatives',
    `> ${COMPARE_LEDE}`,
    `Source: ${SITE_URL}/compare. Last checked ${LAST_CHECKED}.`,
    `| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}`,
    '## Comparisons',
    COMPETITORS.map((c) => `- [AgentDrive vs ${c.name}](${SITE_URL}/compare/${c.slug}.md): ${c.tagline}`).join('\n'),
    '## Questions',
    faqSection(COMPARE_FAQ),
    '',
  ].join('\n\n');
}

export function compareMarkdown(c: Competitor): string {
  const sources = [...new Set(c.facts.map((f) => f.source))];
  return [
    `# AgentDrive vs ${c.name}`,
    `> ${c.tagline}`,
    `Source: ${SITE_URL}/compare/${c.slug}. Last checked ${LAST_CHECKED}. All comparisons: ${SITE_URL}/compare.md.`,
    '## When to pick which',
    `Pick ${c.name} when: ${c.pickThem}`,
    `Pick AgentDrive when: ${c.pickUs}`,
    c.together,
    `| Feature | AgentDrive | ${cell(c.name)} |\n| --- | --- | --- |\n${ROWS.map((r) => `| ${r} | ${cell(AGENTDRIVE_ROW[r])} | ${cell(c.row[r])} |`).join('\n')}`,
    `## About ${c.name}`,
    c.facts.map((f) => `- ${f.text}`).join('\n'),
    ...(c.sections ?? []).flatMap((s) => [`## ${s.title}`, ...s.body]),
    `## Where ${c.name} works well`,
    c.goodAt.map((g) => `- ${g}`).join('\n'),
    '## What AgentDrive does differently',
    c.different.map((x) => `- ${x}`).join('\n'),
    '## Questions',
    faqSection(competitorFaq(c)),
    '## Sources',
    sources.map((s) => `- ${s}`).join('\n'),
    '',
  ].join('\n\n');
}
