import { promises as fs, type Stats } from 'node:fs';
import { resolve, relative, sep, posix } from 'node:path';
import { watch as chokidarWatch } from 'chokidar';
import kleur from 'kleur';
import { ApiError, CliApiClient } from '../lib/api-client.js';
import { ConfigLockedError, changedSince, configDir, configPath, readConfig, reconcileHistory, requireLogin } from '../lib/config.js';
import { changedWhileOff, readHistory, type PrivacyHistory } from '../lib/privacy-history.js';
import { readVetted } from '../lib/safe-read.js';
import { encryptContentAsync } from '../lib/crypto.js';
import { redact, summarizeHits } from '@adrive/mcp-server/redactor';
import { isDenied, loadRules, shouldIgnore } from '../lib/ignore.js';

export interface WatchOptions {
  workspace?: string;
  dryRun?: boolean;
  noEncrypt?: boolean;
  debounce?: number;
}

// A hung upload gives up after this, so one request can't stall the queue for good.
const UPLOAD_TIMEOUT_MS = 60_000;
// How soon files waiting on a pause, or on an unreadable config, are checked again.
const RECHECK_MS = 2_000;
const SHUTDOWN_GRACE_MS = 2_000;
// An upload that failed on a timeout, the network, a 5xx or a 429 is tried again, through
// every check, after this, doubling up to RETRY_MAX_MS. Any other error drops the file.
const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 300_000;

function recoverable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500 || err.status === 429 || err.status === 408;
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError' || (err instanceof TypeError && err.message === 'fetch failed');
}

interface QueuedFile {
  abs: string;
  rel: string;
  reason: 'add' | 'change';
}

function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

