import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CliPreferences {
  // Inbound only. New sessions automatically know what you worked on before.
  // Safe to leave on — no data leaves your machine because of this.
  auto_context: boolean;
  // Files your agents write are saved to your AgentDrive workspace.
  // Off by default. When you turn it on, sensitive paths (.env, .ssh, .aws,
  // any match of common credential patterns) are filtered before upload.
  capture_artifacts: boolean;
  // Chat history is captured to your workspace so future sessions can
  // recall what was discussed. Off by default. Capture happens on your
  // device; redaction runs before anything leaves.
  capture_transcripts: boolean;
  // End-to-end encryption. Artifacts are encrypted on your device before
  // upload. AgentDrive stores ciphertext; only you and your agents can
  // read it. Off by default — enable per workspace.
  private_workspace: boolean;
  // Agent tools installed after `adrive init` are connected at the next
  // session start in any connected tool. Each tool is wired at most once, so
  // removing AgentDrive from one by hand sticks.
  auto_wire: boolean;
}

export const DEFAULT_PREFERENCES: CliPreferences = {
  auto_context: true,
  capture_artifacts: false,
  capture_transcripts: false,
  private_workspace: false,
  auto_wire: true,
};

export interface CliConfig {
  api_url: string;
  api_key?: string;
  agent_id?: string;
  org_id?: string;
  agent_platform?: string;
  agent_role?: string;
  default_workspace?: string;
  preferences?: CliPreferences;
  // Set when the one-time capture notice has been shown after login, so a
  // later `adrive privacy` opt-out is never flipped back on.
  capture_notice_at?: string;
  // Ids of agent tools AgentDrive has wired (claude-code, codex, cursor, ...).
  wired?: string[];
}

export const DEFAULT_API_URL = 'https://app.agentdrive.sh';

export function configDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(home, '.config');
  return join(base, 'agentdrive');
}

export function opencodeConfigDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode');
}

export function configPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(configDir(env, home), 'config.json');
}

export async function readConfig(path: string = configPath()): Promise<CliConfig | null> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      api_url: parsed.api_url ?? DEFAULT_API_URL,
      api_key: parsed.api_key,
      agent_id: parsed.agent_id,
      org_id: parsed.org_id,
      agent_platform: parsed.agent_platform ?? 'cli',
      agent_role: parsed.agent_role,
      default_workspace: parsed.default_workspace,
      preferences: { ...DEFAULT_PREFERENCES, ...(parsed.preferences ?? {}) },
      capture_notice_at: parsed.capture_notice_at,
      wired: Array.isArray(parsed.wired) ? parsed.wired.filter((w): w is string => typeof w === 'string') : undefined,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    throw err;
  }
}

// readConfig fills in default preferences, so this reads the raw file to tell
// a fresh install apart from one where the user already chose.
export async function hasSavedPreferences(path: string = configPath()): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<CliConfig> | null;
    return !!parsed?.preferences && typeof parsed.preferences === 'object';
  } catch {
    return false;
  }
}

export async function writeConfig(config: CliConfig, path: string = configPath()): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const payload = JSON.stringify(config, null, 2);
  await fs.writeFile(path, payload, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.chmod(path, 0o600);
  } catch {
    // chmod can fail on non-POSIX; permissions already set via writeFile mode.
  }
}

export async function deleteConfig(path: string = configPath()): Promise<boolean> {
  try {
    await fs.unlink(path);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return false;
    throw err;
  }
}

export async function requireLogin(path: string = configPath()): Promise<CliConfig & { api_key: string }> {
  const c = await readConfig(path);
  if (!c || !c.api_key) {
    throw new Error('Not logged in. Run `adrive auth login` first.');
  }
  return c as CliConfig & { api_key: string };
}
