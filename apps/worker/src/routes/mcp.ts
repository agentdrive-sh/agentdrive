import { Hono } from 'hono';
import { z } from 'zod';
import { ApiClient, TOOLS, SERVER_INSTRUCTIONS } from '@adrive/mcp-server/registry';
import type { OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env.js';
import { WORKER_HEALTH_VERSION } from '../generated/version.js';

// Hosted MCP server (Streamable HTTP, stateless) at /mcp — same 22 tools as the
// stdio @adrive/mcp-server, reused via its shared registry. Remote MCP hosts
// (Claude, ChatGPT, Cursor, ...) connect to https://mcp.agentdrive.sh/mcp with
// an OAuth access token or `Authorization: Bearer <agentdrive_live_...>`.
// Mounted only behind the OAuth resource servers in oauth-server.ts, which
// authenticate every request and put the caller's API key in ctx.props.
//
// Stateless: every POST is a self-contained JSON-RPC request. No session id is
// issued. tools/call builds an ApiClient that calls the AgentDrive REST API as
// the caller.

type AppType = { Bindings: Env };

const DEFAULT_PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'agentdrive', version: WORKER_HEALTH_VERSION };

// Built once per isolate: Zod shapes -> JSON Schema for tools/list.
export const TOOL_LIST = TOOLS.map((t) => {
  const schema = z.toJSONSchema(z.object(t.schema)) as Record<string, unknown>;
  delete schema.$schema;
  return { name: t.name, title: t.annotations.title, description: t.description, inputSchema: schema, annotations: t.annotations };
});

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
};

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

interface RpcReq { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }

async function handleOne(
  req: RpcReq,
  env: Env,
  apiKey: string,
  platform: string,
  role: string,
): Promise<object | null> {
  const { id, method, params } = req;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: typeof requested === 'string' ? requested : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case 'tools/list':
      return rpcResult(id, { tools: TOOL_LIST });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/call': {
      const name = params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);

      const parsed = z.object(tool.schema).safeParse(params?.arguments ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        return rpcResult(id, { content: [{ type: 'text', text: `Invalid arguments: ${detail}` }], isError: true });
      }

      const self = env.SELF;
      const client = new ApiClient({
        baseUrl: env.APP_URL,
        apiKey,
        agentPlatform: platform,
        agentRole: role,
        // Dispatch in-process via the self service binding (avoids the edge
        // loopback that 522s). Falls back to global fetch if SELF is unbound.
        fetchImpl: self ? (input, init) => self.fetch(input, init) : undefined,
      });
      try {
        const result = await tool.handler(client, parsed.data);
        return rpcResult(id, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return rpcResult(id, { content: [{ type: 'text', text: `Tool error: ${msg}` }], isError: true });
      }
    }
    default:
      // Notifications (initialized, cancelled, ...) and anything id-less: no reply.
      if (isNotification || (typeof method === 'string' && method.startsWith('notifications/'))) return null;
      return rpcError(id, -32601, `Method not found: ${String(method)}`);
  }
}

const app = new Hono<AppType>();

// Stateless server has no server-initiated stream; GET (SSE) isn't supported.
app.get('/', (c) => c.json({ error: 'Use POST for MCP Streamable HTTP' }, 405, CORS));

app.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400, CORS);
  }

  const { apiKey } = (c.executionCtx as OAuthResourceContext<{ apiKey: string }>).props;
  const platform = (c.req.header('X-Agent-Platform') ?? 'unknown').toLowerCase();
  const role = c.req.header('X-Agent-Role') ?? '';

  if (Array.isArray(body)) {
    const out = (await Promise.all(
      body.map((r) => handleOne(r as RpcReq, c.env, apiKey, platform, role)),
    )).filter((r): r is object => r !== null);
    if (out.length === 0) return new Response(null, { status: 202, headers: CORS });
    return c.json(out, 200, CORS);
  }

  const res = await handleOne(body as RpcReq, c.env, apiKey, platform, role);
  if (res === null) return new Response(null, { status: 202, headers: CORS });
  return c.json(res, 200, CORS);
});

export default app;
