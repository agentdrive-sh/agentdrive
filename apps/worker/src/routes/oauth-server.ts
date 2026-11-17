import { Hono } from 'hono';
import {
  AuthorizationError,
  CimdFetchError,
  GrantType,
  OAuthAuthorizationServer,
  OAuthError,
  OAuthResourceServer,
  authorizationErrorRedirect,
  insufficientScope,
  type AuthRequest,
  type ConsentDescription,
  type GrantSummary,
  type OAuthHelpers,
  type OAuthResourceContext,
  type OAuthResourceTokenValidation,
} from '@cloudflare/workers-oauth-provider';
import { hashApiKey, hashContent } from '@agentdrive/shared';
import type { Env, SessionAuth } from '../env.js';
import { sessionAuth } from '../middleware/auth.js';
import { StorageService } from '../services/storage.js';
import { REGISTRATION_CLOSED, selfHosted } from '../lib/self-hosted.js';
import { mintAgentKey } from './cli-auth.js';
import mcpRoutes from './mcp.js';

// OAuth 2.1 for the hosted MCP. The issuer is the site origin (SITE_URL), because RFC 8414
// ties AS metadata to the origin serving it and the person consenting is identified by the
// site's adrive_session cookie. Two protected resources share one handler: MCP_URL (what
// users configure) and the bare site origin, served at <site>/mcp.
//
// A grant's props carry an API key minted at consent: /mcp reaches REST through SELF with
// it, so OAuth adds no new trusted path into flexAuth, and revoking that key in /v1/keys
// disconnects the client.

// mintedAt (ms) dates the key, for KEY_PROPAGATION_GRACE_MS.
type McpProps = { apiKey: string; mintedAt?: number };

const SCOPES = ['mcp'];
const MCP_PATH = '/mcp';
const SESSION_COOKIE = 'adrive_session';
// No form-action: Chrome applies it to the cross-origin redirect after the consent POST.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";

interface Surface {
  issuerHost: string;
  mcpHost: string;
  as: OAuthAuthorizationServer<Env>;
  mcpResource: OAuthResourceServer<Env, McpProps>;
  siteResource: OAuthResourceServer<Env, McpProps>;
}

let surface: Surface | undefined;

// KV is eventually consistent: a key minted at the consenting person's location can read as
// missing (and that miss be negatively cached) where the client redeems the code and calls
// /mcp, for a minute or more. Until this long after minting, a missing key counts as
// propagating rather than revoked.
const KEY_PROPAGATION_GRACE_MS = 5 * 60 * 1000;
// A key no live grant holds is swept only once this old: past the 600s code lifetime plus
// propagation, so neither an overlapping consent's new key nor one whose grant listUserGrants
// doesn't show yet is taken for abandoned.
const ORPHAN_SWEEP_GRACE_MS = 15 * 60 * 1000;

const keyExists = async (kv: KVNamespace, apiKey: string) =>
  (await kv.get(`api_key:${await hashApiKey(apiKey)}`)) !== null;

const keyHeld = async (kv: KVNamespace, props: McpProps) =>
  (props.mintedAt !== undefined && Date.now() - props.mintedAt < KEY_PROPAGATION_GRACE_MS) || keyExists(kv, props.apiKey);

