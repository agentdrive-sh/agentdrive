import prompts from 'prompts';
import kleur from 'kleur';
import type { CliApiClient } from './api-client.js';
import { DEFAULT_PREFERENCES, type CliConfig } from './config.js';

function notice(on: boolean): string {
  return `
${kleur.bold(`AgentDrive session sync is ${on ? 'on' : 'off'}`)}
  - ${on ? 'Uploads' : 'When on, uploads'} to your AgentDrive workspace: your agent session transcripts, and files your agents write that git doesn't track.
${on ? `  - The first sync also uploads your sessions from the last 14 days, from every supported agent tool on this machine, except ones that ran while sync was off.\n` : ''}  - Each synced session is also listed as a run with its title (your first prompt, redacted), project, working directory, timing and the paths it touched.
  - If you run ${kleur.bold('adrive watch')}, it uploads every file under that folder, existing ones included, except links, files with other hard links, the built-in deny list, and matches of the .gitignore and .adriveignore at the folder's top level (nested ones are not read).
  - Secrets are redacted on this device before anything is uploaded.
  - Turn on Private Workspace to encrypt the transcripts and files the CLI syncs on your device before upload, and keep the title, working directory and paths out of runs. What agents write with the MCP tools (drive_write and others) is not encrypted.
  - Agent tools you install later are connected automatically at their next session.
  - ${on ? 'Change or turn it off anytime' : 'Turn it on'}: ${kleur.bold('adrive privacy')}
`;
}

// `preferencesSaved` is whether the on-disk config already had a preferences
// block: only a fresh install gets capture switched on, so a choice made before
// the notice existed is never overridden.
export async function ensureCaptureConsent(
  config: CliConfig,
  client: Pick<CliApiClient, 'listWorkspaces' | 'createWorkspace'>,
  opts: { interactive: boolean; preferencesSaved: boolean; now?: () => Date },
): Promise<CliConfig> {
  const next: CliConfig = { ...config };

  if (!next.capture_notice_at) {
    if (!opts.preferencesSaved) {
      next.preferences = { ...DEFAULT_PREFERENCES, ...(next.preferences ?? {}), capture_transcripts: true, capture_artifacts: true };
    }
    const prefs = next.preferences;
    process.stdout.write(notice(!!prefs?.capture_transcripts || !!prefs?.capture_artifacts));
    next.capture_notice_at = (opts.now ?? (() => new Date()))().toISOString();
  }

  if (!next.default_workspace) {
    try {
      next.default_workspace = await pickDefaultWorkspace(client, opts.interactive);
    } catch (err) {
      // Login already succeeded; a workspace can still be chosen later with --workspace.
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`${kleur.yellow('[warn]')} could not set a default workspace: ${msg}\n`);
    }
  }

  return next;
}

async function pickDefaultWorkspace(
  client: Pick<CliApiClient, 'listWorkspaces' | 'createWorkspace'>,
  interactive: boolean,
): Promise<string> {
  const workspaces = await client.listWorkspaces();
  if (workspaces.length === 0) {
    const ws = await client.createWorkspace('Personal');
    process.stdout.write(`Created workspace ${kleur.bold(ws.name)} (${ws.id}) as your default.\n`);
    return ws.id;
  }
  if (workspaces.length === 1) return workspaces[0]!.id;

  if (interactive) {
    const res = (await prompts({
      type: 'select',
      name: 'ws',
      message: 'Default workspace for synced sessions',
      choices: workspaces.map((w) => ({ title: `${w.name} (${w.id})`, value: w.id })),
    })) as { ws?: string };
    if (res.ws) return res.ws;
  }
  const first = workspaces[0]!;
  process.stdout.write(
    `Using ${kleur.bold(first.name)} (${first.id}) as your default workspace. Change it in ~/.config/agentdrive/config.json.\n`,
  );
  return first.id;
}
