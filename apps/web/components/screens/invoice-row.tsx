import { Icon } from '../icon';
import { StatusPill } from '../shared';
import type { InvoiceSummary } from '../../lib/api-client';

interface Props {
  inv: InvoiceSummary;
}

export function InvoiceRow({ inv }: Props) {
  const link = inv.pdfUrl ?? inv.hostedUrl;
  const hasPdf = inv.pdfUrl && inv.pdfUrl !== inv.hostedUrl;
  return (
    <div
      className="row-item"
      style={{
        gridTemplateColumns: '120px 1fr 100px 90px 90px',
        gap: 14,
        padding: '12px 18px',
      }}
    >
      <span className="mono t-sm faint">{inv.id}</span>
      <span className="mono t-sm muted">{inv.date}</span>
      <span className="mono t-sm fg-0">
        {new Intl.NumberFormat('en-US', { style: 'currency', currency: inv.currency ?? 'USD' }).format(inv.total)}
      </span>
      <StatusPill status={inv.status} />
      {link && <a
        className="btn sm ghost"
        href={link}
        target="_blank"
        rel="noreferrer"
        style={{ justifySelf: 'end' }}
        aria-label={hasPdf ? 'Download invoice PDF' : 'Open hosted invoice'}
      >
        <Icon name={hasPdf ? 'download' : 'arrow-right'} size={11} />
      </a>}
    </div>
  );
}
