import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdAuthLogin } from '../src/commands/auth-login.js';
import { CliApiClient } from '../src/lib/api-client.js';
import { DEFAULT_PREFERENCES, deleteConfig, readConfig, updateConfig } from '../src/lib/config.js';
import { ensureCaptureConsent } from '../src/lib/consent.js';
import { pollAuth } from '../src/lib/poll-auth.js';

vi.mock('../src/lib/poll-auth.js', () => ({ pollAuth: vi.fn() }));
vi.mock('../src/lib/consent.js', () => ({ ensureCaptureConsent: vi.fn(async (config) => config) }));

const KEY = 'agentdrive_live_synthetic_selfhost';
const URL = 'https://agentdrive-worker.synthetic.workers.dev';
let fixture: string;

function stdin(text: string): void {
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(Readable.from([text]) as unknown as typeof process.stdin);
}

beforeEach(async () => {
  fixture = await fs.mkdtemp(join(tmpdir(), 'agentdrive-auth-login-'));
  vi.stubEnv('XDG_CONFIG_HOME', fixture);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(fixture, { recursive: true, force: true });
});

describe('auth login --with-key', () => {
  it('saves a key read from stdin against a custom API URL without opening the browser', async () => {
    stdin(`${KEY}\n`);
    const whoami = vi.spyOn(CliApiClient.prototype, 'whoami').mockResolvedValue({ type: 'agent', agent_id: 'ag_synthetic', org_id: 'org_synthetic' });
    await cmdAuthLogin({ apiUrl: URL, withKey: true });
    expect(pollAuth).not.toHaveBeenCalled();
    expect(whoami).toHaveBeenCalledOnce();
    expect(await readConfig()).toMatchObject({ api_url: URL, api_key: KEY, agent_id: 'ag_synthetic', org_id: 'org_synthetic' });
  });

  it('refuses stdin that is not an API key and saves nothing', async () => {
    stdin('not-a-key\n');
    await expect(cmdAuthLogin({ apiUrl: URL, withKey: true })).rejects.toThrow(/agentdrive_live_/);
    expect(await readConfig()).toBeNull();
  });

  it('applies only what consent changed, so a privacy choice made while it waited stands', async () => {
    stdin(KEY);
    vi.spyOn(CliApiClient.prototype, 'whoami').mockResolvedValue({ type: 'agent', agent_id: 'ag_synthetic', org_id: 'org_synthetic' });
    vi.mocked(ensureCaptureConsent).mockImplementationOnce(async (config) => {
      // adrive privacy, run in another terminal while the notice and workspace prompt were up.
      await updateConfig((latest) => ({ ...latest!, preferences: { ...DEFAULT_PREFERENCES, capture_artifacts: false }, default_workspace: 'ws_private' }), { effectiveBefore: true });
      return { ...config, preferences: { ...DEFAULT_PREFERENCES, capture_transcripts: true, capture_artifacts: true }, capture_notice_at: '2026-11-19T00:00:00.000Z', default_workspace: 'ws_team' };
    });
    await cmdAuthLogin({ apiUrl: URL, withKey: true });
    expect(await readConfig()).toMatchObject({
      api_key: KEY,
      capture_notice_at: '2026-11-19T00:00:00.000Z',
      default_workspace: 'ws_private',
      preferences: { capture_transcripts: false, capture_artifacts: false },
    });
  });

  it('writes no consent into a config logged out while it waited', async () => {
    stdin(KEY);
    vi.spyOn(CliApiClient.prototype, 'whoami').mockResolvedValue({ type: 'agent', agent_id: 'ag_synthetic', org_id: 'org_synthetic' });
    vi.mocked(ensureCaptureConsent).mockImplementationOnce(async (config) => {
      await deleteConfig();
      return { ...config, preferences: { ...DEFAULT_PREFERENCES, capture_transcripts: true, capture_artifacts: true }, capture_notice_at: '2026-11-19T00:00:00.000Z' };
    });
    await cmdAuthLogin({ apiUrl: URL, withKey: true });
    expect(await readConfig()).toBeNull();
  });

  it('saves nothing when the instance rejects the key', async () => {
    stdin(KEY);
    vi.spyOn(CliApiClient.prototype, 'whoami').mockRejectedValue(new Error('Invalid API key'));
    await expect(cmdAuthLogin({ apiUrl: URL, withKey: true })).rejects.toThrow(/Invalid API key/);
    expect(await readConfig()).toBeNull();
  });
});
