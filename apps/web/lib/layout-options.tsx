import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'AgentDrive Docs',
      url: '/',
    },
    links: [{ text: 'Back to AgentDrive', url: '/' }],
    githubUrl: 'https://github.com/agentdrive-sh/agentdrive-mcp',
  };
}
