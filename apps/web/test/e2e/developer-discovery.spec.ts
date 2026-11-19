import { createHash, createPublicKey, verify } from 'node:crypto';
import { expect, test } from '@playwright/test';

const site = 'https://agentdrive.sh';

test('the homepage links to the four canonical developer references and the GitHub organization', async ({ page, request }) => {
  await page.goto('/');
  const links = page.getByRole('navigation', { name: 'Developers', exact: true });
  for (const [slug, title] of Object.entries({
    'rest-api': 'AgentDrive REST API', 'mcp-tools': 'AgentDrive MCP server and tools',
    sdk: 'AgentDrive TypeScript SDK', cli: 'AgentDrive CLI (adrive)',
  })) {
    const path = `/docs/${slug}`;
    await expect(links.locator(`a[href="${path}"]`)).toBeVisible();
    const html = await (await request.get(path)).text();
    expect(html).toContain(`<title>${title}`);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${title.replace(/[()]/g, '\\$&')}<`));
    expect(html).toContain(`rel="canonical" href="${site}${path}"`);
  }
  await expect(links.getByRole('link', { name: 'AgentDrive on GitHub' })).toHaveAttribute('href', 'https://github.com/agentdrive-sh');
});

test('every advertised skill has a matching name, description and digest', async ({ request }) => {
  const base = '/.well-known/agent-skills';
  const index = await (await request.get(`${base}/index.json`)).json();
  expect(index.skills.map((s: { name: string }) => s.name)).toEqual(['agentdrive', 'agentdrive-session-handoff', 'agentdrive-artifact-search']);
  for (const skill of index.skills) {
    expect(skill.url).toBe(`${site}${base}/${skill.name}/SKILL.md`);
    const response = await request.get(new URL(skill.url).pathname);
    expect(response.headers()['content-type']).toContain('text/markdown');
    const bytes = await response.body();
    expect(bytes.toString()).toContain(`\nname: ${skill.name}\n`);
    expect(bytes.toString()).toContain(`\ndescription: ${skill.description}\n`);
    expect(skill.digest).toBe('sha256:' + createHash('sha256').update(bytes).digest('hex'));
  }
  expect((await request.get(`${base}/missing/SKILL.md`)).status()).toBe(404);
});

test('the A2A card leads to a public docs search and reports invalid calls', async ({ request }) => {
  const card = await (await request.get('/.well-known/agent-card.json')).json();
  expect(card).toMatchObject({ protocolVersion: '0.3.0', preferredTransport: 'JSONRPC', url: site + '/a2a', skills: [{ id: 'search-docs' }] });
  const path = new URL(card.url).pathname;
  const rpc = async (method: string, params: unknown) =>
    (await request.post(path, { data: { jsonrpc: '2.0', id: 'q', method, params } })).json();
  const message = { kind: 'message', role: 'user', messageId: 'client-1', contextId: 'docs', parts: [{ kind: 'text', text: 'resume session' }] };
  expect(await rpc('message/send', { message })).toMatchObject({
    id: 'q', result: { kind: 'message', role: 'agent', contextId: 'docs', messageId: expect.any(String), parts: [{ kind: 'text', text: expect.stringContaining(site + '/docs/concepts/sessions') }] },
  });
  expect((await rpc('message/send', {})).error.code).toBe(-32602);
  expect((await rpc('message/send', { message, configuration: { acceptedOutputModes: ['image/png'] } })).error.code).toBe(-32005);
  expect((await rpc('message/send', { message: { ...message, taskId: 'absent' } })).error.code).toBe(-32001);
  expect((await rpc('message/stream', { message })).error.code).toBe(-32004);
  expect((await rpc('tools/list', {})).error.code).toBe(-32601);
});

test('the Web Bot Auth directory is signed by every published Ed25519 key for the apex authority', async ({ request }) => {
  const response = await request.get('/.well-known/http-message-signatures-directory');
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers['content-type']).toBe('application/http-message-signatures-directory+json');
  const body = await response.body();
  const digest = `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;
  expect(headers['content-digest']).toBe(digest);
  const { keys } = JSON.parse(body.toString());
  expect(keys.length).toBeGreaterThan(0);
  for (const [i, key] of keys.entries()) {
    const { crv, kty, x, kid, nbf, exp } = key;
    expect(key).toEqual({ crv: 'Ed25519', kty: 'OKP', x, kid, nbf, exp });
    expect(kid).toBe(createHash('sha256').update(JSON.stringify({ crv, kty, x })).digest('base64url'));
    const now = Date.now() / 1000;
    expect(nbf).toBeLessThanOrEqual(now);
    expect(exp).toBeGreaterThan(now);
    const label = `sig${i + 1}`;
    const input = headers['signature-input']!.split(', ').find(s => s.startsWith(label + '='))!.slice(label.length + 1);
    expect(input).toBe(`("@authority";req "content-digest");alg="ed25519";keyid="${kid}";tag="http-message-signatures-directory";created=${nbf};expires=${exp}`);
    const sig = headers.signature!.split(', ').find(s => s.startsWith(label + '=:'))!.slice(label.length + 2, -1);
    const base = `"@authority";req: agentdrive.sh\n"content-digest": ${digest}\n"@signature-params": ${input}`;
    expect(verify(null, Buffer.from(base), createPublicKey({ key, format: 'jwk' }), Buffer.from(sig, 'base64'))).toBe(true);
  }
});
