import generated from '@/.generated/public-articles.json';
import { markdownNotFound, markdownResponse } from '@/lib/llms';

const articles = new Map(Object.entries(generated));

export function generateStaticParams() {
  return Array.from(articles.keys(), (path) => ({ slug: path.slice(1).split('/') }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const body = articles.get('/' + slug.join('/'));
  return body === undefined ? markdownNotFound() : markdownResponse(body);
}
