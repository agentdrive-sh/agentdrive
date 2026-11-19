import { createFromSource } from 'fumadocs-core/search/server';
import { SITE_URL as SITE } from '@/components/seo/site';
import { source } from '@/lib/source';

export const docsSearch = createFromSource(source);

export async function searchDocs(query: string, limit = 8): Promise<string> {
  const hits = await docsSearch.search(query);
  const pages = new Map<string, { title: string; url: string; description?: string; match?: string }>();
  for (const hit of hits) {
    const [path] = hit.url.split('#');
    let entry = pages.get(path);
    if (!entry) {
      const page = pages.size < limit ? pageAt(path) : undefined;
      if (!page) continue;
      entry = { title: page.data.title, url: `${SITE}${page.url}`, description: page.data.description };
      pages.set(path, entry);
    }
    if (!entry.match && hit.type !== 'page') entry.match = `${hit.content} (${SITE}${hit.url})`;
  }
  if (pages.size === 0) return `No AgentDrive docs pages match "${query}".`;
  return [...pages.values()]
    .map((p, i) =>
      [`${i + 1}. ${p.title}`, `   ${p.url}`, p.description && `   ${p.description}`, p.match && `   Match: ${p.match}`]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

export function pageAt(path: string) {
  if (path !== '/docs' && !path.startsWith('/docs/')) return undefined;
  return source.getPage(path.split('/').slice(2).filter(Boolean).map(decodeURIComponent));
}
