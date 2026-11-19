import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';

let apiKey: string;

beforeAll(async () => {
  const res = await SELF.fetch('http://localhost/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: 'McpBot' }),
  });
  apiKey = ((await res.json()) as { data: { api_key: string } }).data.api_key;
});

async function rpc(body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }) {
  return SELF.fetch('http://localhost/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('MCP Streamable HTTP endpoint', () => {
  it('initialize returns serverInfo + tools capability', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { serverInfo: { name: string }; capabilities: Record<string, unknown>; protocolVersion: string } };
    expect(body.result.serverInfo.name).toBe('agentdrive');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('tools/list returns all 22 tools with JSON-Schema inputs', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string; inputSchema: { type: string } }> } };
    expect(body.result.tools).toHaveLength(22);
    expect(body.result.tools.map((t) => t.name)).toContain('drive_write');
    const write = body.result.tools.find((t) => t.name === 'drive_write')!;
    expect(write.inputSchema.type).toBe('object');
  });

  // Remote MCP hosts start OAuth only on a 401, so even discovery calls need credentials.
  it('initialize and tools/list without credentials get the OAuth challenge', async () => {
    for (const method of ['initialize', 'tools/list']) {
      const res = await rpc({ jsonrpc: '2.0', id: 3, method }, {});
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
    }
  });

  it('ignores the removed ?api_key= query auth', async () => {
    const res = await SELF.fetch(`http://localhost/mcp?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });

  it('tools/list gives every tool a title and read-only/destructive hints', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    type Listed = { name: string; title?: string; annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean } };
    const { result } = (await res.json()) as { result: { tools: Listed[] } };
    for (const t of result.tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.annotations?.title, t.name).toBe(t.title);
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe('boolean');
      expect(typeof t.annotations?.openWorldHint, t.name).toBe('boolean');
      expect(typeof t.annotations?.destructiveHint, t.name).toBe('boolean');
    }
    const hints = Object.fromEntries(result.tools.map((t) => [t.name, t.annotations]));
    expect(hints.drive_read).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    for (const name of ['drive_share', 'drive_invite', 'drive_roles', 'drive_sandbox_clone', 'drive_sandbox_exec']) {
      expect(hints[name]?.openWorldHint, name).toBe(true);
    }
    expect(hints.drive_comment).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    for (const name of ['drive_write', 'drive_delete', 'drive_roles', 'drive_invite', 'drive_sandbox_exec']) {
      expect(hints[name], name).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
  });

  it('unknown tool returns invalid params', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32602);
  });

  it('notifications get 202 with no body', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
  });

  it('GET is rejected (stateless, no SSE)', async () => {
    const res = await SELF.fetch('http://localhost/mcp', { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } });
    expect(res.status).toBe(405);
  });
});
