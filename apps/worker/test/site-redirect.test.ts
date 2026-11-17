import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('site redirect', () => {
  it('keeps the query string when sending app.agentdrive.sh paths to the site', async () => {
    const res = await SELF.fetch('http://localhost/billing?cli=1', { redirect: 'manual' });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://agentdrive.sh/billing?cli=1');
  });

  // agentdrive.sh/auth/* is routed to this worker, so redirecting the site's own
  // host back to itself loops forever (this broke OAuth sign-in in every browser).
  it('answers 404 instead of redirecting the site host to itself', async () => {
    const res = await SELF.fetch('https://agentdrive.sh/auth/callback', { redirect: 'manual' });
    expect(res.status).toBe(404);
  });
});