function build(env: Env): Surface {
  const issuer = env.SITE_URL.replace(/\/+$/, '');
  const as = new OAuthAuthorizationServer<Env>({
    issuer,
    resources: [env.MCP_URL, issuer],
    defaultResource: env.MCP_URL,
    authorizeEndpoint: '/auth/authorize',
    tokenEndpoint: '/auth/token',
    clientRegistrationEndpoint: '/auth/register',
    scopesSupported: SCOPES,
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600,
    refreshTokenTTL: 30 * 24 * 60 * 60,
    refreshTokenIdleTTL: 30 * 24 * 60 * 60,
    // Once the key is revoked the grant is dead: invalid_grant (which also revokes the grant)
    // sends the client back through consent instead of refreshing into tokens /mcp refuses.
    // Only on refresh: the first code exchange follows the mint by seconds, from elsewhere.
    tokenExchangeCallback: async ({ grantType, props, env }) => {
      if (grantType === GrantType.REFRESH_TOKEN && !(await keyHeld(env.KV, props as McpProps))) {
        throw new OAuthError('invalid_grant', { description: 'This connection was revoked; connect again' });
      }
    },
  });

  // A raw API key is still accepted. An OAuth token counts only while the key in its
  // props exists, so revoking that key ends the grant. Anything thrown here is a 503.
  const validateToken = (env: Env) => async (resource: string, token: string): Promise<OAuthResourceTokenValidation<McpProps> | null> => {
    if (token.startsWith('agentdrive_')) {
      return (await keyExists(env.KV, token)) ? { props: { apiKey: token }, audience: resource, scope: SCOPES } : null;
    }
    const validated = await as.validateToken<McpProps>(resource, token, env);
    return validated && (await keyHeld(env.KV, validated.props)) ? validated : null;
  };

  const mcpApp = new Hono<{ Bindings: Env }>().route(MCP_PATH, mcpRoutes);
  const handler = {
    fetch(request: Request, env: Env, ctx: OAuthResourceContext<McpProps>) {
      if (!ctx.auth.scope.includes('mcp')) return insufficientScope(ctx.auth, SCOPES);
      return mcpApp.fetch(request, env, ctx);
    },
  };
  const resourceServer = (resource: string) =>
    new OAuthResourceServer<Env, McpProps>({
      resourceMetadata: { resource, authorization_servers: [issuer], bearer_methods_supported: ['header'], resource_name: 'AgentDrive' },
      requiredScopes: SCOPES,
      validateToken,
      handler,
    });

  return {
    issuerHost: new URL(issuer).host,
    mcpHost: new URL(env.MCP_URL).host,
    as,
    mcpResource: resourceServer(env.MCP_URL),
    siteResource: resourceServer(issuer),
  };
}

