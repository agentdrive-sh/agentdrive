import { promises as fs } from 'node:fs';
import { resolve, relative, sep, posix } from 'node:path';
import { watch as chokidarWatch } from 'chokidar';
import kleur from 'kleur';
import { CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';
import { encryptContentAsync } from '../lib/crypto.js';
import { redact, summarizeHits } from '@adrive/mcp-server/redactor';
import { loadRules, shouldIgnore } from '../lib/ignore.js';

export interface WatchOptions {
  workspace?: string;
  dryRun?: boolean;
  noEncrypt?: boolean;
  debounce?: number;
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
  const cfg = await requireLogin();

  if (!cfg.preferences?.capture_artifacts && !opts.dryRun) {
    process.stderr.write(
      `${kleur.yellow('[warn]')} Capture artifacts is off in your preferences.\n` +
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

  async function flush(): Promise<void> {
    const pending = [...queue.values()];
    queue.clear();
    for (const item of pending) {
      try {
        const raw = await fs.readFile(item.abs, 'utf8');
        const { redacted, hits } = redact(raw);
        const remotePath = toPosix(item.rel);
        const tag = summarizeHits(hits);

        if (dryRun) {
          process.stdout.write(
            `${kleur.dim('[dry]')} ${item.reason.padEnd(6)} ${remotePath} ${kleur.dim(`(${raw.length}B, redactor: ${tag})`)}\n`,
          );
          continue;
        }

        const body = encrypt ? await encryptContentAsync(cfg.api_key, redacted) : redacted;
        const message = `adrive watch: ${item.reason}${hits.length ? ` (redacted ${tag})` : ''}`;
        const result = await client.writeFile(workspaceId!, remotePath, body, message);
        process.stdout.write(
          `${kleur.green('[ok]')}  ${item.reason.padEnd(6)} ${remotePath} v${result.version}` +
            (encrypt ? kleur.cyan(' (encrypted)') : '') +
            (hits.length ? kleur.yellow(` (redacted: ${tag})`) : '') +
            '\n',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`${kleur.red('[err]')} ${item.rel}: ${msg}\n`);
      }
    }
  }

  function enqueue(absPath: string, reason: QueuedFile['reason']): void {
    if (shouldIgnore(root, absPath, rules)) return;
    const rel = relative(root, absPath);
    queue.set(absPath, { abs: absPath, rel, reason });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, debounceMs);
  }

  const watcher = chokidarWatch(root, {
    ignoreInitial: false,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    ignored: (p) => shouldIgnore(root, resolve(p), rules),
  });

  watcher.on('add', (p) => enqueue(resolve(p), 'add'));
  watcher.on('change', (p) => enqueue(resolve(p), 'change'));
  watcher.on('error', (err) => {
    process.stderr.write(`${kleur.red('[err]')} watcher: ${String(err)}\n`);
  });

  const shutdown = async () => {
    if (timer) clearTimeout(timer);
    await flush();
    await watcher.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // Resolve only when the user kills the process.
  await new Promise<void>(() => {});
}
