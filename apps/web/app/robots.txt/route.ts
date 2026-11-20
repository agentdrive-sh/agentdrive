import { SITE_URL as SITE } from '@/components/seo/site';
import { APP_ROUTES } from '@/lib/app-routes';

export const dynamic = 'force-static';

// A crawler named in its own group ignores the * group, so this group repeats the app-route disallow list.
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bingbot',
];

// Content Signals (contentsignals.org): the public pages may be indexed, used to answer, and used for training.
const CONTENT_SIGNAL = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes';

const group = (agents: string[]) => [
  ...agents.map((a) => `User-Agent: ${a}`),
  CONTENT_SIGNAL,
  'Allow: /',
  ...APP_ROUTES.map((path) => `Disallow: ${path}`),
  '',
];

// A route handler, not app/robots.ts, because MetadataRoute.Robots cannot emit the schemamap directive.
export function GET() {
  const body = [
    ...group(['*']),
    ...group(AI_CRAWLERS),
    `Sitemap: ${SITE}/sitemap.xml`,
    `schemamap: ${SITE}/schemamap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
}
