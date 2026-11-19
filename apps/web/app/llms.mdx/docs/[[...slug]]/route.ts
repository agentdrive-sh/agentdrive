import { source } from '@/lib/source';
import { docMarkdown } from '@/lib/docs-markdown';
import { markdownNotFound, markdownResponse } from '@/lib/llms';

export const dynamic = 'force-static';
export const revalidate = false;

export async function GET(_req: Request, props: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  return page ? markdownResponse(await docMarkdown(page)) : markdownNotFound();
}

export function generateStaticParams() {
  return source.generateParams();
}
