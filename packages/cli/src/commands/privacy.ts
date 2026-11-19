import prompts from 'prompts';
import kleur from 'kleur';
import {
  DEFAULT_PREFERENCES,
  readConfig,
  updateConfig,
  type CliPreferences,
} from '../lib/config.js';
import { writeAllInstructions, removeAllInstructions } from '../lib/auto-context.js';

export interface PrivacyOptions {
  // Non-interactive setters. Each accepts on/off.
  autoContext?: 'on' | 'off';
  captureArtifacts?: 'on' | 'off';
  captureTranscripts?: 'on' | 'off';
  privateWorkspace?: 'on' | 'off';
  autoWire?: 'on' | 'off';
  show?: boolean;
}

function display(p: CliPreferences): void {
  process.stdout.write(`\n${kleur.bold('AgentDrive privacy and sync preferences')}\n\n`);
  process.stdout.write(`  Always-on context        ${p.auto_context ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`  Sync artifacts           ${p.capture_artifacts ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`  Sync transcripts         ${p.capture_transcripts ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`  Private Workspace (E2E)  ${p.private_workspace ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`  Connect new agent tools  ${p.auto_wire ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`\n${kleur.dim('A session that runs while transcript or artifact sync is off never syncs that part, even after you turn it back on.')}\n`);
  process.stdout.write(`${kleur.dim('Change with `adrive privacy --capture-artifacts on` etc., or run it bare to step through.')}\n`);
}

export async function cmdPrivacy(opts: PrivacyOptions = {}): Promise<void> {
  const cfg = await readConfig();
  if (!cfg || !cfg.api_key) {
    throw new Error('Not logged in. Run `adrive init` first.');
  }
  const current: CliPreferences = { ...DEFAULT_PREFERENCES, ...(cfg.preferences ?? {}) };
  // Only what the user set: applied to the config as it is when written, so a concurrent writer can't undo it.
  let changes: Partial<CliPreferences> = {};

  const hasFlag =
    opts.autoContext !== undefined ||
    opts.captureArtifacts !== undefined ||
    opts.captureTranscripts !== undefined ||
    opts.privateWorkspace !== undefined ||
    opts.autoWire !== undefined;

  if (opts.show && !hasFlag) {
    display(current);
    return;
  }

  if (hasFlag) {
    if (opts.autoContext !== undefined) changes.auto_context = opts.autoContext === 'on';
    if (opts.captureArtifacts !== undefined) changes.capture_artifacts = opts.captureArtifacts === 'on';
    if (opts.captureTranscripts !== undefined) changes.capture_transcripts = opts.captureTranscripts === 'on';
    if (opts.privateWorkspace !== undefined) changes.private_workspace = opts.privateWorkspace === 'on';
    if (opts.autoWire !== undefined) changes.auto_wire = opts.autoWire === 'on';
  } else {
    process.stdout.write(`\n${kleur.bold('Your AI memory')}\n`);
    process.stdout.write(`${kleur.dim('You control what gets shared.')}\n\n`);
    const answers = (await prompts([
      {
        type: 'toggle',
        name: 'auto_context',
        message: 'Always-on context',
        initial: current.auto_context,
        active: 'on',
        inactive: 'off',
      },
      {
        type: 'toggle',
        name: 'capture_artifacts',
        message: 'Sync artifacts (untracked files your agents write; also allows adrive watch to upload a folder)',
        initial: current.capture_artifacts,
        active: 'on',
        inactive: 'off',
      },
      {
        type: 'toggle',
        name: 'capture_transcripts',
        message: 'Sync session transcripts',
        initial: current.capture_transcripts,
        active: 'on',
        inactive: 'off',
      },
      {
        type: 'toggle',
        name: 'private_workspace',
        message: 'Private Workspace (E2E encrypted)',
        initial: current.private_workspace,
        active: 'on',
        inactive: 'off',
      },
      {
        type: 'toggle',
        name: 'auto_wire',
        message: 'Connect agent tools installed later',
        initial: current.auto_wire,
        active: 'on',
        inactive: 'off',
      },
    ])) as Partial<CliPreferences>;
    changes = Object.fromEntries(Object.entries(answers).filter(([, v]) => typeof v === 'boolean')) as Partial<CliPreferences>;
  }

  const { before, after } = await updateConfig(
    (latest) => {
      if (!latest?.api_key) throw new Error('Not logged in. Run `adrive init` first.');
      return { ...latest, preferences: { ...DEFAULT_PREFERENCES, ...latest.preferences, ...changes } };
    },
    { effectiveBefore: true },
  );
  const was: CliPreferences = { ...DEFAULT_PREFERENCES, ...before?.preferences };
  const next: CliPreferences = { ...DEFAULT_PREFERENCES, ...after?.preferences };

  // Reconcile auto-context instructions with the new preference.
  if (next.auto_context && !was.auto_context) {
    await writeAllInstructions();
  } else if (!next.auto_context && was.auto_context) {
    await removeAllInstructions();
  } else if (next.auto_context) {
    // Keep the instructions in sync if they've drifted.
    await writeAllInstructions();
  }

  display(next);
}
