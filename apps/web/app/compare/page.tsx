import Link from 'next/link';
import { FaqSection, breadcrumbLd, faqLd, pageMetadata, type Faq } from '@/components/marketing/answer-page';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { JsonLd } from '@/components/seo/json-ld';
import { AGENTDRIVE_MATRIX, COMPETITORS, LAST_CHECKED, MATRIX_COLS } from './data';

export const metadata = pageMetadata(
  'AgentDrive vs the alternatives',
  'How AgentDrive compares with built-in resume, session history tools, memory layers, MCP servers and CLAUDE.md, and when each is the right tool.',
  '/compare',
);

const FAQ: Faq[] = [
  {
    q: 'When is AgentDrive the right tool?',
    a: 'When one task moves between coding agents or machines. AgentDrive syncs each session from Claude Code, Codex, OpenCode, Cursor and Antigravity, and the next agent resumes from a handoff brief with the goal, the files touched and the recent turns.',
  },
  {
    q: 'When is AgentDrive the wrong tool?',
    a: "When you stay in one agent, its built-in resume restores the full conversation. When you are building an app that remembers its users, use a memory layer such as Mem0 or Cloudflare Agent Memory. For rules every session should follow, write CLAUDE.md or AGENTS.md.",
  },
  {
    q: 'Which alternative is closest to AgentDrive?',
    a: 'Session history tools. SpecStory and Entire also save sessions from several coding agents, and SpecStory can resume a session in a different agent. AgentDrive differs in handing the next agent a short brief, and in keeping the files agents write in a versioned workspace with provenance.',
  },
  {
    q: 'Can I use AgentDrive alongside these tools?',
    a: 'Yes. Most of them hold something different: project rules, facts about users, or a full session record. AgentDrive carries the state of the current task from one agent to the next.',
  },
];

export default function CompareIndex() {
  return (
    <MarketingPageShell screenLabel="marketing/compare">
      <JsonLd
        data={[
          faqLd(FAQ),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Compare', path: '/compare' },
          ]),
        ]}
      />
      <PageHero
        width="wide"
        title="AgentDrive vs the alternatives"
        lede="AgentDrive is the right tool when one task moves between coding agents or machines: it syncs each session and hands the next agent the goal, files touched and recent turns. It is not the right tool if you stay in one agent, need memory for an app you build, or only need standing project rules."
        meta={`Last checked ${LAST_CHECKED}.`}
      />
      <section className="m-wrap" aria-label="Comparison matrix">
        <div className="m-compare-mobile">
          <dl className="m-compare-pairs">
            <div>
              <dt>AgentDrive</dt>
              {MATRIX_COLS.map((col) => (
                <dd key={col}>
                  <strong>{col}</strong>
                  <span>{AGENTDRIVE_MATRIX[col]}</span>
                </dd>
              ))}
            </div>
            {COMPETITORS.map((c) => (
              <div key={c.slug}>
                <dt>
                  <Link href={`/compare/${c.slug}`}>{c.name}</Link>
                </dt>
                {MATRIX_COLS.map((col) => (
                  <dd key={col}>
                    <strong>{col}</strong>
                    <span>{c.matrix[col]}</span>
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </div>
        <div className="m-table-wrap m-compare m-compare-desktop" role="region" aria-label="Comparison matrix" tabIndex={0}>
          <table className="m-table">
            <thead>
              <tr>
                <th scope="col">Tool</th>
                {MATRIX_COLS.map((col) => (
                  <th key={col} scope="col">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="is-us">
                  AgentDrive
                </th>
                {MATRIX_COLS.map((col) => (
                  <td key={col} className="is-us">
                    {AGENTDRIVE_MATRIX[col]}
                  </td>
                ))}
              </tr>
              {COMPETITORS.map((c) => (
                <tr key={c.slug}>
                  <th scope="row">
                    <Link href={`/compare/${c.slug}`}>{c.name}</Link>
                  </th>
                  {MATRIX_COLS.map((col) => (
                    <td key={col}>{c.matrix[col]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-meta m-table-note">
          Last checked {LAST_CHECKED}. Details for other tools come from their own docs and announcements, linked on each
          comparison page.
        </p>
      </section>
      <section className="m-section tight">
        <div className="m-wrap">
          <h2 className="m-h3">Detailed comparisons</h2>
          <ul className="m-rows">
            {COMPETITORS.map((c) => (
              <li key={c.slug}>
                <Link href={`/compare/${c.slug}`} className="m-row">
                  <span className="m-row-title">AgentDrive vs {c.name}</span>
                  <span className="m-row-body">{c.tagline}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <ProseSection>
        <FaqSection faq={FAQ} />
      </ProseSection>
    </MarketingPageShell>
  );
}
