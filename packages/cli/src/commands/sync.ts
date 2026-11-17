import kleur from 'kleur';
import type { SessionHarness } from '@adrive/mcp-server/session';
import { HARNESSES } from '@adrive/mcp-server/local';
import { runSync } from '../lib/sync.js';

export interface SyncCommandOptions {
  harness?: string;
  session?: string;
  transcript?: string;
  cwd?: string;
  force?: boolean;
  start?: boolean;
  all?: boolean;
  quiet?: boolean;
  dryRun?: boolean;
}

export async function cmdSync(opts: SyncCommandOptions = {}): Promise<void> {
  if (opts.harness && !HARNESSES.includes(opts.harness as SessionHarness)) {
    throw new Error(`Unknown harness: ${opts.harness}. Supported: ${HARNESSES.join(', ')}.`);
  }
  const result = await runSync({ ...opts, harness: opts.harness as SessionHarness | undefined });
  if (opts.quiet) return;

  if (result.skipped) {
    const hint: Record<NonNullable<typeof result.skipped>, string> = {
      'not-logged-in': 'not logged in; run `adrive auth login`',
      'capture-off': 'sync is off; enable with `adrive privacy --capture-transcripts on` or `--capture-artifacts on`',
      locked: 'another sync is running',
      'no-workspace': 'several workspaces and no default_workspace in your config',
    };
    process.stdout.write(`${kleur.yellow('[skip]')} ${hint[result.skipped]}\n`);
    return;
  }
  if (result.paused) process.stdout.write(`${kleur.yellow('[paused]')} ${result.paused}\n`);
  if (result.rateLimited) process.stdout.write(`${kleur.yellow('[rate limited]')} resuming on next sync\n`);
  for (const [harness, s] of Object.entries(result.perHarness)) {
    process.stdout.write(`${harness}: ${s.parsed} sessions, ${s.files} files${opts.dryRun ? ' (dry run)' : ''}\n`);
  }
  process.stdout.write(
    `${kleur.bold('Synced')} ${result.synced.length}, unchanged ${result.unchanged}, debounced ${result.debounced}, failed ${result.failed}.\n`,
  );
}
