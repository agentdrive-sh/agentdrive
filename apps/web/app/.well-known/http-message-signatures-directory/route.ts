import directory from '@/lib/web-bot-directory.json';

export const dynamic = 'force-static';

export function GET() {
  // The digest covers the exact bytes signed by the operator.
  return new Response(directory.body, { headers: directory.headers });
}
