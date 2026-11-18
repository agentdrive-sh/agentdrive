import { z } from 'zod';
import { docsSearch } from '@/lib/search';
import { source } from '@/lib/source';
import webPackage from '../package.json';

// Public, read-only docs MCP server (Streamable HTTP, stateless, no auth) at /docs/mcp.
// The product server lives at mcp.agentdrive.sh/mcp, and agentdrive.sh/mcp* is zone-routed there.

const SITE = 'https://agentdrive.sh';
export const DOCS_MCP_URL = `${SITE}/docs/mcp`;

// Newest first: an unsupported requested version is answered with the newest one.
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const SERVER_INFO = { name: 'agentdrive-docs', title: 'AgentDrive Docs', version: webPackage.version };

export const SERVER_CARD = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
  name: 'sh.agentdrive/docs-mcp',
  title: 'AgentDrive Docs',
  description: 'Search and read the AgentDrive docs: quick start, MCP tools, REST API, self-hosting. Read-only.',
  version: webPackage.version,
  websiteUrl: `${SITE}/docs`,
  icons: [{ src: `${SITE}/apple-icon`, mimeType: 'image/png', sizes: ['180x180'] }],
  remotes: [{ type: 'streamable-http', url: DOCS_MCP_URL, supportedProtocolVersions: PROTOCOL_VERSIONS }],
};

const INSTRUCTIONS =
  'Read-only access to the AgentDrive documentation. Call search_docs to find pages, then read_doc with a result URL for the full page as markdown. To act on an AgentDrive workspace, use the product MCP server at https://mcp.agentdrive.sh/mcp instead.';

const TOOLS = [
  {
    name: 'search_docs',
    title: 'Search AgentDrive docs',
    description:
      'Full-text search over the AgentDrive documentation (setup, cross-agent session resume, MCP tools, REST API, self-hosting). Returns matching pages with title, absolute URL, description and the best-matching snippet. Pass a result URL to read_doc for the full page.',
    schema: z.object({
      query: z.string().trim().min(1).describe('Words to search for, e.g. "resume a Codex session in Claude Code"'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum pages to return (default 8, max 20)'),
    }),
    handler: (args: { query: string; limit?: number }) => searchDocs(args.query, args.limit ?? 8),
  },
  {
    name: 'read_doc',
    title: 'Read an AgentDrive docs page',
    description:
      'Return one AgentDrive docs page as markdown, with links made absolute on https://agentdrive.sh. Accepts a docs path ("/docs/quick-start" or "quick-start") or a full https://agentdrive.sh/docs/... URL, such as one returned by search_docs.',
    schema: z.object({
      path: z.string().trim().describe('Docs path or URL, e.g. "/docs/mcp-tools" or "https://agentdrive.sh/docs/quick-start"'),
    }),
    handler: (args: { path: string }) => readDoc(args.path),
  },
] as const;

const TOOL_LIST = TOOLS.map((t) => {
  const inputSchema = z.toJSONSchema(t.schema) as Record<string, unknown>;
  delete inputSchema.$schema;
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema,
    annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
});

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError && { isError }) });

async function searchDocs(query: string, limit: number): Promise<ToolResult> {
  const hits = await docsSearch.search(query);
  const pages = new Map<string, { title: string; url: string; description?: string; match?: string }>();
  for (const hit of hits) {
    const [path] = hit.url.split('#');
    let entry = pages.get(path);
    if (!entry) {
      const page = pages.size < limit ? pageAt(path) : undefined;
      if (!page) continue;
      entry = { title: page.data.title, url: `${SITE}${page.url}`, description: page.data.description };
      pages.set(path, entry);
    }
    if (!entry.match && hit.type !== 'page') entry.match = `${hit.content} (${SITE}${hit.url})`;
  }
  if (pages.size === 0) return text(`No AgentDrive docs pages match "${query}".`);
  return text(
    [...pages.values()]
      .map((p, i) =>
        [`${i + 1}. ${p.title}`, `   ${p.url}`, p.description && `   ${p.description}`, p.match && `   Match: ${p.match}`]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n'),
  );
}

function pageAt(path: string) {
  if (path !== '/docs' && !path.startsWith('/docs/')) return undefined;
  return source.getPage(path.split('/').slice(2).filter(Boolean).map(decodeURIComponent));
}

async function readDoc(input: string): Promise<ToolResult> {
  let url: URL | undefined;
  try {
    url = new URL(input.replace(/^(?!\/|https?:)(docs(\/|$))?/, '/docs/'), SITE);
  } catch {}
  const page = url?.host === 'agentdrive.sh' ? pageAt(url.pathname.replace(/\.mdx?$/, '').replace(/\/+$/, '')) : undefined;
  if (!page) return text(`No AgentDrive docs page at "${input}". Use search_docs to find one.`, true);
  const markdown = (await page.data.getText('processed'))
    .replace(/(\]\(|^\[[^\]]+\]:\s*|href=["'])\/(?!\/)/gm, `$1${SITE}/`)
    .replace(/\]\(#/g, `](${SITE}${page.url}#`);
  return text(`# ${page.data.title}\n\nSource: ${SITE}${page.url}\n\n${markdown}`);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
};

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  Response.json(body, { status, headers: { ...CORS, ...headers } });
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handleRequest(id: string | number, method: string, params: Record<string, unknown>) {
  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      const protocolVersion =
        typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOL_LIST });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      const parsed = tool.schema.safeParse(params.arguments ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ');
        return rpcResult(id, text(`Invalid arguments: ${detail}`, true));
      }
      try {
        // The union of handlers cannot be narrowed by the tool name, so each gets the args its own schema parsed.
        return rpcResult(id, await (tool.handler as (a: typeof parsed.data) => Promise<ToolResult>)(parsed.data));
      } catch (err) {
        return rpcResult(id, text(`Tool error: ${err instanceof Error ? err.message : String(err)}`, true));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function handlePost(req: Request): Promise<Response> {
  const headerVersion = req.headers.get('mcp-protocol-version');
  if (headerVersion && !PROTOCOL_VERSIONS.includes(headerVersion)) {
    return json(rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${headerVersion}`), 400);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body) || (body as { jsonrpc?: unknown }).jsonrpc !== '2.0') {
    return json(rpcError(null, -32600, 'Invalid Request: send one JSON-RPC 2.0 message per POST'), 400);
  }
  const { id, method, params } = body as { id?: unknown; method?: unknown; params?: unknown };
  if (id === undefined && typeof method === 'string') return new Response(null, { status: 202, headers: CORS });
  if (typeof method !== 'string' || (typeof id !== 'string' && typeof id !== 'number')) {
    return json(rpcError(typeof id === 'string' || typeof id === 'number' ? id : null, -32600, 'Invalid Request'), 400);
  }
  const p = typeof params === 'object' && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  return json(await handleRequest(id, method, p));
}

// Stateless: there is no server-initiated stream to GET and no session to DELETE.
export function methodNotAllowed(): Response {
  return json(rpcError(null, -32000, 'Method not allowed: send JSON-RPC messages with POST'), 405, { Allow: 'POST, OPTIONS' });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

export function serverCard(): Response {
  return json(SERVER_CARD);
}
