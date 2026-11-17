import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync, safeRemote, type SyncClient, type SyncOptions } from '../src/lib/sync.js';
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
    JSON.stringify({ api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', default_workspace: 'ws_1', preferences: prefs }),
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
    await fs.writeFile(join(repo, 'blob.bin'), Buffer.from([1, 0, 2, 3]));
    await fs.writeFile(join(home, 'plan.md'), 'outside cwd, inside home\n');
    await fs.writeFile(join(root, 'outside.txt'), 'outside home\n');

    const tool = (file_path: string) => ({ type: 'tool_use', name: 'Write', input: { file_path } });
    const transcript = await claudeSession(
      's3',
      line('user', 'write stuff', { cwd: repo }) +
        line('assistant', '', {
          content: [tool(join(repo, 'tracked.ts')), tool('notes.md'), tool('.env'), tool('blob.bin'), tool(join(home, 'plan.md')), tool(join(root, 'outside.txt')), tool('missing.ts')],
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
