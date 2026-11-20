#!/usr/bin/env node

import { Command } from 'commander';
import kleur from 'kleur';
import { cmdInit } from './commands/init.js';
import { cmdAuthLogin } from './commands/auth-login.js';
import { cmdAuthLogout } from './commands/auth-logout.js';
import { cmdAuthStatus } from './commands/auth-status.js';
import { cmdWhoami } from './commands/whoami.js';
import { cmdLs } from './commands/ls.js';
import { cmdPush } from './commands/push.js';
import { cmdPull } from './commands/pull.js';
import { cmdSearch } from './commands/search.js';
import { cmdContext } from './commands/context.js';
import { cmdRunLog } from './commands/run-log.js';
import { cmdBilling } from './commands/billing.js';
import { cmdPlan } from './commands/plan.js';
import { cmdUpgrade } from './commands/upgrade.js';
import { cmdPrivacy } from './commands/privacy.js';
import { cmdWatch } from './commands/watch.js';
import { cmdHook } from './commands/hook.js';
import { cmdSync } from './commands/sync.js';
import { cmdResume } from './commands/resume.js';
import { cmdTimeline } from './commands/timeline.js';

// Read from the bundled package.json so we never drift again.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname as pathDirname, join as pathJoin } from 'node:path';
const __dirname = pathDirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(pathJoin(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
const VERSION = pkg.version;

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${kleur.red('[error]')} ${msg}\n`);
  process.exit(1);
}

function wrap<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      fail(err);
    }
  };
}

process.on('SIGINT', () => {
  // A command with its own handler (adrive watch) shuts down cleanly on its own.
  if (process.listenerCount('SIGINT') > 1) return;
  process.stderr.write('\nInterrupted.\n');
  process.exit(130);
});

const program = new Command();

program
  .name('adrive')
  .description('AgentDrive — sync coding-agent sessions and resume them in Claude Code, Codex, OpenCode, Cursor or Antigravity.')
  .version(VERSION, '-v, --version');

program
  .command('init')
  .description('Log in and wire AgentDrive into every installed agent tool')
  .option('-y, --yes', 'Never prompt; with several workspaces, the first becomes the default')
  .option('--api-url <url>', 'Override the AgentDrive API base URL')
  .option('--local', 'Skip sign-in: resume between agents on this machine from local transcripts')
  .action(wrap((opts) => cmdInit(opts)));

const auth = program.command('auth').description('Manage AgentDrive login');
auth
  .command('login')
  .description('Open browser, log in, store API key')
  .option('--api-url <url>', 'Override the AgentDrive API base URL')
  .option('--with-key', 'Read an existing API key from stdin instead of opening the browser')
  .action(wrap((opts) => cmdAuthLogin(opts)));
auth
  .command('logout')
  .description('Wipe local AgentDrive credentials')
  .option('-y, --yes', 'Skip confirmation')
  .action(wrap((opts) => cmdAuthLogout(opts)));
auth
  .command('status')
  .description('Show current login state')
  .action(wrap(() => cmdAuthStatus()));

program
  .command('whoami')
  .description('Print principal info from the AgentDrive API')
  .action(wrap(() => cmdWhoami()));

program
  .command('ls')
  .description('List workspaces')
  .action(wrap(() => cmdLs()));

program
  .command('push <local-path>')
  .description('Upload a local file to a workspace')
  .option('-w, --workspace <id>', 'Workspace id (default: only workspace, if exactly one)')
  .option('-r, --remote-path <path>', 'Remote path (default: basename of local-path)')
  .option('-m, --message <msg>', 'Commit-style message stored on the version')
  .option('--encrypt', 'Force end-to-end encryption for this upload')
  .option('--plaintext', 'Force plaintext upload, even if Private Workspace is on')
  .action(wrap((localPath, opts) => cmdPush(localPath, opts)));

program
  .command('pull <workspace-id-slash-path>')
  .description('Download a file. Spec is <workspace-id>/<path>')
  .option('-o, --out <file>', 'Write to file (default: stdout)')
  .action(wrap((spec, opts) => cmdPull(spec, opts)));

program
  .command('search <query>')
  .description('Semantic search across workspace artifacts')
  .option('--top-k <n>', 'Number of hits to return')
  .option('--platform <p>', 'Filter to artifacts written by a specific agent platform')
  .option('-w, --workspace <id>', 'Restrict to one workspace')
  .action(wrap((query, opts) => cmdSearch(query, {
    topK: opts.topK,
    platform: opts.platform,
    workspace: opts.workspace,
  })));

program
  .command('timeline')
  .description('Cross-agent activity stream for your org')
  .option('--today', 'Only events since midnight UTC')
  .option('--since <iso>', 'Only events strictly after this ISO datetime')
  .option('--limit <n>', 'Max events to show (default 200, max 1000)')
  .action(wrap((opts) => cmdTimeline(opts)));

program
  .command('context [task]')
  .description('Auto-pull relevant artifacts for a task')
  .option('--limit <n>', 'Max artifacts to return')
  .option('-w, --workspace <id>', 'Restrict to one workspace')
  .action(wrap((task, opts) => cmdContext(task, opts)));

program
  .command('run-log <task>')
  .description('Log an agent run for cross-platform provenance')
  .option('--status <status>', 'success | failure | partial | in_progress', 'success')
  .option('--duration <ms>', 'Duration in milliseconds')
  .option('--ref <path...>', 'Artifacts referenced (repeatable)')
  .option('--produced <path...>', 'Artifacts produced (repeatable)')
  .action(wrap((task, opts) => cmdRunLog(task, {
    status: opts.status,
    duration: opts.duration,
    ref: opts.ref,
    produced: opts.produced,
  })));

program
  .command('billing')
  .description('Open the Stripe billing portal in your browser')
  .action(wrap(() => cmdBilling()));

program
  .command('plan')
  .description('Show current plan, usage, and quotas')
  .action(wrap(() => cmdPlan()));

program
  .command('upgrade [plan]')
  .description('Open the upgrade page for pro or team (default: the next plan up)')
  .option('--seats <n>', 'Team seats to buy (3 to 100, default 3)')
  .action(wrap((plan, opts) => cmdUpgrade(plan, opts)));

program
  .command('watch [path]')
  .description('Upload every file under the path (default: cwd), existing ones first, then each change; skips .gitignore and .adriveignore matches')
  .option('-w, --workspace <id>', 'Workspace id (default: only workspace)')
  .option('--dry-run', 'Print what would be uploaded; never write')
  .option('--no-encrypt', 'Skip end-to-end encryption even when Private Workspace is on')
  .option('--debounce <ms>', 'Coalesce changes within this window', (v) => Number(v))
  .action(wrap((path, opts) =>
    cmdWatch(path, {
      workspace: opts.workspace,
      dryRun: opts.dryRun,
      noEncrypt: opts.encrypt === false,
      debounce: opts.debounce,
    }),
  ));

program
  .command('hook <harness>')
  .description('Lifecycle hook entry for claude-code | codex | opencode | gemini-cli | cursor | antigravity (reads the event JSON on stdin)')
  .option('--event <name>', 'Event name, for harnesses whose payload has none (antigravity)')
  .action((harness: string, opts: { event?: string }) => cmdHook(harness, opts.event));

program
  .command('sync')
  .description('Upload agent sessions and the untracked files they wrote to AgentDrive')
  .option('--harness <h>', 'claude-code | codex | opencode | gemini-cli | cursor | antigravity')
  .option('--session <id>', 'Sync this harness session (with --harness)')
  .option('--transcript <path>', 'Transcript file of that session')
  .option('--cwd <dir>', 'Session working directory, used when the transcript has none')
  .option('--force', 'Sync sessions synced in the last 2 minutes too, and mark the named session finished')
  .option('--start', 'Session-start sync: always sweep for recent sessions')
  .option('--all', 'Sweep full history instead of changes since the last sweep')
  .option('--quiet', 'Log to sync.log in the config dir instead of stdout, and skip sessions synced in the last 2 minutes (for hooks)')
  .option('--dry-run', 'Parse and report; never upload')
  .action(wrap((opts) => cmdSync(opts)));

program
  .command('resume [id]')
  .description('Print a handoff for a prior session of this project (if no id, the latest from another agent), or for a share link. Without a login, reads this machine\'s agent transcripts')
  .option('--list', 'List recent sessions for this project')
  .option('--local', 'Read sessions from this machine\'s agent transcripts, even when logged in')
  .option('--max-chars <n>', 'Handoff size budget in characters', (v) => Number(v))
  .option('--as <agent>', 'The agent you are running this from, left out of the latest-session pick (for one adrive cannot detect, such as antigravity)')
  .action(wrap((id, opts) => cmdResume(id, { list: opts.list, local: opts.local, maxChars: opts.maxChars, as: opts.as })));

program
  .command('privacy')
  .description('Show or change your privacy and sync preferences')
  .option('--show', 'Just print current preferences')
  .option('--auto-context <on|off>', 'Always-on context for new sessions')
  .option('--capture-artifacts <on|off>', 'Sync untracked files your agents write, and allow `adrive watch` to upload a folder')
  .option('--capture-transcripts <on|off>', 'Sync session transcripts to your workspace')
  .option('--private-workspace <on|off>', 'End-to-end encrypt your workspace')
  .option('--auto-wire <on|off>', 'Connect agent tools you install later')
  .action(wrap((opts) =>
    cmdPrivacy({
      show: opts.show,
      autoContext: opts.autoContext,
      captureArtifacts: opts.captureArtifacts,
      captureTranscripts: opts.captureTranscripts,
      privateWorkspace: opts.privateWorkspace,
      autoWire: opts.autoWire,
    }),
  ));

program.parseAsync(process.argv).catch(fail);
