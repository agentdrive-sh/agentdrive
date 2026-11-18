import type { Metadata } from 'next';
import { faqPageJsonLd, Inline } from '@/components/marketing/faq';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { JsonLd } from '@/components/seo/json-ld';
import { OPEN_GRAPH_BASE, SOFTWARE_ID } from '@/components/seo/site';
import { formatPostDate } from '@/lib/source';
import { alt, size } from '../opengraph-image';
import { FACTS, FACTS_AS_OF, FACTS_DESCRIPTION } from './facts';

const PAGE_URL = 'https://agentdrive.sh/facts';

export const metadata: Metadata = {
  title: 'Facts',
  description: FACTS_DESCRIPTION,
  alternates: { canonical: '/facts', types: { 'text/markdown': '/facts/index.md' } },
  openGraph: {
    ...OPEN_GRAPH_BASE,
    url: '/facts',
    title: 'AgentDrive facts',
    description: FACTS_DESCRIPTION,
    images: [{ url: '/opengraph-image', ...size, alt }],
  },
};

const ABOUT_PAGE = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  name: 'AgentDrive facts',
  url: PAGE_URL,
  description: FACTS_DESCRIPTION,
  dateModified: FACTS_AS_OF,
  about: { '@id': SOFTWARE_ID },
};

export default function FactsPage() {
  return (
    <MarketingPageShell screenLabel="marketing/facts">
      <PageHero
        title="AgentDrive facts"
        lede="The canonical facts about AgentDrive, for people and for the tools that answer questions about it."
        meta={
          <>
            As of <time dateTime={FACTS_AS_OF}>{formatPostDate(FACTS_AS_OF)}</time>. Also as{' '}
            <a className="m-link" href="/facts/index.md">
              markdown
            </a>
            .
          </>
        }
      />
      <ProseSection>
        {FACTS.map(({ q, a }) => (
          <section key={q}>
            <h2>{q}</h2>
            {a.map((p) => (
              <p key={p}>
                <Inline text={p} />
              </p>
            ))}
          </section>
        ))}
      </ProseSection>
      <JsonLd data={[ABOUT_PAGE, faqPageJsonLd(FACTS)]} />
    </MarketingPageShell>
  );
}
