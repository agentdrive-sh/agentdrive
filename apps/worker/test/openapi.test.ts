import { describe, it, expect } from 'vitest';
import { app } from '../src/app';
import { buildOpenApiDocument } from '../src/openapi';
import { TOOL_LIST } from '../src/routes/mcp';

// Registered routes the spec leaves out, each with why. The hosted MCP endpoint and the
// OAuth authorization server are matched before the Hono app (oauth-server.ts), so they
// never appear in app.routes.
const EXCLUDED: Record<string, string> = {
  'POST /v1/webhooks/stripe': 'Stripe calls it server to server, verified by signature; not for clients',
  'GET /v1/workspaces/:wid/files/:fid/collaborate': 'Live collaboration is not in this release; always 503',
  'GET /auth/oauth/google': 'Browser redirect into Google sign-in, not a JSON API',
  'GET /auth/oauth/google/callback': 'Google OAuth redirect target',
  'GET /auth/oauth/github': 'Browser redirect into GitHub sign-in, not a JSON API',
  'GET /auth/oauth/github/callback': 'GitHub OAuth redirect target',
  'GET /install': 'Shell installer script',
  'GET /install.sh': 'Shell installer script',
  'GET /.well-known/openai-apps-challenge': 'Plaintext domain ownership proof served only on the MCP origin',
  'GET /*': 'Redirects stray paths to the marketing site, which serves the /cli-auth page',
};

// Registered POST, PUT and PATCH routes that take no Idempotency-Key, each with why.
const NOT_IDEMPOTENT: Record<string, string> = {
  'POST /v1/webhooks/stripe': 'Stripe retries by event id, and the route has no principal to scope a key to',
  'POST /v1/register': 'Unauthenticated: no principal to scope a key to',
  'POST /v1/auth/send-code': 'Unauthenticated sign-in route; a resend repeats the live code anyway',
  'POST /v1/auth/verify-code': 'Unauthenticated sign-in route',
  'POST /v1/auth/cli/start': 'Unauthenticated sign-in route',
  'POST /v1/auth/cli/poll': 'Unauthenticated, and it only reads the sign-in state',
  'POST /v1/search': 'Read-only query sent as POST: a retry is already safe, and a replay would be stale',
  'POST /v1/context': 'Read-only query sent as POST: a retry is already safe, and a replay would be stale',
  'POST /v1/auth/logout': 'Ends the session it authenticates with, so a retry gets 401 before any replay; a repeated logout is already harmless',
  'POST /v1/keys': 'Answers with the new API key, which is never stored in clear',
  'POST /v1/workspaces/:wid/share': 'Answers with a share link carrying its token, which is never stored in clear',
  'POST /v1/billing/portal': 'Answers with a Stripe portal login link',
};

type Doc = ReturnType<typeof buildOpenApiDocument>;
type Op = {
  operationId: string;
  description: string;
  parameters: Array<{ name: string; in: string; schema?: unknown; $ref?: string }>;
  responses: Record<string, { $ref?: string; headers?: Record<string, unknown>; content?: Record<string, { schema: Schema }> }>;
};
type Schema = { $ref?: string; allOf?: Schema[]; required?: string[] };

const doc: Doc = buildOpenApiDocument();
const ops = Object.entries(doc.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, op: op as Op })));

// Middleware registers as ALL; '*' is the sandbox route's rest-of-path.
const routes = [...new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))];
const toOpenApi = (route: string) => route.replace(/:(\w+)/g, '{$1}').replace(/\/\*$/, '/{path}');

