import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { HARNESSES, PAIRS } from './data';

const DESCRIPTION =
  'Start a coding-agent session in Claude Code, Codex, Cursor, OpenCode or Antigravity and resume it in any of the others, in any direction.';

export const metadata: Metadata = {
  title: 'Resume a session in another coding agent',
  description: DESCRIPTION,
  alternates: { canonical: '/resume' },
};

export default function ResumeIndex() {
  return (
    <MarketingPageShell screenLabel="marketing/resume">
      <PageHero kicker="Resume across agents" title="Resume a session in another coding agent" lede={DESCRIPTION} />
      <ProseSection>
        {HARNESSES.map((from) => (
          <section key={from.id}>
            <h2>From {from.label}</h2>
            <ul>
              {PAIRS.filter((p) => p.from.id === from.id).map((p) => (
                <li key={p.slug}>
                  <Link href={`/resume/${p.slug}`}>
                    Resume a {from.label} session in {p.to.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </ProseSection>
    </MarketingPageShell>
  );
}
