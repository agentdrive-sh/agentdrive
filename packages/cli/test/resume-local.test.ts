import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runHook } from '../src/commands/hook.js';
import { cmdResume } from '../src/commands/resume.js';

const CWD = '/work/app';
const CODEX_ID = '019e13ac-3554-7e62-87b1-478188dfcced';
const SECRET = `sk-ant-${'a'.repeat(40)}`;

let root: string;
let stdout: string;
let stderr: string;

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function put(path: string, content: string, ageMinutes = 0): Promise<void> {
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, content);
  const at = new Date(Date.now() - ageMinutes * 60_000);
  await fs.utimes(path, at, at);
}

async function login(): Promise<void> {
  await put(join(root, 'config', 'agentdrive', 'config.json'), JSON.stringify({ api_url: 'http://localhost:8787', api_key: 'agentdrive_live_x' }));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'adrive-resume-local-'));
  const home = join(root, 'home');
  for (const name of ['CLAUDE_CODE_CHILD_SESSION', 'CODEX_THREAD_ID', 'OPENCODE', 'GEMINI_CLI', 'CURSOR_AGENT', 'AGENTDRIVE_AGENT_PLATFORM', 'CODEX_HOME', 'XDG_DATA_HOME']) {
    vi.stubEnv(name, '');
  }
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'));
  vi.spyOn(process, 'cwd').mockReturnValue(CWD);
  vi.stubGlobal('fetch', async () => {
    throw new Error('local mode must not touch the network');
  });
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((stdout += String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((stderr += String(chunk)), true));

  await put(
    join(home, '.claude/projects/-work-app/c1.jsonl'),
    jsonl([
      { type: 'user', cwd: CWD, timestamp: ago(11), message: { role: 'user', content: `Fix the login bug, key ${SECRET}` } },
      { type: 'assistant', cwd: CWD, timestamp: ago(10), message: { role: 'assistant', content: [{ type: 'text', text: 'Patched it.' }] } },
    ]),
    10,
  );
  await put(
    join(home, `.codex/sessions/2026/11/01/rollout-2026-11-01T00-00-00-${CODEX_ID}.jsonl`),
    jsonl([
      { timestamp: ago(21), type: 'session_meta', payload: { id: CODEX_ID, cwd: CWD } },
      { timestamp: ago(21), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'add retries to the client' }] } },
      { timestamp: ago(20), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Added retries.' }] } },
    ]),
    20,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe('adrive resume without a login', () => {
  it('lists local sessions in the cloud listing format', async () => {
    await cmdResume(undefined, { list: true });
    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^claude-code:c1 {2}claude-code {2}\d{4}-\d\d-\d\dT\S+Z {2}Fix the login bug, key \[redacted:anthropic-key\]$/);
    expect(lines[1]).toMatch(new RegExp(`^codex:${CODEX_ID} {2}codex {2}\\S+ {2}add retries to the client$`));
    expect(stderr).toContain('From local transcripts on this machine');
    expect(stderr).toContain('adrive init');
  });

  it('prints a redacted handoff of the newest session', async () => {
    await cmdResume(undefined, {});
    expect(stdout).toContain('Handoff from a claude-code session (c1).');
    expect(stdout).toContain('[redacted:anthropic-key]');
    expect(stdout).not.toContain(SECRET);
  });

  it('leaves out the harness it runs in', async () => {
    vi.stubEnv('CLAUDE_CODE_CHILD_SESSION', '1');
    await cmdResume(undefined, {});
    expect(stdout).toContain(`Handoff from a codex session (${CODEX_ID}).`);
    expect(stdout).toContain('Added retries.');
  });

  it('resumes a session by id and fails clearly for an unknown one', async () => {
    await cmdResume(`codex:${CODEX_ID}`, {});
    expect(stdout).toContain('add retries to the client');
    await expect(cmdResume('codex:missing', {})).rejects.toThrow('No local session codex:missing on this machine.');
  });
});

