import { test, expect } from '@playwright/test';
import { isAppRoute } from '../../lib/app-routes';

test('analytics runs on public pages and never on signed-in app routes', async ({ request }) => {
  for (const path of ['/dashboard', '/files/f_1', '/settings', '/api/search', '/s/abc', '/login']) expect(isAppRoute(path), path).toBe(true);
  for (const path of ['/', '/docs', '/pricing', '/blog/x', '/filesystem', '/security']) expect(isAppRoute(path), path).toBe(false);
  const privacy = await (await request.get('/legal/privacy')).text();
  expect(privacy).toContain('Google Analytics');
  expect(privacy).not.toContain('third-party tracking cookies');
});
