import { test, expect } from '@playwright/test';

// NLWeb v0.55 /ask and Schema Feeds discovery, the surfaces the orank NLWeb checks probe.

const DOCS_URL = /^https:\/\/agentdrive\.sh\/docs(\/|$)/;

function parseSse(body: string) {
  return body
    .trim()
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return { event, data: JSON.parse(data ?? 'null') };
    });
}

test('POST /ask answers with real docs pages as schema.org items', async ({ request }) => {
  const res = await request.post('/ask', { data: { query: { text: 'resume a session' }, meta: { version: '0.55' } } });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/json');
  const body = await res.json();
  expect(body._meta).toEqual({ response_type: 'answer', response_format: 'conversational_search', version: '0.55' });
  expect(body.results.length).toBeGreaterThan(0);
  for (const item of body.results) {
    expect(item['@context']).toBe('https://schema.org');
    expect(item['@type']).toBe('TechArticle');
    expect(item.url).toMatch(DOCS_URL);
    expect(item.name).toBeTruthy();
    expect(typeof item.description).toBe('string');
  }
  expect(body.results.map((r: { url: string }) => r.url)).toContain('https://agentdrive.sh/docs/concepts/sessions');
});

test('GET /ask takes the query from the query string', async ({ request }) => {
  for (const qs of ['query=resume%20session', 'query.text=resume%20session']) {
    const res = await request.get(`/ask?${qs}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body._meta.response_type).toBe('answer');
    expect(body.results[0].url).toMatch(DOCS_URL);
  }
});

test('prefer.streaming streams start, results, complete over SSE', async ({ request }) => {
  const res = await request.post('/ask', { data: { query: { text: 'resume session' }, prefer: { streaming: true } } });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/event-stream');
  const events = parseSse(await res.text());
  expect(events[0]).toEqual({
    event: 'start',
    data: { _meta: { response_type: 'answer', response_format: 'conversational_search', version: '0.55', streaming: true } },
  });
  const results = events.slice(1, -1);
  expect(results.length).toBeGreaterThan(0);
  results.forEach((e, i) => {
    expect(e.event).toBe('result');
    expect(e.data.index).toBe(i);
    expect(e.data.item.url).toMatch(DOCS_URL);
  });
  expect(events.at(-1)?.event).toBe('complete');
  expect(events.at(-1)?.data._meta).toMatchObject({ response_type: 'answer', version: '0.55' });

  const viaGet = await request.get('/ask?query=resume&prefer.streaming=true');
  expect(viaGet.headers()['content-type']).toContain('text/event-stream');
  expect(parseSse(await viaGet.text()).map((e) => e.event)).toContain('result');
});

test('malformed requests get the failure shape with 400, no matches get NO_RESULTS', async ({ request }) => {
  const missing = await request.post('/ask', { data: { query: {} } });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toMatchObject({
    _meta: { response_type: 'failure', version: '0.55' },
    error: { code: 'INVALID_QUERY' },
  });

  const badJson = await request.post('/ask', { data: 'not json', headers: { 'Content-Type': 'application/json' } });
  expect(badJson.status()).toBe(400);
  expect((await badJson.json()).error.code).toBe('INVALID_QUERY');

  const none = await request.post('/ask', { data: { query: { text: 'zzzxqqvvj' } } });
  expect(none.status()).toBe(200);
  expect(await none.json()).toMatchObject({ _meta: { response_type: 'failure' }, error: { code: 'NO_RESULTS' } });

  const noneStreamed = await request.post('/ask', { data: { query: { text: 'zzzxqqvvj' }, prefer: { streaming: true } } });
  const events = parseSse(await noneStreamed.text());
  expect(events.map((e) => e.event)).toEqual(['start', 'error', 'complete']);
  expect(events[1].data.error.code).toBe('NO_RESULTS');
});

test('robots.txt advertises the schema map next to the sitemap', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain('Sitemap: https://agentdrive.sh/sitemap.xml\n');
  expect(text).toContain('Disallow: /api/\n');
  expect(text).toMatch(/^schemamap: https:\/\/agentdrive\.sh\/schemamap\.xml$/m);
});

test('schema map lists feeds that parse and describe real pages', async ({ request }) => {
  const map = await request.get('/schemamap.xml');
  expect(map.status()).toBe(200);
  const xml = await map.text();
  expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  expect(xml).toContain('xmlns:sf="http://schema.org/schemas/schemafeed/0.1"');
  const entries = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<sf:contentType>([^<]+)<\/sf:contentType>/g)].map(
    (m) => ({ loc: m[1], type: m[2] }),
  );
  expect(entries).toEqual([
    { loc: 'https://agentdrive.sh/feeds/docs.jsonl', type: 'structuredData/schema.org' },
    { loc: 'https://agentdrive.sh/blog/rss.xml', type: 'structuredData/rss' },
  ]);

  const feed = await request.get('/feeds/docs.jsonl');
  expect(feed.headers()['content-type']).toContain('application/x-jsonlines');
  const lines = (await feed.text()).split('\n');
  expect(lines.pop()).toBe('');
  const items = lines.map((line) => JSON.parse(line));
  const [org, app, ...docs] = items;
  expect(org).toMatchObject({ '@context': 'https://schema.org', '@type': 'Organization', url: 'https://agentdrive.sh' });
  expect(app).toMatchObject({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', url: 'https://agentdrive.sh' });
  expect(docs.length).toBeGreaterThan(5);
  for (const item of docs) {
    expect(item).toMatchObject({ '@context': 'https://schema.org', '@type': 'TechArticle' });
    expect(item['@id']).toBe(`${item.url}#article`);
    expect(item.url).toMatch(DOCS_URL);
  }

  const rss = await request.get('/blog/rss.xml');
  expect(rss.headers()['content-type']).toContain('application/rss+xml');
  expect(await rss.text()).toContain('<rss version="2.0"');
});
