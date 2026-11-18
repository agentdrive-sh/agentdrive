import { SITE_URL as SITE } from '@/components/seo/site';
import { listPosts } from '@/lib/source';

export const dynamic = 'force-static';

export function GET() {
  const newestPost = listPosts()[0]?.data.date;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:sf="http://schema.org/schemas/schemafeed/0.1">
  <url>
    <loc>${SITE}/feeds/docs.jsonl</loc>
    <sf:contentType>structuredData/schema.org</sf:contentType>
  </url>
  <url>
    <loc>${SITE}/blog/rss.xml</loc>${newestPost ? `\n    <lastmod>${newestPost}</lastmod>` : ''}
    <sf:contentType>structuredData/rss</sf:contentType>
  </url>
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
