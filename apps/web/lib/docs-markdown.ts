import type { InferPageType } from 'fumadocs-core/source';
import { SITE_URL as SITE } from '@/components/seo/site';
import { absoluteLinks, frontmatter, link, LLMS_DIRECTIVE, markdownPath } from './llms';
import { source } from '@/lib/source';

type DocPage = InferPageType<typeof source>;

export function docLinks(): string[] {
  return source.getPages().map((p) => link(p.data.title, markdownPath(p.url), p.data.description));
}

export async function docMarkdown(page: DocPage): Promise<string> {
  const body = absoluteLinks(await page.data.getText('processed'));
  return `${frontmatter({
    title: page.data.title,
    description: page.data.description,
    canonical: `${SITE}${page.url}`,
    'last-updated': page.data.lastModified?.toISOString(),
  })}
# ${page.data.title}

${LLMS_DIRECTIVE}

${body}`;
}
