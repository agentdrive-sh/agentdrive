import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { runSync, safeRemote, type SyncClient, type SyncOptions } from '../src/lib/sync.js';
import { cmdPrivacy } from '../src/commands/privacy.js';
import { cmdSync, type SyncCommandOptions } from '../src/commands/sync.js';
import { cmdAuthLogout } from '../src/commands/auth-logout.js';
import { cmdAuthLogin } from '../src/commands/auth-login.js';
import { CliApiClient } from '../src/lib/api-client.js';
import { runHook } from '../src/commands/hook.js';
import { autoWire } from '../src/lib/auto-wire.js';
import { writeConfig as writeCliConfig } from '../src/lib/config.js';
import { ensureCaptureConsent } from '../src/lib/consent.js';
import type { TranscriptSource } from '@adrive/mcp-server/transcripts/types';

let root: string;
let home: string;
let cfgDir: string;
let writes: Array<{ path: string; content: string }>;
let runs: Array<Record<string, unknown>>;

const emptySource = (platform: TranscriptSource['platform']): TranscriptSource => ({
  platform,
  enumerate: async () => [],
  parseSession: async () => null,
});

const client = {
  async writeFile(_ws: string, path: string, content: string) {
    writes.push({ path, content });
    return { id: `file_${writes.length}`, path, version: 1, updated_at: '' };
  },
  async logRun(body: Record<string, unknown>) {
    runs.push(body);
    return { run_id: String(body.run_id), created_at: 0 };
  },
  async listWorkspaces() {
    return [];
  },
} as unknown as SyncClient;

