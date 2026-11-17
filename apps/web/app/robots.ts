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

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: APP_ROUTES },
    sitemap: 'https://agentdrive.sh/sitemap.xml',
  };
}
