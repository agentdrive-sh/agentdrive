import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdInit } from '../src/commands/init.js';
import { configPath, hasSavedPreferences, readConfig } from '../src/lib/config.js';
import { ensureCaptureConsent } from '../src/lib/consent.js';
import { pollAuth } from '../src/lib/poll-auth.js';
import { wireInstalled } from '../src/lib/wire-all.js';

vi.mock('../src/lib/poll-auth.js', () => ({ pollAuth: vi.fn() }));
vi.mock('../src/lib/consent.js', () => ({ ensureCaptureConsent: vi.fn(async (config) => config) }));
vi.mock('../src/lib/wire-all.js', () => ({
  wireInstalled: vi.fn(async () => [{ id: 'codex', label: 'Codex', status: 'wired', changed: [], warnings: [] }]),
}));
vi.mock('../src/lib/auto-context.js', () => ({ writeAllInstructions: vi.fn(async () => []) }));

let dir: string;
let out: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'adrive-init-local-'));
  vi.stubEnv('XDG_CONFIG_HOME', dir);
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((out += String(chunk)), true));
  vi.mocked(pollAuth).mockResolvedValue({ api_key: 'agentdrive_live_synthetic', agent_id: 'ag_1', org_id: 'org_1' });
});

afterEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('adrive init --local', () => {
  it('wires the agent tools without signing in or saving preferences', async () => {
    await cmdInit({ local: true });
    expect(pollAuth).not.toHaveBeenCalled();
    expect(ensureCaptureConsent).not.toHaveBeenCalled();
    expect(wireInstalled).toHaveBeenCalled();
    const cfg = await readConfig();
    expect(cfg?.api_key).toBeUndefined();
    expect(cfg?.wired).toEqual(['codex']);
    expect(await hasSavedPreferences(configPath())).toBe(false);
    expect(out).toContain('Local mode');
    expect(out).toContain('adrive resume');
  });

  it('still signs in by default', async () => {
    await cmdInit({ yes: true });
    expect(pollAuth).toHaveBeenCalledOnce();
    expect((await readConfig())?.api_key).toBe('agentdrive_live_synthetic');
  });
});