async function writeConfig(prefs: Record<string, boolean> = { capture_transcripts: true, capture_artifacts: true }) {
  await fs.mkdir(cfgDir, { recursive: true });
  await fs.writeFile(
    join(cfgDir, 'config.json'),
    JSON.stringify({ api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', default_workspace: 'ws_1', capture_notice_at: '2026-01-01T00:00:00.000Z', preferences: prefs }),
  );
}

function line(type: 'user' | 'assistant', text: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ type, cwd: extra.cwd, timestamp: extra.ts, message: { role: type, content: extra.content ?? text } })}\n`;
}

async function claudeSession(id: string, body: string): Promise<string> {
  const path = join(home, '.claude/projects/proj', `${id}.jsonl`);
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, body);
  return path;
}

function opts(extra: Partial<SyncOptions> = {}): SyncOptions {
  return {
    home,
    env: {},
    configDir: cfgDir,
    quiet: true,
    clientFor: () => client,
    sources: { opencode: emptySource('opencode') },
    autoWire: async () => [],
    now: 1_800_000_000_000,
    ...extra,
  };
}

function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { stdio: 'ignore' });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'adrive-sync-test-'));
  home = join(root, 'home');
  cfgDir = join(root, 'cfg');
  // Private-workspace runs create the keychain under configDir(process.env); keep it off the real one.
  vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg'));
  await fs.mkdir(home, { recursive: true });
  writes = [];
  runs = [];
  await writeConfig();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('runSync', () => {
  it('uploads a named session, skips it when unchanged, and re-uploads once it grows', async () => {
    const cwd = join(home, 'app');
    await fs.mkdir(cwd);
    const transcript = await claudeSession('s1', line('user', 'build the thing', { cwd, ts: '2026-10-01T00:00:00Z' }));
    const named = { harness: 'claude-code' as const, session: 's1', transcript, cwd, force: true };

    const first = await runSync(opts(named));
    expect(first.synced).toEqual(['claude-code:s1']);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toMatch(/^sessions\/local__app-[0-9a-f]{8}\/claude-code\/s1\.md$/);
    expect(writes[0]!.content).toContain('build the thing');
    expect(runs[0]).toMatchObject({
      run_id: 'claude-code:s1',
      task: 'build the thing',
      status: 'success',
      workspace_id: 'ws_1',
      metadata: { transcript_path: writes[0]!.path, turns: 1, harness_session_id: 's1', cwd },
    });

    const again = await runSync(opts({ ...named, now: 1_800_000_300_000 }));
    expect(again.unchanged).toBe(1);
    expect(writes).toHaveLength(1);

    await fs.appendFile(transcript, line('assistant', 'done', { ts: '2026-10-01T00:01:00Z' }));
    const grown = await runSync(opts({ ...named, now: 1_800_000_600_000 }));
    expect(grown.synced).toEqual(['claude-code:s1']);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.content).toContain('done');
  });

  it('keeps title, cwd and paths out of plaintext run metadata in a private workspace', async () => {
    await writeConfig({ capture_transcripts: true, capture_artifacts: true, private_workspace: true });
    const cwd = join(home, 'app');
    await fs.mkdir(cwd);
    const transcript = await claudeSession('p1', line('user', 'secret plan', { cwd }));
    await runSync(opts({ harness: 'claude-code', session: 'p1', transcript, cwd, force: true }));

    expect(writes[0]!.content).toMatch(/^agentdrive-encrypted:v0:/);
    expect(runs[0]).toMatchObject({ task: 'Private session', metadata: { paths_touched: [] } });
    const meta = runs[0]!.metadata as Record<string, unknown>;
    expect(meta.title).toBeUndefined();
    expect(meta.cwd).toBeUndefined();
    expect(JSON.stringify(runs[0])).not.toContain('secret plan');
  });

  it('debounces a session synced under two minutes ago unless forced', async () => {
    const cwd = join(home, 'app');
    await fs.mkdir(cwd);
    const transcript = await claudeSession('s2', line('user', 'first', { cwd }));
    const named = { harness: 'claude-code' as const, session: 's2', transcript, cwd };
    await runSync(opts(named));
    expect(runs[0]).toMatchObject({ status: 'in_progress' });

    await fs.appendFile(transcript, line('assistant', 'second'));
    const soon = await runSync(opts({ ...named, now: 1_800_000_010_000 }));
    expect(soon.debounced).toBe(1);
    expect(writes).toHaveLength(1);

    const forced = await runSync(opts({ ...named, now: 1_800_000_020_000, force: true }));
    expect(forced.synced).toEqual(['claude-code:s2']);
    expect(writes).toHaveLength(2);
  });

  it('records tracked files by path, uploads untracked ones, and skips denied, binary and out-of-home files', async () => {
    const repo = join(home, 'repo');
    await fs.mkdir(repo);
    git(repo, 'init', '-q');
    await fs.writeFile(join(repo, 'tracked.ts'), 'export const a = 1;\n');
    git(repo, 'add', 'tracked.ts');
    git(repo, 'commit', '-q', '-m', 'init');
    await fs.writeFile(join(repo, 'notes.md'), 'token: sk-ant-abcdefghijklmnopqrstuvwxyz\n');
    await fs.writeFile(join(repo, '.env'), 'X=1\n');
    // Case variants of denied names: the same file on a case-insensitive disk.
    await fs.writeFile(join(repo, '.ENV'), 'UPPER=hunter2\n');
    await fs.writeFile(join(repo, 'ID_RSA'), 'PRIVATE hunter2\n');
    await fs.writeFile(join(repo, 'blob.bin'), Buffer.from([1, 0, 2, 3]));
    await fs.writeFile(join(home, 'plan.md'), 'outside cwd, inside home\n');
    await fs.writeFile(join(root, 'outside.txt'), 'outside home\n');

    const tool = (file_path: string) => ({ type: 'tool_use', name: 'Write', input: { file_path } });
    const transcript = await claudeSession(
      's3',
      line('user', 'write stuff', { cwd: repo }) +
        line('assistant', '', {
          content: [tool(join(repo, 'tracked.ts')), tool('notes.md'), tool('.env'), tool('.ENV'), tool('ID_RSA'), tool('blob.bin'), tool(join(home, 'plan.md')), tool(join(root, 'outside.txt')), tool('missing.ts')],
        }),
    );
    await runSync(opts({ harness: 'claude-code', session: 's3', transcript, cwd: repo, force: true }));

    const uploaded = writes.map((w) => w.path).filter((p) => p.includes('/files/'));
    expect(uploaded).toHaveLength(2);
    expect(uploaded[0]).toMatch(/^sessions\/repo-[0-9a-f]{8}\/files\/notes\.md$/);
    expect(uploaded[1]).toMatch(/^sessions\/repo-[0-9a-f]{8}\/files\/_external\/[0-9a-f]{8}-plan\.md$/);
    const notes = writes.find((w) => w.path.endsWith('notes.md'))!;
    expect(notes.content).toContain('[redacted:anthropic-key]');
    expect(runs[0]).toMatchObject({ artifacts_produced: ['file_2', 'file_3'], metadata: { files_uploaded: 2 } });
    const touched = (runs[0]!.metadata as { paths_touched: string[] }).paths_touched;
    expect(touched).toEqual(expect.arrayContaining(['tracked.ts', 'notes.md', '.env', 'blob.bin', join(home, 'plan.md')]));
    expect(JSON.stringify(writes)).not.toContain('hunter2');
  });

  it('skips a file that vanishes mid-sync and still syncs the rest of the session', async () => {
    const cwd = join(home, 'app');
    await fs.mkdir(cwd);
    for (const f of ['gone.md', 'keep.md']) await fs.writeFile(join(cwd, f), `${f}\n`);
    const tool = (file_path: string) => ({ type: 'tool_use', name: 'Write', input: { file_path } });
    const transcript = await claudeSession('v1', line('user', 'write two files', { cwd }) + line('assistant', '', { content: [tool('gone.md'), tool('keep.md')] }));
    // gone.md disappears between the session's realpath of it and the stat.
    const lstat = fs.lstat.bind(fs);
    const spy = vi.spyOn(fs, 'lstat').mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (String(p).endsWith('gone.md')) throw Object.assign(new Error(`ENOENT: no such file, lstat '${p}'`), { code: 'ENOENT' });
      return (lstat as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    }) as unknown as typeof fs.lstat);
    try {
      const result = await runSync(opts({ harness: 'claude-code', session: 'v1', transcript, cwd, force: true }));
      expect(result.failed).toBe(0);
      expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/\/claude-code\/v1\.md$/), expect.stringMatching(/\/files\/keep\.md$/)]);
      expect(runs).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it.skipIf(process.platform === 'win32')('never reads through a link swapped in after the deny check', async () => {
    await fs.mkdir(join(home, '.ssh'), { recursive: true });
    await fs.writeFile(join(home, '.ssh', 'config'), 'Host prod hunter2\n');
    const cwd = join(home, 'app');
    await fs.mkdir(cwd);
    const x = join(cwd, 'x.md');
    await fs.writeFile(x, 'plain notes\n');
    const transcript = await claudeSession('sw', line('user', 'write x', { cwd }) + line('assistant', '', { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'x.md' } }] }));
    // Sync asks git for x.md's status after its deny check; right then, x.md becomes a link
    // to ~/.ssh/config. Every other git call (the project key) sees no repository.
    const bin = join(root, 'bin');
    await fs.mkdir(bin);
    const swap = `rm -f '${x}'; ln -s '${join(home, '.ssh', 'config')}' '${x}'; echo '?? x.md'`;
    await fs.writeFile(join(bin, 'git'), `#!/bin/sh\ncase "$*" in *status*) ${swap} ;; *) echo 'fatal: not a git repository' >&2; exit 128 ;; esac\n`, { mode: 0o755 });
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
    await runSync(opts({ harness: 'claude-code', session: 'sw', transcript, cwd, force: true }));
    expect((await fs.lstat(x)).isSymbolicLink()).toBe(true);
    expect(writes.map((w) => w.path).filter((p) => p.includes('/files/'))).toEqual([]);
    expect(JSON.stringify(writes)).not.toContain('hunter2');
  });

  it('uploads untracked files of a project outside home, still applying the deny list', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(join(proj, 'notes'), { recursive: true });
    git(proj, 'init', '-q');
    await fs.writeFile(join(proj, 'notes', 'plan.md'), 'the plan\n');
    await fs.writeFile(join(proj, '.env'), 'SECRET=hunter2\n');
    await fs.writeFile(join(proj, 'id_rsa'), 'PRIVATE hunter2\n');
    await fs.writeFile(join(proj, '.adriveignore'), '!.env\n!id_rsa\n');
    const tool = (file_path: string) => ({ type: 'tool_use', name: 'Write', input: { file_path } });
    const transcript = await claudeSession('oh', line('user', 'plan it', { cwd: proj }) + line('assistant', '', { content: [tool('notes/plan.md'), tool('.env'), tool('id_rsa')] }));
    await runSync(opts({ harness: 'claude-code', session: 'oh', transcript, cwd: proj, force: true }));
    const uploaded = writes.map((w) => w.path).filter((p) => p.includes('/files/'));
    expect(uploaded).toEqual([expect.stringMatching(/^sessions\/proj-[0-9a-f]{8}\/files\/notes\/plan\.md$/)]);
    expect(JSON.stringify(writes)).not.toContain('hunter2');
  });

  it('treats a filesystem-root cwd as no project for files outside home', async () => {
    await fs.writeFile(join(root, 'stray.txt'), 'stray\n');
    const transcript = await claudeSession('rt', line('user', 'go', { cwd: '/' }) + line('assistant', '', { content: [{ type: 'tool_use', name: 'Write', input: { file_path: join(root, 'stray.txt') } }] }));
    await runSync(opts({ harness: 'claude-code', session: 'rt', transcript, cwd: '/', force: true }));
    expect(writes.map((w) => w.path).filter((p) => p.includes('/files/'))).toEqual([]);
  });

  it('does not log a missing transcript for a session that is just starting', async () => {
    const missing = join(home, '.claude/projects/proj/fresh.jsonl');
    await runSync(opts({ harness: 'claude-code', session: 'fresh', transcript: missing, start: true }));
    const log = await fs.readFile(join(cfgDir, 'sync.log'), 'utf8').catch(() => '');
    expect(log).not.toContain('not found');
    await runSync(opts({ harness: 'claude-code', session: 'fresh', transcript: missing }));
    expect(await fs.readFile(join(cfgDir, 'sync.log'), 'utf8')).toContain('claude-code session fresh not found');
  });

  it('never uploads files git ignores, even when the deny list misses them', async () => {
    const repo = join(home, 'proj');
    await fs.mkdir(join(repo, 'config'), { recursive: true });
    git(repo, 'init', '-q');
    await fs.writeFile(join(repo, '.gitignore'), 'local.conf\nconfig/\n');
    await fs.writeFile(join(repo, 'local.conf'), 'DATABASE_URL=postgres://admin:hunter2@db.internal/prod\n');
    await fs.writeFile(join(repo, 'config', 'prod.yaml'), 'password: hunter2\n');
    await fs.writeFile(join(repo, 'plan.md'), 'plan\n');
    const tool = (file_path: string) => ({ type: 'tool_use', name: 'Write', input: { file_path } });
    const transcript = await claudeSession(
      'ig',
      line('user', 'configure', { cwd: repo }) + line('assistant', '', { content: [tool('local.conf'), tool('config/prod.yaml'), tool('plan.md')] }),
    );
    await runSync(opts({ harness: 'claude-code', session: 'ig', transcript, cwd: repo, force: true }));
    const uploaded = writes.map((w) => w.path).filter((p) => p.includes('/files/'));
    expect(uploaded).toEqual([expect.stringMatching(/\/files\/plan\.md$/)]);
    expect(JSON.stringify(writes)).not.toContain('hunter2');
  });

  it('uploads nothing from a repo git refuses to read (dubious ownership)', async () => {
    const repo = join(home, 'proj');
    await fs.mkdir(repo, { recursive: true });
    git(repo, 'init', '-q');
    await fs.writeFile(join(repo, '.gitignore'), 'secret.json\n');
    await fs.writeFile(join(repo, 'secret.json'), '{"token":"hunter2"}\n');
    await fs.writeFile(join(repo, 'plan.md'), 'plan\n');
    const tool = (file_path: string) => ({ type: 'tool_use', name: 'Write', input: { file_path } });
    const transcript = await claudeSession(
      'do',
      line('user', 'configure', { cwd: repo }) + line('assistant', '', { content: [tool('secret.json'), tool('plan.md')] }),
    );
    // CI images set safe.directory=* in system or global git config, which overrides the ownership check.
    const gitEnv = { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
    Object.assign(process.env, gitEnv);
    try {
      await runSync(opts({ harness: 'claude-code', session: 'do', transcript, cwd: repo, force: true }));
    } finally {
      for (const key of Object.keys(gitEnv)) delete process.env[key];
    }
    expect(writes.map((w) => w.path).filter((p) => p.includes('/files/'))).toEqual([]);
    expect(JSON.stringify(writes)).not.toContain('hunter2');
  });

  it('re-indexes every session under the new project key when private mode is toggled', async () => {
    const transcript = await claudeSession('s9', line('user', 'hi', { cwd: home }));
    const named = { harness: 'claude-code' as const, session: 's9', transcript, force: true };
    await runSync(opts(named));
    expect(writes[0]!.path).not.toMatch(/^sessions\/p-/);

    await writeConfig({ capture_transcripts: true, capture_artifacts: true, private_workspace: true });
    const toggled = await runSync(opts({ ...named, now: 1_800_000_300_000 }));
    expect(toggled.synced).toEqual(['claude-code:s9']);
    expect(writes.at(-1)!.path).toMatch(/^sessions\/p-[0-9a-f]{16}\//);
  });

  it('exits quietly when another sync holds a fresh lock, and breaks a stale one', async () => {
    const transcript = await claudeSession('s4', line('user', 'hi', { cwd: home }));
    const lock = join(cfgDir, 'sync.lock');
    await fs.writeFile(lock, '123');
    const blocked = await runSync(opts({ harness: 'claude-code', session: 's4', transcript, force: true, lockWaitMs: 0 }));
    expect(blocked.skipped).toBe('locked');
    expect(writes).toHaveLength(0);

    const old = new Date(Date.now() - 11 * 60_000);
    await fs.utimes(lock, old, old);
    const ok = await runSync(opts({ harness: 'claude-code', session: 's4', transcript, force: true }));
    expect(ok.synced).toEqual(['claude-code:s4']);
    await expect(fs.stat(lock)).rejects.toThrow();
  });

  it('waits for a held lock instead of dropping the sync', async () => {
    const transcript = await claudeSession('s7', line('user', 'hi', { cwd: home }));
    const lock = join(cfgDir, 'sync.lock');
    await fs.writeFile(lock, '123');
    setTimeout(() => void fs.rm(lock, { force: true }), 400);
    const ok = await runSync(opts({ harness: 'claude-code', session: 's7', transcript, force: true, lockWaitMs: 5000 }));
    expect(ok.skipped).toBeUndefined();
    expect(ok.synced).toEqual(['claude-code:s7']);
  });

  it('starts over when the account or workspace changes', async () => {
    const transcript = await claudeSession('s8', line('user', 'hi', { cwd: home }));
    const named = { harness: 'claude-code' as const, session: 's8', transcript, force: true };
    await runSync(opts(named));
    expect((await runSync(opts({ ...named, now: 1_800_000_300_000 }))).unchanged).toBe(1);

    await fs.writeFile(
      join(cfgDir, 'config.json'),
      JSON.stringify({ api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', default_workspace: 'ws_2', preferences: { capture_transcripts: true, capture_artifacts: true } }),
    );
    const moved = await runSync(opts({ ...named, now: 1_800_000_600_000 }));
    expect(moved.synced).toEqual(['claude-code:s8']);
    expect(runs.at(-1)).toMatchObject({ workspace_id: 'ws_2' });
    const manifest = JSON.parse(await fs.readFile(join(cfgDir, 'sync.manifest.json'), 'utf8'));
    expect(Object.keys(manifest.sessions)).toEqual(['claude-code:s8']);
  });

  it('finalizes an in_progress session that went idle without an end event, without re-uploading it', async () => {
    const transcript = await claudeSession('s9', line('user', 'no end hook', { cwd: home }));
    await runSync(opts({ harness: 'claude-code', session: 's9', transcript }));
    expect(runs[0]).toMatchObject({ status: 'in_progress' });
    expect(writes).toHaveLength(1);

    const swept = await runSync(opts({ now: 1_800_000_300_000 }));
    expect(swept.synced).toEqual(['claude-code:s9']);
    expect(runs[1]).toMatchObject({ run_id: 'claude-code:s9', status: 'success' });
    expect(writes).toHaveLength(1);
    expect((await runSync(opts({ now: 1_800_000_600_000 }))).synced).toEqual([]);
  });

  it('syncs a gemini session once when its end hook and a sweep land in the same run', async () => {
    const cwd = join(home, 'gem');
    await fs.mkdir(cwd);
    const path = join(home, '.gemini/tmp/abc/chats/session-2026-10-21T12-00-1a2b3c4d.jsonl');
    await fs.mkdir(join(path, '..'), { recursive: true });
    await fs.writeFile(
      path,
      [{ $set: { sessionId: 'gem-uuid-1', projectHash: 'abc' } }, { type: 'user', content: 'hello', timestamp: '2026-10-21T12:00:00Z' }]
        .map((l) => JSON.stringify(l))
        .join('\n'),
    );
    const result = await runSync(opts({ harness: 'gemini-cli', session: 'gem-uuid-1', transcript: path, cwd, force: true, all: true }));
    expect(result.synced).toEqual(['gemini-cli:gem-uuid-1']);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'success' });
  });

  it('falls back to the cwd a hook recorded when the transcript has none', async () => {
    const cwd = join(home, 'cur');
    await fs.mkdir(cwd);
    await fs.writeFile(join(cfgDir, 'session-cwd.json'), JSON.stringify({ 'cursor:conv-1': cwd }));
    const path = join(home, '.cursor/projects/x/agent-transcripts/conv-1.jsonl');
    await fs.mkdir(join(path, '..'), { recursive: true });
    await fs.writeFile(path, JSON.stringify({ role: 'user', message: { content: 'hi' } }));
    await runSync(opts({ now: Date.now() + 1000 }));
    expect(runs[0]).toMatchObject({ run_id: 'cursor:conv-1', metadata: { cwd, project: expect.stringMatching(/^local__cur-/) } });
  });

  it('syncs an antigravity session under the cwd its hook recorded', async () => {
    const cwd = join(home, 'agy');
    await fs.mkdir(cwd);
    await fs.writeFile(join(cfgDir, 'session-cwd.json'), JSON.stringify({ 'antigravity:conv-a': cwd }));
    const path = join(home, '.gemini/antigravity-cli/brain/conv-a/.system_generated/logs/transcript.jsonl');
    await fs.mkdir(join(path, '..'), { recursive: true });
    await fs.writeFile(path, JSON.stringify({ type: 'USER_INPUT', content: 'hi' }));
    const result = await runSync(opts({ harness: 'antigravity', session: 'conv-a', transcript: path, force: true }));
    expect(result.synced).toEqual(['antigravity:conv-a']);
    expect(runs[0]).toMatchObject({ run_id: 'antigravity:conv-a', metadata: { cwd, project: expect.stringMatching(/^local__agy-/) } });
  });

  it('hides the project and file names from storage paths in a private workspace', async () => {
    await writeConfig({ capture_transcripts: true, capture_artifacts: true, private_workspace: true });
    const cwd = join(home, 'widget');
    await fs.mkdir(cwd);
    await fs.writeFile(join(cwd, 'roadmap.md'), 'plan\n');
    const tool = { type: 'tool_use', name: 'Write', input: { file_path: 'roadmap.md' } };
    const transcript = await claudeSession('pv', line('user', 'plan', { cwd }) + line('assistant', '', { content: [tool] }));
    await runSync(opts({ harness: 'claude-code', session: 'pv', transcript, cwd, force: true }));
    const paths = writes.map((w) => w.path);
    expect(paths).toHaveLength(2);
    for (const p of paths) expect(p).toMatch(/^sessions\/p-[0-9a-f]{16}\//);
    expect(paths[1]).toMatch(/\/files\/[0-9a-f]{16}$/);
    expect(JSON.stringify(paths)).not.toMatch(/widget|roadmap/);
    expect((runs[0]!.metadata as { project: string }).project).toMatch(/^p-[0-9a-f]{16}$/);
  });

  it('sends no run, so no title, cwd or touched paths, for a session synced with transcript sync off', async () => {
    await writeConfig({ capture_transcripts: false, capture_artifacts: true });
    const cwd = join(home, 'app');
    await fs.mkdir(cwd);
    await fs.writeFile(join(cwd, 'notes.md'), 'notes\n');
    const tool = { type: 'tool_use', name: 'Write', input: { file_path: 'notes.md' } };
    const transcript = await claudeSession('t1', line('user', 'secret plan', { cwd }) + line('assistant', '', { content: [tool] }));
    await runSync(opts({ harness: 'claude-code', session: 't1', transcript, cwd, force: true }));

    expect(runs).toEqual([]);
    expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/^sessions\/local__app-[0-9a-f]{8}\/files\/notes\.md$/)]);
    expect(JSON.stringify(writes)).not.toContain('secret plan');
  });

  it('does nothing when both capture preferences are off', async () => {
    await writeConfig({ capture_transcripts: false, capture_artifacts: false });
    await claudeSession('s5', line('user', 'hi', { cwd: home }));
    const result = await runSync(opts());
    expect(result.skipped).toBe('capture-off');
    expect(writes).toHaveLength(0);
  });

  it('still auto-wires on session start with capture off, without uploading', async () => {
    await writeConfig({ capture_transcripts: false, capture_artifacts: false });
    await claudeSession('s6', line('user', 'hi', { cwd: home }));
    let wired = 0;
    const result = await runSync(opts({ start: true, autoWire: async () => (wired++, []) }));
    expect(wired).toBe(1);
    expect(result.skipped).toBe('capture-off');
    expect(writes).toHaveLength(0);
    await expect(fs.stat(join(cfgDir, 'sync.lock'))).rejects.toThrow();
  });

  it('sweeps oldest-first and reports each session\'s last activity time', async () => {
    const older = await claudeSession('old', line('user', 'a', { cwd: home, ts: '2026-10-21T12:16:00Z' }));
    const newer = await claudeSession('new', line('user', 'b', { cwd: home }));
    const newerMtime = new Date('2026-10-21T12:26:00Z');
    await fs.utimes(newer, newerMtime, newerMtime);
    await fs.utimes(older, new Date('2026-10-21T12:30:00Z'), new Date('2026-10-21T12:30:00Z'));
    await runSync(opts({ now: Date.parse('2026-10-21T13:00:00Z'), all: true }));
    expect(runs.map((r) => r.run_id)).toEqual(['claude-code:new', 'claude-code:old']);
    const activity = Object.fromEntries(runs.map((r) => [r.run_id, (r.metadata as { last_activity_at: number }).last_activity_at]));
    expect(activity).toEqual({ 'claude-code:old': Date.parse('2026-10-21T12:16:00Z'), 'claude-code:new': newerMtime.getTime() });
  });

  it('sweeps sessions changed since the last sweep', async () => {
    await claudeSession('s6', line('user', 'swept', { cwd: home }));
    const first = await runSync(opts({ now: Date.now() + 1000 }));
    expect(first.synced).toEqual(['claude-code:s6']);
    const second = await runSync(opts({ now: Date.now() + 200_000 }));
    expect(second.synced).toEqual([]);
    expect(writes).toHaveLength(1);
  });
});

