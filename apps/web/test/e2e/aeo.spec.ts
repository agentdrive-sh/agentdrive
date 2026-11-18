import { expect, test } from '@playwright/test';

type Ld = { '@type'?: string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] };

const FAQ_PAGES = [
  { path: '/', item: '.m-faq > div', heading: 'h3' },
  { path: '/pricing', item: '.m-faq > div', heading: 'h3' },
  { path: '/facts', item: '.m-prose > section', heading: 'h2' },
];

for (const { path, item, heading } of FAQ_PAGES) {
  test(`${path} shows the same Q&A as its FAQPage JSON-LD, answer first`, async ({ page }) => {
    await page.goto(path);
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const ld = blocks.flatMap((b) => JSON.parse(b) as Ld | Ld[]);
    const faq = ld.find((d) => d['@type'] === 'FAQPage');
    expect(faq?.mainEntity?.length).toBeGreaterThanOrEqual(5);

    const items = page.locator(item);
    await expect(items).toHaveCount(faq!.mainEntity!.length);
    for (const [i, entity] of faq!.mainEntity!.entries()) {
      const el = items.nth(i);
      await expect(el).toBeVisible();
      await expect(el.locator(heading)).toHaveText(entity.name);
      const paragraphs = await el.locator('p').allTextContents();
      expect(paragraphs.join('\n\n')).toBe(entity.acceptedAnswer.text);
      const lead = paragraphs[0].split(/\s+/).length;
      expect(lead, `${entity.name} lead is ${lead} words`).toBeGreaterThanOrEqual(40);
      expect(lead, `${entity.name} lead is ${lead} words`).toBeLessThanOrEqual(60);
    }
  });
}

test('llms.txt links the facts, the full docs file and markdown mirrors that resolve', async ({ request }) => {
  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toMatch(/^# AgentDrive\n\n> /);
  const links = [...llms.matchAll(/\]\(https:\/\/agentdrive\.sh([^)]+\.md|\/llms[^)]*)\)/g)].map((m) => m[1]);
  expect(links).toEqual(expect.arrayContaining(['/facts/index.md', '/llms-full.txt']));
  expect(links.some((l) => l.startsWith('/blog/'))).toBe(true);
  for (const link of links) {
    const res = await request.get(link);
    expect(res.status(), link).toBe(200);
    expect(await res.text(), link).toMatch(/^# /);
  }

  const full = await (await request.get('/llms-full.txt')).text();
  expect(full).toContain('# AgentDrive facts');
  expect(full).toContain('# Quick start');
});
