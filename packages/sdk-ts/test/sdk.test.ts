import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentDrive, ApiError, listAllPages } from '../src/index.js';

// Hermetic fetch mock — the SDK only knows the network, so test by intercepting fetch.

interface MockCall {
  url: string;
  init: RequestInit;
}

function installFetch(handler: (call: MockCall) => Response | Promise<Response>): { calls: MockCall[] } {
  const calls: MockCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const call: MockCall = { url, init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return {
    calls,
    [Symbol.dispose]() {
      globalThis.fetch = original;
    },
  } as { calls: MockCall[] } & Disposable;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AgentDrive — construction', () => {
  it('throws if apiKey is missing', () => {
    expect(() => new AgentDrive({ apiKey: '' })).toThrow(/apiKey is required/);
  });

  it('defaults baseUrl to https://app.agentdrive.sh', async () => {
    const drive = new AgentDrive({ apiKey: 'agentdrive_live_test' });
    const original = globalThis.fetch;
    let capturedUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return jsonResponse({ success: true, data: [] });
    }) as typeof fetch;
    try {
      await drive.listWorkspacesPage();
    } finally {
      globalThis.fetch = original;
    }
    expect(capturedUrl).toBe('https://app.agentdrive.sh/v1/workspaces');
  });

  it('strips trailing slash from custom baseUrl', async () => {
    const drive = new AgentDrive({ apiKey: 'k', baseUrl: 'http://localhost:8787/' });
    const original = globalThis.fetch;
    let capturedUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return jsonResponse({ success: true, data: [] });
    }) as typeof fetch;
    try {
      await drive.listWorkspacesPage();
    } finally {
      globalThis.fetch = original;
    }
    expect(capturedUrl).toBe('http://localhost:8787/v1/workspaces');
  });
});

describe('AgentDrive — identity headers', () => {
  it('stamps X-Agent-Platform and X-Agent-Role on every request', async () => {
    const drive = new AgentDrive({
      apiKey: 'agentdrive_live_test',
      agentPlatform: 'codex',
      agentRole: 'planner',
    });
    const original = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResponse({ success: true, data: { hits: [], total: 0 } });
    }) as typeof fetch;
    try {
      await drive.search({ query: 'hello' });
    } finally {
      globalThis.fetch = original;
    }
    expect(capturedHeaders['X-Agent-Platform']).toBe('codex');
    expect(capturedHeaders['X-Agent-Role']).toBe('planner');
    expect(capturedHeaders['Authorization']).toBe('Bearer agentdrive_live_test');
  });

  it('defaults agentPlatform to "sdk-ts" when not provided', async () => {
    const drive = new AgentDrive({ apiKey: 'k' });
    const original = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResponse({ success: true, data: { hits: [], total: 0 } });
    }) as typeof fetch;
    try {
      await drive.search({ query: 'q' });
    } finally {
      globalThis.fetch = original;
    }
    expect(capturedHeaders['X-Agent-Platform']).toBe('sdk-ts');
  });
});

describe('AgentDrive — error envelope', () => {
  it('throws ApiError with status code when server returns success: false', async () => {
    const drive = new AgentDrive({ apiKey: 'k' });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false, error: 'workspace not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      await expect(drive.readFile('ws_x', 'fid_y')).rejects.toMatchObject({
        name: 'ApiError',
        status: 404,
        message: 'workspace not found',
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws ApiError on invalid JSON', async () => {
    const drive = new AgentDrive({ apiKey: 'k' });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('not json', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })) as typeof fetch;
    try {
      const err = await drive.readFile('ws_x', 'fid_y').catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('AgentDrive — tool surface contract', () => {
  it('search posts to /v1/search', async () => {
    const drive = new AgentDrive({ apiKey: 'k', baseUrl: 'http://x' });
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? 'GET';
      capturedBody = String(init?.body ?? '');
      return jsonResponse({ success: true, data: { hits: [], total: 0 } });
    }) as typeof fetch;
    try {
      await drive.search({ query: 'hello', top_k: 5 });
    } finally {
      globalThis.fetch = original;
    }
    expect(capturedUrl).toBe('http://x/v1/search');
    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody)).toEqual({ query: 'hello', top_k: 5 });
  });

  it('context posts to /v1/context', async () => {
    const drive = new AgentDrive({ apiKey: 'k', baseUrl: 'http://x' });
    let capturedUrl = '';
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return jsonResponse({ success: true, data: { artifacts: [], retrieved_at: 0 } });
    }) as typeof fetch;
    try {
      await drive.context({ task: 'do x' });
    } finally {
      globalThis.fetch = original;
    }
    expect(capturedUrl).toBe('http://x/v1/context');
  });

  it('logRun posts to /v1/runs', async () => {
    const drive = new AgentDrive({ apiKey: 'k', baseUrl: 'http://x' });
    let capturedUrl = '';
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return jsonResponse({ success: true, data: { run_id: 'run_1', created_at: 1 } });
    }) as typeof fetch;
    try {
      await drive.logRun({ task: 't', status: 'success' });
    } finally {
      globalThis.fetch = original;
    }
    expect(capturedUrl).toBe('http://x/v1/runs');
  });

  it('writeFile posts content to the workspace files endpoint', async () => {
    const drive = new AgentDrive({ apiKey: 'k', baseUrl: 'http://x' });
    let capturedUrl = '';
    let capturedBody = '';
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? '');
      return jsonResponse({
        success: true,
        data: { id: 'fid', workspace_id: 'ws', path: 'p', version: 1, created_at: 't', updated_at: 't' },
      });
    }) as typeof fetch;
    try {
      await drive.writeFile('ws_a', 'foo.md', 'hello', 'first commit');
    } finally {
      globalThis.fetch = original;
    }
    expect(capturedUrl).toBe('http://x/v1/workspaces/ws_a/files');
    expect(JSON.parse(capturedBody)).toEqual({ path: 'foo.md', content: 'hello', message: 'first commit' });
  });
});

describe('listAllPages helper', () => {
  it('walks pages until cursor is null', async () => {
    let call = 0;
    const fetchPage = async (cursor: string | null) => {
      call += 1;
      if (call === 1) return { items: ['a', 'b'], cursor: 'c1' };
      if (call === 2) return { items: ['c'], cursor: 'c2' };
      return { items: ['d'], cursor: null };
    };
    const all = await listAllPages(fetchPage, 10);
    expect(all).toEqual(['a', 'b', 'c', 'd']);
    expect(call).toBe(3);
  });

  it('stops at maxPages cap', async () => {
    let call = 0;
    const fetchPage = async () => {
      call += 1;
      return { items: [call], cursor: `c${call}` };
    };
    const all = await listAllPages(fetchPage, 3);
    expect(call).toBe(3);
    expect(all).toEqual([1, 2, 3]);
  });
});
