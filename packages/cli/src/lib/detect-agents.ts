import { promises as fs } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { readJsonObject, writeJsonIfChanged, type WriteAction } from './write-file.js';

// MCP-only clients. Claude Code is wired by its plugin, and Codex / OpenCode /
// Gemini CLI / Cursor / Antigravity get hooks + MCP + commands in harness-wiring.ts.
export interface AgentTarget {
  name: string;
  configPath: string;
  format: 'mcp-json' | 'zed-json' | 'continue-json';
  platform: string;
}

export interface DetectOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  osPlatform?: NodeJS.Platform;
}

export function getAgentTargets(opts: DetectOptions = {}): AgentTarget[] {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const os = opts.osPlatform ?? platform();
  // Linux apps (Electron, Zed) resolve their config under XDG_CONFIG_HOME; Zed on macOS always uses ~/.config.
  const xdgConfig = env.XDG_CONFIG_HOME || join(home, '.config');

  const claudeDesktop =
    os === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : os === 'win32'
        ? join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
        : join(xdgConfig, 'Claude', 'claude_desktop_config.json');

  return [
    {
      name: 'claude-desktop',
      configPath: claudeDesktop,
      format: 'mcp-json',
      platform: 'claude-code',
    },
    {
      name: 'continue',
      configPath: join(home, '.continue', 'config.json'),
      format: 'continue-json',
      platform: 'continue',
    },
    {
      name: 'zed',
      configPath: join(os === 'linux' ? xdgConfig : join(home, '.config'), 'zed', 'settings.json'),
      format: 'zed-json',
      platform: 'zed',
    },
    {
      name: 'cline',
      configPath:
        os === 'darwin'
          ? join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
          : join(xdgConfig, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      format: 'mcp-json',
      platform: 'cline',
    },
  ];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

// No API key here: the MCP server reads it from ~/.config/agentdrive/config.json,
// so harness configs never hold a secret.
export function mcpEntry(agentPlatform: string): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['-y', '@adrive/mcp-server'],
    env: { AGENTDRIVE_AGENT_PLATFORM: agentPlatform },
  };
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

export function mergeMcpJson(
  existing: Record<string, unknown> | null,
  agentPlatform: string,
): Record<string, unknown> {
  const base = asObject(existing);
  const servers = asObject(base.mcpServers);
  servers.agentdrive = mcpEntry(agentPlatform);
  base.mcpServers = servers;
  return base;
}

export function mergeContinueJson(existing: Record<string, unknown> | null): Record<string, unknown> {
  const base = asObject(existing);
  const list = Array.isArray(base.mcpServers) ? base.mcpServers : [];
  const filtered = list.filter((s) => asObject(s).name !== 'agentdrive');
  filtered.push({ name: 'agentdrive', ...mcpEntry('continue') });
  base.mcpServers = filtered;
  return base;
}

export function mergeZedJson(existing: Record<string, unknown> | null): Record<string, unknown> {
  const base = asObject(existing);
  const ctx = asObject(base.context_servers);
  ctx.agentdrive = mcpEntry('zed');
  base.context_servers = ctx;
  return base;
}

export function mergeOpencodeJson(existing: Record<string, unknown> | null): Record<string, unknown> {
  const base = asObject(existing);
  const mcp = asObject(base.mcp);
  mcp.agentdrive = {
    type: 'local',
    command: ['npx', '-y', '@adrive/mcp-server'],
    environment: { AGENTDRIVE_AGENT_PLATFORM: 'opencode' },
    enabled: true,
  };
  base.mcp = mcp;
  return base;
}

const CODEX_BLOCK =
  '[mcp_servers.agentdrive]\ncommand = "npx"\nargs = ["-y", "@adrive/mcp-server"]\n\n' +
  '[mcp_servers.agentdrive.env]\nAGENTDRIVE_AGENT_PLATFORM = "codex"\n' +
  // codex exec runs with approval policy "never", which refuses MCP calls unless the tool is pre-approved; only the read-only ones are.
  '\n[mcp_servers.agentdrive.tools.drive_sessions]\napproval_mode = "approve"\n' +
  '\n[mcp_servers.agentdrive.tools.drive_resume]\napproval_mode = "approve"\n';

const CODEX_BLOCK_TABLES = new Set(CODEX_BLOCK.match(/^\[.+\]$/gm));

// Line-based so every table we don't own keeps its exact text. Drops our
// [mcp_servers.agentdrive*] tables plus the [[mcp_servers]] name="agentdrive"
// array entry older CLIs wrote, which would make the file invalid TOML next
// to a [mcp_servers.*] table.
export function mergeCodexToml(existing: string): string {
  const sections: string[] = [];
  for (const line of existing.split(/(?<=\n)/)) {
    if (sections.length === 0 || /^\s*\[/.test(line)) sections.push(line);
    else sections[sections.length - 1] += line;
  }
  const kept = sections.filter((section, i) => {
    const header = section.split('\n', 1)[0]!.trim();
    if (i === 0 && !header.startsWith('[')) return true;
    if (/^\[mcp_servers\.agentdrive(\.[^\]]+)?\]$/.test(header)) {
      // Approvals the user added for other agentdrive tools are theirs to keep.
      return header.startsWith('[mcp_servers.agentdrive.tools.') && !CODEX_BLOCK_TABLES.has(header);
    }
    if (header === '[[mcp_servers]]' && /^\s*name\s*=\s*"agentdrive"\s*$/m.test(section)) return false;
    return true;
  });
  const rest = kept.join('').trimEnd();
  return rest ? `${rest}\n\n${CODEX_BLOCK}` : CODEX_BLOCK;
}

export async function wireAgent(target: AgentTarget): Promise<WriteAction> {
  const existing = await readJsonObject(target.configPath);
  if (existing === null) throw new Error(`Config not found: ${target.configPath}`);
  const merged =
    target.format === 'continue-json'
      ? mergeContinueJson(existing)
      : target.format === 'zed-json'
        ? mergeZedJson(existing)
        : mergeMcpJson(existing, target.platform);
  return writeJsonIfChanged(target.configPath, merged);
}

export async function detectInstalledAgents(opts: DetectOptions = {}): Promise<AgentTarget[]> {
  const present: AgentTarget[] = [];
  for (const t of getAgentTargets(opts)) {
    if (await fileExists(t.configPath)) present.push(t);
  }
  return present;
}
