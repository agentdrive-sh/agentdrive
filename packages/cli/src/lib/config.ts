import { promises as fs, statSync, unlinkSync, type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { historyTemp, recordToggles, snapshotHistory, type Toggles } from './privacy-history.js';

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

// One writer at a time, across processes: an O_EXCL lockfile beside config.json. A read,
// change and write of the config (adrive privacy, sign-in, init, auto-wire, logout) and the
// privacy history it records all happen under it, so none undoes another's change.
const LOCK_STALE_MS = 10_000;
// A lock whose holder is still running on this machine is left alone up to this age: a
// holder that was stopped or asleep would otherwise write over the change made meanwhile.
const LOCK_DEAD_MS = 120_000;
const LOCK_POLL_MS = 20;
const LOCK_ATTEMPTS = 3;

export class ConfigLockedError extends Error {}
// The lock was taken over as stale while this process held it, so what it read may be old.
class LockLostError extends ConfigLockedError {}

type LockId = Pick<BigIntStats, 'dev' | 'ino' | 'mtimeNs'>;

function sameFile(a: LockId, b: LockId): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mtimeNs === b.mtimeNs;
}

function owns(lock: string, id: LockId): boolean {
  try {
    return sameFile(statSync(lock, { bigint: true }), id);
  } catch {
    return false;
  }
}

// SIGINT's process.exit skips finally blocks: the lock held and the temp files written now
// are removed on exit, the lock only while it is still this process's.
const atExit = new Map<string, LockId | null>();
let exitHook = false;
function removeAtExit(path: string, id: LockId | null = null): void {
  if (!exitHook) {
    exitHook = true;
    process.on('exit', () => {
      for (const [p, lockId] of atExit) {
        try {
          if (!lockId || owns(p, lockId)) unlinkSync(p);
        } catch {
          // Already gone.
        }
      }
    });
  }
  atExit.set(path, id);
}

function holderAlive(owner: string): boolean {
  const at = owner.indexOf('@');
  const pid = Number(owner.slice(0, at));
  // On another machine, or written by an older CLI: its age alone decides.
  if (at < 1 || !Number.isInteger(pid) || owner.slice(at + 1) !== hostname()) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// A crashed holder's lock goes stale rather than blocking writes for good. Waiters break it
// one at a time, under a lock of their own, and only while it is still the stale file seen
// here: a waiter that saw it stale must not remove the lock another has just taken (renaming
// it aside and back leaves a gap in which a third takes the path).
async function breakIfStale(lock: string): Promise<boolean> {
  const st = await fs.stat(lock, { bigint: true }).catch(() => null);
  const age = st ? Date.now() - Number(st.mtimeNs / 1_000_000n) : 0;
  if (!st || age <= LOCK_STALE_MS) return false;
  if (age <= LOCK_DEAD_MS && holderAlive(await fs.readFile(lock, 'utf8').catch(() => ''))) return false;
  const breaking = `${lock}.break`;
  try {
    await (await fs.open(breaking, 'wx', 0o600)).close();
  } catch {
    // Another waiter is breaking it, or died doing so, which takes milliseconds.
    const other = await fs.stat(breaking).catch(() => null);
    if (other && Date.now() - other.mtimeMs > LOCK_STALE_MS) await fs.rm(breaking, { force: true });
    return false;
  }
  removeAtExit(breaking);
  try {
    const now = await fs.stat(lock, { bigint: true }).catch(() => null);
    if (!now || !sameFile(now, st)) return false;
    await fs.rm(lock, { force: true });
    return true;
  } finally {
    atExit.delete(breaking);
    await fs.rm(breaking, { force: true });
  }
}

async function acquire(lock: string, waitMs: number): Promise<LockId> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    let file: FileHandle;
    try {
      file = await fs.open(lock, 'wx', 0o600);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // EPERM: Windows, while the last holder's lock is still being deleted.
      if (code !== 'EEXIST' && code !== 'EPERM') throw err;
      if (await breakIfStale(lock)) continue;
      if (Date.now() >= deadline) throw new ConfigLockedError(`${lock.slice(0, -'.lock'.length)} is being updated by another adrive process; try again`);
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
      continue;
    }
    try {
      // Who holds it, for breakIfStale. A failed write (a file-size limit, say) removes the lock.
      await file.writeFile(`${process.pid}@${hostname()}`);
      const st = await file.stat({ bigint: true });
      await file.close();
      return { dev: st.dev, ino: st.ino, mtimeNs: st.mtimeNs };
    } catch (err) {
      await file.close().catch(() => undefined);
      await fs.rm(lock, { force: true });
      throw err;
    }
  }
}

