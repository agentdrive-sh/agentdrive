import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configDir, configPath, deleteConfig, hasSavedPreferences, readConfig, writeConfig } from '../src/lib/config.js';

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
