import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../env.js';

const ALLOWED_ORIGINS = [
  'https://app.agentdrive.sh',
  'https://agentdrive.sh',
  'https://agentdrive-frontend.pages.dev',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:8787',
];

// Any Cloudflare account can serve a *.workers.dev host, and ours serves unrelated projects too,
// so only the web app's worker counts: agentdrive-web itself and its <version or alias>- previews.
function webAppWorkersDev(origin: string, subdomain: string | undefined): boolean {
  return !!subdomain && /^https:\/\/(?:[a-z0-9]+-)?agentdrive-web\.(.+)\.workers\.dev$/.exec(origin)?.[1] === subdomain;
}

function allowedOrigin(origin: string, env: Env): boolean {
  return (
    ALLOWED_ORIGINS.includes(origin) ||
    origin === new URL(env.SITE_URL).origin ||
    origin === new URL(env.APP_URL).origin ||
    // CF Pages preview deployments for the legacy Vite SPA.
    origin.endsWith('.agentdrive-frontend.pages.dev') ||
    webAppWorkersDev(origin, env.WORKERS_DEV_SUBDOMAIN)
  );
}

const honoCors = cors({
  origin: (origin, c) => (allowedOrigin(origin, c.env as Env) ? origin : null),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-Share-Token',
    'X-Session-Token',
    'X-Agent-Platform',
    'X-Agent-Role',
  ],
  maxAge: 86400,
});

// Hono's own credentials option sends Allow-Credentials to every origin.
export const corsMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (allowedOrigin(c.req.header('origin') ?? '', c.env)) c.res.headers.set('Access-Control-Allow-Credentials', 'true');
  return honoCors(c, next);
});
