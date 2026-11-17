// Owned local API fixture for the real Next.js UI. It never forwards requests.
// Provider acceptance is verified separately against the Worker, not by this fixture.
import { createServer } from 'node:http';

const now = new Date().toISOString();
const comments = [];
let healthState = 'healthy';
const files = (workspace) => Array.from({ length: workspace === 'ws_beta' ? 1 : 51 }, (_, i) => ({
  id: workspace === 'ws_beta' ? 'f_beta' : `f_${i + 1}`,
  path: workspace === 'ws_beta' ? 'beta-plan.md' : `artifact-${String(i + 1).padStart(2, '0')}.md`,
  version: 51, size: 120, updated_at: now, content_hash: `hash-${i + 1}`, agent_platform: 'codex',
}));
function reply(res, data, status = 200, cursor = null) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://localhost:3101', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Session-Token,X-Agent-Platform,X-Agent-Role', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Vary': 'Origin' });
  res.end(JSON.stringify(status < 400 ? { success: true, data, cursor } : { success: false, error: data }));
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8791');
  if (req.method === 'OPTIONS') return reply(res, {});
  if (url.pathname === '/health') return reply(res, {});
  if (url.pathname === '/__fixture/health' && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const state = JSON.parse(raw).state;
    if (!['healthy', 'unavailable'].includes(state)) return reply(res, 'Invalid health fixture state', 400);
    healthState = state;
    return reply(res, { state });
  }
  if (url.pathname === '/v1/health') {
    const healthy = healthState === 'healthy';
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ status: healthy ? 'ok' : 'unavailable', version: '1.2.5', checks: { kv: healthy ? 'ok' : 'unavailable', r2: 'ok' } }));
  }
  if (url.pathname === '/v1/auth/providers') return reply(res, { email: true, google: false, github: false });
  if (!['sess_launch_fixture', 'sess_outage_fixture', 'sess_removed_fixture', 'sess_billing_outage_fixture', 'sess_revoked_fixture'].includes(req.headers['x-session-token'])) return reply(res, 'Invalid or expired session', 401);
  if (url.pathname === '/v1/auth/me' && req.headers['x-session-token'] === 'sess_removed_fixture') return reply(res, { type: 'session', email: 'launch@example.invalid', org: null });
  if (url.pathname === '/v1/auth/me') return reply(res, { email: 'launch@example.invalid', org_id: 'org_fixture', org: { id: 'org_fixture', name: 'Launch fixture' } });
  if (url.pathname === '/v1/auth/cli/complete' && req.method === 'POST') {
    // Revoked after the page loaded: /v1/auth/me still answered, the complete call does not.
    if (req.headers['x-session-token'] === 'sess_revoked_fixture') return reply(res, 'Invalid or expired session', 401);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const { id, user_code: code } = JSON.parse(raw);
    if (id !== 'cli_fixture') return reply(res, 'This sign-in has expired or was already used.', 404);
    if (String(code).replace(/[^A-Z0-9]/gi, '').toUpperCase() !== 'WXYZ2345') return reply(res, 'That code does not match the one in your terminal. 4 tries left.', 400);
    return reply(res, { status: 'complete' });
  }
  if (req.headers['x-session-token'] === 'sess_outage_fixture') return reply(res, 'Fixture service unavailable', 503);
  if (url.pathname === '/v1/workspaces') return reply(res, [{ id: 'ws_alpha', name: 'Alpha project', created_at: now }, { id: 'ws_beta', name: 'Beta project', created_at: now }]);
  if (url.pathname === '/v1/org') return reply(res, { id: 'org_fixture', name: 'Launch fixture', plan: 'pro', agents: [], members: [], invites: [], usage: {}, quota: {}, created_at: now });
  if (req.method === 'POST' && ['/v1/search', '/v1/context'].includes(url.pathname)) {
    const hits = [
      { path: 'artifact-01.md', content_hash: 'identical-copy-hash', score: 0.84, match_kind: 'semantic', created_at: Date.now() - 120_000 },
      { path: 'artifact-02.md', content_hash: 'identical-copy-hash', score: 0.62, match_kind: 'semantic', created_at: Date.now() - 60_000 },
      { path: 'artifact-51.md', content_hash: 'hash-51', score: null, match_kind: 'keyword', created_at: Date.now() },
    ].map((hit) => ({ ...hit, ws_id: 'ws_alpha', agent_id: 'ag_fixture', agent_platform: 'codex', snippet: 'Owned fixture retrieval result' }));
    return reply(res, url.pathname === '/v1/search' ? { hits, total: hits.length } : { artifacts: hits, retrieved_at: Date.now() });
  }
  if (url.pathname === '/v1/org/invites') return reply(res, []);
  if (url.pathname === '/v1/billing/invoices') return reply(res, []);
  if (url.pathname === '/v1/billing/plan') {
    if (req.headers['x-session-token'] === 'sess_billing_outage_fixture') return reply(res, 'Billing service unavailable', 503);
    return reply(res, { plan: 'pro', usage: {}, quota: {}, status: { level: 'ok', upgrade_url: '/billing' } });
  }
  if (url.pathname === '/v1/runs' || url.pathname.endsWith('/activity')) return reply(res, []);
  const list = url.pathname.match(/^\/v1\/workspaces\/(ws_alpha|ws_beta)\/files$/);
  if (list) return reply(res, files(list[1]).slice(url.searchParams.has('cursor') ? 50 : 0, url.searchParams.has('cursor') ? 100 : 50), 200, list[1] === 'ws_alpha' && !url.searchParams.has('cursor') ? 'page2' : null);
  const detail = url.pathname.match(/^\/v1\/workspaces\/(ws_alpha|ws_beta)\/files\/([^/]+)(?:\/(comments|versions|runs))?$/);
  if (detail) {
    const [, workspace, id, child] = detail;
    const file = files(workspace).find((f) => f.id === id);
    if (!file) return reply(res, 'File not found', 404);
    if (child === 'comments') {
      if (req.method === 'POST') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw).body;
        if (body === 'reject this comment') return reply(res, 'Comment rejected by fixture', 503);
        const comment = { id: `comment_${comments.length + 1}`, file_id: id, workspace_id: workspace, body, author_email: 'launch@example.invalid', created_at: now };
        comments.push(comment); return reply(res, comment, 201);
      }
      return reply(res, comments.filter((comment) => comment.file_id === id && comment.workspace_id === workspace));
    }
    if (child === 'versions') return reply(res, [{ version: url.searchParams.has('cursor') ? 51 : 1, content_hash: 'fixture-hash', author_platform: url.searchParams.has('cursor') ? 'codex' : 'claude-code', created_at: now }], 200, url.searchParams.has('cursor') ? null : 'later');
    if (child === 'runs') return reply(res, []);
    return reply(res, { ...file, content: '# Verified launch fixture\nThis is real UI content from the isolated test API.' });
  }
  return reply(res, 'Fixture route not found', 404);
}).listen(8791, '127.0.0.1');
