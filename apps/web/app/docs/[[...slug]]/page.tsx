import { getBreadcrumbItems } from 'fumadocs-core/breadcrumb';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbList, techArticle } from '@/components/seo/site';
import { markdownPath } from '@/lib/llms';
import { source } from '@/lib/source';
import { DocsPage, DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import type { Metadata } from 'next';

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  // A folder without an index page has no URL, and Google rejects a breadcrumb item without one.
  const sections = getBreadcrumbItems(page.url, source.pageTree).filter(
    (item): item is { name: string; url: string } => typeof item.name === 'string' && !!item.url && item.url !== '/docs',
  );

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <JsonLd
        data={[
          techArticle(page),
          breadcrumbList([
            { name: 'Home', path: '/' },
            { name: 'Docs', path: '/docs' },
            ...sections.map((item) => ({ name: item.name, path: item.url })),
            ...(page.url === '/docs' ? [] : [{ name: page.data.title, path: page.url }]),
          ]),
        ]}
      />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url, types: { 'text/markdown': markdownPath(page.url) } },
    openGraph: {
      type: 'article',
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      siteName: 'AgentDrive',
      modifiedTime: page.data.lastModified?.toISOString(),
      // A page-level openGraph drops the root opengraph-image file, so name it again.
      images: '/opengraph-image',
    },
  };
}
