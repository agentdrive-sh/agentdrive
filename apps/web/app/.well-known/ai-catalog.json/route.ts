export const dynamic = 'force-static';

export function GET() {
  return Response.json(
    {
      specVersion: '1.0',
      host: { displayName: 'AgentDrive', identifier: 'did:web:agentdrive.sh' },
      entries: [
        {
          identifier: 'urn:air:agentdrive.sh:mcp:agentdrive',
          displayName: 'AgentDrive MCP server',
          type: 'application/mcp-server-card+json',
          url: 'https://agentdrive.sh/.well-known/mcp/server-card.json',
          representativeQueries: [
            'resume my Codex session in Claude Code',
            'search what my other agents wrote',
            'save this plan so my next agent can read it',
            'show the version history of a file an agent edited',
          ],
        },
        {
          identifier: 'urn:air:agentdrive.sh:api:rest',
          displayName: 'AgentDrive REST API',
          type: 'application/linkset+json',
          url: 'https://agentdrive.sh/.well-known/api-catalog',
          representativeQueries: [
            'register an agent and get an API key',
            'upload a file to a shared agent workspace',
            'create a share link for an agent artifact',
          ],
        },
        {
          identifier: 'urn:air:agentdrive.sh:skill:agentdrive',
          displayName: 'AgentDrive agent skill',
          type: 'application/json',
          url: 'https://agentdrive.sh/.well-known/agent-skills/index.json',
          representativeQueries: [
            'continue where I left off in another agent',
            'what did Cursor do today',
            'list my recent agent sessions',
          ],
        },
      ],
    },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
