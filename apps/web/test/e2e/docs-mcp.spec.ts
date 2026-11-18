import { test, expect, type APIRequestContext } from '@playwright/test';

const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

async function rpc(request: APIRequestContext, method: string, params?: unknown) {
  const res = await request.post('/docs/mcp', { headers: HEADERS, data: { jsonrpc: '2.0', id: 1, method, params } });
  expect(res.status()).toBe(200);
  return res.json();
}

test('initialize negotiates the protocol version and the transport answers notifications, GET and preflight', async ({ request }) => {
  const init = await rpc(request, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '0' },
  });
  expect(init.result.protocolVersion).toBe('2025-06-18');
  expect(init.result.serverInfo.name).toBe('agentdrive-docs');
  expect(init.result.capabilities.tools).toBeTruthy();

  const future = await rpc(request, 'initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
  expect(future.result.protocolVersion).toBe('2025-11-25');

  const notification = await request.post('/docs/mcp', { headers: HEADERS, data: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  expect(notification.status()).toBe(202);

  expect((await request.get('/docs/mcp')).status()).toBe(405);
  const preflight = await request.fetch('/docs/mcp', { method: 'OPTIONS' });
  expect(preflight.headers()['access-control-allow-origin']).toBe('*');
  expect((await rpc(request, 'ping')).result).toEqual({});
});

test('tools/list exposes read-only search_docs and read_doc', async ({ request }) => {
  const { result } = await rpc(request, 'tools/list');
  expect(result.tools.map((t: { name: string }) => t.name)).toEqual(['search_docs', 'read_doc']);
  for (const tool of result.tools) {
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(tool.inputSchema.type).toBe('object');
  }
  expect(result.tools[0].inputSchema.required).toEqual(['query']);
});

test('search_docs finds a real page and read_doc returns its markdown with absolute links', async ({ request }) => {
  const search = await rpc(request, 'tools/call', { name: 'search_docs', arguments: { query: 'resume session' } });
  const hits: string = search.result.content[0].text;
  expect(search.result.isError).toBeUndefined();
  expect(hits).toContain('https://agentdrive.sh/docs/concepts/sessions');

  const read = await rpc(request, 'tools/call', { name: 'read_doc', arguments: { path: 'https://agentdrive.sh/docs' } });
  const markdown: string = read.result.content[0].text;
  expect(markdown).toMatch(/^# AgentDrive Docs/);
  expect(markdown).toContain('](https://agentdrive.sh/docs/quick-start)');
  expect(markdown).not.toContain('](/docs/');

  const bare = await rpc(request, 'tools/call', { name: 'read_doc', arguments: { path: 'concepts/sessions' } });
  expect(bare.result.content[0].text).toMatch(/^# Sessions/);

  const missing = await rpc(request, 'tools/call', { name: 'read_doc', arguments: { path: '/docs/does-not-exist' } });
  expect(missing.result.isError).toBe(true);
});

test('unknown tools, unknown methods and malformed JSON return JSON-RPC errors', async ({ request }) => {
  expect((await rpc(request, 'tools/call', { name: 'drive_write', arguments: {} })).error.code).toBe(-32602);
  expect((await rpc(request, 'resources/list')).error.code).toBe(-32601);

  const malformed = await request.post('/docs/mcp', { headers: HEADERS, data: Buffer.from('{"jsonrpc":"2.0",') });
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).error.code).toBe(-32700);

  const notRpc = await request.post('/docs/mcp', { headers: HEADERS, data: { id: 1, method: 'ping' } });
  expect(notRpc.status()).toBe(400);
  expect((await notRpc.json()).error.code).toBe(-32600);
});

test('server card describes the docs server at its exact address', async ({ request }) => {
  const res = await request.get('/docs/mcp/server-card');
  expect(res.status()).toBe(200);
  expect(res.headers()['access-control-allow-origin']).toBe('*');
  const card = await res.json();
  expect(card.$schema).toBe('https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json');
  expect(card.name).toBe('sh.agentdrive/docs-mcp');
  expect(card.title).toBeTruthy();
  expect(card.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(card.description.length).toBeLessThanOrEqual(100);
  expect(card.icons[0].src).toMatch(/^https:\/\/agentdrive\.sh\//);
  expect(card.remotes).toEqual([expect.objectContaining({ type: 'streamable-http', url: 'https://agentdrive.sh/docs/mcp' })]);
  expect(card.tools).toBeUndefined();
});
