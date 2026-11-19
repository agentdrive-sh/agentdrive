import { spawn } from 'node:child_process';
import { projectKeyFor, scopeProjectKey } from '@adrive/mcp-server/project';
import { sessionActivityAt, sessionRunId, type SessionHarness } from '@adrive/mcp-server/session';
import { CliApiClient } from '../lib/api-client.js';
import { configDir, configPath, readConfig, reconcileHistory, type CliConfig } from '../lib/config.js';
import { HARNESSES } from '@adrive/mcp-server/local';
import { recordSessionCwd } from '@adrive/mcp-server/transcripts/session-cwd';
import { takeAutoWireNotice } from '../lib/auto-wire.js';
import { readUsageNotice } from '../lib/usage-notice.js';
import { asObj, asStr, truncate, type Json } from '@adrive/mcp-server/transcripts/util';

// Entry point for every harness lifecycle hook. Hooks run inline with the
// agent (Codex clamps hook timeouts to 3s), so this answers fast, hands the real
// work to a detached `adrive sync`, never throws, and always exits 0. stdout
// is reserved for the harness's JSON protocol.

const STDIN_TIMEOUT_MS = 1000;
const CONTEXT_TIMEOUT_MS = 1500;
const MAX_CONTEXT_SESSIONS = 3;
const CONTEXT_FETCH = 20;
const NOT_CONNECTED =
  'AgentDrive is installed but not connected to an account, so it runs in local mode. To continue work another agent started on this machine, call the drive_resume tool (or run `adrive resume`); it reads local transcripts and needs no account. ' +
  'Sessions are not synced across machines or shared. If the user wants that, offer to connect: run `npx -y @adrive/cli init --yes` in the shell, in the background so you can read its output. It prints a sign-in URL and a code and opens the browser: show the user both, since they type the code on that page. It then connects every installed agent tool.';

const START_EVENTS = new Set(['SessionStart', 'sessionStart', 'session.created']);
// OpenCode has no end event and its idle often lands within the debounce of
// session.created, so a debounced idle would leave a one-shot session empty.
const FORCE_EVENTS = new Set(['SessionEnd', 'sessionEnd', 'PreCompact', 'preCompact', 'PreCompress', 'session.idle']);
const TURN_EVENTS = new Set(['Stop', 'stop', 'AfterAgent']);

export type HookEvent = 'start' | 'force' | 'turn' | 'file-edit' | 'other';

export function classifyEvent(name: string): HookEvent {
  if (START_EVENTS.has(name)) return 'start';
  if (FORCE_EVENTS.has(name)) return 'force';
  if (TURN_EVENTS.has(name)) return 'turn';
  if (name === 'afterFileEdit') return 'file-edit';
  return 'other';
}

export interface HookDeps {
  // From `--event`, for harnesses whose payload has no event name (Antigravity).
  event?: string;
  spawnSync?: (args: string[]) => void;
  now?: number;
}

function spawnDetachedSync(args: string[]): void {
  const child = spawn(process.execPath, [process.argv[1]!, 'sync', ...args], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

function age(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

async function recentSessions(cfg: CliConfig & { api_key: string }, harness: SessionHarness, cwd: string, sessionId: string | undefined, now: number): Promise<string | undefined> {
  const client = new CliApiClient({ baseUrl: cfg.api_url, apiKey: cfg.api_key, agentPlatform: harness, agentRole: cfg.agent_role });
  const runs = await client.listRuns({ project: scopeProjectKey(projectKeyFor(cwd), !!cfg.preferences?.private_workspace), limit: CONTEXT_FETCH, timeoutMs: CONTEXT_TIMEOUT_MS }).catch(() => []);
  const current = sessionId ? sessionRunId(harness, sessionId) : undefined;
  const others = runs.filter((r) => r.run_id !== current);
  // The newest session of every other harness first, so a burst of short runs in one harness cannot hide the rest.
  const firsts = others.filter((r, i) => r.agent_platform !== harness && others.findIndex((o) => o.agent_platform === r.agent_platform) === i);
  const picked = [...new Set([...firsts, ...others])].slice(0, MAX_CONTEXT_SESSIONS);
  const lines = others
    .filter((r) => picked.includes(r))
    .map((r) => {
      const title = truncate(asStr(r.metadata?.title) || r.task, 120);
      return `- ${r.agent_platform} · ${age(now - sessionActivityAt(r))} · "${title}" (id ${r.run_id})`;
    });
  if (lines.length === 0) return undefined;
  return [
    'Recent AgentDrive sessions in this project:',
    ...lines,
    'To continue one, call the drive_resume tool (or /agentdrive:resume) with its id.',
  ].join('\n');
}

function formatContext(harness: SessionHarness, context: string | undefined): string {
  if (!context || harness === 'opencode') return '';
  if (harness === 'cursor') return JSON.stringify({ additional_context: context });
  if (harness === 'antigravity') return JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: context } }] });
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
}

