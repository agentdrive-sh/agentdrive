export const dynamic = 'force-static';

export function GET() {
  return Response.json(
    {
      linkset: [
        {
          anchor: 'https://app.agentdrive.sh/v1',
          'service-doc': [{ href: 'https://agentdrive.sh/docs/rest-api', type: 'text/html' }],
          status: [{ href: 'https://app.agentdrive.sh/v1/health', type: 'application/json' }],
        },
        {
          anchor: 'https://mcp.agentdrive.sh/mcp',
          'service-desc': [
            { href: 'https://agentdrive.sh/.well-known/mcp/server-card.json', type: 'application/json' },
          ],
          'service-doc': [{ href: 'https://agentdrive.sh/docs/mcp-tools', type: 'text/html' }],
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
