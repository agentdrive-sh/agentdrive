import type { ShareTokenMeta } from '@agentdrive/shared';
import { Icon } from '../icon';

interface Props {
  data: ShareTokenMeta;
  busy: boolean;
  onRevoke: () => void;
}

export function ShareRow({ data, busy, onRevoke }: Props) {
  const expires = data.expires_at
    ? new Date(data.expires_at).toISOString().split('T')[0]
    : null;

  return (
    <div
      className="row-item"
      style={{
        gridTemplateColumns: '110px 2fr 140px 120px 90px 100px 90px',
        gap: 14,
        padding: '14px 16px',
      }}
    >
      <span className="mono t-sm faint">{data.token_id}</span>
      <div className="col" style={{ minWidth: 0, lineHeight: 1.25 }}>
        <span className="mono t-sm fg-0">{data.file_id ?? 'whole workspace'}</span>
        <span className="t-xs faint mono">{data.workspace_id}</span>
      </div>
      <span className="mono t-sm muted">
        {data.email ? (
          data.email
        ) : (
          <span className="faint">— anyone with link</span>
        )}
      </span>
      <span className="pill">{data.permission}</span>
      <span className="mono t-sm muted">
        {data.use_count}
        {data.max_uses ? ` / ${data.max_uses}` : ''}
      </span>
      <span className="t-xs muted mono">
        {expires ? expires : <span className="faint">never</span>}
      </span>
      <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn sm ghost"
          title="revoke share"
          disabled={busy}
          onClick={onRevoke}
        >
          <Icon name="x" size={11} />
        </button>
      </div>
    </div>
  );
}
