import { test, expect, type Page } from '@playwright/test';

async function jsonLdTypes(page: Page) {
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  return scripts
    .flatMap((s) => [JSON.parse(s)].flat())
    .flatMap((d) => d['@graph'] ?? [d])
    .map((d) => d['@type']);
}

test('site JSON-LD is on every page, and a marketing page has its own canonical, og url and og image', async ({ page }) => {
  await page.goto('/security');
  expect(await jsonLdTypes(page)).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'SoftwareApplication']));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://agentdrive.sh/security');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Security');
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://agentdrive.sh/security');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/opengraph-image/);
});

test('a blog post has BlogPosting and breadcrumbs pointing at its own Open Graph image', async ({ page, request }) => {
  await page.goto('/blog/start-in-claude-code-pick-up-in-codex');
  expect(await jsonLdTypes(page)).toEqual(expect.arrayContaining(['BlogPosting', 'BreadcrumbList']));
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(og).toContain('/blog/start-in-claude-code-pick-up-in-codex/opengraph-image');
  const image = await request.get('/blog/start-in-claude-code-pick-up-in-codex/opengraph-image');
  expect(image.headers()['content-type']).toBe('image/png');
});

test('a docs page has TechArticle, breadcrumbs and a canonical URL', async ({ page }) => {
  await page.goto('/docs/quick-start');
  expect(await jsonLdTypes(page)).toEqual(expect.arrayContaining(['TechArticle', 'BreadcrumbList']));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://agentdrive.sh/docs/quick-start');
});

test('robots.txt lets AI crawlers read the public site but not the signed-in app', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  const group = robots.split('\n\n').find((g) => g.includes('User-Agent: ClaudeBot'));
  expect(group).toContain('User-Agent: GPTBot');
  expect(group).toContain('Allow: /');
  expect(group).toContain('Disallow: /dashboard');
  for (const g of robots.split('\n\n').filter((g) => g.includes('User-Agent:'))) {
    expect(g).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes');
  }
});
