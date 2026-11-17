import open from 'open';
import kleur from 'kleur';
import { CliApiClient } from '../lib/api-client.js';
import { readConfig } from '../lib/config.js';

const SITE_URL = 'https://agentdrive.sh';
const PLANS = ['pro', 'team'];
const TEAM_SEATS = { min: 3, max: 100 };

// With no plan named, the server picks the next tier up from the current one
// (Team goes to Enterprise contact); signed out or offline, Pro.
export async function upgradeUrl(plan: string | undefined, current: () => Promise<string | undefined>, seats?: string): Promise<string> {
  if (seats !== undefined) {
    if (plan !== 'team') throw new Error('--seats applies to the team plan: adrive upgrade team --seats <n>');
    const n = Number(seats);
    if (!Number.isInteger(n) || n < TEAM_SEATS.min || n > TEAM_SEATS.max) {
      throw new Error(`--seats must be a whole number from ${TEAM_SEATS.min} to ${TEAM_SEATS.max}.`);
    }
    return `${SITE_URL}/billing/upgrade?plan=team&seats=${n}`;
  }
  if (plan) {
    if (!PLANS.includes(plan)) throw new Error(`Unknown plan: ${plan}. Choose pro or team.`);
    return `${SITE_URL}/billing/upgrade?plan=${plan}`;
  }
  return (await current().catch(() => undefined)) ?? `${SITE_URL}/billing/upgrade?plan=pro`;
}

export async function cmdUpgrade(plan?: string, opts: { seats?: string } = {}): Promise<void> {
  const cfg = await readConfig();
  const url = await upgradeUrl(plan, async () => {
    if (!cfg?.api_key) return undefined;
    const client = new CliApiClient({ baseUrl: cfg.api_url, apiKey: cfg.api_key, agentPlatform: cfg.agent_platform ?? 'cli', agentRole: cfg.agent_role });
    // Bounded so a hung network falls back to the Pro link instead of blocking.
    return (await client.billingPlan(5000)).status?.upgrade_url;
  }, opts.seats);
  try {
    await open(url);
  } catch {
    // Browser launch can fail in headless contexts; the URL is printed below.
  }
  process.stdout.write(`${kleur.green('[ok]')} Opened the upgrade page in your browser.\n  ${url}\n`);
}
