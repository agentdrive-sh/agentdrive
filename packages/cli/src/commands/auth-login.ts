import kleur from 'kleur';
import { CliApiClient } from '../lib/api-client.js';
import { DEFAULT_API_URL, changesOnto, readConfig, updateConfig } from '../lib/config.js';
import { ensureCaptureConsent } from '../lib/consent.js';
import { pollAuth, type PollAuthResult } from '../lib/poll-auth.js';
import { preserveKeychain } from '../lib/keychain.js';

export interface AuthLoginOptions {
  apiUrl?: string;
  withKey?: boolean;
}

// Read from stdin, never argv, so the key stays out of process listings.
async function keyFromStdin(apiUrl: string): Promise<PollAuthResult> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const api_key = Buffer.concat(chunks).toString('utf8').trim();
  if (!api_key.startsWith('agentdrive_live_')) throw new Error('--with-key expects an AgentDrive API key (agentdrive_live_...) on stdin');
  const me = (await new CliApiClient({ baseUrl: apiUrl, apiKey: api_key, agentPlatform: 'cli' }).whoami()) as { agent_id?: string; org_id?: string };
  return { api_key, agent_id: me.agent_id, org_id: me.org_id };
}

export async function cmdAuthLogin(opts: AuthLoginOptions = {}): Promise<void> {
  const existing = await readConfig();
  await preserveKeychain(existing?.api_key);
  const apiUrl = opts.apiUrl ?? existing?.api_url ?? DEFAULT_API_URL;

  const result = opts.withKey
    ? await keyFromStdin(apiUrl)
    : await pollAuth(new CliApiClient({ baseUrl: apiUrl, agentPlatform: 'cli' }));

  const { after } = await updateConfig((latest) => ({
    ...latest,
    api_url: apiUrl,
    api_key: result.api_key,
    agent_id: result.agent_id,
    org_id: result.org_id,
    agent_platform: 'cli',
    // An explicit list, even empty, tells auto-wire this login should wire the tools already installed;
    // only a config from before auto-wire (no list at all) is treated as a baseline.
    wired: latest?.wired ?? [],
    // A workspace of another account would keep sync pointed at it; consent picks one of this account's.
    default_workspace: latest?.org_id && latest.org_id === result.org_id && latest.api_url === apiUrl ? latest.default_workspace : undefined,
  }));
  const saved = after!;

  process.stdout.write(`${kleur.green('[ok]')} API key saved.\n`);
  if (result.agent_id) process.stdout.write(`     agent_id: ${result.agent_id}\n`);
  if (result.org_id) process.stdout.write(`     org_id:   ${result.org_id}\n`);

  const authed = new CliApiClient({ baseUrl: apiUrl, apiKey: result.api_key, agentPlatform: 'cli' });
  // Asked outside the lock (it may prompt); only what consent changed is applied to the config as it is then.
  // `saved` has preferences only if they were saved when it was read, even by adrive privacy run during sign-in.
  const consent = await ensureCaptureConsent(saved, authed, { interactive: !!process.stdin.isTTY, preferencesSaved: !!saved.preferences });
  await updateConfig((latest) => latest && changesOnto(latest, saved, consent));
}
