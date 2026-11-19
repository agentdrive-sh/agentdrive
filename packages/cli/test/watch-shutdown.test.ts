import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const watcher = vi.hoisted(() => ({ root: '', emitter: undefined as EventEmitter | undefined }));
vi.mock('chokidar', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    watch: (root: string) => {
      watcher.root = root;
      watcher.emitter = new Emitter();
      return Object.assign(watcher.emitter, { close: async () => undefined });
    },
  };
});

import { cmdWatch } from '../src/commands/watch.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'adrive-watch-shutdown-'));
  vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg'));
  await fs.mkdir(join(root, 'xdg', 'agentdrive'), { recursive: true });
  await fs.writeFile(
    join(root, 'xdg', 'agentdrive', 'config.json'),
    JSON.stringify({ api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', default_workspace: 'ws_1', preferences: { auto_context: false, capture_artifacts: true } }),
  );
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('cmdWatch shutdown', () => {
  it('gives a hung upload a timeout, and exits shortly after SIGTERM instead of waiting on it', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, 'a.md'), 'the plan\n');
    const signals: Array<AbortSignal | undefined> = [];
    // The server never answers.
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      signals.push(init.signal ?? undefined);
      return new Promise(() => {});
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    watcher.emitter!.emit('add', join(proj, 'a.md'));
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]).toBeInstanceOf(AbortSignal);

    const started = Date.now();
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 4000 });
    expect(Date.now() - started).toBeLessThan(3500);
  });
});
