import { markdownNotFound } from '@/lib/llms';

export function GET() {
  return markdownNotFound();
}
