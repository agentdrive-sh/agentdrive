export const dynamic = 'force-static';

const REST_API = 'https://app.agentdrive.sh/v1';
const MCP_SERVER = 'https://mcp.agentdrive.sh/mcp';
const DOCS_MCP_SERVER = 'https://agentdrive.sh/docs/mcp';

export function GET() {
  return Response.json(
    {
      linkset: [
        {
          anchor: 'https://agentdrive.sh/.well-known/api-catalog',
          item: [{ href: REST_API }, { href: MCP_SERVER }, { href: DOCS_MCP_SERVER }],
        },
        {
          anchor: REST_API,
          'service-desc': [{ href: 'https://agentdrive.sh/openapi.json', type: 'application/vnd.oai.openapi+json' }],
          'service-doc': [{ href: 'https://agentdrive.sh/docs/rest-api', type: 'text/html' }],
          status: [{ href: 'https://app.agentdrive.sh/v1/health', type: 'application/json' }],
        },
        {
          anchor: MCP_SERVER,
          'service-desc': [
            { href: 'https://agentdrive.sh/.well-known/mcp/server-card.json', type: 'application/json' },
          ],
          'service-doc': [{ href: 'https://agentdrive.sh/docs/mcp-tools', type: 'text/html' }],
        },
        {
          anchor: DOCS_MCP_SERVER,
          'service-desc': [{ href: 'https://agentdrive.sh/docs/mcp/server-card', type: 'application/json' }],
          'service-doc': [{ href: 'https://agentdrive.sh/docs', type: 'text/html' }],
        },
      ],
    },
    {
      headers: {
        'Content-Type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      },
    },
  );
}
