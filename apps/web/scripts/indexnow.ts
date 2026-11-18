// Usage: pnpm indexnow [--dry-run] [--sitemap <url>]
// The key is the INDEXNOW_KEY Worker secret. IndexNow verifies it by fetching https://agentdrive.sh/indexnow.txt,
// so it is public by design: without INDEXNOW_KEY in the environment, the script reads it from there.

import process from 'node:process';

const HOST = 'agentdrive.sh';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sitemapAt = args.indexOf('--sitemap');
const sitemap = sitemapAt === -1 ? `https://${HOST}/sitemap.xml` : args[sitemapAt + 1];

const keyLocation = `https://${HOST}/indexnow.txt`;
const key = process.env.INDEXNOW_KEY ?? (await fetch(keyLocation).then((r) => (r.ok ? r.text() : ''))).trim();
if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
  console.error('INDEXNOW_KEY must be 8 to 128 letters, digits or dashes.');
  process.exit(1);
}

const res = await fetch(sitemap);
if (!res.ok) {
  console.error(`Fetching ${sitemap} failed: HTTP ${res.status}`);
  process.exit(1);
}
const urlList = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim())
  .filter((u) => new URL(u).host === HOST);
if (urlList.length === 0) {
  console.error(`No ${HOST} URLs in ${sitemap}`);
  process.exit(1);
}

// shortcut: one request, IndexNow caps it at 10,000 URLs; batch if the sitemap ever grows past that.
const payload = { host: HOST, key, keyLocation, urlList };

if (dryRun) {
  console.log(JSON.stringify({ ...payload, key: '<redacted>' }, null, 2));
  console.log(`Dry run: ${urlList.length} URLs, nothing submitted.`);
  process.exit(0);
}

const submit = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});
console.log(`IndexNow: HTTP ${submit.status} for ${urlList.length} URLs`);
if (!submit.ok) {
  console.error(await submit.text());
  process.exit(1);
}
