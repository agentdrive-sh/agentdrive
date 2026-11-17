import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { IntegrationSection, PromptExample, Snippet } from '@/components/marketing/integration-page';
import { INSTALL_COMMAND } from '../../integrations/data';
import { PAIRS, getPair, pairSlug } from '../data';

export const dynamicParams = false;

export function generateStaticParams() {
  return PAIRS.map((p) => ({ pair: p.slug }));
}

function describe(from: string, to: string): string {
  return `Hit a limit in ${from}? AgentDrive syncs the ${from} session in the background and resumes it in ${to} with the goal, files touched and recent turns. Works in both directions.`;
}

export async function generateMetadata(props: { params: Promise<{ pair: string }> }): Promise<Metadata> {
  const p = getPair((await props.params).pair);
  if (!p) notFound();
  const title = `Resume a ${p.from.label} session in ${p.to.label}`;
  const description = describe(p.from.label, p.to.label);
  return {
    title,
    description,
    alternates: { canonical: `/resume/${p.slug}` },
    openGraph: { title, description, url: `/resume/${p.slug}` },
  };
}

export default async function ResumePairPage(props: { params: Promise<{ pair: string }> }) {
  const p = getPair((await props.params).pair);
  if (!p) notFound();
  const { from, to } = p;
  const prompt = `Resume my last AgentDrive session from ${from.label}.`;
  const others = PAIRS.filter((o) => o.slug !== p.slug && (o.from.id === from.id || o.to.id === to.id));

  return (
    <MarketingPageShell screenLabel={`marketing/resume/${p.slug}`}>
      <PageHero
        kicker="Resume across agents"
        kickerHref="/resume"
        title={`Resume a ${from.label} session in ${to.label}`}
        lede={`Hit a usage limit in ${from.label}, or want a second model's take? AgentDrive syncs the ${from.label} session in the background and loads it into ${to.label} as a handoff brief: the goal, the files touched and the most recent turns.`}
      />
      <ProseSection>
        {p.notes.length > 0 && (
          <IntegrationSection id="good-to-know" title="Good to know">
            {p.notes.map((n) => (
              <p key={n.text}>
                {n.text} <a href={n.source}>Source</a>.
              </p>
            ))}
          </IntegrationSection>
        )}

        <IntegrationSection id="install" title="1. Install once">
          <Snippet>{INSTALL_COMMAND}</Snippet>
          <p>
            It signs you in and wires session sync and resume into every agent it finds on this machine,{' '}
            {from.label} and {to.label} included.
          </p>
          {from.profile.setup && <p>{from.profile.setup}</p>}
          {to.profile.setup && <p>{to.profile.setup}</p>}
        </IntegrationSection>

        <IntegrationSection id="capture" title={`2. Work in ${from.label} as usual`}>
          <p>{from.profile.capture}</p>
          <p>
            The sync uploads the redacted transcript, plus files the agent wrote that git doesn&apos;t track, to{' '}
            <code>sessions/&lt;project&gt;/{from.id}/&lt;session&gt;.md</code> in your workspace. Before you switch,
            leave a clear goal and next step in the session; the brief carries them over.
          </p>
        </IntegrationSection>

        <IntegrationSection id="resume" title={`3. Resume in ${to.label}`}>
          <p>Open {to.label} in the same project{to.profile.command ? <> and run:</> : <> and ask:</>}</p>
          {to.profile.command ? <Snippet>{to.profile.command}</Snippet> : <PromptExample>{prompt}</PromptExample>}
          <p>
            {to.label} calls <code>drive_resume</code>, which loads the latest session in this project from a
            different agent. If you run several agents, name the source so it picks the right one:
          </p>
          {to.profile.command && <PromptExample>{prompt}</PromptExample>}
          <p>From a shell, the same brief is one command away:</p>
          <Snippet>{'adrive resume --list\nadrive resume <id from the list>'}</Snippet>
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
          <p>
            Ask {to.label} to check the files on disk before it continues: the brief says what happened, the repo says
            what is true now. When you are done, hand the work back with the{' '}
            <Link href={`/resume/${pairSlug(to.id, from.id)}`}>
              {to.label} to {from.label}
            </Link>{' '}
            handoff.
          </p>
        </IntegrationSection>

        <IntegrationSection id="other-handoffs" title="Other handoffs">
          <ul>
            {others.map((o) => (
              <li key={o.slug}>
                <Link href={`/resume/${o.slug}`}>
                  Resume a {o.from.label} session in {o.to.label}
                </Link>
              </li>
            ))}
          </ul>
          <p>
            Setup details for each agent are on the <Link href={`/integrations/${from.id}`}>{from.label}</Link> and{' '}
            <Link href={`/integrations/${to.id}`}>{to.label}</Link> integration pages.
          </p>
        </IntegrationSection>
      </ProseSection>
    </MarketingPageShell>
  );
}
