import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const watcher = vi.hoisted(() => ({
  root: '',
  ignored: undefined as ((p: string, stats?: import('node:fs').Stats) => boolean) | undefined,
  followSymlinks: undefined as boolean | undefined,
  emitter: undefined as EventEmitter | undefined,
}));
vi.mock('chokidar', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    watch: (root: string, opts: { ignored: (p: string, stats?: import('node:fs').Stats) => boolean; followSymlinks?: boolean }) => {
      watcher.root = root;
      watcher.ignored = opts.ignored;
      watcher.followSymlinks = opts.followSymlinks;
      watcher.emitter = new Emitter();
      return Object.assign(watcher.emitter, { close: async () => undefined });
    },
  };
});

import { cmdWatch } from '../src/commands/watch.js';
import { cmdPrivacy } from '../src/commands/privacy.js';

let root: string;
let posts: Array<{ path: string; content: string }>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'adrive-watch-test-'));
  vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg'));
  await fs.mkdir(join(root, 'xdg', 'agentdrive'), { recursive: true });
  await fs.writeFile(
    join(root, 'xdg', 'agentdrive', 'config.json'),
    JSON.stringify({
      api_url: 'https://example.invalid',
      api_key: 'agentdrive_live_test',
      default_workspace: 'ws_1',
      preferences: { auto_context: false, capture_transcripts: false, capture_artifacts: true, private_workspace: false },
    }),
  );
  posts = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { path: string; content: string };
    posts.push(body);
    return new Response(JSON.stringify({ success: true, data: { id: `f${posts.length}`, path: body.path, version: 1, updated_at: '' } }), { status: 200 });
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('cmdWatch', () => {
  it('watches the root and uploads ordinary files, while the built-in deny list beats a `!` rule', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, '.adriveignore'), '!.env\n!id_rsa\n');
    await fs.writeFile(join(proj, '.env'), 'SECRET=hunter2\n');
    await fs.writeFile(join(proj, 'id_rsa'), 'PRIVATE hunter2\n');
    await fs.writeFile(join(proj, 'notes.md'), 'the plan\n');

    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.ignored).toBeDefined());
    expect(watcher.root).toBe(proj);
    expect(watcher.ignored!(proj)).toBe(false);
    expect(watcher.ignored!(join(proj, '.env'))).toBe(true);
    expect(watcher.ignored!(join(proj, 'id_rsa'))).toBe(true);

    for (const f of ['.env', 'id_rsa', 'notes.md']) watcher.emitter!.emit('add', join(proj, f));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ path: 'notes.md', content: 'the plan\n' });
    expect(JSON.stringify(posts)).not.toContain('hunter2');
  });

  it('follows no links, checks real paths against the deny list, and refuses a denied folder', async () => {
    const ssh = join(root, 'home', '.ssh');
    await fs.mkdir(ssh, { recursive: true });
    await fs.writeFile(join(ssh, 'config'), 'Host prod hunter2\n');
    await fs.writeFile(join(ssh, 'prod_deploy'), 'KEYBODY hunter2\n');
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.symlink(ssh, join(proj, 'keys'));
    await fs.symlink(join(ssh, 'prod_deploy'), join(proj, 'deploy.txt'));
    await fs.writeFile(join(proj, 'notes.md'), 'the plan\n');

    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    expect(watcher.followSymlinks).toBe(false);
    for (const f of ['deploy.txt', 'keys/config', 'keys/prod_deploy', 'notes.md']) watcher.emitter!.emit('add', join(proj, f));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(posts.map((p) => p.path)).toEqual(['notes.md']);

    await expect(cmdWatch(ssh, { debounce: 1 })).rejects.toThrow(/deny list/);
    await expect(cmdWatch(join(proj, 'keys'), { debounce: 1 })).rejects.toThrow(/deny list/);
  });

  it('reads nothing through a link swapped in during the debounce, a hard link, or a case variant of a denied name', async () => {
    const ssh = join(root, 'home', '.ssh');
    await fs.mkdir(ssh, { recursive: true });
    await fs.writeFile(join(ssh, 'config'), 'Host prod hunter2\n');
    const proj = join(root, 'proj');
    await fs.mkdir(join(proj, '.SSH'), { recursive: true });
    await fs.writeFile(join(proj, 'a.md'), 'draft\n');
    await fs.link(join(ssh, 'config'), join(proj, 'hostnotes.txt'));
    await fs.writeFile(join(proj, '.ENV'), 'DB_PASSWORD=hunter2\n');
    await fs.writeFile(join(proj, '.DEV.VARS'), 'pw hunter2\n');
    await fs.writeFile(join(proj, 'ID_RSA'), 'hunter2\n');
    await fs.writeFile(join(proj, '.SSH', 'known'), 'hunter2\n');
    await fs.writeFile(join(proj, 'notes.md'), 'the plan\n');

    void cmdWatch(proj, { debounce: 200 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    for (const f of ['a.md', 'hostnotes.txt', '.ENV', '.DEV.VARS', 'ID_RSA', '.SSH/known', 'notes.md']) watcher.emitter!.emit('add', join(proj, f));
    // Queued as a regular file, then swapped for a link before the debounce ends.
    await fs.rm(join(proj, 'a.md'));
    await fs.symlink(join(ssh, 'config'), join(proj, 'a.md'));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(posts.map((p) => p.path)).toEqual(['notes.md']);
    expect(JSON.stringify(posts)).not.toContain('hunter2');

    await fs.mkdir(join(root, 'home', '.aws'));
    await expect(cmdWatch(join(root, 'home', '.AWS'), { debounce: 1 })).rejects.toThrow(/deny list/);
  });

  it('stops uploading when artifact sync is turned off while it runs, and holds back what changed meanwhile', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    const pause = () => new Promise((r) => setTimeout(r, 30));
    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));

    await cmdPrivacy({ captureArtifacts: 'off' });
    await pause();
    await fs.writeFile(join(proj, 'off.md'), 'hush while off\n');
    watcher.emitter!.emit('add', join(proj, 'off.md'));
    const printed = () => (process.stdout.write as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join('');
    await vi.waitFor(() => expect(printed()).toContain('[paused]'));
    expect(posts).toEqual([]);

    await pause();
    await cmdPrivacy({ captureArtifacts: 'on' });
    await pause();
    await fs.writeFile(join(proj, 'new.md'), 'the plan\n');
    for (const f of ['off.md', 'new.md']) watcher.emitter!.emit('add', join(proj, f));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(posts.map((p) => p.path)).toEqual(['new.md']);
    expect(printed()).toContain('[resumed]');
  });

  const ok = (path: string, id: number) => new Response(JSON.stringify({ success: true, data: { id: `f${id}`, path, version: 1, updated_at: '' } }), { status: 200 });
  const said = (stream: NodeJS.WriteStream) => (stream.write as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join('');

  it('checks consent before each file, so a toggle made mid-batch stops the rest of it', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    for (const f of ['a.md', 'b.md', 'c.md']) await fs.writeFile(join(proj, f), `${f}\n`);
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { path: string; content: string };
      posts.push(body);
      // Artifact sync goes off while the first file uploads.
      if (posts.length === 1) await cmdPrivacy({ captureArtifacts: 'off' });
      return ok(body.path, posts.length);
    });
    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    for (const f of ['a.md', 'b.md', 'c.md']) watcher.emitter!.emit('add', join(proj, f));
    await vi.waitFor(() => expect(said(process.stdout)).toContain('[paused]'));
    await new Promise((r) => setTimeout(r, 100));
    expect(posts.map((p) => p.path)).toEqual(['a.md']);
  });

  it('runs one batch at a time', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    for (const f of ['a.md', 'b.md']) await fs.writeFile(join(proj, f), `${f}\n`);
    let inFlight = 0;
    let most = 0;
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { path: string; content: string };
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 150));
      inFlight--;
      posts.push(body);
      return ok(body.path, posts.length);
    });
    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    watcher.emitter!.emit('add', join(proj, 'a.md'));
    await new Promise((r) => setTimeout(r, 30));
    watcher.emitter!.emit('add', join(proj, 'b.md'));
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(most).toBe(1);
  });

  it('does not retry a rate-limited upload once artifact sync has been turned off', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, 'a.md'), 'draft\n');
    let calls = 0;
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { path: string; content: string };
      if (++calls === 1) {
        await cmdPrivacy({ captureArtifacts: 'off' });
        return new Response(JSON.stringify({ success: false, error: 'slow down', code: 'rate_limited' }), { status: 429, headers: { 'retry-after': '1' } });
      }
      posts.push(body);
      return ok(body.path, posts.length);
    });
    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    watcher.emitter!.emit('add', join(proj, 'a.md'));
    await vi.waitFor(() => expect(said(process.stderr)).toContain('rate limiting'), { timeout: 3000 });
    expect(calls).toBe(1);
    expect(posts).toEqual([]);
  });

  it('keeps a paused batch and resumes it, while a file changed meanwhile stays local', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    const pause = () => new Promise((r) => setTimeout(r, 30));
    for (const f of ['a.md', 'b.md', 'c.md']) await fs.writeFile(join(proj, f), `${f}\n`);
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { path: string; content: string };
      posts.push(body);
      if (posts.length === 1) await cmdPrivacy({ captureArtifacts: 'off' });
      return ok(body.path, posts.length);
    });
    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    for (const f of ['a.md', 'b.md', 'c.md']) watcher.emitter!.emit('add', join(proj, f));
    await vi.waitFor(() => expect(said(process.stdout)).toContain('[paused]'));
    await pause();
    await fs.writeFile(join(proj, 'c.md'), 'hush while off\n');
    await pause();
    await cmdPrivacy({ captureArtifacts: 'on' });
    await vi.waitFor(() => expect(posts.map((p) => p.path)).toEqual(['a.md', 'b.md']), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(posts.map((p) => p.path)).toEqual(['a.md', 'b.md']);
    expect(said(process.stdout)).toContain('[resumed]');
  });

  it('treats an unreadable config.json as "try again", not as sync turned off', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, 'a.md'), 'the plan\n');
    const file = join(root, 'xdg', 'agentdrive', 'config.json');
    const good = await fs.readFile(file, 'utf8');
    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    await fs.writeFile(file, good.slice(0, 20));
    watcher.emitter!.emit('add', join(proj, 'a.md'));
    await new Promise((r) => setTimeout(r, 300));
    expect(posts).toEqual([]);
    expect(said(process.stdout)).not.toContain('[paused]');
    await fs.writeFile(file, good);
    await vi.waitFor(() => expect(posts.map((p) => p.path)).toEqual(['a.md']), { timeout: 5000 });
  });

  it('shows in a dry run, even with artifact sync off, what would upload and what would be held back', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, 'a.md'), 'from before\n');
    await new Promise((r) => setTimeout(r, 30));
    await cmdPrivacy({ captureArtifacts: 'off' });
    await new Promise((r) => setTimeout(r, 30));
    await fs.writeFile(join(proj, 'b.md'), 'hush while off\n');
    void cmdWatch(proj, { debounce: 1, dryRun: true });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    for (const f of ['a.md', 'b.md']) watcher.emitter!.emit('add', join(proj, f));
    await vi.waitFor(() => expect(said(process.stdout)).toMatch(/\[dry\] held +b\.md/));
    expect(said(process.stdout)).toMatch(/\[dry\] add +a\.md/);
    expect(said(process.stdout)).not.toContain('[paused]');
    expect(posts).toEqual([]);
  });

  it('records an off toggle made by hand while it runs, so files changed during that pause stay local', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    const file = join(root, 'xdg', 'agentdrive', 'config.json');
    const cfg = JSON.parse(await fs.readFile(file, 'utf8'));
    const setArtifacts = (on: boolean) => fs.writeFile(file, JSON.stringify({ ...cfg, preferences: { ...cfg.preferences, capture_artifacts: on } }));
    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    await setArtifacts(false);
    await fs.writeFile(join(proj, 'b.md'), 'hush while off\n');
    watcher.emitter!.emit('add', join(proj, 'b.md'));
    await vi.waitFor(() => expect(said(process.stdout)).toContain('[paused]'));
    await setArtifacts(true);
    await vi.waitFor(() => expect(said(process.stdout)).toContain('[resumed]'), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(posts).toEqual([]);
    const history = JSON.parse(await fs.readFile(join(root, 'xdg', 'agentdrive', 'privacy-history.json'), 'utf8'));
    expect(history.artifacts_off).toEqual([{ at: expect.any(Number), until: expect.any(Number) }]);
  });

  it('says once that files are waiting while config.json can\'t be read', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, 'a.md'), 'the plan\n');
    const file = join(root, 'xdg', 'agentdrive', 'config.json');
    const good = await fs.readFile(file, 'utf8');
    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    await fs.writeFile(file, good.slice(0, 20));
    watcher.emitter!.emit('add', join(proj, 'a.md'));
    await new Promise((r) => setTimeout(r, 2500));
    expect(said(process.stdout).match(/\[waiting\]/g)).toHaveLength(1);
    await fs.writeFile(file, good);
    await vi.waitFor(() => expect(posts.map((p) => p.path)).toEqual(['a.md']), { timeout: 5000 });
  });

  it('tries an upload that failed on a 5xx, the network or a timeout again with backoff, through every check, and drops one the server refused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const proj = join(root, 'proj');
      await fs.mkdir(proj);
      await fs.writeFile(join(proj, 'flaky.md'), 'flaky\n');
      await fs.writeFile(join(proj, 'bad.md'), 'bad\n');
      const failures: Array<() => Response | Promise<Response>> = [
        () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }),
        () => Promise.reject(new TypeError('fetch failed')),
        () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
      ];
      const attempts: string[] = [];
      vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { path: string; content: string };
        attempts.push(body.path);
        if (body.path === 'bad.md') return new Response(JSON.stringify({ error: 'path not allowed' }), { status: 400 });
        const fail = failures.shift();
        if (fail) return fail();
        posts.push(body);
        return ok(body.path, posts.length);
      });
      void cmdWatch(proj, { debounce: 1 });
      await vi.waitFor(() => expect(watcher.root).toBe(proj));
      for (const f of ['flaky.md', 'bad.md']) watcher.emitter!.emit('add', join(proj, f));
      await vi.waitFor(() => expect(said(process.stderr)).toContain('flaky.md: unavailable (trying again in 5s)'));
      await vi.waitFor(() => expect(said(process.stderr)).toContain('bad.md: path not allowed\n'));
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(said(process.stderr)).toContain('flaky.md: fetch failed (trying again in 10s)'));
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => expect(said(process.stderr)).toContain('(trying again in 20s)'));
      // Artifact sync turned off before the next try: the file waits instead of uploading.
      await cmdPrivacy({ captureArtifacts: 'off' });
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.waitFor(() => expect(said(process.stdout)).toContain('[paused]'));
      expect(posts).toEqual([]);
      await cmdPrivacy({ captureArtifacts: 'on' });
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(posts.map((p) => p.path)).toEqual(['flaky.md']));
      expect(attempts.filter((p) => p === 'bad.md')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('doubles the wait between tries up to 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const proj = join(root, 'proj');
      await fs.mkdir(proj);
      await fs.writeFile(join(proj, 'down.md'), 'down\n');
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'bad gateway' }), { status: 502 }));
      void cmdWatch(proj, { debounce: 1 });
      await vi.waitFor(() => expect(watcher.root).toBe(proj));
      watcher.emitter!.emit('add', join(proj, 'down.md'));
      const waits = () => [...said(process.stderr).matchAll(/down\.md: bad gateway \(trying again in (\d+)s\)/g)].map((m) => Number(m[1]));
      for (let n = 1; n <= 8; n++) {
        await vi.waitFor(() => expect(waits()).toHaveLength(n));
        if (n < 8) await vi.advanceTimersByTimeAsync(300_000);
      }
      expect(waits()).toEqual([5, 10, 20, 40, 80, 160, 300, 300]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops, and exits non-zero, once Private Workspace, the account or the default workspace changes while it runs', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const file = join(root, 'xdg', 'agentdrive', 'config.json');
    const original = await fs.readFile(file, 'utf8');
    const cfg = JSON.parse(original);
    const changes: Array<[Record<string, unknown>, string]> = [
      [{ preferences: { ...cfg.preferences, private_workspace: true } }, 'Private Workspace'],
      [{ api_key: 'agentdrive_live_other' }, 'The signed-in account'],
      [{ default_workspace: 'ws_2' }, 'The default workspace'],
    ];
    for (const [i, [change, what]] of changes.entries()) {
      const proj = join(root, `proj${i}`);
      await fs.mkdir(proj);
      await fs.writeFile(join(proj, 'notes.md'), 'the plan\n');
      await fs.writeFile(file, original);
      void cmdWatch(proj, { debounce: 1 });
      await vi.waitFor(() => expect(watcher.root).toBe(proj));
      await fs.writeFile(file, JSON.stringify({ ...cfg, ...change }));
      watcher.emitter!.emit('add', join(proj, 'notes.md'));
      await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(i + 1), { timeout: 4000 });
      expect(exit).toHaveBeenLastCalledWith(1);
      expect(said(process.stderr)).toContain(`${what} changed since adrive watch started; restart it`);
    }
    expect(posts).toEqual([]);

    // With --workspace, uploads never followed the default, so changing it doesn't stop watch.
    const proj = join(root, 'chosen');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, 'notes.md'), 'the plan\n');
    await fs.writeFile(file, original);
    void cmdWatch(proj, { debounce: 1, workspace: 'ws_1' });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    await fs.writeFile(file, JSON.stringify({ ...cfg, default_workspace: 'ws_2' }));
    watcher.emitter!.emit('add', join(proj, 'notes.md'));
    await vi.waitFor(() => expect(posts.map((p) => p.path)).toEqual(['notes.md']));
    expect(exit).toHaveBeenCalledTimes(3);
  });

  it.skipIf(process.platform === 'win32')("waits, and says why, while the privacy history can't be brought up to date", async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, 'a.md'), 'the plan\n');
    const dir = join(root, 'xdg', 'agentdrive');
    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    await fs.chmod(dir, 0o500);
    try {
      watcher.emitter!.emit('add', join(proj, 'a.md'));
      await vi.waitFor(() => expect(said(process.stdout)).toContain("privacy-history.json can't be updated"));
      await new Promise((r) => setTimeout(r, 300));
      expect(posts).toEqual([]);
    } finally {
      await fs.chmod(dir, 0o700);
    }
    await vi.waitFor(() => expect(posts.map((p) => p.path)).toEqual(['a.md']), { timeout: 5000 });
  });

  it('shows in a dry run that nothing would upload while the privacy history is damaged', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, 'a.md'), 'the plan\n');
    await fs.writeFile(join(root, 'xdg', 'agentdrive', 'privacy-history.json'), 'not json');
    void cmdWatch(proj, { debounce: 1, dryRun: true });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    watcher.emitter!.emit('add', join(proj, 'a.md'));
    await vi.waitFor(() => expect(said(process.stdout)).toContain('privacy-history.json is missing or damaged, so a live run would upload nothing'));
    await new Promise((r) => setTimeout(r, 300));
    expect(said(process.stdout)).not.toContain('a.md');
  });

  it.skipIf(process.platform === 'win32')('never watches or opens a FIFO in the folder', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    execFileSync('mkfifo', [join(proj, 'pipe')]);
    await fs.writeFile(join(proj, 'notes.md'), 'the plan\n');

    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    expect(watcher.ignored!(join(proj, 'pipe'), await fs.lstat(join(proj, 'pipe')))).toBe(true);
    expect(watcher.ignored!(join(proj, 'notes.md'), await fs.lstat(join(proj, 'notes.md')))).toBe(false);
    for (const f of ['pipe', 'notes.md']) watcher.emitter!.emit('add', join(proj, f));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts.map((p) => p.path)).toEqual(['notes.md']);
  });
});
