import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('error bodies', () => {
  it('give an error with no route code the status default', async () => {
    const unauth = await SELF.fetch('http://localhost/v1/workspaces');
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ success: false, code: 'unauthorized', error: 'Authentication required' });

    const missing = await SELF.fetch('http://localhost/v1/nope');
    expect(await missing.json()).toEqual({ success: false, code: 'not_found', error: 'Not found' });

    const invalid = await SELF.fetch('http://localhost/v1/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ success: false, code: 'invalid_request' });
  });

  it('keep the code a route sets', async () => {
    const res = await SELF.fetch('http://localhost/v1/auth/cli/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'cli_outdated' });
  });
});