describe('sessions that ran while sync was off', () => {
  const t0 = Date.parse('2026-11-18T10:00:00Z');
  const min = 60_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const sent = () => JSON.stringify([writes, runs]);
  let out: { mockRestore(): void };

  beforeEach(async () => {
    cfgDir = join(root, 'xdg', 'agentdrive');
    await writeConfig({ auto_context: false, capture_transcripts: true, capture_artifacts: true });
    out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    out.mockRestore();
  });

  async function privacy(ms: number, opts: Parameters<typeof cmdPrivacy>[0]) {
    vi.setSystemTime(ms);
    await cmdPrivacy(opts);
  }
  const both = (state: 'on' | 'off') => ({ captureTranscripts: state, captureArtifacts: state });

  // Appends timestamped user turns to a Claude Code session and dates the file at the last one.
  async function session(id: string, ...turns: Array<[number, string]>): Promise<string> {
    const path = join(home, '.claude/projects/proj', `${id}.jsonl`);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.appendFile(path, turns.map(([ms, text]) => line('user', text, { cwd: home, ts: iso(ms) })).join(''));
    const last = new Date(turns.at(-1)![0]);
    await fs.utimes(path, last, last);
    return path;
  }

  // What `adrive auth login` writes: the key, then the consent defaults, which turn sync on.
  async function signIn(ms: number) {
    vi.setSystemTime(ms);
    const file = join(cfgDir, 'config.json');
    const saved = { api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', agent_platform: 'cli', wired: [] };
    await writeCliConfig(saved, file);
    const workspaces = { listWorkspaces: async () => [{ id: 'ws_1', name: 'Personal', created_at: '' }], createWorkspace: async () => ({ id: 'ws_1', name: 'Personal', created_at: '' }) };
    await writeCliConfig(await ensureCaptureConsent(saved, workspaces, { interactive: false, preferencesSaved: false }), file);
  }

  it('syncs work from before sync went off, and keeps off-period sessions local across a workspace switch', async () => {
    await session('pre', [t0 - 10 * min, 'work from before sync went off']);
    await privacy(t0, both('off'));
    await session('off1', [t0 + 5 * min, 'hush while off']);
    await privacy(t0 + 10 * min, both('on'));
    await runSync(opts({ all: true, now: t0 + 20 * min }));
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));
    await fs.writeFile(join(cfgDir, 'config.json'), JSON.stringify({ ...cfg, default_workspace: 'ws_2' }));
    await runSync(opts({ all: true, now: t0 + 30 * min }));

    expect(runs.map((r) => r.run_id)).toEqual(['claude-code:pre', 'claude-code:pre']);
    expect(sent()).not.toMatch(/hush|off1/);
  });

  it('keeps a session local whose prompt came while sync was off, though its first sync comes after sync is back on', async () => {
    await privacy(t0, both('off'));
    // No hook syncs on a prompt, so no sync sees this session while sync is off.
    const a1 = await session('a1', [t0 + 5 * min, 'hush prompt typed while off']);
    await privacy(t0 + 10 * min, both('on'));
    await session('a1', [t0 + 11 * min, 'answered after sync came back']);
    await runSync(opts({ harness: 'claude-code', session: 'a1', transcript: a1, force: true, now: t0 + 12 * min }));
    expect(sent()).toBe('[[],[]]');
  });

  it('keeps every off interval, not only the last one', async () => {
    await privacy(t0, both('off'));
    await session('b1', [t0 + 5 * min, 'hush in the first off interval']);
    await privacy(t0 + 10 * min, both('on'));
    await privacy(t0 + 20 * min, both('off'));
    await privacy(t0 + 30 * min, both('on'));
    await runSync(opts({ all: true, now: t0 + 40 * min }));
    expect(sent()).toBe('[[],[]]');
  });

  it('keeps an off-period session local when the sync manifest is lost or damaged', async () => {
    await privacy(t0, both('off'));
    const c1 = await session('c1', [t0 + 5 * min, 'hush while off']);
    await runSync(opts({ harness: 'claude-code', session: 'c1', transcript: c1, now: t0 + 6 * min }));
    await privacy(t0 + 10 * min, both('on'));
    await session('c1', [t0 + 11 * min, 'continued after sync came back']);
    await fs.rm(join(cfgDir, 'sync.manifest.json'), { force: true });
    await runSync(opts({ harness: 'claude-code', session: 'c1', transcript: c1, force: true, now: t0 + 12 * min }));
    await fs.writeFile(join(cfgDir, 'sync.manifest.json'), '{not json');
    await runSync(opts({ harness: 'claude-code', session: 'c1', transcript: c1, force: true, now: t0 + 20 * min }));
    expect(sent()).toBe('[[],[]]');
  });

  it('keeps a session run while sync was off local across logout and sign-in', async () => {
    await privacy(t0, both('off'));
    await session('e1', [t0 + 5 * min, 'hush while off']);
    await cmdAuthLogout({ yes: true });
    await session('e2', [t0 + 7 * min, 'hush while logged out']);
    await signIn(t0 + 10 * min);
    await runSync(opts({ all: true, now: t0 + 20 * min }));
    expect(sent()).toBe('[[],[]]');
  });

  it('still syncs sessions from before a first sign-in', async () => {
    await fs.rm(join(cfgDir, 'config.json'));
    // `adrive init --local` first: no account, default preferences.
    await writeCliConfig({ api_url: 'https://example.invalid', wired: [] }, join(cfgDir, 'config.json'));
    await session('n1', [t0 - 60 * min, 'local-mode work before signing in']);
    await signIn(t0);
    await runSync(opts({ all: true, now: t0 + 10 * min }));
    expect(runs.map((r) => r.run_id)).toEqual(['claude-code:n1']);
  });

  it('records sync turned off and on by an account that signed in before the sign-in notice', async () => {
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));
    delete cfg.capture_notice_at;
    await fs.writeFile(join(cfgDir, 'config.json'), JSON.stringify(cfg));
    await privacy(t0, both('off'));
    await session('q1', [t0 + 5 * min, 'hush while off']);
    await privacy(t0 + 10 * min, both('on'));
    await runSync(opts({ all: true, now: t0 + 20 * min }));
    expect(sent()).toBe('[[],[]]');
  });

  it('treats sessions from before a signed-in account with no saved preferences turns sync on as run while off', async () => {
    await fs.writeFile(join(cfgDir, 'config.json'), JSON.stringify({ api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', default_workspace: 'ws_1' }));
    await session('r1', [t0 - 10 * min, 'hush from before sync was ever on']);
    await privacy(t0, both('on'));
    await runSync(opts({ all: true, now: t0 + 10 * min }));
    expect(sent()).toBe('[[],[]]');
  });

  it('still backfills recent sessions on a fresh sign-in, even if a hook reconciles and auto-wires while sign-in waits', async () => {
    await fs.rm(join(cfgDir, 'config.json'));
    await session('n1', [t0 - 3 * 24 * 60 * min, 'work from three days before signing in']);
    vi.setSystemTime(t0);
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from(['agentdrive_live_test']) as unknown as typeof process.stdin);
    const noWiring = { installClaude: () => ({ status: 'installed' as const }), trustCodex: async () => ({ status: 'trusted' as const, count: 0 }) };
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/workspaces')) {
        // Another agent starts a session while sign-in waits on the workspace list: its hook
        // reconciles the history, and its session-start sync auto-wires and rewrites the config.
        await runHook('claude-code', JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'x', cwd: home }), { spawnSync: () => undefined });
        await autoWire({ configDir: cfgDir, home, env: {}, log: async () => undefined, connected: 'claude-code', deps: noWiring });
        return Response.json({ success: true, data: [{ id: 'ws_1', name: 'Personal', created_at: '' }] });
      }
      return Response.json({ success: true, data: {} });
    });
    try {
      await cmdAuthLogin({ withKey: true, apiUrl: 'https://example.invalid' });
    } finally {
      vi.unstubAllGlobals();
    }
    await runSync(opts({ all: true, now: t0 + 10 * min }));
    expect(runs.map((r) => r.run_id)).toEqual(['claude-code:n1']);
  });

  it('treats everything before an upgrade made with sync off as run while off, however old', async () => {
    // As 1.4.0 leaves it: sync off and no history.
    await writeConfig({ auto_context: false, capture_transcripts: false, capture_artifacts: false });
    const cwd = join(home, 'app');
    await fs.mkdir(cwd);
    await fs.writeFile(join(cwd, 'old.md'), 'hush file from a month ago\n');
    const old = t0 - 30 * 24 * 60 * min;
    const write = { type: 'tool_use', name: 'Write', input: { file_path: 'old.md' } };
    const f1 = await claudeSession('f1', line('user', 'hush from a month ago', { cwd, ts: iso(old) }) + line('assistant', '', { cwd, ts: iso(old), content: [write] }));
    await fs.utimes(f1, new Date(old), new Date(old));
    await privacy(t0, both('on'));
    await runSync(opts({ all: true, now: t0 + 10 * min }));
    expect(sent()).toBe('[[],[]]');
  });

  it('still syncs the transcript of a pre-off session that a files-only sync handled while transcript sync was off', async () => {
    await session('p1', [t0 - 10 * min, 'work from before transcript sync went off']);
    await privacy(t0, { captureTranscripts: 'off' });
    await runSync(opts({ all: true, now: t0 + 5 * min }));
    expect(sent()).toBe('[[],[]]');
    await privacy(t0 + 10 * min, { captureTranscripts: 'on' });
    await runSync(opts({ now: t0 + 20 * min }));
    expect(runs.map((r) => r.run_id)).toEqual(['claude-code:p1']);
    expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/\/claude-code\/p1\.md$/)]);
  });

  it('keeps the files of a session that ran while artifact sync was off local, and still syncs its transcript', async () => {
    const cwd = join(home, 'app');
    await fs.mkdir(cwd);
    await fs.writeFile(join(cwd, 'notes.md'), 'hush notes\n');
    await privacy(t0, { captureArtifacts: 'off' });
    const write = { type: 'tool_use', name: 'Write', input: { file_path: 'notes.md' } };
    const s1 = await claudeSession('s1', line('user', 'write notes', { cwd, ts: iso(t0 + 5 * min) }) + line('assistant', '', { cwd, ts: iso(t0 + 5 * min), content: [write] }));
    await fs.utimes(s1, new Date(t0 + 5 * min), new Date(t0 + 5 * min));
    await privacy(t0 + 10 * min, { captureArtifacts: 'on' });
    await runSync(opts({ all: true, now: t0 + 20 * min }));
    expect(runs.map((r) => r.run_id)).toEqual(['claude-code:s1']);
    expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/\/claude-code\/s1\.md$/)]);
    expect(runs[0]).toMatchObject({ artifacts_produced: [] });
  });

  // The file gate compares ctime, which only the real clock sets, so these run on it.
  const pause = () => new Promise((r) => setTimeout(r, 30));
  async function realToggle(state: 'on' | 'off') {
    await pause();
    await cmdPrivacy(both(state));
    await pause();
  }
  // A session from two hours ago that wrote the given files, all dated then.
  async function filesSession(id: string, names: string[]) {
    const cwd = join(home, 'app');
    await fs.mkdir(cwd, { recursive: true });
    const ago = Date.now() - 2 * 60 * min;
    for (const n of names) await fs.writeFile(join(cwd, n), `draft ${n}\n`);
    const writesTo = names.map((n) => ({ type: 'tool_use', name: 'Write', input: { file_path: n } }));
    const path = await claudeSession(id, line('user', 'write files', { cwd, ts: iso(ago) }) + line('assistant', '', { cwd, ts: iso(ago), content: writesTo }));
    for (const f of [path, ...names.map((n) => join(cwd, n))]) await fs.utimes(f, new Date(ago), new Date(ago));
    return { cwd, path };
  }
  async function switchWorkspace(id = 'ws_2') {
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));
    await fs.writeFile(join(cfgDir, 'config.json'), JSON.stringify({ ...cfg, default_workspace: id }));
  }

  it('keeps content written while artifact sync was off local, even when an earlier session that touched the file syncs again', async () => {
    vi.useRealTimers();
    const { cwd, path: s1 } = await filesSession('s1', ['notes.md']);
    // A Stop hook syncs s1 and leaves it in_progress; the agent is later killed, so no end event.
    await runSync(opts({ harness: 'claude-code', session: 's1', transcript: s1, cwd, now: Date.now() }));
    expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/\/s1\.md$/), expect.stringMatching(/\/files\/notes\.md$/)]);

    await realToggle('off');
    // Another session, run while sync is off, puts a secret in the same file.
    await fs.writeFile(join(cwd, 'notes.md'), 'db password: hush-offperiod\n');
    await realToggle('on');
    await runSync(opts({ now: Date.now() + 3 * min }));
    await runSync(opts({ harness: 'claude-code', session: 's1', transcript: s1, cwd, force: true, now: Date.now() + 4 * min }));
    await switchWorkspace();
    await runSync(opts({ all: true, now: Date.now() + 5 * min }));

    // The revisit after re-enabling still links the version synced before sync went off.
    expect(runs[1]).toMatchObject({ run_id: 'claude-code:s1', artifacts_produced: ['file_2'] });
    expect(JSON.stringify(writes)).not.toContain('hush');
  });

  it('checks each file just before it uploads, so a toggle made mid-sync stops a file changed after it', async () => {
    vi.useRealTimers();
    const { cwd } = await filesSession('s1', ['a.md', 'b.md']);
    let toggled = false;
    const toggling = {
      ...client,
      async writeFile(ws: string, path: string, content: string, message?: string) {
        if (!toggled && path.endsWith('/files/a.md')) {
          toggled = true;
          // While a.md uploads: sync goes off, then b.md gets a secret.
          await realToggle('off');
          await fs.writeFile(join(cwd, 'b.md'), 'hush written after sync went off\n');
        }
        return client.writeFile(ws, path, content, message);
      },
    } as SyncClient;
    await runSync(opts({ all: true, now: Date.now(), clientFor: () => toggling }));
    expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/\/s1\.md$/), expect.stringMatching(/\/files\/a\.md$/)]);
    expect(JSON.stringify(writes)).not.toContain('hush');
  });

  // Starts each run from the original config, and changes it while a.md uploads.
  async function changingClient(change: (c: Record<string, unknown>) => Record<string, unknown>): Promise<SyncClient> {
    const file = join(cfgDir, 'config.json');
    const original = await fs.readFile(file, 'utf8');
    return {
      ...client,
      async writeFile(ws: string, path: string, content: string, message?: string) {
        if (path.endsWith('/files/a.md')) {
          const cfg = JSON.parse(original) as Record<string, unknown>;
          await fs.writeFile(file, JSON.stringify({ ...cfg, ...change(cfg) }));
        }
        return client.writeFile(ws, path, content, message);
      },
    } as SyncClient;
  }
  async function freshRun(original: string) {
    await fs.writeFile(join(cfgDir, 'config.json'), original);
    await fs.rm(join(cfgDir, 'sync.manifest.json'), { force: true });
    writes = [];
    runs = [];
  }

  it('stops before the next upload once Private Workspace, the account or the workspace changes mid-run', async () => {
    vi.useRealTimers();
    const original = await fs.readFile(join(cfgDir, 'config.json'), 'utf8');
    await filesSession('s1', ['a.md', 'b.md']);
    const changes: Array<(c: Record<string, unknown>) => Record<string, unknown>> = [
      (c) => ({ preferences: { ...(c.preferences as object), private_workspace: true } }),
      () => ({ api_key: 'agentdrive_live_other' }),
      () => ({ api_url: 'https://other.invalid' }),
      () => ({ default_workspace: 'ws_2' }),
    ];
    for (const change of changes) {
      await freshRun(original);
      const changing = await changingClient(change);
      const result = await runSync(opts({ all: true, now: Date.now(), clientFor: () => changing }));
      expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/\/s1\.md$/), expect.stringMatching(/\/files\/a\.md$/)]);
      expect(runs).toEqual([]);
      expect(result.stopped).toMatch(/changed since this sync started/);
    }
  });

  it("exits non-zero from a manual adrive sync stopped by a settings change, but not from a hook's quiet one", async () => {
    vi.useRealTimers();
    const original = await fs.readFile(join(cfgDir, 'config.json'), 'utf8');
    await filesSession('s1', ['a.md', 'b.md']);
    try {
      for (const quiet of [false, true]) {
        await freshRun(original);
        process.exitCode = undefined;
        const changing = await changingClient((c) => ({ preferences: { ...(c.preferences as object), private_workspace: true } }));
        await cmdSync({ ...opts({ all: true, now: Date.now(), clientFor: () => changing }), quiet } as SyncCommandOptions);
        expect(process.exitCode).toBe(quiet ? undefined : 1);
      }
    } finally {
      process.exitCode = undefined;
    }
  });

  it('uploads the files of a session that ended before artifact sync went off, once it is back on, though its transcript synced meanwhile', async () => {
    vi.useRealTimers();
    await filesSession('s1', ['notes.md']);
    await pause();
    await cmdPrivacy({ captureArtifacts: 'off' });
    await pause();
    await runSync(opts({ all: true, now: Date.now() }));
    expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/\/s1\.md$/)]);
    await cmdPrivacy({ captureArtifacts: 'on' });
    await pause();
    await runSync(opts({ now: Date.now() + 3 * min }));
    expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/\/s1\.md$/), expect.stringMatching(/\/files\/notes\.md$/)]);
  });

  it('syncs a transcript that grew before transcript sync went off, once it is back on, though its files synced meanwhile', async () => {
    vi.useRealTimers();
    const { cwd, path } = await filesSession('s1', ['notes.md']);
    await runSync(opts({ all: true, now: Date.now() - 10 * min }));
    const grew = Date.now() - 5 * min;
    await fs.appendFile(path, line('user', 'one more thing', { cwd, ts: iso(grew) }));
    await fs.utimes(path, new Date(grew), new Date(grew));
    await pause();
    await cmdPrivacy({ captureTranscripts: 'off' });
    await pause();
    await runSync(opts({ all: true, now: Date.now() + 3 * min }));
    expect(JSON.stringify(writes)).not.toContain('one more thing');
    await cmdPrivacy({ captureTranscripts: 'on' });
    await pause();
    await runSync(opts({ now: Date.now() + 6 * min }));
    expect(writes.filter((w) => w.path.endsWith('/s1.md')).at(-1)?.content).toContain('one more thing');
  });

  it("starts a session at its first turn when every turn has a timestamp, and at its file's creation when one doesn't", async () => {
    vi.useRealTimers();
    const timed = join(home, '.claude/projects/proj', 'timed.jsonl');
    const mixed = join(home, '.claude/projects/proj', 'mixed.jsonl');
    await fs.mkdir(dirname(timed), { recursive: true });
    await realToggle('off');
    // Both created while sync was off. Only mixed has a turn from then, which carries no timestamp.
    await fs.writeFile(timed, '');
    await fs.writeFile(mixed, line('user', 'hush untimed prompt typed while off', { cwd: home }));
    await realToggle('on');
    for (const path of [timed, mixed]) await fs.appendFile(path, line('user', 'first timed prompt after sync came back', { cwd: home, ts: iso(Date.now()) }));
    await runSync(opts({ all: true, now: Date.now() + 3 * min }));
    expect(runs.map((r) => r.run_id)).toEqual(['claude-code:timed']);
    expect(sent()).not.toContain('hush');
  });

  it('keeps a file local that got off-period content with an old mtime (cp -p, touch)', async () => {
    vi.useRealTimers();
    const { cwd } = await filesSession('s1', ['notes.md']);
    await runSync(opts({ all: true, now: Date.now() }));
    await realToggle('off');
    // cp -p, rsync -a or a Finder copy keep the source's mtime; touch can backdate it.
    const old = new Date(Date.now() - 3 * 60 * min);
    await fs.writeFile(join(cwd, 'notes.md'), 'customer export hush-copied\n');
    await fs.utimes(join(cwd, 'notes.md'), old, old);
    await realToggle('on');
    await switchWorkspace();
    await runSync(opts({ all: true, now: Date.now() + 5 * min }));
    expect(JSON.stringify(writes)).not.toContain('hush');
  });

  it('stops transcripts and runs as soon as transcript sync is turned off mid-run, on-period sessions included', async () => {
    await session('first', [t0 - 20 * min, 'work from before the toggle']);
    await session('second', [t0 - 10 * min, 'more work from before the toggle']);
    let toggled = false;
    const toggling = {
      ...client,
      async writeFile(...args: Parameters<SyncClient['writeFile']>) {
        if (!toggled) {
          toggled = true;
          await privacy(t0, { captureTranscripts: 'off' });
        }
        return client.writeFile(...args);
      },
    } as SyncClient;
    await runSync(opts({ all: true, now: t0 + 20 * min, clientFor: () => toggling }));
    // The first transcript was already on its way when sync went off; nothing goes after it.
    expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/\/claude-code\/first\.md$/)]);
    expect(runs).toEqual([]);
  });

  it('syncs a file held back by a mid-run toggle once artifact sync is back on', async () => {
    vi.useRealTimers();
    await filesSession('s1', ['a.md', 'b.md']);
    // Only artifact sync goes off, while a.md uploads, so the run still posts and the session looks synced.
    const artifactsOnly = (state: 'on' | 'off') => cmdPrivacy({ captureArtifacts: state });
    let toggled = false;
    const toggling = {
      ...client,
      async writeFile(...args: Parameters<SyncClient['writeFile']>) {
        if (!toggled && args[1].endsWith('/files/a.md')) {
          toggled = true;
          await artifactsOnly('off');
        }
        return client.writeFile(...args);
      },
    } as SyncClient;
    await runSync(opts({ all: true, now: Date.now(), clientFor: () => toggling }));
    expect(writes.map((w) => w.path).filter((p) => p.includes('/files/'))).toEqual([expect.stringMatching(/\/files\/a\.md$/)]);
    expect(runs).toHaveLength(1);

    await pause();
    await artifactsOnly('on');
    await runSync(opts({ now: Date.now() + 3 * min }));
    expect(writes.map((w) => w.path).filter((p) => p.includes('/files/'))).toEqual([expect.stringMatching(/\/files\/a\.md$/), expect.stringMatching(/\/files\/b\.md$/)]);
  });

  it('keeps both of two concurrent adrive privacy changes', async () => {
    await Promise.all([privacy(t0, { captureArtifacts: 'off' }), cmdPrivacy({ privateWorkspace: 'on' })]);
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));
    expect(cfg.preferences).toMatchObject({ capture_artifacts: false, private_workspace: true });
  });

  it('keeps a held file pending through a sync that runs while artifact sync is still off', async () => {
    vi.useRealTimers();
    await filesSession('s1', ['a.md', 'b.md']);
    const artifactsOnly = (state: 'on' | 'off') => cmdPrivacy({ captureArtifacts: state });
    let toggled = false;
    const toggling = {
      ...client,
      async writeFile(...args: Parameters<SyncClient['writeFile']>) {
        if (!toggled && args[1].endsWith('/files/a.md')) {
          toggled = true;
          await artifactsOnly('off');
        }
        return client.writeFile(...args);
      },
    } as SyncClient;
    await runSync(opts({ all: true, now: Date.now(), clientFor: () => toggling }));
    // Another session's hook syncs while artifact sync is still off.
    await runSync(opts({ all: true, now: Date.now() + 3 * min }));
    await pause();
    await artifactsOnly('on');
    await runSync(opts({ now: Date.now() + 6 * min }));
    expect(writes.map((w) => w.path).filter((p) => p.includes('/files/'))).toEqual([expect.stringMatching(/\/files\/a\.md$/), expect.stringMatching(/\/files\/b\.md$/)]);
  });

  it('lists, in a dry run with artifact sync off, the files it would hold back', async () => {
    vi.useRealTimers();
    const { cwd } = await filesSession('s1', ['old.md', 'new.md']);
    await realToggle('off');
    await fs.writeFile(join(cwd, 'new.md'), 'hush while off\n');
    await runSync(opts({ all: true, dryRun: true, now: Date.now() }));
    const log = await fs.readFile(join(cfgDir, 'sync.log'), 'utf8');
    expect(log).toMatch(/\[dry\] claude-code:s1: held new\.md \(changed while artifact sync was off\)/);
    expect(log).not.toMatch(/held old\.md/);
    expect(log).toMatch(/1 files would upload/);
  });

  it('does not retry a rate-limited transcript upload once transcript sync has been turned off', async () => {
    await session('r1', [t0 - 10 * min, 'work from before the toggle']);
    const posted: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? '{}')) as { path?: string; run_id?: string };
      if (init.method === 'POST' && String(url).endsWith('/files')) {
        posted.push(body.path!);
        if (posted.length === 1) {
          // Transcript sync goes off while the CLI waits out the Retry-After.
          await privacy(t0, { captureTranscripts: 'off' });
          return new Response(JSON.stringify({ success: false, error: 'slow down', code: 'rate_limited' }), { status: 429, headers: { 'retry-after': '1' } });
        }
        return Response.json({ success: true, data: { id: 'f1', path: body.path, version: 1, updated_at: '' } });
      }
      if (String(url).endsWith('/runs')) {
        posted.push(`run ${body.run_id}`);
        return Response.json({ success: true, data: { run_id: body.run_id, created_at: 0 } });
      }
      return Response.json({ success: true, data: [] });
    });
    try {
      const result = await runSync(opts({ all: true, now: t0 + 20 * min, clientFor: (cfg, harness) => new CliApiClient({ baseUrl: cfg.api_url, apiKey: cfg.api_key, agentPlatform: harness }) }));
      expect(posted).toEqual([expect.stringMatching(/\/claude-code\/r1\.md$/)]);
      expect(result.rateLimited).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps an off-period edit local after a later chmod, rename or hard link changes only its metadata, until it is edited again', async () => {
    vi.useRealTimers();
    const names = ['chmod.md', 'moved.md', 'linked.md'];
    const { cwd } = await filesSession('s1', names);
    await realToggle('off');
    for (const n of names) await fs.writeFile(join(cwd, n), `hush ${n}\n`);
    await realToggle('on');
    await fs.chmod(join(cwd, 'chmod.md'), 0o600);
    await fs.rename(join(cwd, 'moved.md'), join(cwd, 'moved.tmp'));
    await fs.rename(join(cwd, 'moved.tmp'), join(cwd, 'moved.md'));
    await fs.link(join(cwd, 'linked.md'), join(root, 'backup'));
    await fs.rm(join(root, 'backup'));
    await runSync(opts({ all: true, now: Date.now() }));
    await switchWorkspace();
    await runSync(opts({ all: true, now: Date.now() + 5 * min }));
    expect(JSON.stringify(writes)).not.toContain('hush');

    await pause();
    await fs.writeFile(join(cwd, 'chmod.md'), 'edited again with sync on\n');
    await switchWorkspace('ws_3');
    await runSync(opts({ all: true, now: Date.now() + 10 * min }));
    expect(writes.map((w) => w.content)).toContain('edited again with sync on\n');
    expect(JSON.stringify(writes)).not.toContain('hush');
  });

  it('records a hand-edited sync-off when adrive sync runs, so sessions from then on stay local', async () => {
    const file = join(cfgDir, 'config.json');
    const cfg = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...cfg, preferences: { ...cfg.preferences, capture_transcripts: false, capture_artifacts: false } }));
    vi.setSystemTime(t0);
    expect((await runSync(opts({ now: t0 }))).skipped).toBe('capture-off');
    await session('h1', [t0 + 5 * min, 'hush typed while hand-edited off']);
    await fs.writeFile(file, JSON.stringify(cfg));
    vi.setSystemTime(t0 + 10 * min);
    await runSync(opts({ all: true, now: t0 + 10 * min }));
    expect(sent()).toBe('[[],[]]');
  });

  it('does not retry a rate-limited file upload once artifact sync has been turned off', async () => {
    vi.useRealTimers();
    await filesSession('s1', ['a.md']);
    const posted: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? '{}')) as { path?: string; run_id?: string };
      if (init.method === 'POST' && String(url).endsWith('/files')) {
        posted.push(body.path!);
        if (body.path!.endsWith('/files/a.md') && posted.filter((p) => p === body.path).length === 1) {
          // Artifact sync goes off while the CLI waits out the Retry-After.
          await cmdPrivacy(both('off'));
          return new Response(JSON.stringify({ success: false, error: 'slow down', code: 'rate_limited' }), { status: 429, headers: { 'retry-after': '1' } });
        }
        return Response.json({ success: true, data: { id: `f${posted.length}`, path: body.path, version: 1, updated_at: '' } });
      }
      if (String(url).endsWith('/runs')) return Response.json({ success: true, data: { run_id: body.run_id, created_at: 0 } });
      return Response.json({ success: true, data: [] });
    });
    try {
      const result = await runSync(opts({ all: true, now: Date.now(), clientFor: (cfg, harness) => new CliApiClient({ baseUrl: cfg.api_url, apiKey: cfg.api_key, agentPlatform: harness }) }));
      expect(posted.filter((p) => p.endsWith('/files/a.md'))).toHaveLength(1);
      expect(result.rateLimited).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats a dangling link or a folder at the marker path as damage', async () => {
    await privacy(t0, both('off'));
    await session('k1', [t0 + 5 * min, 'hush while off']);
    await privacy(t0 + 10 * min, both('on'));
    const marker = join(cfgDir, 'privacy-history.marker');
    await fs.rm(marker);
    await fs.symlink(join(root, 'nowhere'), marker);
    await fs.rm(join(cfgDir, 'privacy-history.json'));
    expect((await runSync(opts({ all: true, now: t0 + 20 * min }))).skipped).toBe('history-unreadable');
    await fs.rm(marker);
    await fs.mkdir(marker);
    expect((await runSync(opts({ all: true, now: t0 + 30 * min }))).skipped).toBe('history-unreadable');
    expect(sent()).toBe('[[],[]]');
  });

  it('syncs nothing once a recorded privacy history goes missing', async () => {
    await privacy(t0, both('off'));
    await session('m1', [t0 + 5 * min, 'hush while off']);
    await privacy(t0 + 10 * min, both('on'));
    await fs.access(join(cfgDir, 'privacy-history.marker'));
    await fs.rm(join(cfgDir, 'privacy-history.json'));
    expect((await runSync(opts({ all: true, now: t0 + 20 * min }))).skipped).toBe('history-unreadable');
    expect(sent()).toBe('[[],[]]');
  });

  it('stays stopped when the history goes missing after 1.4.0 rewrites config.json or across a logout, and an empty file does not restore it', async () => {
    await privacy(t0, both('off'));
    await session('m2', [t0 + 5 * min, 'hush while off']);
    await privacy(t0 + 10 * min, both('on'));
    // As 1.4.0 writes it: only the fields it knows.
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));
    await fs.writeFile(join(cfgDir, 'config.json'), JSON.stringify({ api_url: cfg.api_url, api_key: cfg.api_key, default_workspace: cfg.default_workspace, preferences: cfg.preferences, capture_notice_at: cfg.capture_notice_at }));
    await fs.rm(join(cfgDir, 'privacy-history.json'));
    expect((await runSync(opts({ all: true, now: t0 + 20 * min }))).skipped).toBe('history-unreadable');
    await cmdAuthLogout({ yes: true });
    await signIn(t0 + 30 * min);
    expect((await runSync(opts({ all: true, now: t0 + 40 * min }))).skipped).toBe('history-unreadable');
    await fs.writeFile(join(cfgDir, 'privacy-history.json'), '');
    expect((await runSync(opts({ all: true, now: t0 + 50 * min }))).skipped).toBe('history-unreadable');
    expect(sent()).toBe('[[],[]]');
  });

  it('syncs nothing while the privacy history is damaged, and catches up once it is fixed', async () => {
    await session('d1', [t0 - 10 * min, 'ordinary work']);
    await fs.writeFile(join(cfgDir, 'privacy-history.json'), '{oops');
    expect((await runSync(opts({ now: t0 }))).skipped).toBe('history-unreadable');
    expect(sent()).toBe('[[],[]]');
    await fs.writeFile(join(cfgDir, 'privacy-history.json'), JSON.stringify({ transcripts_off: [], artifacts_off: [] }));
    await runSync(opts({ now: t0 + 10 * min }));
    expect(runs.map((r) => r.run_id)).toEqual(['claude-code:d1']);
  });
});

describe('safeRemote', () => {
  it('keeps clean paths and disambiguates ones that cleaning or truncation changed', () => {
    expect(safeRemote('sessions/p/files', 'src/a.ts')).toBe('sessions/p/files/src/a.ts');
    const spaced = safeRemote('sessions/p/files', 'foo bar.txt');
    const dashed = safeRemote('sessions/p/files', 'foo-bar.txt');
    expect(dashed).toBe('sessions/p/files/foo-bar.txt');
    expect(spaced).toMatch(/^sessions\/p\/files\/foo-bar-[0-9a-f]{8}\.txt$/);
    const long = (c: string) => safeRemote('sessions/p/files', `${'d/'.repeat(10)}${c.repeat(600)}.md`);
    expect(long('a')).not.toBe(long('a').replace(/-[0-9a-f]{8}$/, ''));
    expect(long('a').length).toBeLessThanOrEqual(500);
    expect(safeRemote('sessions/p/files', `${'x'.repeat(600)}1`)).not.toBe(safeRemote('sessions/p/files', `${'x'.repeat(600)}2`));
    expect(safeRemote('sessions/p/files', `${'x'.repeat(600)}1`).length).toBeLessThanOrEqual(500);
  });
});
