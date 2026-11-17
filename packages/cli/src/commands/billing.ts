import open from 'open';
import kleur from 'kleur';
import { ApiError, CliApiClient } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';

export async function cmdBilling(): Promise<void> {
  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });

  try {
    const portal = await client.billingPortal();
    try {
      await open(portal.url);
    } catch {
      // Browser launch can fail in headless contexts; the URL is printed below.
    }
    process.stdout.write(`${kleur.green('[ok]')} Opened billing portal in browser.\n`);
    process.stdout.write(`  ${portal.url}\n`);
  } catch (err) {
    // 409: the org has no Stripe customer yet, so there is nothing to manage.
    if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
      process.stdout.write(`${kleur.yellow('[info]')} No paid plan yet. See plans at https://agentdrive.sh/pricing\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