function parsePayload(raw: string): Json {
  try {
    return asObj(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

export async function runHook(harness: string, raw: string, deps: HookDeps = {}): Promise<string> {
  // Gemini, Cursor and Antigravity parse stdout as JSON on every event.
  const emptyOut = harness === 'gemini-cli' || harness === 'cursor' || harness === 'antigravity' ? '{}' : '';
  let out = '';
  try {
    if (!HARNESSES.includes(harness as SessionHarness)) return emptyOut;
    const h = harness as SessionHarness;
    const payload = parsePayload(raw);
    const event = classifyEvent(asStr(payload.hook_event_name) ?? deps.event ?? '');
    const roots = h === 'cursor' ? payload.workspace_roots : h === 'antigravity' ? payload.workspacePaths : undefined;
    const root = Array.isArray(roots) ? asStr(roots[0]) : undefined;
    const sessionId = asStr(
      h === 'cursor' ? payload.conversation_id ?? payload.session_id : h === 'antigravity' ? payload.conversationId : payload.session_id,
    );
    const knownCwd = root ?? asStr(payload.cwd);
    // Antigravity runs hooks from ~/.gemini/config, so its process cwd is never the project.
    const cwd = knownCwd ?? (h === 'antigravity' ? undefined : process.cwd());
    const transcript = asStr(h === 'antigravity' ? payload.transcriptPath : payload.transcript_path);

    const cfg = await readConfig();
    // A read, and a write only on change: a toggle an older CLI or a hand edit flipped still gets its off interval.
    if (cfg?.api_key) await reconcileHistory(configPath()).catch(() => undefined);
    const capturing = !!cfg?.preferences?.capture_transcripts || !!cfg?.preferences?.capture_artifacts;
    // Recorded with or without an account or capture: local resume needs it to place
    // transcripts that carry no cwd, and the map never leaves this machine.
    if (sessionId && knownCwd) {
      await recordSessionCwd(configDir(), sessionRunId(h, sessionId), knownCwd);
    }
    if (event === 'other' || event === 'file-edit') return emptyOut;

    if (event === 'start') {
      const recent = !cfg?.api_key
        ? NOT_CONNECTED
        : cfg.preferences?.auto_context && cwd
          ? await recentSessions(cfg as CliConfig & { api_key: string }, h, cwd, sessionId, deps.now ?? Date.now())
          : undefined;
      // OpenCode has no start-context channel, so it must not consume the notice meant for the next harness that does.
      const notice = cfg?.api_key && h !== 'opencode' ? await takeAutoWireNotice(configDir()).catch(() => undefined) : undefined;
      // Recorded by the last background sync; it stays until a sync clears it.
      const usage = cfg?.api_key ? (await readUsageNotice(configDir()))?.message : undefined;
      out = formatContext(h, [usage, notice, recent].filter(Boolean).join('\n\n') || undefined);
    }

    // A session start also runs auto-wire, which matters even when capture is off.
    if (cfg?.api_key && (capturing || (event === 'start' && cfg.preferences?.auto_wire !== false))) {
      (deps.spawnSync ?? spawnDetachedSync)([
        '--quiet',
        '--harness',
        h,
        ...(sessionId ? ['--session', sessionId] : []),
        ...(transcript ? ['--transcript', transcript] : []),
        ...(cwd ? ['--cwd', cwd] : []),
        ...(event === 'force' ? ['--force'] : event === 'start' ? ['--start'] : []),
      ]);
    }
  } catch {
    // A hook failure must never surface in, or block, the agent session.
  }
  return out || emptyOut;
}

function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const done = () => {
      clearTimeout(timer);
      process.stdin.destroy();
      resolve(data);
    };
    const timer = setTimeout(done, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

export async function cmdHook(harness: string, event?: string): Promise<void> {
  let out = '';
  try {
    out = await runHook(harness, await readStdin(STDIN_TIMEOUT_MS), { event });
  } catch {
    // runHook already swallows; this guards stdin edge cases.
  }
  // Exit explicitly: an aborted context fetch keeps its socket connecting for
  // ~10s, and harnesses wait for the hook process to exit.
  process.stdout.write(out ? `${out}\n` : '', () => process.exit(0));
}
