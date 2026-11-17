import open from 'open';
import kleur from 'kleur';
import { ApiError, type CliApiClient, type CliAuthPoll } from './api-client.js';

export interface PollAuthOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  openBrowser?: (url: string) => Promise<unknown>;
  log?: (line: string) => void;
  spinner?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

export interface PollAuthResult {
  api_key: string;
  agent_id?: string;
  org_id?: string;
}

const SPINNER_FRAMES = ['|', '/', '-', '\\'];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollAuth(
  client: CliApiClient,
  options: PollAuthOptions = {},
): Promise<PollAuthResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const sleep = options.sleep ?? defaultSleep;
  const browserOpener = options.openBrowser ?? ((url: string) => open(url));

  const start = await client.startCliAuth();

  log(kleur.bold('Opening browser to log in...'));
  log(`  ${kleur.cyan(start.auth_url)}`);
  log('');
  log(`  Code: ${kleur.bold().yellow(start.user_code)}`);
  log('');
  log('  Enter this code on that page to finish signing in.');
  log('  If the browser does not open, copy and paste the URL above.');

  try {
    await browserOpener(start.auth_url);
  } catch {
    log(kleur.yellow('[warn] Could not auto-open browser. Use the URL above.'));
  }

  const deadline = Date.now() + timeoutMs;
  let frame = 0;
  const showSpinner = options.spinner !== false && process.stdout.isTTY;

  while (Date.now() < deadline) {
    let poll: CliAuthPoll;
    try {
      poll = await client.pollCliAuth(start);
    } catch (err) {
      // A dropped connection is retried until the deadline: the server keeps a delivered key
      // readable for a minute, so a lost response does not cost the login.
      if (!(err instanceof ApiError)) {
        await sleep(pollIntervalMs);
        continue;
      }
      if (showSpinner) process.stdout.write('\r');
      throw err;
    }
    if (poll.status !== 'pending' && showSpinner) process.stdout.write('\r');
    if (poll.status === 'refused') {
      throw new Error(`${poll.error}\n  Upgrade: ${poll.upgrade_url}\n  Or revoke a key you no longer use to free its slot, then log in again.`);
    }
    if (poll.status === 'denied') throw new Error(`${poll.error} Run \`adrive auth login\` to try again.`);
    if (poll.status === 'expired') throw new Error('This login expired before it was finished in the browser. Run `adrive auth login` again.');
    if (poll.status === 'complete') {
      // Every CLI call authenticates with this key; "logged in" without one only fails later.
      if (!poll.api_key) throw new Error('Login finished in the browser but no API key was issued. Run `adrive init` again.');
      log(kleur.green('[ok] Logged in.'));
      return {
        api_key: poll.api_key,
        agent_id: poll.agent_id,
        org_id: poll.org_id,
      };
    }
    if (showSpinner) {
      const f = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
      frame += 1;
      process.stdout.write(`\r${kleur.dim(`[wait] ${f} polling for login...`)}`);
    }
    await sleep(pollIntervalMs);
  }

  if (showSpinner) process.stdout.write('\r');
  throw new Error('Login timed out. Run `adrive auth login` again.');
}
