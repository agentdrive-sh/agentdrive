import type { FaqItem } from '@/components/marketing/faq';
import { MCP_ONLY_AGENTS, SYNC_AGENTS } from './facts/facts';
import { INSTALL_COMMAND } from './integrations/data';

export const HOME_FAQ: FaqItem[] = [
  {
    q: 'How do I install AgentDrive?',
    a: [
      `Run \`${INSTALL_COMMAND}\`, which installs the \`adrive\` CLI and runs \`adrive init\` to sign you in through the browser and wire session sync hooks, the MCP server and the resume commands into Codex, OpenCode, Cursor and Antigravity, plus the Claude Code plugin when the \`claude\` command is on your PATH.`,
      'The CLI needs Node.js 22.15 or later. Read the script first with `curl -fsSL agentdrive.sh/install | less`. To set up Claude Code on its own, run `/plugin marketplace add agentdrive-sh/agentdrive-mcp` and `/plugin install agentdrive@agentdrive` inside it, then `/agentdrive:login`. Restart your agents afterwards so they load the new hooks.',
    ],
  },
  {
    q: 'Which agents does AgentDrive work with?',
    a: [
      `Session sync and resume work in ${SYNC_AGENTS}, and any of them can pick up a session another one started; ${MCP_ONLY_AGENTS} connect as plain MCP clients, so they can use the workspace tools and resume sessions, but their own sessions are not synced.`,
    ],
  },
  {
    q: 'What does the next agent get when it resumes?',
    a: [
      "It gets a handoff brief with the source agent and session details, the goal from the session's first message, the files touched, and as many recent turns as fit in 12,000 characters by default, and it is told to check the files on disk before relying on the brief.",
      'Open the next agent in the same project directory and run `/agentdrive:resume` in Claude Code or `adrive resume` in a terminal, or ask the agent to resume your last AgentDrive session.',
    ],
  },
  {
    q: 'Do I need an account?',
    a: [
      "No: local mode resumes sessions between agents on one machine without an account, by reading each agent's own transcripts on disk, so nothing is uploaded and local resumes are unlimited; an account adds sync across machines, a shared workspace, semantic search, share links and the provenance timeline.",
      'Run `adrive init --local` to wire the hooks without signing in, then `adrive resume` in your project directory.',
    ],
  },
  {
    q: 'What gets uploaded from my machine?',
    a: [
      'With an account, AgentDrive uploads session transcripts and the files an agent wrote that git does not track, after redacting common secret shapes, while `.env` files, keys, SSH and cloud credentials and anything in `.adriveignore` stay local, and `adrive privacy` switches transcript or file sync off.',
      'Redaction is best-effort, and ignore rules cover files, not text you paste into a conversation. Private Workspace encrypts content on your machine with AES-256-GCM before upload, so the server stores only ciphertext and that content is not searchable by meaning.',
    ],
  },
  {
    q: 'Does syncing slow my agent down?',
    a: [
      "No: the agent's hook starts a detached `adrive sync` and exits right away, so it never blocks the agent, and a failing hook never surfaces in your session; turn-end events re-sync a session at most every two minutes, while session-end and compaction events always sync.",
      'Hook-started syncs log to `~/.config/agentdrive/sync.log`, and `adrive sync --dry-run` shows what a sync would pick up without uploading anything.',
    ],
  },
  {
    q: 'Is AgentDrive open source, and can I self-host it?',
    a: [
      'Yes: the server is AGPL-3.0 and the CLI, MCP server, SDK, installer and Claude Code plugin are Apache-2.0, and `pnpm selfhost` deploys the same server to your own Cloudflare account, which needs the Workers Paid plan and runs API-key only, with no billing and no plan limits.',
      'Self-hosting is community-supported. The source is at https://github.com/agentdrive-sh/agentdrive and the guide is at https://agentdrive.sh/docs/self-hosting.',
    ],
  },
];
