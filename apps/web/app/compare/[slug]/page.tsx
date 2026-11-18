import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FaqSection, Rich, breadcrumbLd, faqLd, pageMetadata, type Faq } from '@/components/marketing/answer-page';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { JsonLd } from '@/components/seo/json-ld';
import { COMPETITORS, LAST_CHECKED, getCompetitor, type Competitor } from '../data';
import { ComparisonTable } from '../table';

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = getCompetitor((await props.params).slug);
  if (!c) notFound();
  return pageMetadata(`AgentDrive vs ${c.name}`, c.description, `/compare/${c.slug}`, `/compare/${c.slug}/opengraph-image`);
}

function faqFor(c: Competitor): Faq[] {
  return [
    { q: `What is the difference between ${c.name} and AgentDrive?`, a: c.tagline },
    { q: `When should I use ${c.name}?`, a: c.pickThem },
    { q: 'When should I use AgentDrive instead?', a: c.pickUs },
    { q: `Can I use AgentDrive alongside ${c.name}?`, a: `Yes. ${c.together}` },
  ];
}

export default async function ComparePage(props: { params: Promise<{ slug: string }> }) {
  const c = getCompetitor((await props.params).slug);
  if (!c) notFound();
  const sources = [...new Set(c.facts.map((f) => f.source))];
  const faq = faqFor(c);

  return (
    <MarketingPageShell screenLabel={`marketing/compare/${c.slug}`}>
      <JsonLd
        data={[
          faqLd(faq),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Compare', path: '/compare' },
            { name: `AgentDrive vs ${c.name}`, path: `/compare/${c.slug}` },
          ]),
        ]}
      />
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
          <p>{c.together}</p>
        </section>

      </ProseSection>
      <section className="m-wrap narrow m-compare-one" aria-label="Comparison table">
        <ComparisonTable competitor={c} />
      </section>
      <ProseSection>
        <section>
          <h2>About {c.name}</h2>
          <ul>
            {c.facts.map((f) => (
              <li key={f.text}><Rich text={f.text} /></li>
            ))}
          </ul>
        </section>

        {c.sections?.map((s) => (
          <section key={s.title}>
            <h2>{s.title}</h2>
            {s.body.map((b) => (
              <p key={b}><Rich text={b} /></p>
            ))}
          </section>
        ))}

        <section>
          <h2>Where {c.name} works well</h2>
          <ul>
            {c.goodAt.map((g) => (
              <li key={g}><Rich text={g} /></li>
            ))}
          </ul>
        </section>

        <section>
          <h2>What AgentDrive does differently</h2>
          <ul>
            {c.different.map((d) => (
              <li key={d}><Rich text={d} /></li>
            ))}
          </ul>
        </section>

        <FaqSection faq={faq} />

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
