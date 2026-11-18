// Signed-in app surfaces from app/(app), auth and API routes, and share links.
export const APP_ROUTES = [
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

export function isAppRoute(path: string): boolean {
  return APP_ROUTES.some((route) => (route.endsWith('/') ? path.startsWith(route) : path === route || path.startsWith(`${route}/`)));
}
