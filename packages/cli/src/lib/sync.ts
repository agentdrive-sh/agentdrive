import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PROJECT_KEY_VERSION, projectKeyFor, scopeProjectKey } from '@adrive/mcp-server/project';
import { renderSession, sessionPath, sessionRunId, type SessionHarness } from '@adrive/mcp-server/session';
import { ApiError, CliApiClient, type UsageWarning } from './api-client.js';
import { ConfigLockedError, changedSince, configDir as defaultConfigDir, readConfig, reconcileHistory, type CliConfig } from './config.js';
import { encryptContentAsync } from './crypto.js';
import { DENY_RULES, loadRules, shouldIgnore } from './ignore.js';
import { HARNESSES, SOURCES } from '@adrive/mcp-server/local';
import { redact, summarizeHits } from '@adrive/mcp-server/redactor';
import { readSessionCwds } from '@adrive/mcp-server/transcripts/session-cwd';
import type { TranscriptEntry, TranscriptSource } from '@adrive/mcp-server/transcripts/types';
import { mtimeOf } from '@adrive/mcp-server/transcripts/util';
import { autoWire, type AutoWireOptions } from './auto-wire.js';
import { changedWhileOff, fileHeldBack, historyPath, overlapsOff, readHistory, type PrivacyHistory } from './privacy-history.js';
import { readVetted } from './safe-read.js';
import { readUsageNotice, writeUsageNotice } from './usage-notice.js';

const DEBOUNCE_MS = 120_000;
const FIRST_SWEEP_MS = 14 * 24 * 60 * 60_000;
const SWEEP_CAP = 50;
const LOCK_STALE_MS = 10 * 60_000;
// Hook events fire in bursts; a detached sync waits its turn instead of dropping.
const LOCK_WAIT_MS = 30_000;
const LOCK_POLL_MS = 300;
const LOG_CAP_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;
const MAX_PATHS_TOUCHED = 200;
// A swept session untouched this long is treated as finished.
const IDLE_MS = 30 * 60_000;

export type SyncClient = Pick<CliApiClient, 'writeFile' | 'logRun' | 'listWorkspaces'>;

export interface SyncOptions {
  harness?: SessionHarness;
  session?: string;
  transcript?: string;
  cwd?: string;
  force?: boolean;
  start?: boolean;
  all?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
  home?: string;
  env?: NodeJS.ProcessEnv;
  configDir?: string;
  sources?: Partial<Record<SessionHarness, TranscriptSource>>;
  clientFor?: (cfg: CliConfig & { api_key: string }, harness: SessionHarness) => SyncClient;
  now?: number;
  lockWaitMs?: number;
  autoWire?: (opts: AutoWireOptions) => Promise<string[]>;
}

interface SessionRecord {
  // The rendered session and run status last sent; unset until its transcript is synced.
  hash?: string;
  status?: string;
  // The rendered session its touched files were last synced for.
  files?: string;
  // Its active span overlaps a transcript-sync-off interval, so its transcript never
  // syncs. Only a cache: the history decides, this just skips re-checking.
  local?: true;
  // The transcript or a file was held back only for now (sync off mid-run, an unreadable
  // config), so a later sync revisits it even if the session hasn't changed. Each stays
  // set until a pass that actually handled that kind settles it.
  pending_transcript?: true;
  pending_files?: true;
  synced_at: number;
  project: string;
  cwd?: string;
  harness?: SessionHarness;
  path?: string;
  mtime?: number;
}

interface Manifest {
  // Fingerprint of the account + workspace the ids below belong to.
  scope?: string;
  sessions: Record<string, SessionRecord>;
  files: Record<string, { hash: string; id: string }>;
  last_sweep_at?: number;
}

