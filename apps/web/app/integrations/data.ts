import type { Faq } from '@/components/marketing/answer-page';
import type { PlatformId } from '@/components/platform-glyph';

export interface Integration {
  platform: PlatformId;
  label: string;
  body: string;
}

export const INSTALL_COMMAND = 'curl -fsSL agentdrive.sh/install | sh';

export const CAPTURE_HARNESSES: Integration[] = [
  {
    platform: 'claude-code',
    label: 'Claude Code',
    body: 'Plugin from the agentdrive-sh/agentdrive-mcp marketplace. Syncs sessions; resume with /agentdrive:resume.',
  },
  {
    platform: 'codex',
    label: 'Codex',
    body: 'Hooks, MCP server and prompts in ~/.codex. Setup approves the hooks for you.',
  },
  {
    platform: 'opencode',
    label: 'OpenCode',
    body: 'A plugin in ~/.config/opencode/plugins plus the MCP server. Resume with /agentdrive-resume.',
  },
  {
    platform: 'cursor',
    label: 'Cursor',
    body: 'Hooks in ~/.cursor/hooks.json and the MCP server in ~/.cursor/mcp.json. Resume with /agentdrive-resume.',
  },
  {
    platform: 'antigravity',
    label: 'Antigravity',
    body: 'Hooks, the MCP server and skills in ~/.gemini/config, shared by the agy CLI, the app and the IDE. Ask it to resume.',
  },
];

export const MCP_CLIENTS: Integration[] = [
  { platform: 'cline', label: 'Cline', body: 'Wired into the Cline MCP settings by adrive init. Workspace tools only, no session sync.' },
  { platform: 'zed', label: 'Zed', body: 'Added to context_servers in Zed settings by adrive init. Workspace tools only, no session sync.' },
  { platform: 'continue', label: 'Continue', body: 'Added to ~/.continue/config.json by adrive init. Workspace tools only, no session sync.' },
];

export interface IntegrationPage {
  title: string;
  description: string;
  answer: string;
  files: { path: string; what: string }[];
  faq: Faq[];
}

const INSTALL = `\`${INSTALL_COMMAND}\``;

