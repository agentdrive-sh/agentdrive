import { test, expect, type APIRequestContext } from '@playwright/test';

const SITE = 'https://agentdrive.sh';
const MARKDOWN = /^text\/markdown/;

async function markdown(request: APIRequestContext, path: string, headers: Record<string, string> = {}) {
  const res = await request.get(path, { headers });
  return { status: res.status(), type: res.headers()['content-type'] ?? '', body: await res.text() };
}

test('docs pages have .md twins with frontmatter, the llms.txt directive and absolute links', async ({ request }) => {
  for (const path of ['/docs/quick-start.md', '/docs/concepts/sessions.md', '/docs.md', '/docs/index.md']) {
    const md = await markdown(request, path);
    expect(md.status, path).toBe(200);
    expect(md.type, path).toMatch(MARKDOWN);
    expect(md.body, path).toMatch(/^---\ntitle: ".+"\n(description: ".+"\n)?canonical: "https:\/\/agentdrive\.sh\/docs[^"]*"\n(last-updated: "\d{4}-\d\d-\d\dT[^"]+"\n)?---\n\n# /);
    expect(md.body, path).toContain(`[llms.txt](${SITE}/llms.txt)`);
    expect(md.body, path).not.toContain('](/');
  }
});

test('markdown clients and AI fetchers get markdown, browsers keep HTML', async ({ request }) => {
  const accept = { accept: 'text/markdown' };
  expect((await markdown(request, '/docs/concepts/sessions', accept)).body).toMatch(/^---\ntitle: "Sessions"/);
  expect((await markdown(request, '/', accept)).body).toContain('# AgentDrive');
  expect((await markdown(request, '/pricing', accept)).body).toContain('# AgentDrive pricing');
  for (const ua of ['ClaudeBot/1.0', 'Mozilla/5.0 (compatible; GPTBot/1.2)', 'Perplexity-User/1.0']) {
    expect((await markdown(request, '/docs', { 'user-agent': ua })).type, ua).toMatch(MARKDOWN);
  }
  const html = await markdown(request, '/docs', { 'user-agent': 'Mozilla/5.0 Chrome/150' });
  expect(html.type).toMatch(/^text\/html/);
  const mcp = await request.get('/docs/mcp', { headers: accept });
  expect(mcp.headers()['content-type'] ?? '').not.toMatch(MARKDOWN);
});

test('unknown paths answer markdown clients with a markdown 404', async ({ request }) => {
  for (const path of ['/__agent-404-probe', '/docs/no-such-page.md', '/docs/no-such-page', '/integrations/no-such-page.md', '/resume/no-such-pair.md']) {
    const md = await markdown(request, path, { accept: 'text/markdown' });
    expect(md.status, path).toBe(404);
    expect(md.type, path).toMatch(MARKDOWN);
    expect(md.body, path).toContain(`${SITE}/llms.txt`);
  }
  const html = await request.get('/__agent-404-probe');
  expect(html.status()).toBe(404);
  expect(html.headers()['content-type']).toMatch(/^text\/html/);
});

test('llms.txt links markdown twins and covers every sitemap page', async ({ request }) => {
  const llms = await (await request.get('/llms.txt')).text();
  const linked = new Set([...llms.matchAll(/\]\((https:\/\/agentdrive\.sh[^)]*)\)/g)].map((m) => m[1]!.replace(/(\/index)?\.md$/, '')));
  const links = [...llms.matchAll(/\]\((https:\/\/agentdrive\.sh[^)]*)\)/g)].map((m) => new URL(m[1]!).pathname);
  for (const path of links) expect(path).toMatch(/\.md$|\/llms(?:-full)?\.txt$/);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const missing = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!).filter((u) => !linked.has(u));
  expect(missing).toEqual([]);

  const docsIndex = await request.get('/docs/llms.txt');
  expect(docsIndex.status()).toBe(200);
  expect(await docsIndex.text()).toMatch(/^# AgentDrive Docs\n/);

  const full = await (await request.get('/llms-full.txt')).text();
  for (const title of ['Quick start', 'AgentDrive REST API', 'AgentDrive CLI (adrive)']) expect(full).toContain(`# ${title}\n`);
});

test('pricing.md lists every plan with its price', async ({ request }) => {
  const md = await markdown(request, '/pricing.md');
  expect(md.type).toMatch(MARKDOWN);
  for (const plan of ['## Free: $0', '## Pro: $20', '## Team: $30', '## Enterprise: Custom']) expect(md.body).toContain(plan);
});

