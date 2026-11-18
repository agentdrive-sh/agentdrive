import { describe, it, expect } from 'vitest';
import { app } from '../src/app';
import { buildOpenApiDocument } from '../src/openapi';

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
  'GET /*': 'Redirects stray paths to the marketing site, which serves the /cli-auth page',
};

type Doc = ReturnType<typeof buildOpenApiDocument>;
type Op = { operationId: string; description: string; parameters: Array<{ name: string; in: string; schema?: unknown; $ref?: string }> };

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

  // Regenerate with `pnpm --filter @agentdrive/worker run openapi`.
  it('matches the committed openapi.json', async () => {
    await expect(`${JSON.stringify(doc, null, 2)}\n`).toMatchFileSnapshot('../openapi.json');
  });
});
