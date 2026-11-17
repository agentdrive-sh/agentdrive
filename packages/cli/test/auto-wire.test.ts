import { promises as fs, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoWire, takeAutoWireNotice } from '../src/lib/auto-wire.js';
import type { WireDeps } from '../src/lib/wire-all.js';

let home: string;
let cfgDir: string;
let env: NodeJS.ProcessEnv;
let installs: number;
let trusts: string[];
const logs: string[] = [];
const deps: WireDeps = {
  installClaude: () => {
    installs += 1;
    return { status: 'installed' };
  },
  trustCodex: async (dir) => {
    trusts.push(dir);
    return { status: 'trusted', count: 1 };
  },
};
const log = async (m: string) => void logs.push(m);

async function config(extra: Record<string, unknown> = {}) {
  await fs.mkdir(cfgDir, { recursive: true });
  await fs.writeFile(
    join(cfgDir, 'config.json'),
    JSON.stringify({ api_url: 'https://example.invalid', api_key: 'agentdrive_live_test', ...extra }),
  );
}
const readWired = async () => (JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8')) as { wired?: string[] }).wired;
const run = (connected?: string) => autoWire({ configDir: cfgDir, home, env, log, connected, deps });

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'adrive-autowire-'));
  cfgDir = join(home, 'cfg');
  env = { XDG_CONFIG_HOME: join(home, 'xdg'), XDG_DATA_HOME: join(home, 'data') };
  installs = 0;
  trusts = [];
  logs.length = 0;
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('autoWire', () => {
  it('wires tools installed after init, once, and tells the next session', async () => {
    await config({ wired: ['claude-code'] });
    await fs.mkdir(join(home, '.claude'));
    await fs.mkdir(join(home, '.cursor'));
    await fs.mkdir(join(home, '.codex'));

    expect(await run()).toEqual(['Codex', 'Cursor']);
    expect(installs).toBe(0);
    expect(trusts).toEqual([join(home, '.codex')]);
    expect(await fs.readFile(join(home, '.cursor', 'hooks.json'), 'utf8')).toContain('adrive hook cursor');
    expect(await readWired()).toEqual(['claude-code', 'codex', 'cursor']);
    expect(await takeAutoWireNotice(cfgDir)).toContain('Codex, Cursor');
    expect(await takeAutoWireNotice(cfgDir)).toBeUndefined();

    expect(await run()).toEqual([]);
    expect(trusts).toHaveLength(1);
  });

  it('leaves a tool alone once it has been wired, even if the user removed AgentDrive from it', async () => {
    await config({ wired: ['cursor'] });
    await fs.mkdir(join(home, '.cursor'));
    expect(await run()).toEqual([]);
    await expect(fs.stat(join(home, '.cursor', 'hooks.json'))).rejects.toThrow();
  });

  it('counts the harness whose hook started the sync as wired without touching it', async () => {
    await config();
    await fs.mkdir(join(home, '.claude'));
    expect(await run('claude-code')).toEqual([]);
    expect(installs).toBe(0);
    expect(await readWired()).toEqual(['claude-code']);
  });

  it('does nothing when turned off or logged out', async () => {
    await fs.mkdir(join(home, '.cursor'));
    await config({ preferences: { auto_wire: false } });
    expect(await run()).toEqual([]);
    await config({ api_key: undefined });
    expect(await run()).toEqual([]);
    await expect(fs.stat(join(home, '.cursor', 'hooks.json'))).rejects.toThrow();
  });

  it('installs the Claude Code plugin when Claude Code shows up later', async () => {
    await config({ wired: ['codex'] });
    await fs.mkdir(join(home, '.claude'));
    expect(await run('codex')).toEqual(['Claude Code']);
    expect(installs).toBe(1);
    expect(await readWired()).toEqual(['codex', 'claude-code']);
    expect(await takeAutoWireNotice(cfgDir)).toContain('Claude Code');
  });

  it('takes the tools installed at upgrade time as the baseline instead of wiring them', async () => {
    await config();
    await fs.mkdir(join(home, '.claude'));
    await fs.mkdir(join(home, '.cursor'));
    expect(await run('codex')).toEqual([]);
    expect(installs).toBe(0);
    await expect(fs.stat(join(home, '.cursor', 'hooks.json'))).rejects.toThrow();
    expect(await readWired()).toEqual(['claude-code', 'cursor', 'codex']);
  });

  it('never brings back a config that was logged out while wiring ran', async () => {
    await config({ wired: ['codex'] });
    await fs.mkdir(join(home, '.claude'));
    const logoutMidway: WireDeps = {
      ...deps,
      installClaude: () => {
        rmSync(join(cfgDir, 'config.json'));
        return { status: 'installed' };
      },
    };
    await autoWire({ configDir: cfgDir, home, env, log, deps: logoutMidway });
    await expect(fs.stat(join(cfgDir, 'config.json'))).rejects.toThrow();
  });
});
