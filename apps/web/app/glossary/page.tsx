import Link from 'next/link';
import { plainText } from '@/components/marketing/faq';
import { MarketingPageShell, PageHero } from '@/components/marketing/page-shell';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbList, pageMetadata, SITE_URL } from '@/components/seo/site';
import { GLOSSARY, GLOSSARY_DESCRIPTION, GLOSSARY_SET_ID } from './glossary';

export const metadata = pageMetadata('Glossary of coding-agent terms', GLOSSARY_DESCRIPTION, '/glossary');

const TERM_SET = {
  '@context': 'https://schema.org',
  '@type': 'DefinedTermSet',
  '@id': GLOSSARY_SET_ID,
  name: 'AgentDrive glossary',
  description: GLOSSARY_DESCRIPTION,
  url: `${SITE_URL}/glossary`,
  hasDefinedTerm: GLOSSARY.map((t) => ({
    '@type': 'DefinedTerm',
    '@id': `${SITE_URL}/glossary/${t.slug}#term`,
    name: t.term,
    description: plainText(t.definition),
    url: `${SITE_URL}/glossary/${t.slug}`,
  })),
};

export default function GlossaryIndex() {
  return (
    <MarketingPageShell screenLabel="marketing/glossary">
      <JsonLd
        data={[
          TERM_SET,
          breadcrumbList([
            { name: 'Home', path: '/' },
            { name: 'Glossary', path: '/glossary' },
          ]),
        ]}
      />
      <PageHero
        title="Glossary"
        lede="Short definitions of the terms behind coding agents and moving work between them, with what each one means in AgentDrive."
      />
      <section className="m-section tight">
        <div className="m-wrap narrow">
          <ul className="m-rows">
            {GLOSSARY.map((t) => (
              <li key={t.slug}>
                <Link href={`/glossary/${t.slug}`} className="m-row">
                  <span className="m-row-title">{t.term}</span>
                  <span className="m-row-body">{plainText(t.definition)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </MarketingPageShell>
  );
}