test('pages advertise canonical and markdown alternates, the llms.txt directive and Organization JSON-LD', async ({ request }) => {
  const docs = await (await request.get('/docs/rest-api')).text();
  expect(docs).toContain(`<link rel="canonical" href="${SITE}/docs/rest-api"/>`);
  expect(docs).toContain(`<link rel="alternate" type="text/markdown" href="${SITE}/docs/rest-api.md"/>`);
  const home = await (await request.get('/')).text();
  expect(home).toContain(`<link rel="canonical" href="${SITE}"/>`);
  expect(home).toContain(`<link rel="alternate" type="text/markdown" href="${SITE}/index.md"/>`);
  expect(home).toMatch(/<div class="m-sr" aria-hidden="true">For AI agents:[^<]*<a href="https:\/\/agentdrive\.sh\/llms\.txt" tabindex="-1">/);
  const ld = [...home.matchAll(/<script type="application\/ld\+json">(.+?)<\/script>/g)]
    .flatMap((m) => [JSON.parse(m[1]!)].flat())
    .flatMap((d: Record<string, unknown>) => (d['@graph'] as Record<string, unknown>[] | undefined) ?? [d]);
  const org = ld.find((n) => n['@type'] === 'Organization')!;
  expect(org.contactPoint).toEqual(expect.arrayContaining([expect.objectContaining({ contactType: 'customer support', email: 'hello@agentdrive.sh' })]));
  expect(org.sameAs).toContain('https://github.com/agentdrive-sh');
});

test('trust pages carry real text without JavaScript', async ({ request }) => {
  for (const path of ['/about', '/contact']) {
    const html = await (await request.get(path)).text();
    const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text.length, path).toBeGreaterThan(500);
  }
});

test('discovery catalogs carry branding, linkset items and trust manifests', async ({ request }) => {
  const card = await (await request.get('/.well-known/mcp/server-card.json')).json();
  expect(card).toMatchObject({ name: 'sh.agentdrive/mcp', title: 'AgentDrive', remotes: [{ type: 'streamable-http', url: 'https://mcp.agentdrive.sh/mcp' }] });
  expect(card.icons[0].src).toBe(`${SITE}/apple-icon`);
  expect(card.description.length).toBeLessThanOrEqual(100);
  expect(card.tools.length).toBeGreaterThan(0);
  for (const tool of card.tools) expect(tool).toMatchObject({ name: expect.stringMatching(/^drive_/), title: expect.any(String), inputSchema: { type: 'object' } });

  const catalog = await request.get('/.well-known/api-catalog');
  expect(catalog.headers()['content-type']).toContain('application/linkset+json');
  const { linkset } = await catalog.json();
  expect(linkset[0]).toEqual({ anchor: `${SITE}/.well-known/api-catalog`, item: expect.arrayContaining([{ href: 'https://app.agentdrive.sh/v1' }]) });

  const ai = await (await request.get('/.well-known/ai-catalog.json')).json();
  for (const entry of ai.entries) {
    expect(entry.trustManifests, entry.identifier).toEqual([
      { contributor: 'did:web:agentdrive.sh', provenance: [expect.objectContaining({ relation: 'publishedFrom' })] },
    ]);
  }
  const spec = await request.get('/openapi.json');
  expect(spec.status()).toBe(200);
  expect((await spec.json()).openapi).toBe('3.1.0');
});

test('WebMCP registers read-only tools that read docs and pricing through the markdown routes', async ({ page }) => {
  await page.addInitScript(() => {
    const tools: { name: string; annotations?: { readOnlyHint?: boolean }; execute: (input: unknown) => Promise<{ content: { text: string }[] }> }[] = [];
    Object.assign(window, { __tools: tools });
    Object.defineProperty(document, 'modelContext', { value: { registerTool: (t: (typeof tools)[number]) => tools.push(t) } });
  });
  await page.goto('/docs');
  const result = await page.evaluate(async () => {
    const tools = (window as unknown as { __tools: { name: string; annotations?: { readOnlyHint?: boolean }; execute: (i: unknown) => Promise<{ content: { text: string }[] }> }[] }).__tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return {
      names: tools.map((t) => t.name),
      readOnly: tools.every((t) => t.annotations?.readOnlyHint === true),
      doc: (await byName.read_doc!.execute({ path: '/docs/quick-start' })).content[0]!.text,
      pricing: (await byName.get_pricing!.execute({})).content[0]!.text,
    };
  });
  expect(result.names).toEqual(['search_docs', 'get_install_command', 'read_doc', 'get_pricing']);
  expect(result.readOnly).toBe(true);
  expect(result.doc).toContain('# Quick start');
  expect(result.pricing).toContain('# AgentDrive pricing');
});

