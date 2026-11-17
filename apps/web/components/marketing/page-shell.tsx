import type { ReactNode } from 'react';
import Link from 'next/link';
import { MarketingNav } from './nav';
import { MarketingFooter } from './footer';

interface MarketingPageShellProps {
  children: ReactNode;
  screenLabel?: string;
}

export function MarketingPageShell({
  children,
  screenLabel,
}: MarketingPageShellProps) {
  return (
    <div className="marketing" data-screen-label={screenLabel}>
      <a className="m-skip" href="#main">
        Skip to content
      </a>
      <MarketingNav />
      <main id="main">{children}</main>
      <MarketingFooter />
    </div>
  );
}

export function PageHero({
  kicker,
  kickerHref,
  title,
  lede,
  meta,
  actions,
  width = 'narrow',
}: {
  kicker?: string;
  kickerHref?: string;
  title: string;
  lede?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  width?: 'narrow' | 'wide';
}) {
  return (
    <section className={`m-wrap ${width === 'narrow' ? 'narrow' : ''} m-page-hero`}>
      {kicker && (
        <p className="m-crumb">
          {kickerHref ? <Link href={kickerHref}>{kicker}</Link> : kicker}
        </p>
      )}
      <h1 className="m-h1 page">{title}</h1>
      {lede && <p className="m-lede">{lede}</p>}
      {meta && <p className="m-meta">{meta}</p>}
      {actions && <div className="m-actions">{actions}</div>}
    </section>
  );
}

export function ProseSection({ children }: { children: ReactNode }) {
  return <section className="m-wrap narrow m-prose">{children}</section>;
}
