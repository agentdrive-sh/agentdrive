import prompts from 'prompts';
import kleur from 'kleur';
import { configPath, deleteConfig, readConfig } from '../lib/config.js';
import { preserveKeychain } from '../lib/keychain.js';

export interface AuthLogoutOptions {
  yes?: boolean;
}

export async function cmdAuthLogout(opts: AuthLogoutOptions = {}): Promise<void> {
  if (!opts.yes) {
    const res = await prompts({
      type: 'confirm',
      name: 'ok',
      message: 'Wipe local AgentDrive credentials?',
      initial: false,
    });
    if (!res.ok) {
      process.stdout.write('Cancelled.\n');
      return;
    }
  }
  await preserveKeychain((await readConfig())?.api_key);
  const removed = await deleteConfig();
  if (removed) {
    process.stdout.write(`${kleur.green('[ok]')} Logged out. Removed ${configPath()}.\n`);
  } else {
    process.stdout.write('Nothing to remove — already logged out.\n');
  }
}
