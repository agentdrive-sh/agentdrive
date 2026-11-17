import type { Env } from '../env.js';
import type {
  SandboxState,
  SandboxExecResult,
  SandboxCommitResult,
} from '@agentdrive/shared';
import { StorageService } from './storage.js';

// Per-workspace persistent Linux sandbox. Backed by @cloudflare/sandbox over a
// Durable-Object-keyed-by-workspaceId. The binding is OPTIONAL — when SANDBOX
// is undefined, all functions throw SandboxUnavailableError so route + MCP
// layers can return a clean 503.
//
// Operational requirement: enabling Sandbox requires a Dockerfile + a
// [[containers]] block in wrangler.toml and a Cloudflare Containers plan.
// The code path is dormant when the binding isn't there.

const MAX_STDOUT_BYTES = 64 * 1024;
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const MAX_EXEC_TIMEOUT_MS = 60_000;
const MAX_READ_BYTES = 8 * 1024 * 1024;

export class SandboxUnavailableError extends Error {
  constructor() {
    super('Sandbox is not configured on this deployment. Set up [[containers]] in wrangler.toml + add a Dockerfile to enable.');
    this.name = 'SandboxUnavailableError';
  }
}

interface SandboxHandle {
  exec(cmd: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  gitCheckout(url: string, opts?: { branch?: string; depth?: number; targetDir?: string }): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

// We import getSandbox lazily so workers without the binding don't pay the
// module-resolve cost (and so unit tests can stub the loader).
type GetSandboxFn = (binding: unknown, name: string) => SandboxHandle;
let _getSandbox: GetSandboxFn | null = null;
let _getSandboxLoaded = false;

async function getSandboxLoader(): Promise<GetSandboxFn> {
  if (_getSandbox) return _getSandbox;
  if (_getSandboxLoaded) {
    throw new SandboxUnavailableError();
  }
  _getSandboxLoaded = true;
  try {
    const mod = await import('@cloudflare/sandbox');
    const fn = (mod as { getSandbox?: GetSandboxFn }).getSandbox;
    if (!fn) throw new SandboxUnavailableError();
    _getSandbox = fn;
    return fn;
  } catch {
    throw new SandboxUnavailableError();
  }
}

// Test hook: lets unit tests inject a stub Sandbox SDK without touching
// `@cloudflare/sandbox` import resolution.
export function __setSandboxLoaderForTest(fn: GetSandboxFn | null) {
  _getSandbox = fn;
  _getSandboxLoaded = fn !== null;
}

async function getWorkspaceSandbox(env: Env, workspaceId: string): Promise<SandboxHandle> {
  if (!env.SANDBOX) throw new SandboxUnavailableError();
  const loader = await getSandboxLoader();
  return loader(env.SANDBOX, workspaceId);
}

function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
}

export async function sandboxClone(
  env: Env,
  workspaceId: string,
  opts: { url: string; branch?: string; depth?: number },
): Promise<SandboxState> {
  const sb = await getWorkspaceSandbox(env, workspaceId);
  await sb.gitCheckout(opts.url, { branch: opts.branch, depth: opts.depth });
  return {
    workspace_id: workspaceId,
    repo_url: opts.url,
    branch: opts.branch,
    last_active_at: Math.floor(Date.now() / 1000),
  };
}

export async function sandboxExec(
  env: Env,
  workspaceId: string,
  cmd: string,
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<SandboxExecResult> {
  const sb = await getWorkspaceSandbox(env, workspaceId);
  const timeoutMs = Math.min(opts?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS, MAX_EXEC_TIMEOUT_MS);
  const start = Date.now();
  const result = await sb.exec(cmd, { cwd: opts?.cwd, timeoutMs });
  const duration = Date.now() - start;
  const stdout = truncate(result.stdout ?? '', MAX_STDOUT_BYTES);
  const stderr = truncate(result.stderr ?? '', MAX_STDOUT_BYTES);
  return {
    exit_code: result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    duration_ms: duration,
    truncated: stdout.truncated || stderr.truncated,
  };
}

export async function sandboxReadFile(
  env: Env,
  workspaceId: string,
  path: string,
): Promise<{ content: string; size: number; truncated: boolean } | null> {
  const sb = await getWorkspaceSandbox(env, workspaceId);
  try {
    const content = await sb.readFile(path);
    const size = new TextEncoder().encode(content).length;
    if (size > MAX_READ_BYTES) {
      return {
        content: content.slice(0, MAX_READ_BYTES),
        size,
        truncated: true,
      };
    }
    return { content, size, truncated: false };
  } catch {
    return null;
  }
}

export async function sandboxCommit(
  env: Env,
  workspaceId: string,
  opts: {
    message: string;
    author?: { name: string; email: string };
    actorId: string;
    actorAgentPlatform?: string;
    orgId?: string;
  },
): Promise<SandboxCommitResult> {
  const sb = await getWorkspaceSandbox(env, workspaceId);
  if (opts.author) {
    await sb.exec(`git config user.name "${opts.author.name.replace(/"/g, '')}"`);
    await sb.exec(`git config user.email "${opts.author.email.replace(/"/g, '')}"`);
  }
  await sb.exec('git add -A');
  const escapedMsg = opts.message.replace(/"/g, '\\"');
  const commitRes = await sb.exec(`git commit -m "${escapedMsg}"`);
  // Best-effort: parse the commit sha from the output.
  const shaRes = await sb.exec('git rev-parse HEAD');
  const branchRes = await sb.exec('git rev-parse --abbrev-ref HEAD');
  const shortStatRes = await sb.exec('git diff --shortstat HEAD~1 HEAD');

  const commitSha = (shaRes.stdout || '').trim();
  const branch = (branchRes.stdout || 'main').trim();
  const filesChangedMatch = (shortStatRes.stdout || '').match(/(\d+) files? changed/);
  const filesChanged = filesChangedMatch ? Number(filesChangedMatch[1]) : 0;

  // Surface the commit as an AgentDrive artifact for cross-agent visibility.
  const artifactPath = `commits/${commitSha}.json`;
  const storage = new StorageService(env.KV, env.R2);
  const artifactBody = JSON.stringify(
    {
      commit_sha: commitSha,
      branch,
      message: opts.message,
      author: opts.author,
      files_changed: filesChanged,
      commit_stdout: truncate(commitRes.stdout ?? '', 2000).text,
      committed_at: new Date().toISOString(),
      agent_platform: opts.actorAgentPlatform,
    },
    null,
    2,
  );
  await storage.writeFile(
    workspaceId,
    artifactPath,
    artifactBody,
    'agent',
    opts.actorId,
    `sandbox commit ${commitSha.slice(0, 8)}`,
    env,
    undefined,
    {
      agent_platform: opts.actorAgentPlatform,
      org_id: opts.orgId,
      mime: 'application/json',
    },
  );

  return {
    commit_sha: commitSha,
    branch,
    files_changed: filesChanged,
    artifact_path: artifactPath,
  };
}
