import prompts from 'prompts';
import kleur from 'kleur';
import {
  DEFAULT_PREFERENCES,
  readConfig,
  writeConfig,
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
  process.stdout.write(`\n${kleur.bold('AgentDrive privacy + memory preferences')}\n\n`);
  process.stdout.write(`  Always-on context        ${p.auto_context ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`  Capture artifacts        ${p.capture_artifacts ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`  Remember conversations   ${p.capture_transcripts ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`  Private workspace (E2E)  ${p.private_workspace ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`  Connect new agent tools  ${p.auto_wire ? kleur.green('on') : kleur.dim('off')}\n`);
  process.stdout.write(`\n${kleur.dim('Change with `adrive privacy --capture-artifacts on` etc., or run it bare to step through.')}\n`);
}

export async function cmdPrivacy(opts: PrivacyOptions = {}): Promise<void> {
  const cfg = await readConfig();
  if (!cfg || !cfg.api_key) {
    throw new Error('Not logged in. Run `adrive init` first.');
  }
  const current: CliPreferences = { ...DEFAULT_PREFERENCES, ...(cfg.preferences ?? {}) };
  let next = { ...current };

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
    if (opts.autoContext !== undefined) next.auto_context = opts.autoContext === 'on';
    if (opts.captureArtifacts !== undefined) next.capture_artifacts = opts.captureArtifacts === 'on';
    if (opts.captureTranscripts !== undefined) next.capture_transcripts = opts.captureTranscripts === 'on';
    if (opts.privateWorkspace !== undefined) next.private_workspace = opts.privateWorkspace === 'on';
    if (opts.autoWire !== undefined) next.auto_wire = opts.autoWire === 'on';
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
        message: 'Capture artifacts',
        initial: current.capture_artifacts,
        active: 'on',
        inactive: 'off',
      },
      {
        type: 'toggle',
        name: 'capture_transcripts',
        message: 'Remember conversations',
        initial: current.capture_transcripts,
        active: 'on',
        inactive: 'off',
      },
      {
        type: 'toggle',
        name: 'private_workspace',
        message: 'Private workspace (E2E encrypted)',
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
    next = {
      auto_context: answers.auto_context ?? current.auto_context,
      capture_artifacts: answers.capture_artifacts ?? current.capture_artifacts,
      capture_transcripts: answers.capture_transcripts ?? current.capture_transcripts,
      private_workspace: answers.private_workspace ?? current.private_workspace,
      auto_wire: answers.auto_wire ?? current.auto_wire,
    };
  }

  await writeConfig({ ...cfg, preferences: next });

  // Reconcile auto-context instructions with the new preference.
  if (next.auto_context && !current.auto_context) {
    await writeAllInstructions();
  } else if (!next.auto_context && current.auto_context) {
    await removeAllInstructions();
  } else if (next.auto_context) {
    // Keep the instructions in sync if they've drifted.
    await writeAllInstructions();
  }

  display(next);
}
