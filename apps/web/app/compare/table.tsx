import { AGENTDRIVE_ROW, ROWS, type Competitor } from './data';

export function ComparisonTable({ competitor }: { competitor: Competitor }) {
  return (
    <>
    <div className="m-compare-mobile">
      <dl className="m-compare-pairs">
        {ROWS.map((row) => <div key={row}>
          <dt>{row}</dt>
          <dd><strong>AgentDrive</strong><span>{AGENTDRIVE_ROW[row]}</span></dd>
          <dd><strong>{competitor.name}</strong><span>{competitor.row[row]}</span></dd>
        </div>)}
      </dl>
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
            <th scope="col">
              {competitor.name}
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row}>
              <th scope="row">{row}</th>
              <td className="is-us">{AGENTDRIVE_ROW[row]}</td>
              <td>{competitor.row[row]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