test('blog, glossary, compare and facts pages have .md twins, and the blog has its own llms.txt', async ({ request }) => {
  const llms = await (await request.get('/llms.txt')).text();
  const post = llms.match(/\]\(https:\/\/agentdrive\.sh(\/blog\/[^)/]+)\/index\.md\)/)![1]!;
  const term = llms.match(/\]\(https:\/\/agentdrive\.sh(\/glossary\/[^)/]+)\/index\.md\)/)![1]!;
  const compare = llms.match(/\]\(https:\/\/agentdrive\.sh(\/compare\/[^)/.]+)\.md\)/)![1]!;
  for (const path of ['/blog.md', `${post}.md`, '/glossary.md', `${term}.md`, '/compare.md', `${compare}.md`, '/facts.md']) {
    const md = await markdown(request, path);
    expect(md.status, path).toBe(200);
    expect(md.type, path).toMatch(MARKDOWN);
    expect(md.body, path).toMatch(/^---\ntitle: ".+"\n[\s\S]*?\n---\n\n?# .+\n\n> For the complete documentation index, see \[llms\.txt\]\(https:\/\/agentdrive\.sh\/llms\.txt\)/);
    expect(md.body, path).not.toContain('](/');
  }
  expect((await markdown(request, compare, { accept: 'text/markdown' })).body).toMatch(/\n# AgentDrive vs /);
  const matrix = (await markdown(request, '/compare.md')).body;
  expect(matrix).toMatch(/\| Tool \| Works across agents \|/);
  expect(matrix).toContain('## Detailed comparisons');
  expect(matrix).toContain('Details for other tools come from their own docs and announcements');
  const facts = (await markdown(request, '/facts.md')).body;
  expect(facts).toContain('The canonical facts about AgentDrive');
  expect(facts).toMatch(/As of [A-Z][a-z]+ \d{1,2}, \d{4}\./);
  const blogIndex = await request.get('/blog/llms.txt');
  expect(blogIndex.status()).toBe(200);
  expect(await blogIndex.text()).toMatch(/^# AgentDrive blog\n\n> .+\n\n## Posts\n\n- \[/);
  expect(llms).toContain('(https://agentdrive.sh/blog/llms.txt)');
});

test('public article representations share their content, links and negotiation headers', async ({ request }) => {
  for (const [path, excerpt] of [
    ['/integrations/codex', 'adrive resume --list'],
    ['/resume/claude-code-to-codex', 'What carries over'],
    ['/resume/cursor-to-claude-code', 'Frequently asked questions'],
    ['/legal/dpa', 'International transfers'],
    ['/resume', 'Resume across agents'],
  ]) {
    const html = await request.get(path, { headers: { accept: 'text/html' } });
    const negotiated = await request.get(path, { headers: { accept: 'text/markdown' } });
    const md = await markdown(request, path + '.md');
    expect(md.status, path).toBe(200);
    expect(md.type, path).toMatch(MARKDOWN);
    expect(md.body, path).toContain(excerpt);
    expect(md.body, path).toContain(`canonical: "${SITE}${path}"`);
    expect(md.body, path).toContain(`[llms.txt](${SITE}/llms.txt)`);
    expect(md.body, path).not.toContain('](/');
    expect(await negotiated.text(), path).toBe(md.body);
    expect(negotiated.headers()['content-type']).toMatch(MARKDOWN);
    expect(html.headers()['content-type']).toContain('text/html');
    expect(html.headers().vary.toLowerCase().split(/,\s*/)).toEqual(expect.arrayContaining([
      'rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch',
    ]));
    expect(await html.text()).toContain(`type="text/markdown" href="${SITE}${path}.md"`);
    for (const res of [html, negotiated]) {
      expect(res.headers().vary.toLowerCase().split(/,\s*/)).toEqual(expect.arrayContaining(['accept', 'user-agent']));
    }
  }
});

test('Filesystem MCP compares the same rows in its accessible table and Markdown', async ({ request }) => {
  const html = await (await request.get('/compare/filesystem-mcp')).text();
  expect(html).toMatch(/class="m-compare-mobile" data-markdown-ignore/);
  expect(html).toMatch(/class="m-actions m-actions-end" data-markdown-ignore/);
  const md = await markdown(request, '/compare/filesystem-mcp.md');
  expect(md.body).toContain('| Unit of storage | Sessions and files, versioned, with provenance | Files on your local disk |');
  expect(md.body).toContain('## Frequently asked questions');
});

test('REST reference introduces the downloadable schema before its first section', async ({ request }) => {
  const md = await markdown(request, '/docs/rest-api.md');
  expect(md.body.split('## Authentication')[0]).toContain(`[OpenAPI 3.1 specification](${SITE}/openapi.json)`);
});
