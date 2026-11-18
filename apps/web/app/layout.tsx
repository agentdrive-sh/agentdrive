import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { PLAN_CATALOG } from '@agentdrive/shared';
import { JsonLd } from '@/components/seo/json-ld';
import { ORGANIZATION, SITE_URL, SOFTWARE_ID } from '@/components/seo/site';
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

const TITLE = 'AgentDrive — start in any agent, finish in any other';
const DESCRIPTION =
  "The shared workspace that lets Claude Code, Codex, OpenCode, Cursor and Antigravity pick up each other's sessions, with provenance on every artifact.";

export const metadata: Metadata = {
  metadataBase: new URL('https://agentdrive.sh'),
  title: {
    default: TITLE,
    template: '%s — AgentDrive',
  },
  description: DESCRIPTION,
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

const PLAN_BILLING: Record<string, Record<string, unknown>> = {
  pro: { billingDuration: 'P1M' },
  team: { billingDuration: 'P1M', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'seat' } },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      ...ORGANIZATION,
      sameAs: [
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
      description: DESCRIPTION,
      publisher: { '@id': ORGANIZATION['@id'] },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': SOFTWARE_ID,
      name: 'AgentDrive',
      url: SITE_URL,
      license: ['https://spdx.org/licenses/AGPL-3.0-only.html', 'https://spdx.org/licenses/Apache-2.0.html'],
      description: DESCRIPTION,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Linux',
      publisher: { '@id': ORGANIZATION['@id'] },
      offers: PLAN_CATALOG.filter((p) => p.price.startsWith('$')).map((p) => {
        const price = p.price.slice(1);
        return {
          '@type': 'Offer',
          name: p.name,
          price,
          priceCurrency: 'USD',
          description: p.blurb,
          ...(PLAN_BILLING[p.id] && {
            priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: 'USD', ...PLAN_BILLING[p.id] },
          }),
        };
      }),
    },
  ],
};

const CF_BEACON_TOKEN = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN;

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
        {children}
        <script dangerouslySetInnerHTML={{ __html: WEBMCP_SCRIPT }} />
        <JsonLd data={JSON_LD} />
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
