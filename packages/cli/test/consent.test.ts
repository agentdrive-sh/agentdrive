import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCaptureConsent } from '../src/lib/consent.js';
import { DEFAULT_PREFERENCES, type CliConfig } from '../src/lib/config.js';

const now = () => new Date('2026-10-21T12:00:00.000Z');
const base: CliConfig = { api_url: 'https://app.agentdrive.sh', api_key: 'agentdrive_live_x', preferences: DEFAULT_PREFERENCES };

function client(workspaces: Array<{ id: string; name: string }>) {
  return {
    listWorkspaces: vi.fn(async () => workspaces.map((w) => ({ ...w, created_at: '' }))),
    createWorkspace: vi.fn(async (name: string) => ({ id: 'ws_new', name, created_at: '' })),
  };
}

let stdout: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  stdout.mockRestore();
});

function printed(): string {
  return (stdout as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join('');
}

describe('ensureCaptureConsent', () => {
  it('shows the notice once, turns capture on, and records when', async () => {
    const out = await ensureCaptureConsent(base, client([{ id: 'ws_1', name: 'Only' }]), { interactive: false, preferencesSaved: false, now });
    expect(out.preferences).toEqual({ ...DEFAULT_PREFERENCES, capture_transcripts: true, capture_artifacts: true });
    expect(out.capture_notice_at).toBe('2026-10-21T12:00:00.000Z');
    expect(out.default_workspace).toBe('ws_1');
    expect(printed()).toMatch(/adrive privacy/);
    expect(printed()).toMatch(/redacted on this device/);
  });

  it('never flips capture back on after the notice was shown', async () => {
    const optedOut: CliConfig = {
      ...base,
      default_workspace: 'ws_1',
      capture_notice_at: '2026-01-01T00:00:00.000Z',
      preferences: { ...DEFAULT_PREFERENCES, capture_transcripts: false, capture_artifacts: false },
    };
    const c = client([]);
    const out = await ensureCaptureConsent(optedOut, c, { interactive: false, preferencesSaved: false, now });
    expect(out).toEqual(optedOut);
    expect(printed()).toBe('');
    expect(c.listWorkspaces).not.toHaveBeenCalled();
  });

  it('leaves saved preferences alone when the notice is first shown to an existing install', async () => {
    const saved: CliConfig = {
      ...base,
      default_workspace: 'ws_1',
      preferences: { ...DEFAULT_PREFERENCES, capture_transcripts: false, capture_artifacts: false },
    };
    const out = await ensureCaptureConsent(saved, client([]), { interactive: false, preferencesSaved: true, now });
    expect(out.preferences).toEqual(saved.preferences);
    expect(out.capture_notice_at).toBe('2026-10-21T12:00:00.000Z');
    expect(printed()).toMatch(/session sync is off/);
    expect(printed()).toMatch(/Turn it on: .*adrive privacy/);
  });

  it('creates a Personal workspace when there are none', async () => {
    const c = client([]);
    const out = await ensureCaptureConsent(base, c, { interactive: false, preferencesSaved: false, now });
    expect(c.createWorkspace).toHaveBeenCalledWith('Personal');
    expect(out.default_workspace).toBe('ws_new');
  });

  it('picks the first of several workspaces non-interactively and says so', async () => {
    const out = await ensureCaptureConsent(
      base,
      client([{ id: 'ws_a', name: 'A' }, { id: 'ws_b', name: 'B' }]),
      { interactive: false, preferencesSaved: false, now },
    );
    expect(out.default_workspace).toBe('ws_a');
    expect(printed()).toMatch(/Using .*A.* \(ws_a\) as your default workspace/);
  });

  it('keeps going without a default workspace when the API call fails', async () => {
    const c = client([]);
    c.listWorkspaces.mockRejectedValueOnce(new Error('offline'));
    const out = await ensureCaptureConsent(base, c, { interactive: false, preferencesSaved: false, now });
    expect(out.default_workspace).toBeUndefined();
    expect(out.capture_notice_at).toBeDefined();
    expect(printed()).toMatch(/offline/);
  });
});
