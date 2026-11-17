import { describe, expect, it, vi } from 'vitest';
import { pollAuth } from '../src/lib/poll-auth.js';
import type { CliApiClient, CliAuthPoll, CliAuthStart } from '../src/lib/api-client.js';

const START: CliAuthStart = {
  auth_url: 'https://agentdrive.sh/cli-auth?id=abc',
  id: 'abc',
  user_code: 'WXYZ-2345',
  device_code: 'secret-device-code',
  expires_in: 600,
};

function fakeClient(start: CliAuthStart, polls: CliAuthPoll[]): CliApiClient {
  let i = 0;
  return {
    startCliAuth: vi.fn(async () => start),
    pollCliAuth: vi.fn(async () => {
      const next = polls[Math.min(i, polls.length - 1)];
      i += 1;
      return next!;
    }),
  } as unknown as CliApiClient;
}

describe('pollAuth', () => {
  it('returns the api key on first complete poll', async () => {
    const client = fakeClient(
      START,
      [{ status: 'complete', api_key: 'agentdrive_live_xyz', agent_id: 'ag_1', org_id: 'org_1' }],
    );
    const lines: string[] = [];
    const result = await pollAuth(client, {
      pollIntervalMs: 1,
      timeoutMs: 1000,
      openBrowser: async () => undefined,
      log: (l) => lines.push(l),
      spinner: false,
      sleep: async () => undefined,
    });
    expect(result.api_key).toBe('agentdrive_live_xyz');
    expect(result.agent_id).toBe('ag_1');
    expect(client.pollCliAuth).toHaveBeenCalledWith(START);
  });

  it('prints the code to type right under the sign-in URL, and never the device code', async () => {
    const client = fakeClient(START, [{ status: 'complete', api_key: 'k' }]);
    const lines: string[] = [];
    await pollAuth(client, { openBrowser: async () => undefined, log: (l) => lines.push(l), spinner: false, sleep: async () => undefined });
    const url = lines.findIndex((l) => l.includes('cli-auth?id=abc'));
    const code = lines.findIndex((l) => l.includes('Code: ') && l.includes('WXYZ-2345'));
    expect(url).toBeGreaterThanOrEqual(0);
    expect(code).toBeGreaterThan(url);
    expect(code - url).toBeLessThanOrEqual(2);
    expect(lines.join('\n')).not.toContain('secret-device-code');
  });

  it.each([
    [{ status: 'denied', error: 'Sign-in was cancelled after too many wrong codes were entered.' }, /too many wrong codes/],
    [{ status: 'expired' }, /expired/],
  ] as Array<[CliAuthPoll, RegExp]>)('stops polling with a clear error on %o', async (end, message) => {
    const client = fakeClient(START, [{ status: 'pending' }, end, { status: 'complete', api_key: 'never' }]);
    await expect(
      pollAuth(client, { openBrowser: async () => undefined, log: () => undefined, spinner: false, sleep: async () => undefined }),
    ).rejects.toThrow(message);
    expect(client.pollCliAuth).toHaveBeenCalledTimes(2);
  });

  it('fails instead of reporting success when the completed login carries no key', async () => {
    const client = fakeClient(
      START,
      [{ status: 'complete' } as CliAuthPoll],
    );
    const lines: string[] = [];
    await expect(
      pollAuth(client, { openBrowser: async () => undefined, log: (l) => lines.push(l), spinner: false, sleep: async () => undefined }),
    ).rejects.toThrow(/no API key/);
    expect(lines.some((l) => l.includes('Logged in'))).toBe(false);
  });

  it('stops polling on refused and surfaces the message and upgrade link', async () => {
    const client = fakeClient(
      START,
      [
        { status: 'pending' },
        { status: 'refused', error: "AgentDrive: your Free plan's agents are full (3 of 3).", upgrade_url: 'https://agentdrive.sh/billing/upgrade?plan=pro' },
        { status: 'complete', api_key: 'never' },
      ],
    );
    const lines: string[] = [];
    const err = await pollAuth(client, { openBrowser: async () => undefined, log: (l) => lines.push(l), spinner: false, sleep: async () => undefined })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('agents are full (3 of 3)');
    expect((err as Error).message).toContain('Upgrade: https://agentdrive.sh/billing/upgrade?plan=pro');
    expect(client.pollCliAuth).toHaveBeenCalledTimes(2);
    expect(lines.some((l) => l.includes('Logged in'))).toBe(false);
  });

  it('retries a poll whose connection dropped and still collects the key', async () => {
    const client = fakeClient(START, [{ status: 'complete', api_key: 'agentdrive_live_retry' }]);
    const real = client.pollCliAuth as ReturnType<typeof vi.fn>;
    const firstCall = real.getMockImplementation()!;
    real.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    });
    real.mockImplementation(firstCall);
    const result = await pollAuth(client, {
      pollIntervalMs: 1,
      timeoutMs: 1000,
      openBrowser: async () => undefined,
      log: () => undefined,
      spinner: false,
      sleep: async () => undefined,
    });
    expect(result.api_key).toBe('agentdrive_live_retry');
    expect(client.pollCliAuth).toHaveBeenCalledTimes(2);
  });

  it('keeps polling on pending then resolves on complete', async () => {
    const client = fakeClient(
      START,
      [
        { status: 'pending' },
        { status: 'pending' },
        { status: 'complete', api_key: 'agentdrive_live_done' },
      ],
    );
    const result = await pollAuth(client, {
      pollIntervalMs: 1,
      timeoutMs: 1000,
      openBrowser: async () => undefined,
      log: () => undefined,
      spinner: false,
      sleep: async () => undefined,
    });
    expect(result.api_key).toBe('agentdrive_live_done');
  });

  it('times out cleanly with a useful error', async () => {
    const client = fakeClient(
      START,
      [{ status: 'pending' }],
    );
    await expect(
      pollAuth(client, {
        pollIntervalMs: 1,
        timeoutMs: 10,
        openBrowser: async () => undefined,
        log: () => undefined,
        spinner: false,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('continues when openBrowser throws', async () => {
    const client = fakeClient(
      START,
      [{ status: 'complete', api_key: 'k' }],
    );
    const lines: string[] = [];
    const result = await pollAuth(client, {
      pollIntervalMs: 1,
      timeoutMs: 1000,
      openBrowser: async () => {
        throw new Error('no DISPLAY');
      },
      log: (l) => lines.push(l),
      spinner: false,
      sleep: async () => undefined,
    });
    expect(result.api_key).toBe('k');
    expect(lines.some((l) => l.includes('Could not auto-open browser'))).toBe(true);
  });
});
