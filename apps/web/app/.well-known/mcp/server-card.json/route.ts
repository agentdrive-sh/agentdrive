import mcpServerPackage from '../../../../../../packages/mcp-server/package.json';

export const dynamic = 'force-static';

const ENDPOINT = 'https://mcp.agentdrive.sh/mcp';

// Field names follow the SEP-1649 draft (first revision of PR #2127), which is what
// isitagentready.com validates; the final SEP-2127 card is a different, flat shape. The flat
// name/title/icons/remotes fields are added alongside so registry readers of that shape match too.
export function GET() {
  return Response.json(
    {
      $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
      version: '1.0',
      protocolVersion: '2025-06-18',
      name: 'sh.agentdrive/mcp',
      title: 'AgentDrive',
      icons: [
        { src: 'https://agentdrive.sh/apple-icon', mimeType: 'image/png', sizes: ['180x180'] },
        { src: 'https://agentdrive.sh/icon', mimeType: 'image/png', sizes: ['32x32'] },
      ],
      websiteUrl: 'https://agentdrive.sh',
      remotes: [{ type: 'streamable-http', url: ENDPOINT }],
      serverInfo: { name: 'agentdrive', title: 'AgentDrive', version: mcpServerPackage.version },
      description: 'Shared workspace for coding agents: cross-agent session resume, versioned files, semantic search.',
      documentationUrl: 'https://agentdrive.sh/docs/mcp-tools',
      transport: { type: 'streamable-http', endpoint: ENDPOINT },
      capabilities: { tools: { listChanged: false } },
      authentication: { required: true, schemes: ['bearer'] },
      instructions:
        'Send Authorization: Bearer agentdrive_live_... with an AgentDrive API key. See https://agentdrive.sh/auth.md.',
    },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