export async function cmdWatch(rawRoot: string | undefined, opts: WatchOptions = {}): Promise<void> {
  const root = resolve(rawRoot ?? process.cwd());
  const realRoot = await fs.realpath(root);
  if (isDenied(realRoot)) throw new Error(`${root} is, or is inside, a folder on the built-in deny list, so adrive watch won't upload from it.`);
  const cfg = await requireLogin();

  if (!cfg.preferences?.capture_artifacts && !opts.dryRun) {
    process.stderr.write(
      `${kleur.yellow('[warn]')} Sync artifacts is off in your preferences.\n` +
        `       Either enable it with \`adrive privacy --capture-artifacts on\`\n` +
        `       or run a one-off dry-run with \`adrive watch --dry-run\`.\n`,
    );
    process.exit(2);
  }

  const dryRun = !!opts.dryRun;
  const encrypt = !opts.noEncrypt && !!cfg.preferences?.private_workspace;
  const debounceMs = opts.debounce ?? 750;

  const rules = await loadRules(root);
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });

  let workspaceId = opts.workspace ?? cfg.default_workspace;
  if (!workspaceId && !dryRun) {
    const list = await client.listWorkspaces();
    if (list.length === 1) workspaceId = list[0]!.id;
    else if (list.length === 0) throw new Error('No workspaces. Create one first.');
    else throw new Error(`Multiple workspaces — specify --workspace <id>.`);
  }

  process.stdout.write(`${kleur.bold('AgentDrive watch')}\n`);
  process.stdout.write(`  root:        ${root}\n`);
  process.stdout.write(`  workspace:   ${workspaceId ?? kleur.dim('(dry-run, none)')}\n`);
  process.stdout.write(`  mode:        ${dryRun ? kleur.yellow('dry-run — nothing uploads') : kleur.green('live')}\n`);
  process.stdout.write(`  encryption:  ${encrypt ? kleur.cyan('end-to-end on your device') : 'off'}\n`);
  process.stdout.write(`  redactor:    on (secrets are scrubbed before anything leaves)\n\n`);

  const queue = new Map<string, QueuedFile>();
  let timer: NodeJS.Timeout | undefined;

  // Checked when read, not when queued, since during the debounce a file can be swapped
  // for a link: no part of the path below the folder may be a link (its real path is the
  // same path), the real path stays off the deny list, and readVetted does the rest.
  async function readChecked(abs: string): Promise<{ raw: string; st: Stats } | null> {
    const real = await fs.realpath(abs).catch(() => null);
    const rel = relative(root, abs);
    if (!real || rel.startsWith('..') || relative(realRoot, real) !== rel || isDenied(real)) return null;
    const read = await readVetted(real);
    return read && { raw: read.buf.toString('utf8'), st: read.st };
  }

  // Read fresh before each file's read, again before its upload and before a 429 retry,
  // so turning artifact sync off while watch runs stops it at once. 'unknown' when
  // config.json can't be read right now (say, a write in progress): nothing uploads, but
  // that is not the user turning sync off, so nothing says paused. A dry run only
  // reports, so it never pauses, but still shows what would be held back.
  type Consent = { state: 'on'; history: PrivacyHistory } | { state: 'off' | 'unknown' };
  let paused = false;
  let waiting = false;
  const unknown = (why: string): Consent => {
    if (!waiting) process.stdout.write(`${kleur.yellow('[waiting]')} ${why}; queued files wait until that clears\n`);
    waiting = true;
    return { state: 'unknown' };
  };
  async function consent(): Promise<Consent> {
    // A toggle flipped by hand while watch runs gets its off interval before anything is decided.
    // Until it is recorded, the history may be missing an off interval, so nothing goes.
    if (!dryRun) {
      try {
        await reconcileHistory(configPath(), 1_000);
      } catch (err) {
        return unknown(
          err instanceof ConfigLockedError
            ? 'another adrive process is updating config.json'
            : `privacy-history.json can't be updated (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
    const history = await readHistory(configDir());
    if (dryRun) return history ? { state: 'on', history } : unknown('privacy-history.json is missing or damaged, so a live run would upload nothing');
    let latest: Awaited<ReturnType<typeof readConfig>>;
    try {
      latest = await readConfig();
    } catch {
      return unknown("config.json can't be read right now");
    }
    waiting = false;
    const changed = changedSince(cfg, latest, { workspace: !opts.workspace });
    if (changed) {
      if (!closing) {
        process.stderr.write(`${kleur.red('[stopped]')} ${changed} changed since adrive watch started; restart it\n`);
        void shutdown(1);
      }
      return { state: 'off' };
    }
    const off = !history || !latest?.preferences?.capture_artifacts;
    if (off !== paused) {
      paused = off;
      process.stdout.write(
        off
          ? `${kleur.yellow('[paused]')} artifact sync is off, or privacy-history.json is missing or damaged; nothing uploads until that changes\n`
          : `${kleur.green('[resumed]')} artifact sync is on again; queued files upload now, except ones changed while it was off, which stay local until they change again\n`,
      );
    }
    return off ? { state: 'off' } : { state: 'on', history: history! };
  }

  // 'go'; 'hold' when the file changed while artifact sync was off (it stays local until it
  // changes again); 'wait' while sync is off or unknown (it stays queued).
  async function gate(st: Stats): Promise<'go' | 'hold' | 'wait'> {
    const now = await consent().catch((): Consent => ({ state: 'unknown' }));
    if (now.state !== 'on') return 'wait';
    return changedWhileOff(now.history, st) ? 'hold' : 'go';
  }

  // Waiting files go back in the queue, unless a newer change to the same file is there,
  // and are checked again shortly, so a pause or an unreadable config never drops them.
  let closing = false;
  let recheck: NodeJS.Timeout | undefined;
  function requeue(items: QueuedFile[]): void {
    for (const item of items) if (!queue.has(item.abs)) queue.set(item.abs, item);
    if (closing || recheck || queue.size === 0) return;
    recheck = setTimeout(() => {
      recheck = undefined;
      void flush();
    }, RECHECK_MS);
  }

  const failures = new Map<string, number>();
  const retries = new Map<string, NodeJS.Timeout>();
  function retryLater(item: QueuedFile): number {
    const n = failures.get(item.abs) ?? 0;
    failures.set(item.abs, n + 1);
    const delay = Math.min(RETRY_FIRST_MS * 2 ** n, RETRY_MAX_MS);
    retries.set(
      item.abs,
      setTimeout(() => {
        retries.delete(item.abs);
        if (closing) return;
        if (!queue.has(item.abs)) queue.set(item.abs, item);
        void flush();
      }, delay),
    );
    return delay;
  }

  // One batch at a time, so a second never uploads alongside a first that saw a toggle.
  let flushing: Promise<void> = Promise.resolve();
  function flush(): Promise<void> {
    flushing = flushing.then(flushBatch, flushBatch);
    return flushing;
  }

  async function flushBatch(): Promise<void> {
    const pending = [...queue.values()];
    queue.clear();
    for (const [i, item] of pending.entries()) {
      let last: 'go' | 'hold' | 'wait' = 'go';
      try {
        if ((await consent()).state !== 'on') return requeue(pending.slice(i));
        const read = await readChecked(item.abs);
        if (!read) continue;
        const { raw, st } = read;
        const remotePath = toPosix(item.rel);
        last = await gate(st);
        if (last === 'wait') return requeue(pending.slice(i));
        if (last === 'hold') {
          if (dryRun) process.stdout.write(`${kleur.dim('[dry]')} held   ${remotePath} ${kleur.dim('(changed while artifact sync was off)')}\n`);
          continue;
        }
        const { redacted, hits } = redact(raw);
        const tag = summarizeHits(hits);

        if (dryRun) {
          process.stdout.write(
            `${kleur.dim('[dry]')} ${item.reason.padEnd(6)} ${remotePath} ${kleur.dim(`(${raw.length}B, redactor: ${tag})`)}\n`,
          );
          continue;
        }

        const body = encrypt ? await encryptContentAsync(cfg.api_key, redacted) : redacted;
        const message = `adrive watch: ${item.reason}${hits.length ? ` (redacted ${tag})` : ''}`;
        last = await gate(st);
        if (last === 'wait') return requeue(pending.slice(i));
        if (last === 'hold') continue;
        const again = async () => (last = await gate(st)) === 'go';
        const result = await client.writeFile(workspaceId!, remotePath, body, message, again, UPLOAD_TIMEOUT_MS);
        failures.delete(item.abs);
        process.stdout.write(
          `${kleur.green('[ok]')}  ${item.reason.padEnd(6)} ${remotePath} v${result.version}` +
            (encrypt ? kleur.cyan(' (encrypted)') : '') +
            (hits.length ? kleur.yellow(` (redacted: ${tag})`) : '') +
            '\n',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const retry = last === 'go' && recoverable(err) ? retryLater(item) : 0;
        if (!retry) failures.delete(item.abs);
        process.stderr.write(`${kleur.red('[err]')} ${item.rel}: ${msg}${retry ? ` (trying again in ${retry / 1000}s)` : ''}\n`);
        // A retry called off because sync went off: the file waits for it to come back on.
        if (last === 'wait') requeue([item]);
      }
    }
  }

  function enqueue(absPath: string, reason: QueuedFile['reason']): void {
    if (closing || shouldIgnore(root, absPath, rules)) return;
    const rel = relative(root, absPath);
    // A newer change goes up after the debounce instead of at the pending retry.
    clearTimeout(retries.get(absPath));
    retries.delete(absPath);
    queue.set(absPath, { abs: absPath, rel, reason });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, debounceMs);
  }

  const watcher = chokidarWatch(root, {
    ignoreInitial: false,
    persistent: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    // Only regular files and folders: chokidar opens what it watches, and opening a FIFO
    // blocks for good. shouldIgnore rejects the root itself, which would stop chokidar
    // from watching anything.
    ignored: (p, stats) => (!!stats && !stats.isFile() && !stats.isDirectory()) || (resolve(p) !== root && shouldIgnore(root, resolve(p), rules)),
  });

  watcher.on('add', (p) => enqueue(resolve(p), 'add'));
  watcher.on('change', (p) => enqueue(resolve(p), 'change'));
  watcher.on('error', (err) => {
    process.stderr.write(`${kleur.red('[err]')} watcher: ${String(err)}\n`);
  });

  // Stops queueing, gives what is queued and the upload in progress a short grace period
  // (a hung request can't keep watch alive), then exits. A second signal exits at once.
  const shutdown = async (code = 0) => {
    if (closing) process.exit(130);
    closing = true;
    if (timer) clearTimeout(timer);
    if (recheck) clearTimeout(recheck);
    for (const t of retries.values()) clearTimeout(t);
    await watcher.close();
    await Promise.race([flush(), new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS))]);
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // Resolve only when the user kills the process.
  await new Promise<void>(() => {});
}
