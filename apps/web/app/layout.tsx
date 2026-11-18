import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@/components/analytics';
import { JsonLd } from '@/components/seo/json-ld';
import { ORGANIZATION, SITE_DESCRIPTION, SITE_TITLE, SITE_URL, SOFTWARE_APPLICATION } from '@/components/seo/site';
import { WEBMCP_SCRIPT } from '@/components/webmcp-script';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-sans-loaded',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono-loaded',
  display: 'swap',
});


export const metadata: Metadata = {
  metadataBase: new URL('https://agentdrive.sh'),
  title: {
    default: SITE_TITLE,
    template: '%s — AgentDrive',
  },
  description: SITE_DESCRIPTION,
  applicationName: 'AgentDrive',
  keywords: [
    'shared workspace for coding agents',
    'session handoff',
    'agent provenance',
    'MCP server',
    'Claude Code',
    'Codex',
    'OpenCode',
    'Cursor',
    'Antigravity',
    'bring your own bucket',
  ],
  // No title, description or url here: Next fills the og and twitter title and description from each
  // page's own metadata, and a url set here would point every page that inherits it at the home page.
  openGraph: {
    siteName: 'AgentDrive',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
  },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      ...ORGANIZATION,
      legalName: 'Roushan, Inc.',
      email: 'hello@agentdrive.sh',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '1111b S Governors Ave STE 55131',
        addressLocality: 'Dover',
        addressRegion: 'DE',
        postalCode: '19904',
        addressCountry: 'US',
      },
      contactPoint: [
        { '@type': 'ContactPoint', contactType: 'customer support', email: 'hello@agentdrive.sh', url: `${SITE_URL}/contact` },
        { '@type': 'ContactPoint', contactType: 'security', email: 'security@agentdrive.sh', url: `${SITE_URL}/security` },
      ],
      sameAs: [
        'https://github.com/agentdrive-sh',
        'https://github.com/agentdrive-sh/agentdrive',
        'https://www.npmjs.com/package/@adrive/cli',
        'https://www.npmjs.com/package/@adrive/mcp-server',
        'https://www.npmjs.com/package/@adrive/sdk',
        'https://www.youtube.com/@agentdrive-sh',
      ],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'AgentDrive',
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      publisher: { '@id': ORGANIZATION['@id'] },
    },
    SOFTWARE_APPLICATION,
  ],
};

const CF_BEACON_TOKEN = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN;
// Production only, so local dev and e2e runs neither report visits nor wait on Google's CDN.
const GTM_ID = process.env.NODE_ENV === 'production' ? 'GTM-M8ZJ3B5R' : undefined;

export const viewport: Viewport = {
  themeColor: '#0a0a0b',
  colorScheme: 'dark light',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-density="airy"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={{
        // Bind next/font CSS variables to the design-token names.
        // The token names (--font-sans, --font-mono) are what every component
        // in globals.css references; next/font hands us scoped CSS variables
        // that we re-expose under the canonical names.
        ['--font-sans' as string]: `var(--font-sans-loaded), system-ui, -apple-system, sans-serif`,
        ['--font-mono' as string]: `var(--font-mono-loaded), ui-monospace, 'SF Mono', Menlo, monospace`,
      }}
    >
      <body>
        {/* Visually hidden and kept out of the accessibility tree; it is for agents reading the raw HTML. */}
        <div className="m-sr" aria-hidden="true">
          For AI agents: the documentation index is at <a href="https://agentdrive.sh/llms.txt" tabIndex={-1}>https://agentdrive.sh/llms.txt</a>. Every docs page is also served as markdown at its URL plus .md.
        </div>
        {children}
        <script dangerouslySetInnerHTML={{ __html: WEBMCP_SCRIPT }} />
        <JsonLd data={JSON_LD} />
        {GTM_ID && <Analytics id={GTM_ID} />}
        {CF_BEACON_TOKEN && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
          />
        )}
      </body>
    </html>
  );
}
