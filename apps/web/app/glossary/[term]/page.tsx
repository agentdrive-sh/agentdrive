import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Inline, plainText } from '@/components/marketing/faq';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbList, pageMetadata, SITE_URL } from '@/components/seo/site';
import { getTerm, GLOSSARY, GLOSSARY_SET_ID } from '../glossary';

export const dynamicParams = false;

export function generateStaticParams() {
  return GLOSSARY.map((t) => ({ term: t.slug }));
}

export async function generateMetadata(props: { params: Promise<{ term: string }> }): Promise<Metadata> {
  const t = getTerm((await props.params).term);
  if (!t) notFound();
  const path = `/glossary/${t.slug}`;
  const meta = pageMetadata(`${t.term}: definition`, t.description, path);
  return { ...meta, alternates: { ...meta.alternates, types: { 'text/markdown': `${path}/index.md` } } };
}

export default async function GlossaryTermPage(props: { params: Promise<{ term: string }> }) {
  const t = getTerm((await props.params).term);
  if (!t) notFound();
  const path = `/glossary/${t.slug}`;
  const related = t.related.flatMap((slug) => getTerm(slug) ?? []);

  return (
    <MarketingPageShell screenLabel={`marketing/glossary/${t.slug}`}>
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'DefinedTerm',
            '@id': `${SITE_URL}${path}#term`,
            name: t.term,
            ...(t.aka && { alternateName: t.aka }),
            description: plainText(t.definition),
            url: `${SITE_URL}${path}`,
            inDefinedTermSet: { '@type': 'DefinedTermSet', '@id': GLOSSARY_SET_ID, name: 'AgentDrive glossary', url: `${SITE_URL}/glossary` },
            ...(t.source && { sameAs: t.source.href }),
          },
          breadcrumbList([
            { name: 'Home', path: '/' },
            { name: 'Glossary', path: '/glossary' },
            { name: t.term, path },
          ]),
        ]}
      />
      <PageHero
        kicker="Glossary"
        kickerHref="/glossary"
        title={t.term}
        lede={<Inline text={t.definition} />}
        meta={
          <>
            Also as{' '}
            <a className="m-link" href={`${path}/index.md`}>
              markdown
            </a>
            .
          </>
        }
      />
      <ProseSection>
        <section>
          <p>
            <Inline text={t.explanation} />
          </p>
        </section>
        <section>
          <h2>In AgentDrive</h2>
          <p>
            <Inline text={t.agentdrive} />
          </p>
        </section>
        <section>
          <h2>Related terms</h2>
          <ul>
            {related.map((r) => (
              <li key={r.slug}>
                <Link className="m-link" href={`/glossary/${r.slug}`}>
                  {r.term}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Go deeper</h2>
          <ul>
            {t.links.map((l) => (
              <li key={l.href}>
                <a className="m-link" href={l.href}>
                  {l.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
        {t.source && (
          <section>
            <h2>Official source</h2>
            <p>
              <a className="m-link" href={t.source.href} rel="noopener noreferrer">
                {t.source.title}
              </a>
            </p>
          </section>
        )}
      </ProseSection>
    </MarketingPageShell>
  );
}
