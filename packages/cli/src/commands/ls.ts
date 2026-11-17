import { CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';

export async function cmdLs(): Promise<void> {
  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });
  const workspaces = await client.listWorkspaces();
  if (workspaces.length === 0) {
    process.stdout.write('No workspaces. Create one via the dashboard or `POST /v1/workspaces`.\n');
    return;
  }
  const idWidth = Math.max(...workspaces.map((w) => w.id.length));
  const nameWidth = Math.max(...workspaces.map((w) => w.name.length));
  for (const w of workspaces) {
    const id = w.id.padEnd(idWidth);
    const name = w.name.padEnd(nameWidth);
    process.stdout.write(`${id}  ${name}  ${w.created_at}\n`);
  }
}
