import { describe, it, expect } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import type { Env } from '../src/env';

const prod = { ...(env as unknown as Env), WORKERS_DEV_SUBDOMAIN: 'comfyfw' };

async function call(origin: string, method: 'OPTIONS' | 'GET', overrides: Partial<Env> = {}): Promise<Response> {
  const headers: Record<string, string> = { Origin: origin };
  if (method === 'OPTIONS') headers['Access-Control-Request-Method'] = 'PATCH';
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request('http://localhost/v1/org', { method, headers }), { ...prod, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('CORS', () => {
  it('lets the website send PATCH, which renaming the org uses', async () => {
    const res = await call('http://localhost:3001', 'OPTIONS');
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
  });

  const allowed = [
    'http://localhost:3001',
    'https://app.agentdrive.sh',
    'https://agentdrive.sh',
    'https://agentdrive-web.comfyfw.workers.dev',
    'https://3f2a9c1e-agentdrive-web.comfyfw.workers.dev',
    'https://staging-agentdrive-web.comfyfw.workers.dev',
    'https://abc123.agentdrive-frontend.pages.dev',
  ];
  for (const origin of allowed) {
    it(`allows ${origin} with credentials`, async () => {
      for (const method of ['OPTIONS', 'GET'] as const) {
        const res = await call(origin, method);
        expect(res.headers.get('access-control-allow-origin')).toBe(origin);
        expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      }
    });
  }

  const rejected = [
    'https://evil.workers.dev',
    'https://x.evil.comfyfw.workers.dev.attacker.com',
    'https://x.evil.comfyfw.workers.dev',
    'https://comfyfw.workers.dev',
    'http://agentdrive-web.comfyfw.workers.dev',
    'https://agentdrive-web.comfyfw.workers.dev:8443',
    'https://agentdrive-web.comfyfwx.workers.dev',
    'https://other-project.comfyfw.workers.dev',
    'https://agentdrive-worker.comfyfw.workers.dev',
    'https://agentdrive-webx.comfyfw.workers.dev',
    'https://pr-12-agentdrive-web.comfyfw.workers.dev',
    'https://-agentdrive-web.comfyfw.workers.dev',
    'https://x.agentdrive-web.comfyfw.workers.dev',
    'null',
  ];
  for (const origin of rejected) {
    it(`rejects ${origin} and sends it no credentials`, async () => {
      for (const method of ['OPTIONS', 'GET'] as const) {
        const res = await call(origin, method);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
      }
    });
  }

  it('allows no workers.dev origin when WORKERS_DEV_SUBDOMAIN is unset', async () => {
    const res = await call('https://agentdrive-web.comfyfw.workers.dev', 'GET', { WORKERS_DEV_SUBDOMAIN: undefined });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('allows the configured SITE_URL and APP_URL origins', async () => {
    const selfHost = { SITE_URL: 'https://drive.example.com/', APP_URL: 'https://api.example.com' };
    for (const origin of ['https://drive.example.com', 'https://api.example.com']) {
      const res = await call(origin, 'GET', selfHost);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    }
  });

  it('on a self-hosted instance allows only its own workers.dev URL, not our web app', async () => {
    const own = 'https://agentdrive.synthetic.workers.dev';
    const selfHost = { SITE_URL: own, APP_URL: own, SELF_HOSTED: 'true', WORKERS_DEV_SUBDOMAIN: undefined };
    expect((await call(own, 'GET', selfHost)).headers.get('access-control-allow-credentials')).toBe('true');
    for (const origin of ['https://agentdrive-web.comfyfw.workers.dev', 'https://agentdrive-web.synthetic.workers.dev']) {
      const res = await call(origin, 'GET', selfHost);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    }
  });
});