// Matched by host and path before the Hono app, so its CORS middleware can't answer
// OAuth preflights and its catch-all can't swallow these routes.
export function handleOAuthSurface(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> | undefined {
  const s = (surface ??= build(env));
  const { host, pathname } = new URL(req.url);
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  // The resource server answers its own metadata and 404s the rest of the namespace, so no
  // host hands out (or redirects to) another resource's metadata.
  const isResource = under(MCP_PATH) || under('/.well-known/oauth-protected-resource');
  if (host === s.issuerHost) {
    if (pathname === '/.well-known/oauth-authorization-server' || pathname === '/auth/token' || pathname === '/auth/register') {
      return s.as.fetch(req, env, ctx);
    }
    if (pathname === '/auth/authorize') return authorize(req, env, ctx, s.as.getOAuthApi(env));
    // The bare-origin resource covers every path, so it gets only /mcp and its metadata.
    if (isResource) return s.siteResource.fetch(req, env, ctx);
  }
  if (host === s.mcpHost && isResource) return s.mcpResource.fetch(req, env, ctx);
  return undefined;
}

async function authorize(req: Request, env: Env, ctx: ExecutionContext, oauth: OAuthHelpers): Promise<Response> {
  try {
    if (req.method === 'GET') return await showConsent(req, env, ctx, oauth);
    if (req.method === 'POST') return await decide(req, env, ctx, oauth);
    return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (err) {
    // Only parseAuthRequest attaches redirectTo, after validating the client's exact redirect URI.
    if (err instanceof AuthorizationError && err.redirectTo) return redirect(err.redirectTo);
    if (err instanceof AuthorizationError) return page(400, 'Could not connect', [err.description]);
    if (err instanceof CimdFetchError) return page(400, 'Could not connect', ['This app could not be verified.']);
    throw err;
  }
}

async function showConsent(req: Request, env: Env, ctx: ExecutionContext, oauth: OAuthHelpers): Promise<Response> {
  const request = await oauth.parseAuthRequest(req);
  // The library requires PKCE only of public clients; every client must use it here.
  if (!request.codeChallenge) return redirect(authorizationErrorRedirect(request, 'invalid_request', 'PKCE (S256) is required'));

  const { cookie, session } = await signedIn(req, env, ctx);
  if (!session) {
    const url = new URL(req.url);
    const headers = new Headers({ Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' });
    // A stale cookie must go, or the login page sees it and bounces straight back here.
    if (cookie) headers.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`);
    return new Response(null, { status: 302, headers });
  }

  const details = await oauth.describeConsent(request);
  const consent = await oauth.beginConsent(request);
  consent.headers.set('Content-Type', 'text/html; charset=utf-8');
  consent.headers.set('Content-Security-Policy', CSP);
  return new Response(consentPage(details, consent.handle, session.email), { headers: consent.headers });
}

async function decide(req: Request, env: Env, ctx: ExecutionContext, oauth: OAuthHelpers): Promise<Response> {
  const { session } = await signedIn(req, env, ctx);
  if (!session) return page(401, 'Signed out', ['Sign in to AgentDrive, then start connecting again from your app.']);

  const form = await req.formData().catch(() => null);
  const handle = form?.get('handle');
  if (typeof handle !== 'string') return page(400, 'Could not connect', ['This request is incomplete. Start again from your app.']);
  const email = session.email.toLowerCase();
  // The page asked one account; a session swapped in since then must not receive the grant.
  if (form?.get('account') !== email) {
    return page(400, 'Could not connect', ['You signed in to a different account after this page opened. Start again from your app.']);
  }

  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(req, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const storage = new StorageService(env.KV, env.R2);
  // Before approveConsent, so a refusal leaves no unused grant behind.
  if (selfHosted(env) && !session.org_id && !(await storage.getOrgIdByEmail(session.email))) {
    return page(403, 'Could not connect', [REGISTRATION_CLOSED.error]);
  }

  const approved = await oauth.approveConsent(req, handle, { scope: SCOPES });
  const details = await oauth.describeConsent(approved.request);
  const userId = await hashContent(email);
  const orgId = session.org_id ?? (await storage.getOrCreateOrgForEmail(session.email, env));
  const grants = await userGrants(oauth, userId);

  // A key whose grant is gone (its code went unredeemed, or the grant expired) backs nothing
  // but would hold an agent slot forever. Sequential: each revoke read-modify-writes agent_count.
  const held = new Set(grants.map((g) => grantKey(g)?.keyId));
  for (const key of await storage.oauthKeysCreatedBy(orgId, email)) {
    const orphaned = !held.has(key.key_id) && Date.now() - Date.parse(key.created_at) >= ORPHAN_SWEEP_GRACE_MS;
    if (orphaned) await storage.revokeApiKey(orgId, key.key_id!);
  }

  // The keys behind the grants this one replaces go only once it is in place, so a refused or
  // failed reconnect leaves the working connection alone; until then they count as freed.
  const replaced = replacedKeys(grants, approved.request, details.clientDomain !== undefined);
  const freeing = (await Promise.all(replaced.filter((k) => k.orgId === orgId).map((k) => storage.getApiKey(orgId, k.keyId)))).filter(Boolean).length;
  const minted = await mintAgentKey(env, {
    email: session.email,
    orgId,
    name: `${details.clientName.slice(0, 64)} (OAuth)`,
    freeing,
    oauthClientId: approved.request.clientId,
  });
  if ('code' in minted) {
    return page(402, 'No agent slot left', [minted.error, 'Upgrade, or revoke a key you no longer use to free its slot, then connect again.'], [
      ['Upgrade', minted.upgrade_url],
      ['Manage keys', `${env.SITE_URL.replace(/\/+$/, '')}/keys`],
    ]);
  }

  let redirectTo: string;
  try {
    ({ redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId,
      scope: SCOPES,
      props: { apiKey: minted.apiKey, mintedAt: Date.now() } satisfies McpProps,
      metadata: { key_id: minted.keyId, org_id: minted.orgId } satisfies GrantMetadata,
    }));
  } catch (err) {
    // No grant holds the new key, so it would only take an agent slot.
    await storage.revokeApiKey(minted.orgId, minted.keyId);
    throw err;
  }
  for (const key of replaced) await storage.revokeApiKey(key.orgId, key.keyId);

  approved.headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}

type GrantMetadata = { key_id: string; org_id: string };

function grantKey(grant: GrantSummary): { orgId: string; keyId: string } | undefined {
  const m = grant.metadata as Partial<GrantMetadata> | undefined;
  return m?.key_id && m.org_id ? { orgId: m.org_id, keyId: m.key_id } : undefined;
}

async function userGrants(oauth: OAuthHelpers, userId: string): Promise<GrantSummary[]> {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, { cursor });
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return grants;
}

// The keys behind the grants completeAuthorization replaces, by the library's own rule: same
// client and resource, and for a CIMD client (the ones describeConsent gives a domain) the
// same redirect URI too.
function replacedKeys(grants: GrantSummary[], request: AuthRequest, isCimd: boolean): Array<{ orgId: string; keyId: string }> {
  return grants
    .filter((g) => g.clientId === request.clientId && (!isCimd || g.redirectUri === request.redirectUri) && g.resource === request.resource)
    .flatMap((g) => grantKey(g) ?? []);
}

// The site stores the session id in the adrive_session cookie's (misnamed) api_key field.
async function signedIn(req: Request, env: Env, ctx: ExecutionContext): Promise<{ cookie: boolean; session?: SessionAuth }> {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    let id: unknown;
    try {
      id = (JSON.parse(decodeURIComponent(part.slice(eq + 1).trim())) as { api_key?: unknown }).api_key;
    } catch {
      return { cookie: true };
    }
    if (typeof id !== 'string' || !id) return { cookie: true };
    const auth = await sessionAuth(env, ctx, id);
    return { cookie: true, session: 'error' in auth ? undefined : auth };
  }
  return { cookie: false };
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

const escape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #fafafa; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 40px; max-width: 440px; width: 90%; box-sizing: border-box; }
  h1 { font-size: 22px; margin: 0 0 16px; overflow-wrap: anywhere; }
  p { color: #a1a1aa; font-size: 14px; line-height: 1.5; margin: 0 0 16px; overflow-wrap: anywhere; }
  strong { color: #fafafa; }
  .warn { color: #fbbf24; }
  .row { display: flex; gap: 12px; margin-top: 24px; }
  button, .row a { flex: 1; padding: 12px 20px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; border: 1px solid #27272a; background: #27272a; color: #fafafa; text-align: center; text-decoration: none; }
  .primary { background: #fafafa; color: #0a0a0a; border-color: #fafafa; }
  .meta { color: #71717a; font-size: 12px; margin: 24px 0 0; }
`;

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="card">
${body}
</main>
</body>
</html>`;
}

function consentPage(details: ConsentDescription, handle: string, email: string): string {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : 'This app registered itself; its name is not verified.';
  const loopback = details.redirectIsLoopback
    ? '<p class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>'
    : '';
  return shell(`Connect ${name} to AgentDrive`, `
  <h1>Allow ${name} to use your AgentDrive?</h1>
  <p>${origin}</p>
  <p>It gets full read, write, share and delete access to your AgentDrive org's workspaces.</p>
  <p>Access is sent to <strong>${escape(details.redirectHost)}</strong>.</p>
  ${loopback}
  <form method="post">
    <input type="hidden" name="handle" value="${escape(handle)}" />
    <input type="hidden" name="account" value="${escape(email.toLowerCase())}" />
    <div class="row">
      <button class="primary" name="decision" value="approve">Allow</button>
      <button name="decision" value="deny">Deny</button>
    </div>
  </form>
  <p class="meta">Signed in as ${escape(email)}. Disconnect it any time by revoking its key under API keys.</p>`);
}

function page(status: number, title: string, paragraphs: string[], links: Array<[label: string, href: string]> = []): Response {
  const body = [
    `<h1>${escape(title)}</h1>`,
    ...paragraphs.map((p) => `<p>${escape(p)}</p>`),
    ...(links.length ? [`<div class="row">${links.map(([label, href], i) => `<a${i ? '' : ' class="primary"'} href="${escape(href)}">${escape(label)}</a>`).join('')}</div>`] : []),
  ].join('\n  ');
  return new Response(shell(escape(title), body), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': CSP,
      'X-Frame-Options': 'DENY',
    },
  });
}
