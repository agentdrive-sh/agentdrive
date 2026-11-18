import { describe, it, expect } from 'vitest';
import { SELF, env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { WORKER_HEALTH_VERSION, MCP_SERVER_VERSION } from '../src/generated/version';
import worker from '../src/index';
import type { Env } from '../src/env';

// Phase 0 deliverable #1: /v1/health must report the real MCP server version
// resolved at build time, NEVER a hardcoded string. The drift between
// "version: '0.3.0'" inline and mcp-server@0.4.x is what this guards against.

describe('GET /v1/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await SELF.fetch('http://localhost/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
  });

  it('reports the version sourced from packages/mcp-server/package.json', async () => {
    const res = await SELF.fetch('http://localhost/v1/health');
    const body = (await res.json()) as { status: string; version: string };
    expect(body.version).toBe(WORKER_HEALTH_VERSION);
    expect(body.version).toBe(MCP_SERVER_VERSION);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('does NOT report the stale hardcoded 0.3.0 (regression pin)', async () => {
    // If this fires, someone reverted to the hardcoded literal. The /v1/health
    // version must come from the generated module so it stays in lockstep with
    // the MCP server package.
    const res = await SELF.fetch('http://localhost/v1/health');
    const body = (await res.json()) as { status: string; version: string };
    expect(body.version).not.toBe('0.3.0');
  });

  // Regression: launch OPS-02 — a healthy process must not hide unavailable storage.
  // Found by /qa on 2026-11-16.
  it.each(['KV', 'R2'] as const)('returns unavailable when %s cannot be read without exposing provider errors', async (binding) => {
    const unavailable = async () => { throw new Error('synthetic-private-provider-detail'); };
    const bindings = {
      ...env,
      [binding]: binding === 'KV' ? { get: unavailable } : { head: unavailable },
    } as Env;
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request('http://localhost/v1/health'), bindings, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ success: false, code: 'storage_unavailable', status: 'unavailable' });
    expect(body).not.toContain('synthetic-private-provider-detail');
  });
});
