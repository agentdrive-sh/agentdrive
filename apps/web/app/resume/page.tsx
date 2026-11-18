import Link from 'next/link';
import { Rich, breadcrumbLd, pageMetadata } from '@/components/marketing/answer-page';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { JsonLd } from '@/components/seo/json-ld';
import { INSTALL_COMMAND } from '../integrations/data';
import { HARNESSES, pairSlug } from './data';

export const metadata = pageMetadata(
  'Resume a coding-agent session in another agent',
  'Continue a Claude Code, Codex, Cursor, OpenCode or Antigravity session in any of the others. Pick the pair you need and follow its resume steps.',
  '/resume',
);

const ANSWER = `To continue a coding-agent session in a different agent, install AgentDrive once with \`${INSTALL_COMMAND}\`. Hooks in Claude Code, Codex, OpenCode, Cursor and Antigravity sync each session to your workspace in the background. Open the other agent in the same project and run its resume command; it loads the goal, the files touched and the recent turns.`;

export default function ResumeIndex() {
  return (
    <MarketingPageShell screenLabel="marketing/resume">
      <JsonLd data={breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Resume', path: '/resume' }])} />
      <PageHero kicker="Resume across agents" title="Resume a session in another coding agent" lede={<Rich text={ANSWER} />} />
      <ProseSection>
        <section id="matrix">
          <h2>Every handoff</h2>
          <p>Rows are the agent the session started in; columns are the agent that picks it up.</p>
          <div className="m-table-wrap" role="region" aria-label="Resume guides by agent pair" tabIndex={0}>
            <table className="m-table">
              <thead>
                <tr>
                  <th scope="col">From \ To</th>
                  {HARNESSES.map((to) => (
                    <th key={to.id} scope="col">
                      {to.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HARNESSES.map((from) => (
                  <tr key={from.id}>
                    <th scope="row">{from.label}</th>
                    {HARNESSES.map((to) => (
                      <td key={to.id}>
                        {to.id === from.id ? (
                          'Same agent'
                        ) : (
                          <Link href={`/resume/${pairSlug(from.id, to.id)}`}>
                            {from.label} to {to.label}
                          </Link>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="commands">
          <h2>The resume command in each agent</h2>
          <ul>
            {HARNESSES.map((h) => (
              <li key={h.id}>
                <Link href={`/integrations/${h.id}`}>{h.label}</Link>: <Rich text={h.profile.resumeShort} />
              </li>
            ))}
            <li>
              Any shell: <code>adrive resume</code>
            </li>
          </ul>
          <p>
            New to AgentDrive? Start with the <Link href="/docs/quick-start">quick start</Link>.
          </p>
        </section>
      </ProseSection>
    </MarketingPageShell>
  );
}
