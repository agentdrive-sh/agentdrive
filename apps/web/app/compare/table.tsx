'use client';

import { useId, useState } from 'react';
import { AGENTDRIVE_ROW, ROWS, type Competitor } from './data';

export function ComparisonTable({ competitors }: { competitors: Competitor[] }) {
  const id = useId();
  const [slug, setSlug] = useState(competitors[0]?.slug);
  const selected = competitors.find((c) => c.slug === slug) ?? competitors[0];
  return (
    <>
    <div className="m-compare-mobile">
      {competitors.length > 1 && <div className="m-compare-picker">
        <label htmlFor={id}>Compare AgentDrive with</label>
        <select id={id} value={selected?.slug} onChange={(e) => setSlug(e.target.value)}>
          {competitors.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </div>}
      {selected && <dl className="m-compare-pairs">
        {ROWS.map((row) => <div key={row}>
          <dt>{row}</dt>
          <dd><strong>AgentDrive</strong><span>{AGENTDRIVE_ROW[row]}</span></dd>
          <dd><strong>{selected.name}</strong><span>{selected.row[row]}</span></dd>
        </div>)}
      </dl>}
    </div>
    <div className="m-table-wrap m-compare m-compare-desktop" role="region" aria-label="Feature comparison" tabIndex={0}>
      <table className="m-table">
        <thead>
          <tr>
            <th scope="col">
              Feature
            </th>
            <th scope="col" className="is-us">
              AgentDrive
            </th>
            {competitors.map((c) => (
              <th key={c.slug} scope="col">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row}>
              <th scope="row">{row}</th>
              <td className="is-us">{AGENTDRIVE_ROW[row]}</td>
              {competitors.map((c) => (
                <td key={c.slug}>{c.row[row]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
