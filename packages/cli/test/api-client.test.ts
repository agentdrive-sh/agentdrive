import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, CliApiClient } from '../src/lib/api-client.js';

describe('CliApiClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as unknown as ReturnType<typeof vi.spyOn>;
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function mockResponse(body: unknown, ok = true, status = 200) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as Promise<Response>;
  }

  it('stamps platform and role headers on every request', async () => {
    fetchSpy.mockReturnValue(mockResponse({ success: true, data: [] }));
    const client = new CliApiClient({
      baseUrl: 'https://app.agentdrive.sh',
      apiKey: 'agentdrive_live_test',
      agentPlatform: 'cli',
      agentRole: 'pusher',
    });
    await client.listWorkspaces();
    const call = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Agent-Platform']).toBe('cli');
    expect(headers['X-Agent-Role']).toBe('pusher');
    expect(headers['Authorization']).toBe('Bearer agentdrive_live_test');
  });

  it('omits Authorization for unauthenticated endpoints', async () => {
    fetchSpy.mockReturnValue(
      mockResponse({ success: true, data: { auth_url: 'x', id: 'y', expires_in: 600 } }),
    );
    const client = new CliApiClient({ baseUrl: 'https://app.agentdrive.sh' });
    await client.startCliAuth();
    const init = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('starts sign-in saying it shows the user code, and polls with the device code in the body', async () => {
    fetchSpy.mockImplementation(() => mockResponse({ success: true, data: { status: 'pending' } }));
    const client = new CliApiClient({ baseUrl: 'https://app.agentdrive.sh' });
    await client.startCliAuth();
    await client.pollCliAuth({ id: 'cli_1', device_code: 'dc', auth_url: 'u', user_code: 'ABCD-EFGH', expires_in: 600 });
    const calls = (fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[0]![0]).toBe('https://app.agentdrive.sh/v1/auth/cli/start');
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ shows_user_code: true });
    expect(calls[1]![0]).toBe('https://app.agentdrive.sh/v1/auth/cli/poll');
    expect(calls[1]![1].method).toBe('POST');
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ id: 'cli_1', device_code: 'dc' });
  });

  it('throws ApiError with status on a non-OK response', async () => {
    fetchSpy.mockReturnValue(mockResponse({ success: false, error: 'nope' }, false, 401));
    const client = new CliApiClient({ baseUrl: 'https://app.agentdrive.sh', apiKey: 'k' });
    await expect(client.listWorkspaces()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });
  });

  it('whoami falls back to /v1/org on 404', async () => {
    fetchSpy
      .mockReturnValueOnce(mockResponse({ success: false, error: 'not found' }, false, 404))
      .mockReturnValueOnce(mockResponse({ success: true, data: { id: 'org_1', name: 'acme' } }));
    const client = new CliApiClient({ baseUrl: 'https://app.agentdrive.sh', apiKey: 'k' });
    const out = await client.whoami();
    expect(out).toEqual({ id: 'org_1', name: 'acme' });
  });

  it('does not read a different artifact when only a path-prefix match exists', async () => {
    fetchSpy.mockImplementation(() => mockResponse({ success: true, data: [{ id: 'f_backup', path: 'launch.md.backup' }], cursor: null }));
    const client = new CliApiClient({ baseUrl: 'https://synthetic.invalid', apiKey: 'synthetic' });
    await expect(client.readFileByPath('ws_1', 'launch.md')).rejects.toMatchObject({ status: 404 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  describe('on 429', () => {
    const limited = () =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false, code: 'rate_limited', error: 'slow down' }), {
          status: 429,
          headers: { 'Retry-After': '10' },
        }),
      ) as unknown as Promise<Response>;
    const client = () => new CliApiClient({ baseUrl: 'https://app.agentdrive.sh', apiKey: 'k' });

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('waits out Retry-After and retries exactly once', async () => {
      fetchSpy.mockImplementationOnce(limited).mockImplementationOnce(() => mockResponse({ success: true, data: { id: 'r_1' } }));
      const pending = client().getRun('r_1');
      await vi.advanceTimersByTimeAsync(9_999);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ id: 'r_1' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('rejects with rate_limited when the retry is limited too', async () => {
      fetchSpy.mockImplementation(limited);
      const pending = client().getRun('r_1');
      const outcome = expect(pending).rejects.toMatchObject({
        name: 'ApiError',
        status: 429,
        code: 'rate_limited',
        message: 'AgentDrive is rate limiting this key; try again in 10 seconds.',
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await outcome;
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('rejects at once when Retry-After does not fit the request timeout', async () => {
      fetchSpy.mockImplementation(limited);
      await expect(client().listRuns({ project: 'p', timeoutMs: 1500 })).rejects.toMatchObject({ code: 'rate_limited' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('exposes ApiError as an Error subclass', () => {
    const err = new ApiError('boom', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(500);
  });
});

describe('CliApiClient per-request timeout', () => {
  it('bounds each request, not the Retry-After wait, so a long Retry-After still retries', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return calls === 1
        ? new Response(JSON.stringify({ success: false, error: 'slow down' }), { status: 429, headers: { 'retry-after': '1' } })
        : new Response(JSON.stringify({ success: true, data: { id: 'f1', path: 'a.md', version: 1, updated_at: '' } }), { status: 200 });
    });
    try {
      const client = new CliApiClient({ baseUrl: 'https://example.invalid', apiKey: 'agentdrive_live_test' });
      await expect(client.writeFile('ws_1', 'a.md', 'x', undefined, undefined, 200)).resolves.toMatchObject({ id: 'f1' });
      expect(calls).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
