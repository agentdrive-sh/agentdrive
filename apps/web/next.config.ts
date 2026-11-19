import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';

// shortcut: ignores q-values, upgrade to a negotiator if a client sends text/markdown;q=0
const acceptsMarkdown = [{ type: 'header' as const, key: 'accept', value: '(.*)text/markdown(.*)' }];
// AI fetchers that ask for HTML still read markdown best.
const aiAgent = [
  {
    type: 'header' as const,
    key: 'user-agent',
    value: '(.*)(ClaudeBot|Claude-User|Claude-SearchBot|GPTBot|ChatGPT-User|OAI-SearchBot|PerplexityBot|Perplexity-User)(.*)',
  },
];
// Docs page slugs never contain a dot, which keeps /docs/llms.txt and the .md twins out, and
// /docs/mcp is the docs MCP endpoint, which a markdown rewrite would break.
const DOCS_PAGE = '/docs/:path((?!mcp(?:/|$))[^.]+)';
const toMarkdown = (source: string, destination: string) =>
  [acceptsMarkdown, aiAgent].map((has) => ({ source, has, destination }));

// Next marks prerendered pages s-maxage=31536000; agents and caches should see a redeploy within minutes.
const FRESH_PATHS = [
  '/',
  '/index.md',
  '/llms.txt',
  '/llms-full.txt',
  '/docs',
  '/docs.md',
  DOCS_PAGE,
  '/docs/:path+.md',
  '/docs/llms.txt',
  '/pricing',
  '/pricing.md',
  '/integrations/:path*',
  '/resume/:path*',
  '/compare/:path*',
  '/blog/:path*',
  '/security',
  '/manifesto',
  '/about',
  '/contact',
  '/facts/:path*',
  '/facts.md',
  '/glossary/:path*',
  '/glossary.md',
  '/blog.md',
  '/compare.md',
  '/legal/:path*',
  '/openapi.json',
  '/robots.txt',
  '/schemamap.xml',
  '/feeds/:path*',
  '/.well-known/:path*',
];

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
      ...FRESH_PATHS.map((source) => ({
        source,
        headers: [{ key: 'Cache-Control', value: 'public, max-age=300, must-revalidate' }],
      })),
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
        // Search results still point to the original docs host. Consolidate them on each page's canonical URL.
        source: '/docs/:path*',
        has: [{ type: 'host', value: 'app.agentdrive.sh' }],
        destination: 'https://agentdrive.sh/docs/:path*',
        permanent: true,
      },
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
      {
        source: '/blog/how-background-session-capture-works',
        destination: '/blog/how-background-session-sync-works',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/docs.md', destination: '/llms.mdx/docs' },
        { source: '/docs/index.md', destination: '/llms.mdx/docs' },
        { source: '/docs/:path+.md', destination: '/llms.mdx/docs/:path+' },
        ...toMarkdown('/', '/index.md'),
        // Under OpenNext a single /docs/:path* rule rewrote bare /docs to a 404, so it gets its own rule.
        ...toMarkdown('/docs', '/llms.mdx/docs'),
        ...toMarkdown(DOCS_PAGE, '/llms.mdx/docs/:path'),
        ...toMarkdown('/pricing', '/pricing.md'),
        { source: '/blog/:slug.md', destination: '/blog/:slug/index.md' },
        { source: '/glossary/:term.md', destination: '/glossary/:term/index.md' },
        { source: '/compare/:slug.md', destination: '/compare/:slug/index.md' },
        { source: '/facts.md', destination: '/facts/index.md' },
        ...toMarkdown('/blog', '/blog.md'),
        ...toMarkdown('/blog/:slug([^./]+)', '/blog/:slug/index.md'),
        ...toMarkdown('/glossary', '/glossary.md'),
        ...toMarkdown('/glossary/:term([^./]+)', '/glossary/:term/index.md'),
        ...toMarkdown('/compare', '/compare.md'),
        ...toMarkdown('/compare/:slug([^./]+)', '/compare/:slug/index.md'),
        ...toMarkdown('/facts', '/facts/index.md'),
      ],
      afterFiles: [],
      fallback: [{ source: '/:path*', has: acceptsMarkdown, destination: '/llms.mdx/not-found' }],
    };
  },
};

const withMDX = createMDX();

export default withMDX(config);