describe('OpenAPI document', () => {
  it('has an operation for every registered route that is not excluded', () => {
    const specced = new Set(ops.map((o) => o.key));
    const missing = routes.filter((r) => !(r in EXCLUDED) && !specced.has(toOpenApi(r)));
    expect(missing).toEqual([]);
  });

  it('describes only registered routes', () => {
    const registered = new Set(routes.map(toOpenApi));
    expect(ops.map((o) => o.key).filter((k) => !registered.has(k))).toEqual([]);
  });

  it('excludes only routes that exist', () => {
    expect(Object.keys(EXCLUDED).filter((r) => !routes.includes(r))).toEqual([]);
  });

  it('gives every operation a unique operationId and a description', () => {
    const operationIds = ops.map((o) => o.op.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    for (const { key, op } of ops) {
      expect(op.operationId, key).toMatch(/^[a-z][A-Za-z]+$/);
      expect(op.description.length, key).toBeGreaterThan(20);
    }
  });

  it('gives every parameter a schema', () => {
    const shared = doc.components.parameters as Record<string, { schema?: unknown }>;
    for (const { key, op } of ops) {
      for (const p of op.parameters) {
        const schema = p.$ref ? shared[p.$ref.split('/').pop()!]?.schema : p.schema;
        expect(schema, `${key} ${p.name ?? p.$ref}`).toBeTruthy();
      }
    }
  });

  it('resolves every $ref', () => {
    const json = JSON.stringify(doc);
    for (const [, kind, name] of json.matchAll(/"#\/components\/(\w+)\/(\w+)"/g)) {
      expect((doc.components as Record<string, Record<string, unknown>>)[kind!]?.[name!], `${kind}/${name}`).toBeDefined();
    }
  });

  it('gives every 4xx and 5xx response the Error schema or a subtype of it', () => {
    const shared = doc.components.responses as Record<string, NonNullable<Op['responses'][string]>>;
    const schemas = doc.components.schemas as Record<string, Schema>;
    expect(schemas.Error!.required).toEqual(expect.arrayContaining(['success', 'code', 'error']));
    const isError = (s: Schema): boolean =>
      s.$ref === '#/components/schemas/Error' || (!!s.$ref && isError(schemas[s.$ref.split('/').pop()!]!)) || !!s.allOf?.some(isError);
    for (const { key, op } of ops) {
      for (const [status, res] of Object.entries(op.responses)) {
        if (Number(status) < 400) continue;
        const resolved = res.$ref ? shared[res.$ref.split('/').pop()!]! : res;
        expect(isError(resolved.content!['application/json']!.schema), `${key} ${status}`).toBe(true);
      }
    }
  });

  it('declares Idempotency-Key, 409 and 422 on every write that takes one', () => {
    const writes = routes.filter((r) => /^(POST|PUT|PATCH) /.test(r) && !(r in EXCLUDED));
    for (const route of writes) {
      const op = ops.find((o) => o.key === toOpenApi(route))!.op;
      const declares = op.parameters.some((p) => p.$ref === '#/components/parameters/IdempotencyKey');
      expect(declares, route).toBe(!(route in NOT_IDEMPOTENT));
      if (!declares) continue;
      expect(Object.keys(op.responses), route).toEqual(expect.arrayContaining(['400', '409', '422']));
      for (const [status, res] of Object.entries(op.responses)) {
        if (Number(status) < 300) expect(res.headers?.['Idempotent-Replayed'], `${route} ${status}`).toBeDefined();
      }
    }
    expect(Object.keys(NOT_IDEMPOTENT).filter((r) => !routes.includes(r))).toEqual([]);
    for (const { key, op } of ops.filter((o) => /^(GET|DELETE) /.test(o.key))) {
      expect(op.parameters.some((p) => p.$ref === '#/components/parameters/IdempotencyKey'), key).toBe(false);
    }
  });

  it('puts Retry-After and RateLimit-Policy on 429', () => {
    const limited = (doc.components.responses as Record<string, { headers: Record<string, unknown> }>).RateLimited!;
    expect(Object.keys(limited.headers)).toEqual(['Retry-After', 'RateLimit-Policy']);
  });

  // Regenerate with `pnpm --filter @agentdrive/worker run openapi`.
  it('matches the committed openapi.json', async () => {
    await expect(`${JSON.stringify(doc, null, 2)}\n`).toMatchFileSnapshot('../openapi.json');
  });

  // The hosted MCP's tools/list; the site's MCP server card publishes it.
  it('matches the committed mcp-tools.json', async () => {
    await expect(`${JSON.stringify(TOOL_LIST, null, 2)}\n`).toMatchFileSnapshot('../mcp-tools.json');
  });
});
