import { it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdSearch } from '../src/commands/search.js';
import { ApiClient } from '../../mcp-server/src/api-client.js';
import { TOOLS } from '../../mcp-server/src/registry.js';

it('CLI search and MCP search/recall preserve semantic scores and label keyword fallback over REST', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adrive-keyword-contract-'));
  const requests: Array<{ method?: string; path?: string; query?: string; authorized: boolean }> = [];
  // A real REST response passes through each native API client and public handler.
  // The server is owned and loopback-only; no fetch or formatter is mocked.
  const hits = [
    { path: 'semantic.md', ws_id: 'ws_owned', content_hash: 'sha-semantic', score: 0.84, match_kind: 'semantic', snippet: 'Semantic fixture', agent_id: 'ag_owned', agent_platform: 'codex', created_at: 1_794_845_100_000 },
    { path: 'keyword.md', ws_id: 'ws_owned', content_hash: 'sha-keyword', score: null, match_kind: 'keyword', snippet: 'Keyword fallback fixture', agent_id: 'ag_owned', agent_platform: 'codex', created_at: 1_794_845_100_000 },
  ];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const authorized = req.headers.authorization === 'Bearer owned-contract-fixture';
    requests.push({ method: req.method, path: req.url, query: body.query, authorized });
    res.writeHead(req.method === 'POST' && req.url === '/v1/search' && authorized ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { hits, total: hits.length } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind a port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  vi.stubEnv('XDG_CONFIG_HOME', root);
  await mkdir(join(root, 'agentdrive'));
  await writeFile(join(root, 'agentdrive', 'config.json'), JSON.stringify({ api_url: baseUrl, api_key: 'owned-contract-fixture', default_workspace: 'ws_owned' }));
  const results: Array<{ name: string; output: string; error?: string }> = [];
  let cliOutput = '';
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { cliOutput += String(chunk); return true; });
  try {
    try { await cmdSearch('fallback contract'); results.push({ name: 'CLI search', output: cliOutput }); }
    catch (error) { results.push({ name: 'CLI search', output: cliOutput, error: String(error) }); }
    stdout.mockRestore();
    const client = new ApiClient({ baseUrl, apiKey: 'owned-contract-fixture' });
    for (const name of ['drive_search', 'drive_recall']) {
      try {
        const result = await TOOLS.find((tool) => tool.name === name)!.handler(client, { query: 'fallback contract' });
        results.push({ name, output: result.content.map((part) => 'text' in part ? part.text : '').join('\n') });
      } catch (error) { results.push({ name, output: '', error: String(error) }); }
    }
    for (const result of results) {
      expect.soft(result.error, result.name).toBeUndefined();
      expect.soft(result.output, result.name).toContain('semantic.md');
      expect.soft(result.output, result.name).toContain('score=0.84');
      expect.soft(result.output, result.name).toContain('keyword.md');
      expect.soft(result.output, result.name).toContain('score=keyword');
      expect.soft(result.output, result.name).not.toMatch(/score=(?:0\.00|null|NaN)/);
    }
    expect(requests).toEqual(Array.from({ length: 3 }, () => ({ method: 'POST', path: '/v1/search', query: 'fallback contract', authorized: true })));
  } finally {
    stdout.mockRestore();
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
