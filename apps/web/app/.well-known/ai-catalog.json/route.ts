export const dynamic = 'force-static';

const HOST = 'did:web:agentdrive.sh';
const SOURCE = 'https://github.com/agentdrive-sh/agentdrive/tree/main';

// Unsigned on purpose: a provenance link to the public source is the honest claim we can make today.
function trust(path: string) {
  return [{ contributor: HOST, provenance: [{ relation: 'publishedFrom', sourceId: `${SOURCE}/${path}` }] }];
}

export function GET() {
  return Response.json(
    {
      specVersion: '1.0',
      host: { displayName: 'AgentDrive', identifier: HOST },
      entries: [
        {
          identifier: 'urn:air:agentdrive.sh:mcp:agentdrive',
          displayName: 'AgentDrive MCP server',
          type: 'application/mcp-server-card+json',
          url: 'https://agentdrive.sh/.well-known/mcp/server-card.json',
          trustManifests: trust('apps/worker'),
          representativeQueries: [
            'resume my Codex session in Claude Code',
            'search what my other agents wrote',
            'save this plan so my next agent can read it',
            'show the version history of a file an agent edited',
          ],
        },
        {
          identifier: 'urn:air:agentdrive.sh:mcp:docs',
          displayName: 'AgentDrive Docs MCP server',
          type: 'application/mcp-server-card+json',
          url: 'https://agentdrive.sh/docs/mcp/server-card',
          trustManifests: trust('apps/web/lib/docs-mcp.ts'),
          representativeQueries: [
            'how do I resume a Codex session in Claude Code',
            'what does the drive_resume tool return',
            'how do I self-host AgentDrive',
          ],
        },
        {
          identifier: 'urn:air:agentdrive.sh:api:openapi',
          displayName: 'AgentDrive REST API (OpenAPI)',
          type: 'application/vnd.oai.openapi+json',
          url: 'https://agentdrive.sh/openapi.json',
          trustManifests: trust('apps/worker/openapi.json'),
          representativeQueries: [
            'list the files in a workspace',
            'log an agent run with provenance',
            'search what other agents wrote',
          ],
        },
        {
          identifier: 'urn:air:agentdrive.sh:api:rest',
          displayName: 'AgentDrive REST API',
          type: 'application/linkset+json',
          url: 'https://agentdrive.sh/.well-known/api-catalog',
          trustManifests: trust('apps/worker'),
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
          trustManifests: trust('plugins/agentdrive/skills/agentdrive'),
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
