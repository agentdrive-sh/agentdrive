import { listPosts } from '@/lib/source';

export const dynamic = 'force-static';

const SITE = 'https://agentdrive.sh';

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function GET() {
  const items = listPosts()
    .map((post) => {
      const link = `${SITE}${post.url}`;
      return [
        '    <item>',
        `      <title>${escapeXml(post.data.title)}</title>`,
        `      <link>${link}</link>`,
        `      <guid isPermaLink="true">${link}</guid>`,
        `      <pubDate>${new Date(`${post.data.date}T00:00:00Z`).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(post.data.description ?? '')}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AgentDrive Blog</title>
    <link>${SITE}/blog</link>
    <atom:link href="${SITE}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>Session continuity, provenance and portable storage for coding agents.</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
