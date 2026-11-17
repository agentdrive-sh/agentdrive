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
    body: 'Plugin from the agentdrive-sh/agentdrive-mcp marketplace. Captures sessions; resume with /agentdrive:resume.',
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
    platform: 'gemini-cli',
    label: 'Gemini CLI',
    body: 'Hooks and the MCP server in ~/.gemini/settings.json. Resume with /agentdrive:resume.',
  },
  {
    platform: 'antigravity',
    label: 'Antigravity',
    body: 'Hooks, the MCP server and skills in ~/.gemini/config, shared by the agy CLI, the app and the IDE. Ask it to resume.',
  },
];

export const MCP_CLIENTS: Integration[] = [
  { platform: 'cline', label: 'Cline', body: 'Wired into the Cline MCP settings by adrive init. Workspace tools only, no session capture.' },
  { platform: 'zed', label: 'Zed', body: 'Added to context_servers in Zed settings by adrive init. Workspace tools only, no session capture.' },
  { platform: 'continue', label: 'Continue', body: 'Added to ~/.continue/config.json by adrive init. Workspace tools only, no session capture.' },
];