export interface SyncResult {
  skipped?: 'locked' | 'not-logged-in' | 'capture-off' | 'no-workspace' | 'history-unreadable';
  // The plan is full: uploads stopped for this run, with the message to show.
  paused?: string;
  // The key hit its rate limit even after one retry: uploads stopped for this run.
  rateLimited?: boolean;
  // Why the run stopped early: the account, workspace or Private Workspace changed meanwhile.
  stopped?: string;
  synced: string[];
  unchanged: number;
  debounced: number;
  failed: number;
  perHarness: Partial<Record<SessionHarness, { parsed: number; files: number }>>;
}

interface Candidate {
  harness: SessionHarness;
  entry: TranscriptEntry;
  explicit: boolean;
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function isInside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

const MAX_REMOTE_CHARS = 500;

// Worker paths allow only [A-Za-z0-9._-/] with no '..' or '//'. When cleaning
// or truncating changes `rel`, a hash of the original keeps distinct files apart.
export function safeRemote(prefix: string, rel: string): string {
  const clean = rel
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, '-').replace(/\.{2,}/g, '.'))
    .join('/');
  const full = `${prefix}/${clean}`;
  if (clean === rel && full.length <= MAX_REMOTE_CHARS) return full;
  const tag = `-${sha256(rel).slice(0, 8)}`;
  const cut = full.slice(0, MAX_REMOTE_CHARS - tag.length);
  const dot = cut.lastIndexOf('.');
  const at = dot > cut.lastIndexOf('/') + 1 ? dot : cut.length;
  return `${cut.slice(0, at)}${tag}${cut.slice(at)}`;
}

async function realpathSafe(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

type GitState = 'untracked' | 'no-repo' | 'skip';

// Only untracked, non-ignored files (or files outside any repo) may upload:
// tracked files are already in git, and gitignored ones are where secrets live.
// Fails closed: git also exits 128 for "dubious ownership" (WSL, bind mounts),
// so only an explicit "not a git repository" counts as outside a repo.
function gitState(file: string): Promise<GitState> {
  return new Promise((done) => {
    execFile(
      'git',
      ['-C', dirname(file), 'status', '--porcelain', '--ignored', '--untracked-files=all', '--', basename(file)],
      { timeout: 2000, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout, stderr) => {
        if (err) return done(/not a git repository/i.test(String(stderr)) ? 'no-repo' : 'skip');
        done(stdout.startsWith('??') ? 'untracked' : 'skip');
      },
    );
  });
}

async function readManifest(path: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<Manifest>;
    return { scope: parsed.scope, sessions: parsed.sessions ?? {}, files: parsed.files ?? {}, last_sweep_at: parsed.last_sweep_at };
  } catch {
    return { sessions: {}, files: {} };
  }
}

async function writeManifest(path: string, m: Manifest): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(m), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, path);
}

async function acquireLock(path: string, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const handle = await fs.open(path, 'wx', 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const st = await fs.stat(path).catch(() => null);
      if (!st) continue;
      if (Date.now() - st.mtimeMs >= LOCK_STALE_MS) {
        await fs.rm(path, { force: true });
        continue;
      }
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }
  }
}

function makeLogger(quiet: boolean, dir: string): (msg: string) => Promise<void> {
  if (!quiet) return async (msg) => void process.stdout.write(`${msg}\n`);
  const path = join(dir, 'sync.log');
  return async (msg) => {
    try {
      const st = await fs.stat(path).catch(() => null);
      const line = `${new Date().toISOString()} ${msg}\n`;
      if (st && st.size > LOG_CAP_BYTES) await fs.writeFile(path, line, { mode: 0o600 });
      else await fs.appendFile(path, line, { mode: 0o600 });
    } catch {
      // Logging must never break a hook-spawned sync.
    }
  };
}

function defaultClient(cfg: CliConfig & { api_key: string }, harness: SessionHarness): SyncClient {
  return new CliApiClient({ baseUrl: cfg.api_url, apiKey: cfg.api_key, agentPlatform: harness, agentRole: cfg.agent_role });
}

