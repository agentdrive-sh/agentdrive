import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import kleur from 'kleur';
import { CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';
import { encryptContentAsync } from '../lib/crypto.js';

export interface PushOptions {
  workspace?: string;
  remotePath?: string;
  message?: string;
  encrypt?: boolean;
  plaintext?: boolean;
}

export async function cmdPush(localPath: string, opts: PushOptions = {}): Promise<void> {
  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });

  const raw = await fs.readFile(localPath, 'utf8');
  const remotePath = opts.remotePath ?? basename(localPath);

  // Encryption: explicit --encrypt always on; explicit --plaintext always off;
  // otherwise honor the user's preference.
  let encrypt: boolean;
  if (opts.encrypt) encrypt = true;
  else if (opts.plaintext) encrypt = false;
  else encrypt = cfg.preferences?.private_workspace ?? false;

  const content = encrypt ? await encryptContentAsync(cfg.api_key, raw) : raw;

  let workspaceId = opts.workspace ?? cfg.default_workspace;
  if (!workspaceId) {
    const list = await client.listWorkspaces();
    if (list.length === 1) {
      workspaceId = list[0]!.id;
    } else if (list.length === 0) {
      throw new Error('No workspaces. Create one first.');
    } else {
      throw new Error(`Multiple workspaces — specify --workspace <id>. Available: ${list.map((w) => w.id).join(', ')}`);
    }
  }

  const result = await client.writeFile(workspaceId, remotePath, content, opts.message);
  const tag = encrypt ? kleur.cyan(' (encrypted)') : '';
  process.stdout.write(
    `${kleur.green('[ok]')} pushed ${localPath} -> ${workspaceId}:${result.path} (v${result.version})${tag}\n`,
  );
}
