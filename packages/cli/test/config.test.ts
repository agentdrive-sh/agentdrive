import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigLockedError,
  DEFAULT_PREFERENCES,
  configDir,
  configPath,
  deleteConfig,
  hasSavedPreferences,
  readConfig,
  updateConfig,
  withConfigLock,
  writeConfig,
  type CliConfig,
} from '../src/lib/config.js';

// Stands in for `ps -o etime=` when a test sets it: how long the process at a pid has run.
const ps = vi.hoisted(() => ({ etime: undefined as undefined | (() => string) }));
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const execFileSync = ((file: string, ...rest: unknown[]) =>
    file === 'ps' && ps.etime ? ps.etime() : (real.execFileSync as (...a: unknown[]) => unknown)(file, ...rest)) as typeof real.execFileSync;
  return { ...real, execFileSync };
});

describe('config XDG resolution', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    const dir = configDir({ XDG_CONFIG_HOME: '/var/xdg' } as NodeJS.ProcessEnv, '/Users/foo');
    expect(dir).toBe('/var/xdg/agentdrive');
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    const dir = configDir({} as NodeJS.ProcessEnv, '/Users/foo');
    expect(dir).toBe('/Users/foo/.config/agentdrive');
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is empty string', () => {
    const dir = configDir({ XDG_CONFIG_HOME: '' } as NodeJS.ProcessEnv, '/Users/foo');
    expect(dir).toBe('/Users/foo/.config/agentdrive');
  });

  it('builds the path off the resolved dir', () => {
    const p = configPath({ XDG_CONFIG_HOME: '/var/xdg' } as NodeJS.ProcessEnv, '/Users/foo');
    expect(p).toBe('/var/xdg/agentdrive/config.json');
  });
});

describe('config read/write/delete', () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'adrive-config-'));
    path = join(dir, 'config.json');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns null when no config file exists', async () => {
    expect(await readConfig(path)).toBeNull();
  });

  it('round-trips a config object', async () => {
    await writeConfig(
      {
        api_url: 'https://app.agentdrive.sh',
        api_key: 'agentdrive_live_xyz',
        agent_id: 'ag_1',
        org_id: 'org_1',
        agent_platform: 'cli',
      },
      path,
    );
    const back = await readConfig(path);
    expect(back?.api_key).toBe('agentdrive_live_xyz');
    expect(back?.org_id).toBe('org_1');
  });

  it('tells saved preferences apart from the defaults readConfig fills in', async () => {
    expect(await hasSavedPreferences(path)).toBe(false);
    await writeConfig({ api_url: 'https://app.agentdrive.sh', api_key: 'k' }, path);
    expect(await hasSavedPreferences(path)).toBe(false);
    expect((await readConfig(path))?.preferences).toBeDefined();
    await writeConfig((await readConfig(path))!, path);
    expect(await hasSavedPreferences(path)).toBe(true);
  });

  it('writes file with 0600 permissions on POSIX', async () => {
    if (process.platform === 'win32') return;
    await writeConfig({ api_url: 'https://app.agentdrive.sh', api_key: 'secret' }, path);
    const stat = await fs.stat(path);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('deleteConfig removes the file and returns true', async () => {
    await writeConfig({ api_url: 'https://app.agentdrive.sh', api_key: 'k' }, path);
    expect(await deleteConfig(path)).toBe(true);
    expect(await readConfig(path)).toBeNull();
  });

  it('deleteConfig returns false when nothing to remove', async () => {
    expect(await deleteConfig(path)).toBe(false);
  });
});

