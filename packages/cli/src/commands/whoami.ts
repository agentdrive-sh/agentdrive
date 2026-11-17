import { CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';

export async function cmdWhoami(): Promise<void> {
  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });
  const info = await client.whoami();
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
}
