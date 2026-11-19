import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVetted } from './safe-read.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.realpath(await mkdtemp(join(tmpdir(), 'adrive-safe-read-')));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readVetted', () => {
  it('reads a regular file, within the size cap', async () => {
    await fs.writeFile(join(dir, 'a.md'), 'plan\n');
    expect((await readVetted(join(dir, 'a.md')))?.buf.toString()).toBe('plan\n');
    expect(await readVetted(join(dir, 'a.md'), 2)).toBeNull();
  });

  it('refuses a link, a hard-linked file, and a path whose parent folder became a link', async () => {
    await fs.writeFile(join(dir, 'secret'), 'hunter2\n');
    await fs.symlink(join(dir, 'secret'), join(dir, 'link.md'));
    expect(await readVetted(join(dir, 'link.md'))).toBeNull();
    await fs.link(join(dir, 'secret'), join(dir, 'hard.md'));
    expect(await readVetted(join(dir, 'hard.md'))).toBeNull();

    await fs.mkdir(join(dir, 'proj'));
    await fs.writeFile(join(dir, 'proj', 'x.md'), 'plain\n');
    await fs.mkdir(join(dir, 'other'));
    await fs.writeFile(join(dir, 'other', 'x.md'), 'hunter2\n');
    await fs.rename(join(dir, 'proj'), join(dir, 'proj.old'));
    await fs.symlink(join(dir, 'other'), join(dir, 'proj'));
    expect(await readVetted(join(dir, 'proj', 'x.md'))).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('returns at once for a FIFO instead of blocking on it', async () => {
    execFileSync('mkfifo', [join(dir, 'pipe')]);
    expect(await readVetted(join(dir, 'pipe'))).toBeNull();
  });
});