// `fn` gets `held`, which throws unless the lock is still this process's. It is called
// right before each write is committed, so a holder whose lock was taken over writes
// nothing, and the whole update starts over from a fresh read.
export async function withConfigLock<T>(path: string, fn: (held: () => void) => Promise<T>, waitMs = 5_000): Promise<T> {
  const lock = `${path}.lock`;
  const historyTmp = historyTemp(dirname(path));
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 1; ; attempt++) {
    const id = await acquire(lock, waitMs);
    removeAtExit(lock, id);
    removeAtExit(historyTmp);
    try {
      return await fn(() => {
        if (!owns(lock, id)) throw new LockLostError(`${path} was taken over by another adrive process; try again`);
      });
    } catch (err) {
      if (!(err instanceof LockLostError) || attempt === LOCK_ATTEMPTS) throw err;
    } finally {
      atExit.delete(lock);
      atExit.delete(historyTmp);
      try {
        if (owns(lock, id)) unlinkSync(lock);
      } catch {
        // Already gone.
      }
    }
  }
}

// Reads, changes and writes config.json under the lock. `fn` gets the config as it is now,
// with preferences unset unless they were saved (spreading readConfig's defaults back in
// would save a sync-off nobody chose), and returns the one to write, or null to leave it.
// `effectiveBefore`: compare the toggles with what was in effect, defaults included; only
// adrive privacy, which the user just ran, knows that is what they changed.
export async function updateConfig(
  fn: (current: CliConfig | null) => CliConfig | null | Promise<CliConfig | null>,
  opts: { path?: string; effectiveBefore?: boolean } = {},
): Promise<{ before: CliConfig | null; after: CliConfig | null }> {
  const path = opts.path ?? configPath();
  return withConfigLock(path, async (held) => {
    const read = await readConfig(path);
    const before = read && !(await hasSavedPreferences(path)) ? { ...read, preferences: undefined } : read;
    const after = await fn(before);
    if (after) await write(after, path, held, opts.effectiveBefore && read ? { ...DEFAULT_PREFERENCES, ...read.preferences } : undefined);
    return { before, after };
  });
}

// For a command that chose `next` from `base`, a config it read before it prompted or
// signed in: the fields it changed, applied to `latest`, the config as it is under the
// lock. A field another process changed since `base` (adrive privacy, say) keeps that
// newer value. `base` must come from updateConfig (preferences unset unless saved).
export function changesOnto(latest: CliConfig, base: CliConfig | null, next: CliConfig): CliConfig {
  const merged: Record<string, unknown> = { ...latest };
  const was: Record<string, unknown> = { ...base };
  const now: Record<string, unknown> = { ...latest };
  for (const [key, value] of Object.entries(next)) {
    const from = JSON.stringify(was[key]);
    if (JSON.stringify(value) !== from && JSON.stringify(now[key]) === from) merged[key] = value;
  }
  return merged as unknown as CliConfig;
}

// What a running sync or watch uploads under, named, if it changed since `start`: carrying on
// would send later uploads to another account or workspace, or unencrypted.
export function changedSince(start: CliConfig | null, now: CliConfig | null, opts: { workspace?: boolean } = {}): string | null {
  if (now?.api_key !== start?.api_key || now?.api_url !== start?.api_url) return 'The signed-in account';
  if (opts.workspace !== false && now?.default_workspace !== start?.default_workspace) return 'The default workspace';
  if (!!now?.preferences?.private_workspace !== !!start?.preferences?.private_workspace) return 'Private Workspace';
  return null;
}

export async function writeConfig(config: CliConfig, path: string = configPath()): Promise<void> {
  await withConfigLock(path, (held) => write(config, path, held));
}

// Brings the privacy history in line with config.json under the same lock, so the two
// never disagree. Short wait by default: a hook can't stall the agent on it.
export async function reconcileHistory(path: string = configPath(), waitMs = 300): ReturnType<typeof recordToggles> {
  return withConfigLock(path, (held) => recordToggles(path, undefined, undefined, undefined, held), waitMs);
}

async function write(config: CliConfig, path: string, held: () => void, before?: Toggles): Promise<void> {
  // A config.json linked from a dotfiles folder stays a link: the file it points at is replaced.
  const target = await fs.realpath(path).catch(() => path);
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  // Written whole and renamed into place: a hook or sync reading it mid-write must never
  // see a torn file. It is ready before the history changes, so only the rename can fail
  // after that. A failure at any step removes the temp file.
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  removeAtExit(tmp);
  try {
    const file = await fs.open(tmp, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(config, null, 2), 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    // The history first, so no toggle changes without its off interval.
    const undo = await snapshotHistory(dirname(path));
    try {
      await recordToggles(path, config, before, undefined, held);
      held();
      await fs.rename(tmp, target);
    } catch (err) {
      // config.json is unchanged, so its history change is put back. Not when the lock was
      // lost: another writer may have changed the history since, and the retry reconciles it.
      if (!(err instanceof LockLostError)) await undo(held).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  } finally {
    atExit.delete(tmp);
  }
}

export async function deleteConfig(path: string = configPath()): Promise<boolean> {
  return withConfigLock(path, async (held) => {
    held();
    try {
      await fs.unlink(path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  });
}

export async function requireLogin(path: string = configPath()): Promise<CliConfig & { api_key: string }> {
  const c = await readConfig(path);
  if (!c || !c.api_key) {
    throw new Error('Not logged in. Run `adrive auth login` first.');
  }
  return c as CliConfig & { api_key: string };
}