describe('writeConfig while others read', () => {
  it('never lets a reader see a torn config.json, and keeps it private', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adrive-config-atomic-'));
    const path = join(dir, 'config.json');
    // Big enough that a plain write lands in several chunks a reader can see between.
    const config = { api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', wired: [], preferences: { ...DEFAULT_PREFERENCES, capture_artifacts: true }, notes: 'x'.repeat(5_000_000) } as unknown as CliConfig;
    try {
      await writeConfig(config, path);
      const failures: unknown[] = [];
      let writing = true;
      const writes = (async () => {
        for (let i = 0; i < 6; i++) await writeConfig({ ...config, preferences: { ...config.preferences!, auto_context: i % 2 === 0 } }, path);
        writing = false;
      })();
      while (writing) await readConfig(path).catch((err) => failures.push(err));
      await writes;
      expect(failures).toEqual([]);
      expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
      expect((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('updateConfig and the config lock', () => {
  let dir: string;
  let path: string;
  const base = { api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', capture_notice_at: '2026-01-01T00:00:00.000Z', wired: [], preferences: { ...DEFAULT_PREFERENCES, auto_context: false, capture_artifacts: true } } as CliConfig;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'adrive-config-lock-'));
    path = join(dir, 'config.json');
    await writeConfig(base, path);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('never loses an update to a concurrent read, change and write', async () => {
    const slow = updateConfig(
      async (latest) => {
        await new Promise((r) => setTimeout(r, 100));
        return { ...latest!, wired: ['codex'] };
      },
      { path },
    );
    await new Promise((r) => setTimeout(r, 20));
    const off = updateConfig((latest) => ({ ...latest!, preferences: { ...DEFAULT_PREFERENCES, ...latest!.preferences, capture_artifacts: false } }), { path, effectiveBefore: true });
    await Promise.all([slow, off]);
    const cfg = await readConfig(path);
    expect(cfg?.preferences?.capture_artifacts).toBe(false);
    expect(cfg?.wired).toEqual(['codex']);
    const history = JSON.parse(await fs.readFile(join(dir, 'privacy-history.json'), 'utf8'));
    expect(history.artifacts_off).toEqual([{ at: expect.any(Number), until: null }]);
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.lock'))).toEqual([]);
  });

  it('leaves no temp file behind when a write fails', async () => {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation((async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith('.tmp')) {
        handle.writeFile = async () => {
          throw Object.assign(new Error('EFBIG: file too large'), { code: 'EFBIG' });
        };
      }
      return handle;
    }) as typeof fs.open);
    await expect(writeConfig({ ...base, agent_role: 'x' }, path)).rejects.toThrow('EFBIG');
    vi.restoreAllMocks();
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock'))).toEqual([]);
    expect((await readConfig(path))?.api_key).toBe('agentdrive_live_test');
  });

  const lockOf = () => `${path}.lock`;
  const history = () => fs.readFile(join(dir, 'privacy-history.json'), 'utf8').catch(() => null);
  const leftovers = async () => (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp') || f.includes('.lock'));
  const ago = async (p: string, ms: number) => fs.utimes(p, new Date(Date.now() - ms), new Date(Date.now() - ms));

  it('writes nothing once its lock is taken over, and starts over from a fresh read', async () => {
    let calls = 0;
    await updateConfig(
      async (latest) => {
        if (++calls === 1) {
          // Another process takes the lock over as stale and turns artifact sync off meanwhile.
          await fs.rm(lockOf());
          await fs.writeFile(lockOf(), 'other');
          await fs.writeFile(path, JSON.stringify({ ...base, preferences: { ...base.preferences, capture_artifacts: false } }));
          setTimeout(() => void fs.rm(lockOf()), 200);
        }
        return { ...latest!, agent_role: 'reviewer' };
      },
      { path },
    );
    expect(calls).toBe(2);
    const cfg = await readConfig(path);
    expect(cfg?.preferences?.capture_artifacts).toBe(false);
    expect(cfg?.agent_role).toBe('reviewer');
  });

  it('releases only its own lock', async () => {
    await withConfigLock(path, async () => {
      await fs.rm(lockOf());
      await fs.writeFile(lockOf(), 'other');
    });
    expect(await fs.readFile(lockOf(), 'utf8')).toBe('other');
  });

  it('logs out under the lock, so a write in progress cannot bring the config back', async () => {
    const slow = updateConfig(
      async (latest) => {
        await new Promise((r) => setTimeout(r, 100));
        return { ...latest!, agent_role: 'reviewer' };
      },
      { path },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(await deleteConfig(path)).toBe(true);
    await slow;
    expect(await readConfig(path)).toBeNull();
  });

  it('lets only one of the waiters break a stale lock', async () => {
    await fs.writeFile(lockOf(), '');
    await ago(lockOf(), 60_000);
    // The second waiter's look at the stale lock comes back only after the first has broken
    // it and taken a new one, as it can when processes race.
    const stat = fs.stat.bind(fs);
    let looks = 0;
    vi.spyOn(fs, 'stat').mockImplementation((async (...args: Parameters<typeof fs.stat>) => {
      const st = await stat(...args);
      if (String(args[0]) === lockOf() && ++looks === 2) await new Promise((r) => setTimeout(r, 30));
      return st;
    }) as typeof fs.stat);
    let inside = 0;
    let most = 0;
    const hold = () =>
      withConfigLock(path, async () => {
        most = Math.max(most, ++inside);
        await new Promise((r) => setTimeout(r, 80));
        inside--;
      });
    await Promise.all([hold(), hold(), ...Array.from({ length: 10 }, hold)]);
    expect(most).toBe(1);
    expect(await leftovers()).toEqual([]);
  });

  it('leaves an old lock alone while its holder runs on this machine, and breaks it once that holder is gone', async () => {
    ps.etime = () => '1-00:00:00\n';
    try {
      await fs.writeFile(lockOf(), `${process.pid}@${hostname()}`);
      await ago(lockOf(), 60_000);
      await expect(withConfigLock(path, async () => undefined, 200)).rejects.toBeInstanceOf(ConfigLockedError);
      expect(await fs.readFile(lockOf(), 'utf8')).toBe(`${process.pid}@${hostname()}`);
    } finally {
      ps.etime = undefined;
    }
    const gone = spawnSync(process.execPath, ['-e', '0']).pid;
    await fs.writeFile(lockOf(), `${gone}@${hostname()}`);
    await ago(lockOf(), 60_000);
    expect(await withConfigLock(path, async () => 'held', 200)).toBe('held');
  });

  it.skipIf(process.platform === 'win32')('breaks an old lock whose pid now belongs to a process started after it was taken', async () => {
    const reused = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
    try {
      await fs.writeFile(lockOf(), `${reused.pid}@${hostname()}`);
      await ago(lockOf(), 60_000);
      expect(await withConfigLock(path, async () => 'held', 200)).toBe('held');
    } finally {
      reused.kill();
    }
  });

  // The lock was taken 60 s ago by this (live) pid; ps says how long the process at that pid has run.
  it.each([
    ['1-00:00:00', 'left'],
    ['02:00:00', 'left'],
    ['01:30', 'left'],
    // etime counts whole seconds, so a start a second after the lock may still be its holder.
    ['00:59', 'left'],
    ['00:05', 'broken'],
    ['0:00:05', 'broken'],
    ['0-00:00:05', 'broken'],
    ['not a time', 'left'],
    ['', 'left'],
    [new Error('spawn ps ENOENT'), 'left'],
  ] as const)('with the live pid running for %s, an old lock is %s', async (etime, outcome) => {
    ps.etime = () => {
      if (etime instanceof Error) throw etime;
      return `${etime}\n`;
    };
    try {
      await fs.writeFile(lockOf(), `${process.pid}@${hostname()}`);
      await ago(lockOf(), 60_000);
      const taken = withConfigLock(path, async () => 'held', 200);
      if (outcome === 'broken') expect(await taken).toBe('held');
      else await expect(taken).rejects.toBeInstanceOf(ConfigLockedError);
    } finally {
      ps.etime = undefined;
    }
  });

  it('waits on EPERM from the lock, which Windows returns while the last one is being deleted', async () => {
    const open = fs.open.bind(fs);
    let refused = 0;
    vi.spyOn(fs, 'open').mockImplementation((async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).endsWith('.lock') && refused++ < 3) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      return open(...args);
    }) as typeof fs.open);
    expect(await withConfigLock(path, async () => 'held')).toBe('held');
    expect(refused).toBeGreaterThan(3);
  });

  it('puts the privacy history back when config.json cannot be replaced after it', async () => {
    const rename = fs.rename.bind(fs);
    const failConfigRename = () =>
      vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (basename(String(to)) === 'config.json') throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
        return rename(from, to);
      });
    const off = (latest: CliConfig | null) => ({ ...latest!, preferences: { ...DEFAULT_PREFERENCES, ...latest!.preferences, capture_artifacts: false } });
    const was = await history();
    expect(was).not.toBeNull();
    failConfigRename();
    await expect(updateConfig(off, { path, effectiveBefore: true })).rejects.toThrow('EIO');
    expect(await history()).toBe(was);
    expect((await readConfig(path))?.preferences?.capture_artifacts).toBe(true);
    vi.restoreAllMocks();

    // With no history before, none is left, and no marker that would mark one lost.
    await fs.rm(join(dir, 'privacy-history.json'));
    await fs.rm(join(dir, 'privacy-history.marker'));
    failConfigRename();
    await expect(updateConfig(off, { path, effectiveBefore: true })).rejects.toThrow('EIO');
    expect((await fs.readdir(dir)).filter((f) => f.startsWith('privacy-history'))).toEqual([]);
    expect(await leftovers()).toEqual([]);
  });

  it('leaves no history temp file behind when the history write fails', async () => {
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('privacy-history.json')) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      return rename(from, to);
    });
    await expect(updateConfig((latest) => ({ ...latest!, preferences: { ...DEFAULT_PREFERENCES, ...latest!.preferences, capture_artifacts: false } }), { path })).rejects.toThrow('ENOSPC');
    expect(await leftovers()).toEqual([]);
  });

  it('removes its lock and temp files if the process exits mid-write (SIGINT skips finally)', async () => {
    vi.resetModules();
    const fresh = await import('../src/lib/config.js');
    const before = new Set(process.listeners('exit'));
    const exitNow = () => {
      for (const l of process.listeners('exit')) if (!before.has(l)) (l as (code: number) => void)(130);
    };
    const rename = fs.rename.bind(fs);
    let seen: string[] = [];
    let afterExit: string[] = [];
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (basename(String(to)) === 'privacy-history.json') {
        seen = await leftovers();
        exitNow();
        afterExit = await leftovers();
        throw new Error('exited');
      }
      return rename(from, to);
    });
    const off = (latest: CliConfig | null) => ({ ...latest!, preferences: { ...DEFAULT_PREFERENCES, ...latest!.preferences, capture_artifacts: false } });
    await expect(fresh.updateConfig(off, { path })).rejects.toThrow('exited');
    // The lock, the config temp file and the history temp file.
    expect(seen).toHaveLength(3);
    expect(afterExit).toEqual([]);
  });

  // A child process that holds the lock until it is signalled. Node strips the types; the hook
  // maps the source's .js imports onto the .ts files.
  const holdInChild = (ownHandler: boolean) => {
    const script = `
      import { registerHooks } from 'node:module';
      registerHooks({ resolve: (s, c, next) => { try { return next(s, c); } catch (e) { if (s.startsWith('.') && s.endsWith('.js')) return next(s.slice(0, -3) + '.ts', c); throw e; } } });
      if (${ownHandler}) process.on('SIGTERM', () => process.exit(0));
      const { withConfigLock } = await import(${JSON.stringify(new URL('../src/lib/config.ts', import.meta.url).href)});
      await withConfigLock(${JSON.stringify(path)}, async () => { process.stdout.write('held\\n'); await new Promise((r) => setTimeout(r, 60_000)); });
    `;
    const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => child.on('exit', (code, signal) => r({ code, signal })));
    const held = new Promise<void>((r) => child.stdout.on('data', (d: Buffer) => d.toString().includes('held') && r()));
    return { child, exited, held };
  };

  it.skipIf(process.platform === 'win32').each(['SIGTERM', 'SIGHUP'] as const)('removes its lock when killed by %s, and still dies of that signal', async (signal) => {
    const { child, exited, held } = holdInChild(false);
    await held;
    expect(await leftovers()).toEqual(['config.json.lock']);
    child.kill(signal);
    expect(await exited).toEqual({ code: null, signal });
    expect(await leftovers()).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('leaves SIGTERM to a command with its own handler, whose exit still removes the lock', async () => {
    const { child, exited, held } = holdInChild(true);
    await held;
    child.kill('SIGTERM');
    expect(await exited).toEqual({ code: 0, signal: null });
    expect(await leftovers()).toEqual([]);
  });

  it('listens for SIGTERM and SIGHUP only while it holds the lock', async () => {
    const before = [process.listenerCount('SIGTERM'), process.listenerCount('SIGHUP')];
    let during: number[] = [];
    await withConfigLock(path, async () => {
      during = [process.listenerCount('SIGTERM'), process.listenerCount('SIGHUP')];
    });
    expect(during).toEqual(before.map((n) => n + 1));
    expect([process.listenerCount('SIGTERM'), process.listenerCount('SIGHUP')]).toEqual(before);
  });

  it('keeps a symlinked config.json a link, and writes the file it points at', async () => {
    const dotfiles = join(dir, 'dotfiles');
    await fs.mkdir(dotfiles);
    await fs.rename(path, join(dotfiles, 'config.json'));
    await fs.symlink(join(dotfiles, 'config.json'), path);
    await updateConfig((latest) => ({ ...latest!, agent_role: 'reviewer' }), { path });
    expect((await fs.lstat(path)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await fs.readFile(join(dotfiles, 'config.json'), 'utf8')).agent_role).toBe('reviewer');
  });
});
