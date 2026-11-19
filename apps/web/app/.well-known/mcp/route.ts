import { DOCS_MCP_URL } from '@/lib/docs-mcp';

export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    version: '1.0.0',
    transport: 'http',
    url: DOCS_MCP_URL,
    servers: [{ name: 'public', url: DOCS_MCP_URL, transport: 'http', authentication: 'none' }],
  });
}
