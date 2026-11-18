import Link from 'next/link';
import { pageMetadata } from '@/components/marketing/answer-page';
import { MarketingPageShell, PageHero } from '@/components/marketing/page-shell';
import { COMPETITORS, LAST_CHECKED } from './data';
import { ComparisonTable } from './table';

export const metadata = pageMetadata(
  'Compare AgentDrive with memory and file tools',
  'How AgentDrive compares with Mem0, Cloudflare Agent Memory, the Filesystem MCP server and CLAUDE.md handoff notes, and when to pick which.',
  '/compare',
);

export default function CompareIndex() {
  return (
    <MarketingPageShell screenLabel="marketing/compare">
      <PageHero
        width="wide"
        title="Where AgentDrive fits."
        lede="Choose AgentDrive to carry work between coding agents. Choose a memory service when you are building an app that remembers its users. Choose Filesystem MCP for direct access to local files, and CLAUDE.md or AGENTS.md for rules every session should follow. Compare the details below."
      />
      <section className="m-wrap" aria-label="Comparison table">
        <ComparisonTable competitors={COMPETITORS} />
        <p className="m-meta m-table-note">
          Last checked {LAST_CHECKED}. Competitor details come from their own docs and announcements, linked on each
          page.
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
    </MarketingPageShell>
  );
}