// From packages/cli/src/lib/harness-wiring.ts and wire-all.ts; backticks mark inline code.
export const INTEGRATION_PAGES: Record<string, IntegrationPage> = {
  'claude-code': {
    title: 'Connect Claude Code to AgentDrive',
    description: 'Install the AgentDrive plugin in Claude Code to sync sessions in the background and resume work from Codex, OpenCode, Cursor or Antigravity.',
    answer: 'To connect Claude Code to AgentDrive, run `/plugin marketplace add agentdrive-sh/agentdrive-mcp` and `/plugin install agentdrive@agentdrive` inside Claude Code, then `/agentdrive:login` to sign in. The plugin adds session sync hooks, the MCP server and `/agentdrive:resume`, so Claude Code and your other agents can resume each other\'s sessions.',
    files: [
      { path: 'agentdrive@agentdrive (user scope)', what: 'Init does not write Claude Code files itself. When `claude` is on your PATH it runs `claude plugin install agentdrive@agentdrive -s user`, adding the `agentdrive-sh/agentdrive-mcp` marketplace first if it is missing.' },
      { path: 'Plugin hooks', what: '`SessionStart`, `Stop`, `SessionEnd` and `PreCompact`, each running `adrive hook claude-code`.' },
      { path: 'Plugin commands and skill', what: '`/agentdrive:resume`, `/agentdrive:sessions`, `/agentdrive:login`, the `agentdrive` skill and the AgentDrive MCP server.' },
      { path: '`~/.claude/skills/agentdrive/SKILL.md`', what: 'Removed if CLI 1.0.0 left it there, because the plugin now ships the skill.' },
    ],
    faq: [
      {
        q: 'Can the installer set up the Claude Code plugin for me?',
        a: `Yes. When \`~/.claude\` exists and \`claude\` is on your PATH, ${INSTALL} installs the plugin at user scope. If \`claude\` is missing or the install fails, it prints the two \`/plugin\` commands to run inside Claude Code.`,
      },
      {
        q: 'Which Claude Code events sync a session?',
        a: '`SessionStart`, `Stop`, `SessionEnd` and `PreCompact`. Each hook starts a detached `adrive sync` and returns, so Claude Code never waits on it. Turn ends re-sync at most every two minutes; session end and compaction always sync.',
      },
      {
        q: 'How do I resume a Codex or Cursor session in Claude Code?',
        a: 'Run `/agentdrive:resume`. With no id it loads the latest session in this project from a different agent. `/agentdrive:sessions` lists sessions to choose from.',
      },
      {
        q: 'How do I control what Claude Code syncs?',
        a: 'Run `adrive privacy` to switch transcript sync, artifact sync, auto-context and Private Workspace on or off. `adrive privacy --show` prints the current settings.',
      },
    ],
  },
  codex: {
    title: 'Connect Codex to AgentDrive',
    description: 'Wire AgentDrive into Codex with one command: session sync hooks, the MCP server and resume prompts, so Codex picks up work other agents started.',
    answer: `To connect Codex to AgentDrive, run ${INSTALL}. It signs you in, adds session sync hooks to \`~/.codex/hooks.json\`, the MCP server to \`~/.codex/config.toml\` and the \`agentdrive-resume\` prompt, then approves the hooks. Codex sessions sync in the background, and Codex can resume sessions your other agents started.`,
    files: [
      { path: '`~/.codex/hooks.json`', what: 'A hook on `SessionStart`, `Stop`, `SessionEnd` and `PreCompact` running `adrive hook codex`, with a 3-second timeout.' },
      { path: '`~/.codex/config.toml`', what: 'The AgentDrive MCP server. The original file is kept as `config.toml.bak` the first time.' },
      { path: '`~/.codex/prompts/agentdrive-resume.md`, `agentdrive-sessions.md`', what: 'Custom prompts that call `drive_resume` and `drive_sessions`.' },
      { path: '`~/.codex/skills/agentdrive/SKILL.md`', what: 'The AgentDrive skill.' },
      { path: 'Codex hook approval', what: 'Set through `codex app-server`, the way the `/hooks` screen does, for the exact hook commands init wrote.' },
    ],
    faq: [
      {
        q: 'Do I have to approve the AgentDrive hooks in Codex?',
        a: 'Setup approves them for you, and only the hook commands it wrote in your user-level `hooks.json`. If that fails, for example on an older Codex, approve them once via `/hooks`.',
      },
      {
        q: 'Does setup respect CODEX_HOME?',
        a: 'Yes. Every Codex file goes to `$CODEX_HOME` when it is set, and to `~/.codex` otherwise.',
      },
      {
        q: 'How do I resume another agent\'s session in Codex?',
        a: 'Run the `agentdrive-resume` custom prompt, or ask Codex to resume your last AgentDrive session from a named agent. Both call `drive_resume`. From a shell, `adrive resume` prints the same brief.',
      },
      {
        q: 'Why does the Codex hook return so quickly?',
        a: 'Codex caps hook time at 3 seconds, so the hook only starts a detached `adrive sync` and returns. The upload finishes in the background.',
      },
    ],
  },
  opencode: {
    title: 'Connect OpenCode to AgentDrive',
    description: 'Add the AgentDrive plugin, MCP server and resume command to OpenCode so its sessions sync in the background and it can resume other agents\' work.',
    answer: `To connect OpenCode to AgentDrive, run ${INSTALL}. It signs you in, writes a plugin to \`~/.config/opencode/plugins/agentdrive.ts\`, adds the MCP server to \`opencode.json\` and installs \`/agentdrive-resume\`. OpenCode sessions then sync in the background, and OpenCode can resume sessions your other agents started.`,
    files: [
      { path: '`~/.config/opencode/plugins/agentdrive.ts`', what: 'Listens for `session.created` and `session.idle` and hands each one to `adrive hook opencode`. Re-running init overwrites it.' },
      { path: '`~/.config/opencode/opencode.json`', what: 'The AgentDrive MCP server, merged into your existing config. The original is kept as `opencode.json.bak` the first time.' },
      { path: '`~/.config/opencode/commands/agentdrive-resume.md`, `agentdrive-sessions.md`', what: 'The `/agentdrive-resume` and `/agentdrive-sessions` commands.' },
      { path: '`~/.config/opencode/skills/agentdrive/SKILL.md`', what: 'The AgentDrive skill.' },
    ],
    faq: [
      {
        q: 'What if my OpenCode config is opencode.jsonc?',
        a: 'If only `opencode.jsonc` exists and it is plain JSON, setup merges into it. If it has comments, setup leaves it alone and tells you to add the MCP entry by hand, so the comments survive.',
      },
      {
        q: 'Does the plugin slow OpenCode down?',
        a: 'No. It hands each event to a detached `adrive` process and never waits on it or surfaces its errors, so a slow or missing CLI cannot stall OpenCode.',
      },
      {
        q: 'Why doesn\'t OpenCode mention my other agents\' sessions at startup?',
        a: 'OpenCode\'s plugin API cannot inject context at session start. Run `/agentdrive-sessions` to list recent sessions from your other agents, then `/agentdrive-resume`.',
      },
      {
        q: 'Does setup follow XDG_CONFIG_HOME?',
        a: 'Yes. It writes to `$XDG_CONFIG_HOME/opencode` when that is set, and to `~/.config/opencode` otherwise.',
      },
    ],
  },
  cursor: {
    title: 'Connect Cursor to AgentDrive',
    description: 'Merge AgentDrive hooks and its MCP server into Cursor so agent sessions sync in the background and /agentdrive-resume picks up other agents\' work.',
    answer: `To connect Cursor to AgentDrive, run ${INSTALL}, then reload the Cursor window. It signs you in, merges sync hooks into \`~/.cursor/hooks.json\` and the MCP server into \`~/.cursor/mcp.json\`, and adds \`/agentdrive-resume\`. Cursor agent sessions then sync in the background, and Cursor can resume your other agents' sessions.`,
    files: [
      { path: '`~/.cursor/hooks.json`', what: 'An entry on `sessionStart`, `stop`, `sessionEnd` and `preCompact` running `adrive hook cursor`, merged beside your own hooks.' },
      { path: '`~/.cursor/mcp.json`', what: 'The `agentdrive` MCP server, added to your existing `mcpServers`.' },
      { path: '`~/.cursor/commands/agentdrive-resume.md`, `agentdrive-sessions.md`', what: 'The `/agentdrive-resume` and `/agentdrive-sessions` commands.' },
      { path: '`~/.cursor/skills/agentdrive/SKILL.md`', what: 'The AgentDrive skill.' },
    ],
    faq: [
      {
        q: 'Do I need to restart Cursor after setup?',
        a: 'Reload the window (Cmd-Shift-P, then Developer: Reload Window) so Cursor loads the new hooks and the MCP server.',
      },
      {
        q: 'Will setup overwrite my existing Cursor hooks?',
        a: 'No. It replaces only its own entry in each hook event and leaves other hooks in their order, so re-running setup gives the same file. The original `hooks.json` is kept as `hooks.json.bak` the first time.',
      },
      {
        q: 'Why is an older Cursor session not matched to my project?',
        a: 'Cursor transcripts don\'t store the project directory, so the AgentDrive hook records it from Cursor\'s workspace roots while a session runs. Sessions that ended before setup sync under an unknown project.',
      },
      {
        q: 'How do I resume a Claude Code or Codex session in Cursor?',
        a: 'Run `/agentdrive-resume`, or ask in chat to resume your last AgentDrive session from that agent. Cursor calls `drive_resume` and gets the goal, files touched and recent turns.',
      },
    ],
  },
  antigravity: {
    title: 'Connect Antigravity to AgentDrive',
    description: 'Set up AgentDrive for the Antigravity CLI, app and IDE in one step: a sync hook, the MCP server and resume skills under ~/.gemini/config.',
    answer: `To connect Antigravity to AgentDrive, run ${INSTALL}. It signs you in, merges a hook into \`~/.gemini/config/hooks.json\` and the MCP server into \`~/.gemini/config/mcp_config.json\`, and adds the \`agentdrive-resume\` skill. One setup covers the \`agy\` CLI, the Antigravity app and the IDE, which share that folder.`,
    files: [
      { path: '`~/.gemini/config/hooks.json`', what: 'An `agentdrive` hook on `SessionStart` and `Stop`. An `enabled: false` you set on it survives re-running setup.' },
      { path: '`~/.gemini/config/mcp_config.json`', what: 'The AgentDrive MCP server, merged into your existing config.' },
      { path: '`~/.gemini/config/skills/agentdrive-resume/SKILL.md`, `agentdrive-sessions/SKILL.md`', what: 'The resume and sessions skills; Antigravity has no custom commands.' },
      { path: '`~/.gemini/config/skills/agentdrive/SKILL.md`', what: 'The AgentDrive skill.' },
      { path: '`~/.gemini/settings.json`, `~/.gemini/commands/agentdrive/`', what: 'Also created or updated with hooks, the MCP server and `resume` and `sessions` commands.' },
    ],
    faq: [
      {
        q: 'Which Antigravity products does one setup cover?',
        a: 'The `agy` CLI, the Antigravity app and the Antigravity IDE all read `~/.gemini/config`, so one setup wires all three, and sync reads each one\'s transcripts.',
      },
      {
        q: 'How do I resume another agent\'s session in Antigravity?',
        a: 'Ask it to resume your last AgentDrive session from that agent. Resume is the `agentdrive-resume` skill rather than a slash command, and it calls `drive_resume`.',
      },
      {
        q: 'When is an Antigravity session marked finished?',
        a: 'Antigravity has no session-end event, so a session is marked finished after 30 minutes idle.',
      },
      {
        q: 'Why is an older Antigravity session not matched to my project?',
        a: 'Antigravity transcripts don\'t store the project directory, so the AgentDrive hook records the workspace Antigravity reports while a session runs. Sessions that ended before setup sync under an unknown project.',
      },
    ],
  },
};
