import { homedir } from 'node:os';
import kleur from 'kleur';
import prompts from 'prompts';
import { ApiError, CliApiClient } from '../lib/api-client.js';
import { DEFAULT_API_URL, DEFAULT_PREFERENCES, changesOnto, hasSavedPreferences, readConfig, updateConfig, type CliConfig } from '../lib/config.js';
import { ensureCaptureConsent } from '../lib/consent.js';
import { pollAuth } from '../lib/poll-auth.js';
import { writeAllInstructions } from '../lib/auto-context.js';
import { wireInstalled, type WireOutcome } from '../lib/wire-all.js';
import { preserveKeychain } from '../lib/keychain.js';

export interface InitOptions {
  yes?: boolean;
  apiUrl?: string;
  // Skip sign-in: resume between agents on this machine from their local transcripts.
  local?: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summaryStatus(o: WireOutcome): string {
  if (o.status === 'absent') return 'skipped (not installed)';
  if (o.status === 'failed') return `skipped (${o.detail})`;
  if (o.status === 'manual') return `manual step needed${o.detail ? ` (${o.detail})` : ''} (see above)`;
  const what = o.detail === 'MCP' ? 'MCP wired' : `wired${o.detail ? ` (${o.detail})` : ''}`;
  return o.changed.length || o.id === 'claude-code' ? what : `${what} (already up to date)`;
}

async function chooseLocal(opts: InitOptions): Promise<boolean> {
  if (opts.local) return true;
  if (opts.yes || !process.stdin.isTTY) return false;
  const { mode } = (await prompts({
    type: 'select',
    name: 'mode',
    message: 'How do you want to use AgentDrive?',
    choices: [
      { title: 'Sign in', description: 'sync sessions across machines, share them, hosted MCP', value: 'cloud' },
      { title: 'Local mode, no account', description: 'resume sessions between agents on this machine only', value: 'local' },
    ],
    initial: 0,
  })) as { mode?: string };
  return mode === 'local';
}

async function keyStillValid(apiUrl: string, apiKey: string): Promise<boolean> {
  try {
    await new CliApiClient({ baseUrl: apiUrl, apiKey, agentPlatform: 'cli' }).whoami();
    return true;
  } catch (err) {
    // Only a rejected key forces a new login; being offline should not.
    return !(err instanceof ApiError && (err.status === 401 || err.status === 403));
  }
}

export async function cmdInit(opts: InitOptions = {}): Promise<void> {
  const home = homedir();
  const existing = await readConfig();
  await preserveKeychain(existing?.api_key);
  const preferencesSaved = await hasSavedPreferences();
  const apiUrl = opts.apiUrl ?? existing?.api_url ?? DEFAULT_API_URL;
  let config: CliConfig = { ...existing, api_url: apiUrl, agent_platform: 'cli' };

  if (config.api_key && !(await keyStillValid(apiUrl, config.api_key))) {
    process.stdout.write(`${kleur.yellow('[warn]')} Saved API key was rejected; logging in again.\n`);
    // The new login may land in a different org, where the old workspace id means nothing.
    config = { ...config, api_key: undefined, default_workspace: undefined };
  }

  const local = !config.api_key && (await chooseLocal(opts));
  if (local) {
    process.stdout.write(`${kleur.green('[ok]')} Local mode: no account. Sessions stay on this machine.\n`);
  } else if (config.api_key) {
    process.stdout.write(`${kleur.green('[ok]')} Logged in (api key ${config.api_key.slice(0, 12)}...).\n`);
  } else {
    const auth = await pollAuth(new CliApiClient({ baseUrl: apiUrl, agentPlatform: 'cli' }));
    config = { ...config, api_key: auth.api_key, agent_id: auth.agent_id, org_id: auth.org_id };
  }

  if (!local) {
    config = await ensureCaptureConsent(
      config,
      new CliApiClient({ baseUrl: apiUrl, apiKey: config.api_key, agentPlatform: 'cli' }),
      { interactive: !opts.yes && !!process.stdin.isTTY, preferencesSaved },
    );
  }
  const preferences = { ...DEFAULT_PREFERENCES, ...(config.preferences ?? {}) };
  // Unsaved preferences let a later sign-in still turn capture on by default.
  config = { ...config, preferences: local && !preferencesSaved ? undefined : preferences };
  // Saved before wiring: hooks and the MCP server read the key from this file. Sign-in and
  // consent can take minutes, so only what init changed is applied to the config as it is now.
  const decided = config;
  const base = existing && !preferencesSaved ? { ...existing, preferences: undefined } : existing;
  await updateConfig((latest) => (latest ? changesOnto(latest, base, decided) : decided));

  process.stdout.write(`\n${kleur.bold('Connecting your agents')}\n`);
  const outcomes = await wireInstalled(home, process.env);
  for (const o of outcomes) {
    for (const p of o.changed) process.stdout.write(`  ${kleur.green('+')} ${p}\n`);
    for (const p of o.removed ?? []) process.stdout.write(`  ${kleur.green('-')} ${p}\n`);
    for (const w of o.warnings) process.stdout.write(`  ${kleur.yellow('!')} ${o.label}: ${w}\n`);
  }
  const wired = outcomes.filter((o) => o.status === 'wired' || o.status === 'manual').map((o) => o.id);
  await updateConfig((latest) => latest && { ...latest, wired: [...new Set([...(latest.wired ?? []), ...wired])] });
  const summary: Array<[string, string]> = outcomes.map((o) => [o.label, summaryStatus(o)]);

  if (preferences.auto_context) {
    try {
      const written = (await writeAllInstructions(home)).filter((r) => r.action !== 'unchanged');
      for (const r of written) process.stdout.write(`  ${kleur.green('+')} ${r.path}\n`);
    } catch (err) {
      process.stdout.write(`  ${kleur.yellow('!')} auto-context instructions: ${errorMessage(err)}\n`);
    }
  }

  process.stdout.write(`\n${kleur.bold('Summary')}\n`);
  const width = Math.max(...summary.map(([name]) => name.length)) + 2;
  for (const [name, status] of summary) {
    process.stdout.write(`  ${name.padEnd(width)}${status}\n`);
  }
  process.stdout.write(`  ${'Auto-context'.padEnd(width)}${preferences.auto_context ? 'on' : 'off'}\n`);
  if (local) {
    process.stdout.write(`  ${'Mode'.padEnd(width)}local (no account, nothing uploaded)\n`);
    process.stdout.write('\nStart a session in any wired agent, then pick it up in another one on this machine with\n');
    process.stdout.write('/agentdrive:resume in Claude Code or `adrive resume`. Run `adrive init` again to sign in and sync across machines.\n');
    return;
  }
  process.stdout.write(
    `  ${'Sync'.padEnd(width)}transcripts ${preferences.capture_transcripts ? 'on' : 'off'}, artifacts ${preferences.capture_artifacts ? 'on' : 'off'}\n`,
  );
  process.stdout.write(`  ${'Encryption'.padEnd(width)}${preferences.private_workspace ? 'on (E2E)' : 'off'}\n`);
  process.stdout.write(`  ${'New tools'.padEnd(width)}${preferences.auto_wire ? 'connected automatically when installed' : 'off (re-run adrive init)'}\n`);

  process.stdout.write('\nStart a session in any wired agent; it syncs to your workspace in the background.\n');
  process.stdout.write('Pick it up anywhere with /agentdrive:resume in Claude Code or `adrive resume`. Change settings with `adrive privacy`.\n');
}
