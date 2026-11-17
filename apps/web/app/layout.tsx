import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { PLAN_CATALOG } from '@agentdrive/shared';
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
  "The shared workspace that lets Claude Code, Codex, OpenCode, Cursor and Antigravity pick up each other's sessions, with provenance on every artifact and portable storage on R2, S3 or your own bucket.";

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
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://agentdrive.sh',
    siteName: 'AgentDrive',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'AgentDrive',
  url: 'https://agentdrive.sh',
  description: DESCRIPTION,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'macOS, Linux',
  offers: PLAN_CATALOG.filter((p) => p.price.startsWith('$')).map((p) => ({
    '@type': 'Offer',
    name: p.name,
    price: p.price.slice(1),
    priceCurrency: 'USD',
    description: p.blurb,
  })),
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
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
