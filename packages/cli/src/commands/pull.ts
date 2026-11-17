import { promises as fs } from 'node:fs';
import kleur from 'kleur';
import { CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';
import { decryptContentAsync, isEncrypted } from '../lib/crypto.js';

export interface PullOptions {
  out?: string;
}

export async function cmdPull(spec: string, opts: PullOptions = {}): Promise<void> {
  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });

  const slash = spec.indexOf('/');
  if (slash <= 0) {
    throw new Error('Expected <workspace-id>/<path>');
  }
  const workspaceId = spec.slice(0, slash);
  const remotePath = spec.slice(slash + 1);

  const file = await client.readFileByPath(workspaceId, remotePath);
  const content = isEncrypted(file.content)
    ? await decryptContentAsync(cfg.api_key, file.content)
    : file.content;

  if (opts.out) {
    await fs.writeFile(opts.out, content, 'utf8');
    process.stdout.write(`${kleur.green('[ok]')} wrote ${opts.out} (v${file.version})\n`);
  } else {
    process.stdout.write(content);
    if (!content.endsWith('\n')) process.stdout.write('\n');
  }
}