// shortcut: no trailing-edge debounce; a debounced last turn with no end event after it (a killed agent) syncs on the next sweep from any harness. Add a delayed re-sync if that lag matters.
export async function runSync(opts: SyncOptions = {}): Promise<SyncResult> {
  const result: SyncResult = { synced: [], unchanged: 0, debounced: 0, failed: 0, perHarness: {} };
  const dir = opts.configDir ?? defaultConfigDir();
  const home = opts.home ?? homedir();
  const now = opts.now ?? Date.now();
  const dryRun = !!opts.dryRun;
  const log = makeLogger(!!opts.quiet, dir);
  const sources = { ...SOURCES, ...opts.sources };

  const cfg = await readConfig(join(dir, 'config.json'));
  if (!dryRun && !cfg?.api_key) {
    await log('sync skipped: not logged in');
    return { ...result, skipped: 'not-logged-in' };
  }
  const captureTranscripts = dryRun || !!cfg?.preferences?.capture_transcripts;
  const captureArtifacts = dryRun || !!cfg?.preferences?.capture_artifacts;
  const capturing = captureTranscripts || captureArtifacts;
  const wiring = !!opts.start && !dryRun && cfg?.preferences?.auto_wire !== false;
  // Before any early return, so a run with sync off still records an off toggle (say, a hand edit).
  // Under the config lock; if another adrive process holds it a while, the history as it stands still decides.
  const history = dryRun
    ? await readHistory(dir)
    : await reconcileHistory(join(dir, 'config.json'), 5_000).catch((err) => (err instanceof ConfigLockedError ? readHistory(dir) : null));
  if (!capturing && !wiring) return { ...result, skipped: 'capture-off' };

  const lockPath = join(dir, 'sync.lock');
  if (!dryRun) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (!dryRun && !(await acquireLock(lockPath, opts.lockWaitMs ?? LOCK_WAIT_MS))) {
    await log('sync skipped: another sync holds the lock');
    return { ...result, skipped: 'locked' };
  }

  const manifestPath = join(dir, 'sync.manifest.json');
  let manifest = await readManifest(manifestPath);
  try {
    if (wiring) {
      try {
        await (opts.autoWire ?? autoWire)({ configDir: dir, home, env: opts.env ?? process.env, log, connected: opts.harness });
      } catch (err) {
        await log(`auto-wire failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!capturing) return { ...result, skipped: 'capture-off' };
    let workspaceId: string | undefined;
    if (!dryRun) {
      workspaceId = cfg!.default_workspace;
      if (!workspaceId) {
        const list = await (opts.clientFor ?? defaultClient)(cfg as CliConfig & { api_key: string }, opts.harness ?? HARNESSES[0]!).listWorkspaces();
        if (list.length === 1) workspaceId = list[0]!.id;
        else {
          await log(`sync skipped: ${list.length} workspaces and no default_workspace set`);
          return { ...result, skipped: 'no-workspace' };
        }
      }
      // Synced state and file ids only hold for the account, workspace, privacy
      // mode and project-key rules they were written under; any change starts
      // over like a first sweep.
      const scope = sha256(`${cfg!.api_url}\n${cfg!.api_key}\n${workspaceId}\n${!!cfg!.preferences?.private_workspace}\n${PROJECT_KEY_VERSION}`);
      if (manifest.scope !== scope) manifest = { scope, sessions: {}, files: {} };
    }

    // Without it nothing can tell an off-period session apart, so nothing syncs and the sweep keeps its place.
    if (!history) {
      await log(`sync skipped: ${historyPath(dir)} is missing, damaged or can't be written`);
      return { ...result, skipped: 'history-unreadable' };
    }

    const candidates: Candidate[] = [];
    const named = !!opts.harness && !!(opts.session || opts.transcript);
    if (named) {
      const entry = await locate(sources[opts.harness!], opts, home, dir);
      if (entry) candidates.push({ harness: opts.harness!, entry, explicit: true });
      // A starting session usually has no transcript yet.
      else if (!opts.start) await log(`${opts.harness} session ${opts.session ?? opts.transcript} not found`);
    }

    const sweep = !named || !!opts.all || !!opts.start || !!opts.force || !manifest.last_sweep_at || now - manifest.last_sweep_at > DEBOUNCE_MS;
    let deferredMin: number | undefined;
    const defer = (e: TranscriptEntry) => {
      deferredMin = Math.min(deferredMin ?? Infinity, e.mtime.getTime());
    };

    if (sweep) {
      const since = opts.all ? undefined : new Date(manifest.last_sweep_at ?? now - FIRST_SWEEP_MS);
      const found: Candidate[] = [];
      for (const harness of opts.harness && !named ? [opts.harness] : HARNESSES) {
        let entries: TranscriptEntry[];
        try {
          entries = await sources[harness].enumerate({ home, since, configDir: dir, cwd: opts.cwd ?? process.cwd(), env: opts.env });
        } catch (err) {
          await log(`${harness} enumerate failed: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        for (const entry of entries) {
          if (candidates.some((c) => c.harness === harness && c.entry.sessionId === entry.sessionId)) continue;
          const prev = manifest.sessions[sessionRunId(harness, entry.sessionId)];
          if (prev && prev.synced_at >= entry.mtime.getTime()) continue;
          found.push({ harness, entry, explicit: false });
        }
      }
      // Sessions whose end event never came (a killed agent) never
      // change again, so a stale in_progress entry is revisited to finalize it.
      for (const [runId, rec] of Object.entries(manifest.sessions)) {
        // Synced only for its files while transcript sync was off: its transcript may still be owed.
        const owed = (captureTranscripts && ((rec.hash === undefined && !rec.local) || !!rec.pending_transcript)) || (captureArtifacts && !!rec.pending_files);
        if ((rec.status !== 'in_progress' && !owed) || !rec.harness || !rec.path || (opts.quiet && now - rec.synced_at < DEBOUNCE_MS)) continue;
        if (opts.harness && !named && rec.harness !== opts.harness) continue;
        const sessionId = runId.slice(rec.harness.length + 1);
        const seen = (c: Candidate) => c.harness === rec.harness && c.entry.sessionId === sessionId;
        if (candidates.some(seen) || found.some(seen)) continue;
        const mtime = (await mtimeOf(rec.path)) ?? (rec.mtime ? new Date(rec.mtime) : null);
        if (!mtime || (!owed && now - mtime.getTime() <= IDLE_MS)) continue;
        found.push({ harness: rec.harness, entry: { sessionId, path: rec.path, mtime, cwd: rec.cwd }, explicit: false });
      }
      found.sort((a, b) => a.entry.mtime.getTime() - b.entry.mtime.getTime());
      for (const c of found.slice(SWEEP_CAP)) defer(c.entry);
      candidates.push(...found.slice(0, SWEEP_CAP));
    }

    const ctx: SessionContext = {
      opts,
      cfg: cfg as CliConfig & { api_key: string },
      manifest,
      sources,
      workspaceId,
      now,
      dryRun,
      captureTranscripts,
      captureArtifacts,
      configDir: dir,
      realHome: (await realpathSafe(home)) ?? home,
      cwdRules: new Map(),
      sessionCwds: await readSessionCwds(dir),
      log,
    };
    for (const [i, c] of candidates.entries()) {
      try {
        const outcome = await syncSession(ctx, c, result);
        if (outcome === 'debounced') {
          result.debounced++;
          defer(c.entry);
        } else if (outcome === 'unchanged') {
          result.unchanged++;
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'plan_limit') {
          // Every later upload would get the same refusal; the next sync tries again.
          for (const rest of candidates.slice(i)) defer(rest.entry);
          result.paused = err.message;
          if ((await readUsageNotice(dir))?.message !== err.message) await log(err.message);
          await writeUsageNotice(dir, { level: 'paused', message: err.message, upgrade_url: err.upgradeUrl ?? '' }).catch(() => undefined);
          break;
        }
        if (err instanceof SettingsChangedError) {
          for (const rest of candidates.slice(i)) defer(rest.entry);
          result.stopped = err.message;
          await log(err.message);
          break;
        }
        if (err instanceof ApiError && err.code === 'rate_limited') {
          for (const rest of candidates.slice(i)) defer(rest.entry);
          result.rateLimited = true;
          await log(err.message);
          break;
        }
        result.failed++;
        defer(c.entry);
        await log(`${c.harness} ${c.entry.sessionId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (sweep && !dryRun) manifest.last_sweep_at = deferredMin === undefined ? now : Math.min(now, deferredMin - 1);
    if (!result.paused && ctx.usage !== undefined) await writeUsageNotice(dir, ctx.usage ?? undefined).catch(() => undefined);
    return result;
  } finally {
    if (!dryRun) {
      await writeManifest(manifestPath, manifest).catch(() => undefined);
      await fs.rm(lockPath, { force: true });
    }
  }
}

async function locate(source: TranscriptSource, opts: SyncOptions, home: string, dir: string): Promise<TranscriptEntry | null> {
  if (opts.transcript) {
    const mtime = await mtimeOf(opts.transcript);
    if (!mtime) return null;
    const sessionId = opts.session ?? basename(opts.transcript).replace(/\.jsonl?(\.zst)?$/, '');
    return { sessionId, path: opts.transcript, mtime, cwd: opts.cwd };
  }
  const entries = await source.enumerate({ home, configDir: dir, cwd: opts.cwd, env: opts.env });
  const hit = entries.find((e) => e.sessionId === opts.session);
  return hit ? { ...hit, cwd: hit.cwd ?? opts.cwd } : null;
}

interface SessionContext {
  opts: SyncOptions;
  cfg: CliConfig & { api_key: string };
  manifest: Manifest;
  sources: Record<SessionHarness, TranscriptSource>;
  workspaceId?: string;
  now: number;
  dryRun: boolean;
  captureTranscripts: boolean;
  captureArtifacts: boolean;
  configDir: string;
  realHome: string;
  cwdRules: Map<string, Awaited<ReturnType<typeof loadRules>>>;
  sessionCwds: Record<string, string>;
  log: (msg: string) => Promise<void>;
  // The usage warning from the last run logged: null when it had none, unset when nothing was written.
  usage?: UsageWarning | null;
}

// Read fresh before each upload and each retry, so a toggle made while this sync runs,
// by adrive privacy or by hand, stops it at once. 'later' while that kind of sync is off,
// or while config.json or the history can't be read: nothing is sent, nothing is marked
// done, and a later sync tries again. 'never' when its own times fall while it was off.
type Gate = 'go' | 'later' | 'never';
// The account, workspace or Private Workspace changed since the run started: it stops.
class SettingsChangedError extends Error {}
// A dry run reports what the history and the file's own times decide, as if that sync were on.
async function gate(ctx: SessionContext, kind: 'transcripts' | 'artifacts', blocked: (h: PrivacyHistory) => boolean, dryRun = false): Promise<Gate> {
  let cfg: CliConfig | null;
  let history: PrivacyHistory | null;
  try {
    [cfg, history] = await Promise.all([readConfig(join(ctx.configDir, 'config.json')), readHistory(ctx.configDir)]);
  } catch {
    return 'later';
  }
  const changed = changedSince(ctx.cfg, cfg);
  if (changed) throw new SettingsChangedError(`${changed} changed since this sync started; it stops here, and the next sync picks up`);
  const list = history?.[`${kind}_off`];
  const on = dryRun || (kind === 'transcripts' ? cfg?.preferences?.capture_transcripts : cfg?.preferences?.capture_artifacts);
  if (!history || !list || !on || (!dryRun && list[list.length - 1]?.until === null)) return 'later';
  return blocked(history) ? 'never' : 'go';
}

async function syncSession(ctx: SessionContext, c: Candidate, result: SyncResult): Promise<'synced' | 'unchanged' | 'debounced' | 'empty' | 'local'> {
  const { opts, manifest, now } = ctx;
  // Only hooks run quiet, and they fire every turn; a person running `adrive sync` wants it now.
  if (!opts.force && opts.quiet && now - (manifest.sessions[sessionRunId(c.harness, c.entry.sessionId)]?.synced_at ?? 0) < DEBOUNCE_MS) {
    return 'debounced';
  }
  const doc = await ctx.sources[c.harness].parseSession(c.entry);
  if (!doc) return 'empty';
  const stats = (result.perHarness[c.harness] ??= { parsed: 0, files: 0 });
  stats.parsed++;

  const sessionId = doc.entry.sessionId;
  const runId = sessionRunId(c.harness, sessionId);
  const prev = manifest.sessions[runId];
  const cwd = doc.cwd ?? prev?.cwd ?? ctx.sessionCwds[runId];
  const privateWorkspace = !!ctx.cfg?.preferences?.private_workspace;
  const project = cwd ? scopeProjectKey(projectKeyFor(cwd), privateWorkspace) : prev?.project ?? scopeProjectKey('local__unknown', privateWorkspace);
  const status = c.explicit
    ? opts.force ? 'success' : 'in_progress'
    : now - doc.entry.mtime.getTime() > IDLE_MS ? 'success' : 'in_progress';

  const absPaths = [...new Set(doc.filesTouched.map((p) => (isAbsolute(p) ? p : cwd ? resolve(cwd, p) : null)).filter((p): p is string => !!p))];
  const display = (abs: string) => (cwd && isInside(cwd, abs) ? toPosix(relative(cwd, abs)) : abs);
  const pathsTouched = absPaths.map(display);
  const updatedAt = [...doc.turns].reverse().find((t) => t.ts)?.ts ?? doc.entry.mtime.toISOString();
  const lastTurnAt = Date.parse(updatedAt);
  const lastActivityAt = Number.isFinite(lastTurnAt) ? lastTurnAt : doc.entry.mtime.getTime();
  const markdown = renderSession({
    harness: c.harness,
    sessionId,
    project,
    cwd,
    title: doc.title,
    updatedAt,
    turns: doc.turns,
    filesTouched: pathsTouched,
  });
  const hash = sha256(markdown);

  // Whatever path got here (hook, sweep, --all, revisit, a new scope), a session
  // syncs only if its active span misses every interval its kind of sync was off:
  // from its first timestamp when every turn has one; otherwise from the file's birth (or
  // an earlier timestamp), since an untimed turn may date from then, else from 0. To its last activity.
  let first = Infinity;
  let untimed = doc.turns.length === 0;
  let last = Math.max(lastActivityAt, doc.entry.mtime.getTime());
  for (const t of doc.turns) {
    const ms = Date.parse(t.ts ?? '');
    if (Number.isFinite(ms)) [first, last] = [Math.min(first, ms), Math.max(last, ms)];
    else untimed = true;
  }
  const birth = !untimed || !isAbsolute(doc.entry.path) ? 0 : await fs.stat(doc.entry.path).then((st) => st.birthtimeMs, () => 0);
  const start = Math.min(!untimed ? first : birth > 0 ? Math.min(birth, first) : 0, last);
  // Read again for each session, so a toggle made while this sync runs counts.
  const off = await readHistory(ctx.configDir);
  if (!off) throw new Error(`${historyPath(ctx.configDir)} is missing or damaged`);
  const transcriptsOff = overlapsOff(off.transcripts_off, start, last);
  const filesOff = overlapsOff(off.artifacts_off, start, last);
  const transcripts = ctx.captureTranscripts && !prev?.local && !transcriptsOff;
  const files = ctx.captureArtifacts && !filesOff;
  const record: SessionRecord = {
    hash: prev?.hash,
    status: prev?.status,
    files: prev?.files,
    local: prev?.local ?? ((ctx.captureTranscripts && !transcripts) || undefined),
    // Dropped when the session can never sync that kind. While that kind of sync is off, a
    // session that ended before it went off is owed it, so a later sync comes back for it.
    pending_transcript: transcriptsOff ? undefined : !ctx.captureTranscripts && prev?.hash !== hash ? true : prev?.pending_transcript,
    pending_files: filesOff ? undefined : !ctx.captureArtifacts && prev?.files !== hash ? true : prev?.pending_files,
    synced_at: now,
    project,
    cwd,
    harness: c.harness,
    path: doc.entry.path,
    mtime: doc.entry.mtime.getTime(),
  };
  if (!transcripts && !files) {
    if (!ctx.dryRun) manifest.sessions[runId] = record;
    return 'local';
  }
  if (!(transcripts && (prev?.pending_transcript || prev?.hash !== hash || prev?.status !== status)) && !(files && (prev?.pending_files || prev?.files !== hash))) return 'unchanged';

  const encrypt = !ctx.dryRun && privateWorkspace;
  const seal = async (text: string) => {
    const { redacted, hits } = redact(text);
    return { body: encrypt ? await encryptContentAsync(ctx.cfg.api_key, redacted) : redacted, tag: summarizeHits(hits) };
  };
  const client = ctx.dryRun ? null : (opts.clientFor ?? defaultClient)(ctx.cfg, c.harness);

  // Checked again right before the transcript and the run go, and before their retries.
  // A transient hold leaves the record pending, so a later sync comes back for it.
  let heldTranscript = false;
  let heldFiles = false;
  const transcriptGate = () => gate(ctx, 'transcripts', (h) => overlapsOff(h.transcripts_off, start, last));
  const transcriptGo = async () => {
    const g = await transcriptGate();
    if (g === 'later') heldTranscript = true;
    else if (g === 'never') record.local = true;
    return g === 'go';
  };
  let transcriptPath: string | undefined;
  if (transcripts) {
    transcriptPath = sessionPath(project, c.harness, sessionId);
    if (client && prev?.hash !== hash) {
      const { body, tag } = await seal(markdown);
      if (await transcriptGo()) await client.writeFile(ctx.workspaceId!, transcriptPath, body, `session sync (${tag})`, async () => (await transcriptGate()) === 'go');
      else transcriptPath = undefined;
    }
  }

  const artifactIds: string[] = [];
  let wouldUpload = 0;
  if (files) {
    const realCwd = cwd ? await realpathSafe(cwd) : null;
    for (const abs of absPaths) {
      const real = await realpathSafe(abs);
      if (!real) continue;
      const inCwd = !!realCwd && isInside(realCwd, real);
      // Outside home only the session's own project is in scope, and a filesystem-root cwd is no project.
      const root = isInside(ctx.realHome, real) ? ctx.realHome : inCwd && dirname(realCwd!) !== realCwd ? realCwd! : null;
      // A hard gate: a project's .adriveignore is untrusted and could negate DEFAULT_DENY.
      if (!root || shouldIgnore(root, real, DENY_RULES)) continue;
      if (inCwd) {
        let rules = ctx.cwdRules.get(realCwd!);
        if (!rules) ctx.cwdRules.set(realCwd!, (rules = await loadRules(realCwd!, ['.adriveignore'])));
        if (shouldIgnore(realCwd!, real, rules)) continue;
      }
      // A cheap first look before spawning git; readVetted checks it all again at the read.
      // A file gone since the session touched it is skipped; the rest of the session still syncs.
      const pre = await fs.lstat(real).catch(() => null);
      if (!pre?.isFile() || pre.size > MAX_FILE_BYTES || pre.nlink > 1) continue;
      if ((await gitState(real)) === 'skip') continue;
      const read = await readVetted(real, MAX_FILE_BYTES);
      if (!read) continue;
      const { buf, st } = read;
      if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) continue;

      const fileHash = sha256(buf);
      const known = manifest.files[real];
      if (known?.hash === fileHash) {
        artifactIds.push(known.id);
        continue;
      }
      const rel = inCwd ? toPosix(relative(realCwd!, real)) : `_external/${sha256(real).slice(0, 8)}-${basename(real)}`;
      // Content is sealed in a private workspace, but a path would still name the file.
      const remote = privateWorkspace ? `sessions/${project}/files/${sha256(rel).slice(0, 16)}` : safeRemote(`sessions/${project}/files`, rel);
      const sealed = client ? await seal(buf.toString('utf8')) : null;
      // Last, after every other await: a toggle made while this sync ran, another session's
      // edit while artifact sync was off, or content copied in with an old mtime all stop the
      // file. A version synced earlier stays linked.
      const fileGate = () => gate(ctx, 'artifacts', (h) => (ctx.dryRun ? changedWhileOff(h, st) : fileHeldBack(h, st)), ctx.dryRun);
      const g = await fileGate();
      if (g !== 'go') {
        if (g === 'later') heldFiles = true;
        if (ctx.dryRun) await ctx.log(`[dry] ${runId}: held ${rel} (${g === 'never' ? 'changed while artifact sync was off' : "can't check right now"})`);
        if (known) artifactIds.push(known.id);
        continue;
      }
      if (!client || !sealed) {
        wouldUpload++;
        continue;
      }
      // A 429 retry comes seconds later, so it checks again first.
      const res = await client.writeFile(ctx.workspaceId!, remote, sealed.body, `session artifact from ${c.harness} (${sealed.tag})`, async () => (await fileGate()) === 'go');
      manifest.files[real] = { hash: fileHash, id: res.id };
      artifactIds.push(res.id);
    }
  }
  stats.files += client ? artifactIds.length : wouldUpload;

  // A run only indexes a synced transcript; without one it would carry nothing
  // but what the transcript says (title, cwd, paths, turns, timing).
  if (client && transcriptPath && (await transcriptGo())) {
    // Run metadata is plaintext, so a private workspace keeps the title, cwd and
    // paths out of it entirely; otherwise the title is redacted before it leaves.
    const title = doc.title && !encrypt ? redact(doc.title).redacted : undefined;
    const logged = await client.logRun({
      run_id: runId,
      task: title || (encrypt ? 'Private session' : 'Untitled session'),
      status,
      workspace_id: ctx.workspaceId,
      artifacts_produced: artifactIds,
      metadata: {
        project,
        cwd: encrypt ? undefined : cwd,
        title,
        transcript_path: transcriptPath,
        files_uploaded: artifactIds.length,
        paths_touched: encrypt ? [] : pathsTouched.slice(0, MAX_PATHS_TOUCHED),
        turns: doc.turns.length,
        harness_session_id: sessionId,
        last_activity_at: lastActivityAt,
      },
    }, async () => (await transcriptGate()) === 'go');
    ctx.usage = logged.usage_warning ?? null;
    [record.hash, record.status] = [hash, status];
  }
  // Only once every file uploaded or was deliberately left out (deny list, ignore rules,
  // size, git, links): a file held back for now is retried by a later sync.
  if (files && !heldFiles) record.files = hash;
  // A pass that skipped a kind (that sync is off, or the session is ineligible for it) leaves its flag as it was.
  if (transcripts) record.pending_transcript = heldTranscript || undefined;
  if (files) record.pending_files = heldFiles || undefined;
  if (client) manifest.sessions[runId] = record;
  result.synced.push(runId);
  await ctx.log(
    `${ctx.dryRun ? '[dry] ' : ''}${runId}: ${doc.turns.length} turns, ${pathsTouched.length} paths touched, ` +
      `${client ? artifactIds.length : wouldUpload} files ${client ? 'linked' : 'would upload'} -> ${project}`,
  );
  return 'synced';
}
