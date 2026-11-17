import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { COMPETITORS, LAST_CHECKED, getCompetitor } from '../data';
import { ComparisonTable } from '../table';

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = getCompetitor((await props.params).slug);
  if (!c) notFound();
  const title = `AgentDrive vs ${c.name}`;
  return {
    title,
    description: c.tagline,
    alternates: { canonical: `/compare/${c.slug}` },
    openGraph: { title, description: c.tagline, url: `/compare/${c.slug}` },
  };
}

export default async function ComparePage(props: { params: Promise<{ slug: string }> }) {
  const c = getCompetitor((await props.params).slug);
  if (!c) notFound();
  const sources = [...new Set(c.facts.map((f) => f.source))];

  return (
    <MarketingPageShell screenLabel={`marketing/compare/${c.slug}`}>
      <PageHero
        kicker="Compare"
        kickerHref="/compare"
        title={`AgentDrive vs ${c.name}`}
        lede={c.tagline}
        meta={`Last checked ${LAST_CHECKED}.`}
      />
      <ProseSection>
        <section>
          <h2>When to pick which</h2>
          <div className="m-pick">
            <div className="m-panel">
              <p className="m-panel-title">Pick {c.name} when</p>
              <p>{c.pickThem}</p>
            </div>
            <div className="m-panel accent">
              <p className="m-panel-title">Pick AgentDrive when</p>
              <p>{c.pickUs}</p>
            </div>
          </div>
          <p>They also work side by side: nothing stops an agent from using both.</p>
        </section>

      </ProseSection>
      <section className="m-wrap narrow m-compare-one" aria-label="Comparison table">
        <ComparisonTable competitors={[c]} />
      </section>
      <ProseSection>
        <section>
          <h2>What {c.name} is</h2>
          <ul>
            {c.facts.map((f) => (
              <li key={f.text}>{f.text}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2>What {c.name} is good at</h2>
          <ul>
            {c.goodAt.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2>What AgentDrive does differently</h2>
          <ul>
            {c.different.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>


        <section>
          <h2>Sources</h2>
          <ul className="m-sources">
            {sources.map((s) => (
              <li key={s}>
                <a href={s} rel="noopener noreferrer">
                  {s}
                </a>
              </li>
            ))}
          </ul>
          <div className="m-actions m-actions-end">
            <Link href="/docs/quick-start" className="btn lg primary">
              Quick start
            </Link>
            <Link href="/compare" className="btn lg secondary">
              All comparisons
            </Link>
          </div>
        </section>
      </ProseSection>
    </MarketingPageShell>
  );
}
