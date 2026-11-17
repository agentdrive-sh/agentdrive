import type { PlatformId } from '@/components/platform-glyph';
import { CAPTURE_HARNESSES } from '../integrations/data';

interface Profile {
  setup?: string;
  capture: string;
  command?: string;
}

// Mirrors the per-harness integration pages; keep the two in step.
const PROFILES: Record<string, Profile> = {
  'claude-code': {
    setup: 'In Claude Code you can install the plugin instead: /plugin marketplace add agentdrive-sh/agentdrive-mcp, then /plugin install agentdrive@agentdrive.',
    capture: 'The AgentDrive plugin hooks SessionStart, Stop, SessionEnd and PreCompact, and hands each session to a background sync, so Claude Code never waits on it.',
    command: '/agentdrive:resume',
  },
  codex: {
    setup: 'Setup approves the AgentDrive hooks in Codex for you. On an older Codex, approve them once via /hooks.',
    capture: 'Hooks in ~/.codex fire on SessionStart, Stop, SessionEnd and PreCompact. Codex caps hook time at 3 seconds, so the hook only starts a background sync and returns.',
  },
  opencode: {
    capture: 'A plugin at ~/.config/opencode/plugins/agentdrive.ts listens for session.created and session.idle and reads the session through opencode export, without ever blocking OpenCode.',
    command: '/agentdrive-resume',
  },
  cursor: {
    setup: 'Reload Cursor after setup (Developer: Reload Window) so it picks up the hooks and the MCP server.',
    capture: 'Hooks in ~/.cursor/hooks.json fire on sessionStart, stop, sessionEnd and preCompact, and hand the session to a background sync.',
    command: '/agentdrive-resume',
  },
  'gemini-cli': {
    capture: 'Hooks in ~/.gemini/settings.json fire on SessionStart, AfterAgent, SessionEnd and PreCompress. The sync reads the session from ~/.gemini/tmp.',
    command: '/agentdrive:resume',
  },
  antigravity: {
    capture: 'A hook in ~/.gemini/config/hooks.json fires on SessionStart and Stop. Antigravity has no session-end event, so a session counts as finished after 30 minutes idle.',
  },
};

export interface Note {
  text: string;
  source: string;
}

const CODEX_IMPORT = 'https://codex.danielvaughan.com/2026/07/24/codex-cli-v0145-import-command-cursor-claude-code-migration-mcp-servers-memories-settings/';

// Only facts checked against a source page; a pair with none gets no note.
function notesFor(from: PlatformId, to: PlatformId): Note[] {
  const notes: Note[] = [];
  if (to === 'codex' && (from === 'claude-code' || from === 'cursor')) {
    notes.push({
      text: `Codex can pull recent ${label(from)} sessions in by itself with /import: the 50 most recent from the last 30 days, one way, on one machine. Use it for a one-time move. Use AgentDrive when you switch back and forth, need older sessions, or hand off to another machine or a teammate.`,
      source: CODEX_IMPORT,
    });
  }
  if (from === 'codex') {
    notes.push({
      text: `Codex imports sessions from other agents but has no export command, so ${label(to)} cannot read Codex sessions natively. AgentDrive captures them through Codex's own hooks instead.`,
      source: CODEX_IMPORT,
    });
  }
  if (from === 'claude-code') {
    notes.push({
      text: 'Claude Code deletes local transcripts after 30 days by default (the cleanupPeriodDays setting), so the copy AgentDrive keeps is also your long-term record.',
      source: 'https://code.claude.com/docs/en/settings-reference#cleanupperioddays',
    });
  }
  if (from === 'gemini-cli' || to === 'gemini-cli') {
    notes.push({
      text: from === 'gemini-cli' && to === 'antigravity'
        ? 'Google retired Gemini CLI for personal accounts on June 18, 2026 and moved them to Antigravity CLI. AgentDrive carries your Gemini CLI session history across, so Antigravity can continue where Gemini CLI stopped.'
        : 'Google retired Gemini CLI for personal accounts on June 18, 2026 in favor of Antigravity CLI. This handoff still works wherever Gemini CLI runs.',
      source: 'https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/',
    });
  }
  return notes;
}

export interface Harness {
  id: PlatformId;
  label: string;
  profile: Profile;
}

export const HARNESSES: Harness[] = CAPTURE_HARNESSES.map((h) => ({ id: h.platform, label: h.label, profile: PROFILES[h.platform]! }));

function label(id: PlatformId): string {
  return HARNESSES.find((h) => h.id === id)!.label;
}

export interface Pair {
  slug: string;
  from: Harness;
  to: Harness;
  notes: Note[];
}

export const PAIRS: Pair[] = HARNESSES.flatMap((from) =>
  HARNESSES.filter((to) => to.id !== from.id).map((to) => ({
    slug: `${from.id}-to-${to.id}`,
    from,
    to,
    notes: notesFor(from.id, to.id),
  })),
);

export function getPair(slug: string): Pair | undefined {
  return PAIRS.find((p) => p.slug === slug);
}

export function pairSlug(from: PlatformId, to: PlatformId): string {
  return `${from}-to-${to}`;
}
