import { SITE_URL } from '@/components/seo/site';
import web from '../../../package.json';

export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    protocolVersion: '0.3.0',
    name: 'AgentDrive Docs',
    description: 'Search the public AgentDrive documentation by topic and return matching pages with source links.',
    url: `${SITE_URL}/a2a`,
    preferredTransport: 'JSONRPC',
    provider: { organization: 'AgentDrive', url: SITE_URL },
    documentationUrl: `${SITE_URL}/docs`,
    version: web.version,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{
      id: 'search-docs',
      name: 'Search AgentDrive documentation',
      description: 'Find instructions for session handoffs, workspace tools and the AgentDrive REST API.',
      tags: ['documentation', 'search'],
      examples: ['resume session', 'REST API authentication'],
    }],
  });
}
