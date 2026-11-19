import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// As on Windows: no O_NOFOLLOW, so only lstat can keep watch from reading through a link.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, constants: { ...actual.constants, O_NOFOLLOW: undefined } };
});

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
let posts: Array<{ path: string; content: string }>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'adrive-watch-nofollow-'));
  vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg'));
  await fs.mkdir(join(root, 'xdg', 'agentdrive'), { recursive: true });
  await fs.writeFile(
    join(root, 'xdg', 'agentdrive', 'config.json'),
    JSON.stringify({ api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', default_workspace: 'ws_1', preferences: { capture_artifacts: true } }),
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

describe('cmdWatch without O_NOFOLLOW', () => {
  it('still refuses a link the watcher reports', async () => {
    const proj = join(root, 'proj');
    await fs.mkdir(proj);
    await fs.writeFile(join(proj, 'notes.md'), 'the plan\n');
    await fs.symlink(join(proj, 'notes.md'), join(proj, 'link.md'));

    void cmdWatch(proj, { debounce: 1 });
    await vi.waitFor(() => expect(watcher.root).toBe(proj));
    for (const f of ['link.md', 'notes.md']) watcher.emitter!.emit('add', join(proj, f));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(posts.map((p) => p.path)).toEqual(['notes.md']);
  });
});
