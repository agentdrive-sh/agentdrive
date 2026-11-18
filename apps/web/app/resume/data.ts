import type { Faq } from '@/components/marketing/answer-page';
import type { PlatformId } from '@/components/platform-glyph';
import { CAPTURE_HARNESSES, INSTALL_COMMAND } from '../integrations/data';

interface Profile {
  setup?: string;
  capture: string;
  command?: string;
  syncShort: string;
  resumeShort: string;
  list: string;
}

// Mirrors the per-harness integration pages; keep the two in step. Backticks mark inline code.
const PROFILES: Record<string, Profile> = {
  'claude-code': {
    setup: 'In Claude Code you can install the plugin instead: `/plugin marketplace add agentdrive-sh/agentdrive-mcp`, then `/plugin install agentdrive@agentdrive`.',
    capture: 'The AgentDrive plugin hooks `SessionStart`, `Stop`, `SessionEnd` and `PreCompact`, and hands each session to a background sync, so Claude Code never waits on it.',
    command: '/agentdrive:resume',
    syncShort: 'the Claude Code plugin syncs each session in the background',
    resumeShort: 'run `/agentdrive:resume`',
    list: '`/agentdrive:sessions`',
  },
  codex: {
    setup: 'Setup approves the AgentDrive hooks in Codex for you. On an older Codex, approve them once via `/hooks`.',
    capture: 'Hooks in `~/.codex/hooks.json` fire on `SessionStart`, `Stop`, `SessionEnd` and `PreCompact`. Codex allows a `SessionEnd` hook at most 3 seconds, so every AgentDrive hook uses a 3-second timeout and only starts a background sync.',
    command: '$agentdrive resume my last AgentDrive session',
    syncShort: 'hooks in `~/.codex` sync each Codex session in the background',
    resumeShort: 'ask it to resume your session, or mention the AgentDrive skill with `$agentdrive`',
    list: 'a plain request such as "list my AgentDrive sessions"',
  },
  opencode: {
    capture: 'A plugin at `~/.config/opencode/plugins/agentdrive.ts` listens for `session.created` and `session.idle` and reads the session through `opencode export`, without ever blocking OpenCode.',
    command: '/agentdrive-resume',
    syncShort: 'an OpenCode plugin syncs each session whenever it goes idle',
    resumeShort: 'run `/agentdrive-resume`',
    list: '`/agentdrive-sessions`',
  },
  cursor: {
    setup: 'Reload Cursor after setup (Developer: Reload Window) so it picks up the hooks and the MCP server.',
    capture: 'Hooks in `~/.cursor/hooks.json` fire on `sessionStart`, `stop`, `sessionEnd` and `preCompact`, and hand the session to a background sync.',
    command: '/agentdrive-resume',
    syncShort: 'hooks in `~/.cursor/hooks.json` sync each Cursor agent session',
    resumeShort: 'run `/agentdrive-resume`',
    list: '`/agentdrive-sessions`',
  },
  antigravity: {
    capture: 'A hook in `~/.gemini/config/hooks.json` fires on `SessionStart` and `Stop`. Antigravity has no session-end event, so a session counts as finished after 30 minutes idle.',
    syncShort: 'a hook in `~/.gemini/config` syncs each Antigravity session',
    resumeShort: 'ask it to resume your session (the `agentdrive-resume` skill)',
    list: 'the `agentdrive-sessions` skill',
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
  if (to === 'codex') {
    notes.push({
      text: 'In Codex you call a skill by name by typing $ to mention it, so $agentdrive invokes the AgentDrive skill that setup installs. Codex has replaced custom prompts with skills, and current Codex no longer runs the /prompts:agentdrive-resume prompt that setup also writes.',
      source: 'https://learn.chatgpt.com/docs/build-skills',
    });
  }
  if (to === 'codex' && (from === 'claude-code' || from === 'cursor')) {
    notes.push({
      text: `Codex can pull recent ${label(from)} sessions in by itself with /import: the 50 most recent from the last 30 days, one way, on one machine. Use it for a one-time move. Use AgentDrive when you switch back and forth, need older sessions, or hand off to another machine or a teammate.`,
      source: CODEX_IMPORT,
    });
  }
  if (from === 'codex') {
    notes.push({
      text: `Codex imports sessions from other agents but has no export command, so ${label(to)} cannot read Codex sessions natively. AgentDrive syncs them through Codex's own hooks instead.`,
      source: CODEX_IMPORT,
    });
  }
  if (from === 'claude-code') {
    notes.push({
      text: 'Claude Code deletes local transcripts after 30 days by default (the cleanupPeriodDays setting), so the copy AgentDrive keeps is also your long-term record.',
      source: 'https://code.claude.com/docs/en/settings-reference#cleanupperioddays',
    });
  }
  return notes;
}

export interface Harness {
  id: PlatformId;
  label: string;
  article: 'a' | 'an';
  profile: Profile;
}

export const HARNESSES: Harness[] = CAPTURE_HARNESSES.map((h) => ({
  id: h.platform,
  label: h.label,
  article: /^[AEIOU]/.test(h.label) ? 'an' : 'a',
  profile: PROFILES[h.platform]!,
}));

function label(id: PlatformId): string {
  return HARNESSES.find((h) => h.id === id)!.label;
}

export interface Step {
  name: string;
  text: string;
  code?: string;
}

export interface Pair {
  slug: string;
  from: Harness;
  to: Harness;
  notes: Note[];
  answer: string;
  steps: Step[];
  caveats: string[];
  faq: Faq[];
}

function answerFor(from: Harness, to: Harness): string {
  return `To continue ${from.article} ${from.label} session in ${to.label}, install AgentDrive once with \`${INSTALL_COMMAND}\`. After that, ${from.profile.syncShort}. Open ${to.label} in the same project and ${to.profile.resumeShort}. ${to.label} loads a handoff brief with the goal, the files touched and the recent turns.`;
}

function stepsFor(from: Harness, to: Harness): Step[] {
  const setup = [from.profile.setup, to.profile.setup].filter(Boolean).join(' ');
  return [
    {
      name: 'Install AgentDrive',
      text: `Run \`${INSTALL_COMMAND}\`. It signs you in and wires session sync and resume into every agent it finds on this machine, ${from.label} and ${to.label} included.${setup ? ` ${setup}` : ''}`,
      code: INSTALL_COMMAND,
    },
    {
      name: `Work in ${from.label} as usual`,
      text: `${from.profile.capture} The sync uploads the redacted transcript, plus files the agent wrote that git doesn't track, to \`sessions/<project>/${from.id}/<session>.md\` in your workspace. Before you switch, leave a clear goal and next step in the session; the brief carries them over.`,
    },
    {
      name: `Resume in ${to.label}`,
      text: `Open ${to.label} in the same project and ${to.profile.resumeShort}. It calls \`drive_resume\`, which loads the latest session in this project from a different agent. If you run several agents, ask for the session from ${from.label} by name, or list sessions with ${to.profile.list} and pass an id.`,
      code: to.profile.command,
    },
    {
      name: 'Check the files before continuing',
      text: `Ask ${to.label} to check the files on disk before it continues: the brief says what happened, the repo says what is true now.`,
    },
  ];
}

const MISSING_CWD = new Set<PlatformId>(['cursor', 'antigravity']);
const HAS_SESSION_END = new Set<PlatformId>(['claude-code', 'codex', 'cursor']);

// Each line restates code behavior; the source is named in the comment beside it.
function caveatsFor(from: Harness, to: Harness): string[] {
  const out: string[] = [];
  // packages/mcp-server/src/transcripts/{cursor,antigravity}.ts, packages/cli/src/commands/hook.ts, packages/cli/src/lib/sync.ts
  if (MISSING_CWD.has(from.id)) {
    out.push(`${from.label} transcripts don't record the project directory, so the AgentDrive hook records it while the session runs. ${from.article === 'an' ? 'An' : 'A'} ${from.label} session that ended before the hook was installed has no recorded directory: it is filed under an unknown project and can't be matched to this one.`);
  }
  // packages/cli/src/commands/hook.ts (START_EVENTS, FORCE_EVENTS, TURN_EVENTS)
  if (HAS_SESSION_END.has(from.id)) {
    out.push(`Ending the session in ${from.label} triggers a sync right away. Turn-end events re-sync at most every two minutes, so end or compact the session if you switch mid-task.`);
  } else if (from.id === 'antigravity') {
    out.push('Antigravity has no session-end event. Turn-end events re-sync at most every two minutes, and a session is marked finished after 30 minutes idle.');
  } else {
    out.push('The OpenCode plugin listens for `session.created` and `session.idle` only. Every idle event forces a sync, so the session is uploaded each time it goes idle.');
  }
  if (from.id === 'codex') {
    out.push('Codex runs only hooks you have approved. Setup approves the AgentDrive hooks; on an older Codex, approve them once via `/hooks`.');
  }
  // packages/cli/src/commands/hook.ts (formatContext)
  if (to.id === 'opencode') {
    out.push(`OpenCode's plugin API can't add context at session start, so OpenCode won't mention the ${from.label} session on its own. Run \`/agentdrive-sessions\` to see it.`);
  } else {
    out.push(`With auto-context on, ${to.label} is told at session start about up to three recent sessions in this project, the newest from each other agent first, so the ${from.label} session shows up before you ask.`);
  }
  if (to.id === 'antigravity') {
    out.push('Antigravity has no custom commands, so resume is a skill: ask for it in plain words.');
  }
  return out;
}

function faqFor(from: Harness, to: Harness): Faq[] {
  const faq: Faq[] = [
    {
      q: `How do I pick a specific ${from.label} session in ${to.label}?`,
      a: `List sessions with ${to.profile.list}. It calls \`drive_sessions\`, which takes a platform filter, so asking for \`${from.id}\` sessions shows only ${from.label}'s. Then resume with the session id.`,
    },
    {
      q: `Do ${from.label} and ${to.label} need to be on the same machine?`,
      a: `No. Signed-in sessions sync to your workspace, so ${to.label} can resume ${from.article} ${from.label} session from another machine with the same AgentDrive account. With a git remote, the project is keyed by the normalized remote, so any clone of the repo matches. Without an account, \`adrive resume\` reads only this machine's local transcripts.`,
    },
  ];
  if (MISSING_CWD.has(from.id)) {
    faq.push({
      q: `Why can't ${to.label} find an older ${from.label} session?`,
      a: `${from.label} transcripts don't store the project directory, and the AgentDrive hook records it only for sessions that ran after setup. Older ${from.label} sessions sync under an unknown project, so a resume from this project can't match them.`,
    });
  } else if (from.id === 'claude-code') {
    faq.push({
      q: 'How long is the Claude Code session kept?',
      a: 'Claude Code deletes its local transcripts after 30 days by default (`cleanupPeriodDays`). The synced copy stays in your AgentDrive workspace, as a redacted transcript you can search later.',
    });
  } else if (from.id === 'codex') {
    faq.push({
      q: 'Why does the Codex hook only start a background sync?',
      a: 'Codex allows a `SessionEnd` hook at most 3 seconds, and one AgentDrive hook serves every event, so it starts a detached `adrive sync` and returns. The upload finishes after the hook exits and never slows Codex down.',
    });
  } else {
    faq.push({
      q: 'When does an OpenCode session sync?',
      a: 'The plugin hands the session to `adrive` on `session.created` and `session.idle`, without waiting on it. The sync reads the session through `opencode export` and uploads the redacted transcript.',
    });
  }
  faq.push({
    q: `Can I hand the work back from ${to.label} to ${from.label}?`,
    a: `Yes. Sync runs in both directions: ${to.label} sessions sync too, and in ${from.label} you ${from.profile.resumeShort} to load the latest session from another agent.`,
  });
  return faq;
}

export const PAIRS: Pair[] = HARNESSES.flatMap((from) =>
  HARNESSES.filter((to) => to.id !== from.id).map((to) => ({
    slug: `${from.id}-to-${to.id}`,
    from,
    to,
    notes: notesFor(from.id, to.id),
    answer: answerFor(from, to),
    steps: stepsFor(from, to),
    caveats: caveatsFor(from, to),
    faq: faqFor(from, to),
  })),
);

export function getPair(slug: string): Pair | undefined {
  return PAIRS.find((p) => p.slug === slug);
}

export function pairSlug(from: PlatformId, to: PlatformId): string {
  return `${from}-to-${to}`;
}
