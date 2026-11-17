import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';

// shortcut: ignores q-values, upgrade to a negotiator if a client sends text/markdown;q=0
const acceptsMarkdown = [{ type: 'header' as const, key: 'accept', value: '(.*)text/markdown(.*)' }];

// Gemini CLI pages were folded into Antigravity; keep their indexed URLs working.
const GEMINI_PAIR_PEERS = ['claude-code', 'codex', 'opencode', 'cursor'];
const geminiRedirects = [
  { source: '/integrations/gemini-cli', destination: '/integrations/antigravity', permanent: true },
  { source: '/resume/gemini-cli-to-antigravity', destination: '/integrations/antigravity', permanent: true },
  { source: '/resume/antigravity-to-gemini-cli', destination: '/integrations/antigravity', permanent: true },
  ...GEMINI_PAIR_PEERS.flatMap((peer) => [
    { source: `/resume/gemini-cli-to-${peer}`, destination: `/resume/antigravity-to-${peer}`, permanent: true },
    { source: `/resume/${peer}-to-gemini-cli`, destination: `/resume/${peer}-to-antigravity`, permanent: true },
  ]),
];

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  typedRoutes: false,
  async headers() {
    return [
      {
        source: '/',
        headers: [
          {
            key: 'Link',
            value:
              '</.well-known/api-catalog>; rel="api-catalog", </docs/rest-api>; rel="service-doc", </llms.txt>; rel="describedby", </.well-known/mcp/server-card.json>; rel="service-desc", </.well-known/ai-catalog.json>; rel="ai-catalog"',
          },
        ],
      },
      {
        // Authorizing a CLI is a typed code and one click, so no other site may frame the page and steer them.
        source: '/cli-auth',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        // Sign-in always ends on agentdrive.sh and the session cookie is host-only, so pages
        // on the app host would never see it. Its /v1, /auth and /install paths are zone-routed
        // to the API worker and never reach this app.
        source: '/:path*',
        has: [{ type: 'host', value: 'app.agentdrive.sh' }],
        destination: 'https://agentdrive.sh/:path*',
        permanent: false,
      },
      ...geminiRedirects,
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', has: acceptsMarkdown, destination: '/index.md' },
        // Under OpenNext a single /docs/:path* rule rewrote bare /docs to a 404, so it gets its own rule.
        { source: '/docs', has: acceptsMarkdown, destination: '/llms.mdx/docs' },
        { source: '/docs/:path+', has: acceptsMarkdown, destination: '/llms.mdx/docs/:path+' },
      ],
    };
  },
};

const withMDX = createMDX();

export default withMDX(config);
