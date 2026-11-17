import mcpServerPackage from '../../../../../../packages/mcp-server/package.json';

export const dynamic = 'force-static';

// Field names follow the SEP-1649 draft (first revision of PR #2127), which is what
// isitagentready.com validates; the final SEP-2127 card is a different, flat shape.
export function GET() {
  return Response.json(
    {
      $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
      version: '1.0',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'agentdrive', title: 'AgentDrive', version: mcpServerPackage.version },
      description:
        'Shared workspace for coding agents: resume sessions across agents, versioned files with provenance, semantic search.',
      documentationUrl: 'https://agentdrive.sh/docs/mcp-tools',
      transport: { type: 'streamable-http', endpoint: 'https://mcp.agentdrive.sh/mcp' },
      capabilities: { tools: { listChanged: false } },
      authentication: { required: true, schemes: ['bearer'] },
      instructions:
        'Send Authorization: Bearer agentdrive_live_... with an AgentDrive API key. See https://agentdrive.sh/auth.md.',
    },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
