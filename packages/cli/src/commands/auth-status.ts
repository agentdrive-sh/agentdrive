import kleur from 'kleur';
import { readConfig } from '../lib/config.js';

export async function cmdAuthStatus(): Promise<void> {
  const c = await readConfig();
  if (!c || !c.api_key) {
    process.stdout.write(`${kleur.yellow('[not logged in]')} Run \`adrive auth login\` or \`adrive init\`.\n`);
    process.exitCode = 1;
    return;
  }
  const masked = `${c.api_key.slice(0, 12)}${'.'.repeat(8)}`;
  process.stdout.write(`${kleur.green('[ok]')} Logged in.\n`);
  process.stdout.write(`  api_url:    ${c.api_url}\n`);
  process.stdout.write(`  api_key:    ${masked}\n`);
  if (c.org_id) process.stdout.write(`  org_id:     ${c.org_id}\n`);
  if (c.agent_id) process.stdout.write(`  agent_id:   ${c.agent_id}\n`);
  if (c.default_workspace) process.stdout.write(`  workspace:  ${c.default_workspace}\n`);
}