describe('harnesses whose transcripts carry no cwd, with no account', () => {
  it('places Cursor and Antigravity sessions through the cwd their hook records', async () => {
    const home = join(root, 'home');
    // A slug that is not derived from the workspace path, so only the hook can place it.
    await put(join(home, '.cursor/projects/x-proj/agent-transcripts/conv-1.jsonl'), jsonl([{ role: 'user', message: { content: [{ type: 'text', text: '<user_query>rename the util</user_query>' }] } }]), 30);
    await put(join(home, '.gemini/antigravity-cli/brain/ag1/.system_generated/logs/transcript.jsonl'), jsonl([{ type: 'USER_INPUT', created_at: ago(40), content: '<USER_REQUEST>add a health check</USER_REQUEST>' }]), 40);

    await cmdResume(undefined, { list: true });
    expect(stdout).not.toContain('cursor:conv-1');

    const spawnSync = vi.fn();
    expect(await runHook('cursor', JSON.stringify({ hook_event_name: 'sessionStart', conversation_id: 'conv-1', workspace_roots: [CWD] }), { spawnSync })).toContain('local mode');
    await runHook('antigravity', JSON.stringify({ conversationId: 'ag1', workspacePaths: [CWD] }), { spawnSync, event: 'SessionStart' });
    expect(spawnSync).not.toHaveBeenCalled();

    stdout = '';
    await cmdResume(undefined, { list: true });
    expect(stdout.trim().split('\n').map((l) => l.split('  ')[0])).toEqual(['claude-code:c1', `codex:${CODEX_ID}`, 'cursor:conv-1', 'antigravity:ag1']);
  });
});

describe('adrive resume --local', () => {
  it('reads local transcripts even when logged in', async () => {
    await login();
    await cmdResume(undefined, { local: true, list: true });
    expect(stdout).toContain('claude-code:c1');
    expect(stderr).toContain('From local transcripts on this machine');
    expect(stderr).not.toContain('adrive init');
  });

  it('uses the cloud when logged in without --local', async () => {
    await login();
    await expect(cmdResume(undefined, { list: true })).rejects.toThrow();
    expect(stdout).toBe('');
  });
});

describe('adrive resume when logged in', () => {
  const run = (agent: string, id: string) => ({ run_id: `${agent}:${id}`, workspace_id: 'ws_1', agent_platform: agent, task: id, metadata: { transcript_path: `sessions/${id}.md` }, artifacts_produced: [] });

  function stubServer(runs: Array<ReturnType<typeof run>>) {
    vi.stubGlobal('fetch', async (url: string) => {
      const { pathname, searchParams } = new URL(url);
      const prefix = searchParams.get('prefix');
      const id = prefix?.slice('sessions/'.length, -'.md'.length) ?? decodeURIComponent(pathname.split('/').pop()!);
      const data = pathname === '/v1/runs'
        ? runs
        : pathname.startsWith('/v1/runs/')
          ? runs.find((r) => r.run_id === id)
          : prefix
            ? [{ id, path: prefix }]
            : { id, path: `sessions/${id}.md`, content: `# Session\n\n## user\n\nwork from ${id}\n`, version: 1, updated_at: '' };
      return new Response(JSON.stringify({ success: true, data }));
    });
  }

  beforeEach(login);

  it('resumes the newest session from another agent, not the one it runs in', async () => {
    stubServer([run('claude-code', 'mine'), run('codex', 'theirs')]);
    vi.stubEnv('CLAUDE_CODE_CHILD_SESSION', '1');
    await cmdResume(undefined, {});
    expect(stdout).toContain('work from theirs');
    expect(stderr).toBe('');
  });

  it('falls back to the newest session, and says so, when no other agent has one', async () => {
    stubServer([run('claude-code', 'mine')]);
    vi.stubEnv('CLAUDE_CODE_CHILD_SESSION', '1');
    await cmdResume(undefined, {});
    expect(stdout).toContain('work from mine');
    expect(stderr).toContain('No session from an agent other than claude-code');
  });

  it('leaves out the agent named by --as, for one it cannot detect', async () => {
    stubServer([run('antigravity', 'mine'), run('codex', 'theirs')]);
    await cmdResume(undefined, { as: 'antigravity' });
    expect(stdout).toContain('work from theirs');
    await expect(cmdResume(undefined, { as: 'antigravityy' })).rejects.toThrow('Unknown agent: antigravityy.');
  });

  it('resumes an explicit id even from the agent it runs in', async () => {
    stubServer([run('claude-code', 'mine'), run('codex', 'theirs')]);
    vi.stubEnv('CLAUDE_CODE_CHILD_SESSION', '1');
    await cmdResume('claude-code:mine', {});
    expect(stdout).toContain('work from mine');
  });
});

describe('adrive resume --as without a login', () => {
  it('leaves out the named agent from local transcripts', async () => {
    await cmdResume(undefined, { as: 'claude-code' });
    expect(stdout).toContain(`Handoff from a codex session (${CODEX_ID}).`);
  });
});
