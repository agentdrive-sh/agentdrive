import { Hono } from 'hono';
import type { Env } from '../env.js';
import { INSTALL_SCRIPT, INSTALL_SCRIPT_SHA256 } from '../generated/install-script.js';

const app = new Hono<{ Bindings: Env }>();

function serveScript() {
  return new Response(INSTALL_SCRIPT, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(new TextEncoder().encode(INSTALL_SCRIPT).length),
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'X-Install-Script-Sha256': INSTALL_SCRIPT_SHA256,
    },
  });
}

app.get('/install', (_c) => serveScript());
app.get('/install.sh', (_c) => serveScript());

export default app;
