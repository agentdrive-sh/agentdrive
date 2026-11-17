import { Icon } from '../icon';
import { StatusPill } from '../shared';

export interface Invoice {
  id: string;
  date: string;
  total: number;
  currency?: string;
  status: 'paid' | 'pending' | 'failed' | string;
  pdfUrl?: string;
}

interface Props {
  inv: Invoice;
}

export function InvoiceRow({ inv }: Props) {
  const status =
    inv.status === 'paid'
      ? 'success'
      : inv.status === 'failed'
        ? 'failed'
        : 'pending';
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
        ${inv.total.toFixed(2)}
      </span>
      <StatusPill status={status} />
      <a
        className="btn sm ghost"
        href={inv.pdfUrl ?? '#'}
        target={inv.pdfUrl ? '_blank' : undefined}
        rel="noreferrer"
        style={{ justifySelf: 'end' }}
        aria-label="Download invoice PDF"
      >
        <Icon name="download" size={11} />
      </a>
    </div>
  );
}
