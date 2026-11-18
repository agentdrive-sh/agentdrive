import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FaqSection, Rich, SITE, breadcrumbLd, faqLd, pageMetadata, plain } from '@/components/marketing/answer-page';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { IntegrationSection, Snippet } from '@/components/marketing/integration-page';
import { JsonLd } from '@/components/seo/json-ld';
import { PAIRS, getPair, pairSlug, type Pair } from '../data';

export const dynamicParams = false;

export function generateStaticParams() {
  return PAIRS.map((p) => ({ pair: p.slug }));
}

function title(p: Pair): string {
  return `Continue ${p.from.article} ${p.from.label} session in ${p.to.label}`;
}

export async function generateMetadata(props: { params: Promise<{ pair: string }> }): Promise<Metadata> {
  const p = getPair((await props.params).pair);
  if (!p) notFound();
  const description = `${title(p)}: AgentDrive syncs it in the background and ${p.to.label} resumes it with the goal, files touched and recent turns.`;
  return pageMetadata(title(p), description, `/resume/${p.slug}`);
}

export default async function ResumePairPage(props: { params: Promise<{ pair: string }> }) {
  const p = getPair((await props.params).pair);
  if (!p) notFound();
  const { from, to } = p;
  const path = `/resume/${p.slug}`;
  const reverse = pairSlug(to.id, from.id);
  const others = PAIRS.filter((o) => o.slug !== p.slug && o.slug !== reverse && (o.from.id === from.id || o.to.id === to.id));

  return (
    <MarketingPageShell screenLabel={`marketing/resume/${p.slug}`}>
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: title(p),
            description: plain(p.answer),
            url: `${SITE}${path}`,
            step: p.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: plain(s.text) })),
          },
          faqLd(p.faq),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Resume', path: '/resume' },
            { name: `${from.label} to ${to.label}`, path },
          ]),
        ]}
      />
      <PageHero kicker="Resume across agents" kickerHref="/resume" title={title(p)} lede={<Rich text={p.answer} />} />
      <ProseSection>
        <IntegrationSection id="steps" title="Steps">
          <ol>
            {p.steps.map((s) => (
              <li key={s.name}>
                <h3>{s.name}</h3>
                <p>
                  <Rich text={s.text} />
                </p>
                {s.code && <Snippet>{s.code}</Snippet>}
              </li>
            ))}
          </ol>
          <p>
            From a shell, <code>adrive resume --list</code> lists this project&apos;s sessions and{' '}
            <code>adrive resume &lt;id&gt;</code> prints the brief for one.
          </p>
        </IntegrationSection>

        <IntegrationSection id="caveats" title={`Before you switch from ${from.label} to ${to.label}`}>
          <ul>
            {p.caveats.map((c) => (
              <li key={c}>
                <Rich text={c} />
              </li>
            ))}
          </ul>
          {p.notes.map((n) => (
            <p key={n.text}>
              {n.text} <a href={n.source}>Source</a>.
            </p>
          ))}
        </IntegrationSection>

        <IntegrationSection id="what-carries-over" title="What carries over">
          <ul>
            <li>The goal, the files touched and the most recent turns, as a compact brief (12,000 characters by default).</li>
            <li>Files the {from.label} agent wrote that git doesn&apos;t track, such as plans and notes.</li>
            <li>The full redacted transcript, which stays in your workspace and is searchable later.</li>
            <li>
              Sessions encrypted with Private Workspace resume with <code>adrive resume &lt;id&gt;</code> on a machine
              that holds your key.
            </li>
          </ul>
        </IntegrationSection>

        <FaqSection faq={p.faq} />

        <IntegrationSection id="related" title="Related guides">
          <ul>
            <li>
              <Link href={`/resume/${reverse}`}>
                Continue {to.article} {to.label} session in {from.label}
              </Link>
              , the same handoff in reverse
            </li>
            <li>
              <Link href={`/integrations/${from.id}`}>AgentDrive for {from.label}</Link> and{' '}
              <Link href={`/integrations/${to.id}`}>AgentDrive for {to.label}</Link>: setup details for each agent
            </li>
            <li>
              <Link href="/docs/quick-start">Quick start</Link>: install, sign in and run your first handoff
            </li>
          </ul>
          <h3>Other handoffs</h3>
          <ul>
            {others.map((o) => (
              <li key={o.slug}>
                <Link href={`/resume/${o.slug}`}>
                  Continue {o.from.article} {o.from.label} session in {o.to.label}
                </Link>
              </li>
            ))}
          </ul>
        </IntegrationSection>
      </ProseSection>
    </MarketingPageShell>
  );
}
