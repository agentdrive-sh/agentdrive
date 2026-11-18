import type { MetadataRoute } from 'next';

// Signed-in app surfaces from app/(app), auth and API routes, and share links.
const APP_ROUTES = [
  '/agents',
  '/billing',
  '/buckets',
  '/dashboard',
  '/files',
  '/keys',
  '/memory',
  '/onboarding',
  '/runs',
  '/settings',
  '/shares',
  '/team',
  '/api/',
  '/signin/',
  '/cli-auth',
  '/login',
  '/s/',
];

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

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: APP_ROUTES },
      { userAgent: AI_CRAWLERS, allow: '/', disallow: APP_ROUTES },
    ],
    sitemap: 'https://agentdrive.sh/sitemap.xml',
  };
}
