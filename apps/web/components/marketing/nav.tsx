'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { AgentDriveLogo } from '@/components/agentdrive-logo';

const LINKS = [
  { href: '/docs', label: 'Docs' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: '/security', label: 'Security' },
];

const GITHUB = 'https://github.com/agentdrive-sh/agentdrive-mcp';

export function MarketingNav() {
  const pathname = usePathname() ?? '/';
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent | KeyboardEvent) => {
      const el = menu.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        el.open = false;
        el.querySelector('summary')?.focus();
      } else if (!el.contains(e.target as Node)) {
        el.open = false;
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  const current = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined;

  return (
    <header className="m-nav">
      <div className="m-wrap m-nav-inner">
        <Link href="/" className="m-brand" aria-current={pathname === '/' ? 'page' : undefined}>
          <AgentDriveLogo size={20} />
          <span>AgentDrive</span>
        </Link>
        <nav className="m-nav-links" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current(l.href)}>
              {l.label}
            </Link>
          ))}
          <a href={GITHUB}>GitHub</a>
        </nav>
        <div className="m-nav-cta">
          <Link className="btn ghost" href="/login">
            Sign in
          </Link>
          <Link className="btn primary" href="/docs/quick-start">
            Install
          </Link>
          {/* Keyed on the path so the menu closes after a client-side navigation. */}
          <details className="m-menu" key={pathname} ref={menu}>
            <summary aria-label="Menu">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.5 5h11M2.5 11h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </summary>
            <nav className="m-menu-panel" aria-label="Main">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} aria-current={current(l.href)}>
                  {l.label}
                </Link>
              ))}
              <a href={GITHUB}>GitHub</a>
              <Link href="/login">Sign in</Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
