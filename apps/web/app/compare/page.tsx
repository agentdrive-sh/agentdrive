import Link from 'next/link';
import { FaqSection, breadcrumbLd, faqLd, pageMetadata } from '@/components/marketing/answer-page';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { JsonLd } from '@/components/seo/json-ld';
import { AGENTDRIVE_MATRIX, COMPARE_FAQ, COMPARE_LEDE, COMPETITORS, LAST_CHECKED, MATRIX_COLS, MATRIX_NOTE } from './data';

export const metadata = pageMetadata(
  'AgentDrive vs the alternatives',
  'How AgentDrive compares with built-in resume, session history tools, memory layers, MCP servers and CLAUDE.md, and when each is the right tool.',
  '/compare',
);


export default function CompareIndex() {
  return (
    <MarketingPageShell screenLabel="marketing/compare">
      <JsonLd
        data={[
          faqLd(COMPARE_FAQ),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Compare', path: '/compare' },
          ]),
        ]}
      />
      <PageHero
        width="wide"
        title="AgentDrive vs the alternatives"
        lede={COMPARE_LEDE}
        meta={`Last checked ${LAST_CHECKED}.`}
      />
      <section className="m-wrap" aria-label="Comparison matrix">
        <div className="m-compare-mobile" data-markdown-ignore>
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
        <p className="m-meta m-table-note">{MATRIX_NOTE}</p>
      </section>
      <section className="m-section tight">
        <div className="m-wrap">
          <h2 className="m-h3">Detailed comparisons</h2>
          <ul className="m-rows">
            {COMPETITORS.map((c) => (
              <li key={c.slug}>
                <Link href={`/compare/${c.slug}`} className="m-row">
                  <span className="m-row-title">AgentDrive vs {c.name}</span>{' '}
                  <span className="m-row-body">{c.tagline}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <ProseSection>
        <FaqSection faq={COMPARE_FAQ} />
      </ProseSection>
    </MarketingPageShell>
  );
}
