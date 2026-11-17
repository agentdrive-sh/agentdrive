import Link from 'next/link';
import { AgentDriveLogo } from '@/components/agentdrive-logo';
import cli from '../../../../packages/cli/package.json';

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/integrations', label: 'Integrations' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/compare', label: 'Compare' },
      { href: '/security', label: 'Security' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { href: '/docs', label: 'Docs' },
      { href: 'https://github.com/agentdrive-sh/agentdrive-mcp', label: 'GitHub' },
      { href: '/status', label: 'Status' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/blog', label: 'Blog' },
      { href: '/manifesto', label: 'Manifesto' },
      { href: '/legal/privacy', label: 'Privacy' },
      { href: '/legal/terms', label: 'Terms' },
      { href: '/legal/dpa', label: 'DPA' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="m-footer">
      <div className="m-wrap">
        <div className="m-footer-inner">
          <div className="m-footer-brand">
            <Link href="/" className="m-brand">
              <AgentDriveLogo size={18} />
              <span>AgentDrive</span>
            </Link>
            <p>Start in any agent. Finish in any other.</p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2>{col.title}</h2>
              <ul>
                {col.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith('/') ? (
                      <Link href={l.href}>{l.label}</Link>
                    ) : (
                      <a href={l.href}>{l.label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="m-footer-base">
          <small>CLI v{cli.version}, Apache-2.0 client tools.</small>
          <small>© 2026 Roushan Inc</small>
        </div>
      </div>
    </footer>
  );
}
