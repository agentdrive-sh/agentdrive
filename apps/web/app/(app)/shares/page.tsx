'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ShareTokenMeta } from '@agentdrive/shared';
import { ApiClient } from '../../../lib/api-client';
import { getClientSession } from '../../../lib/session';
import { collectPages } from '../../../lib/pagination';
import { Icon } from '../../../components/icon';
import { PageHead } from '../../../components/shared';
import { ShareRow } from '../../../components/screens/share-row';

export default function SharesPage() {
  const [shares, setShares] = useState<ShareTokenMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const client = useMemo(() => ApiClient.fromSession(getClientSession()), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const workspaces = await client.listWorkspaces();
      const pages = await Promise.all(workspaces.map((w) => collectPages((cursor) => client.listShares(w.id, cursor))));
      setShares(pages.flat().filter((s) => !s.revoked));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function revoke(share: ShareTokenMeta) {
    if (busyId) return;
    if (!window.confirm('Revoke this share link? Anyone using it loses access immediately.')) return;
    setBusyId(share.token_id);
    setActionError(null);
    try {
      await client.revokeShare(share.workspace_id, share.token_id);
      setShares((prev) => prev.filter((s) => s.token_id !== share.token_id));
    } catch (err) {
      setActionError(`Couldn't revoke ${share.token_id}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead
        sub="HMAC-signed share tokens. Optional email gate. Read-only or comment-enabled."
      />

      {actionError && (
        <p role="alert" className="t-sm" style={{ color: 'var(--danger)', margin: '0 0 12px' }}>
          {actionError}
        </p>
      )}
      <div className="surface table-scroll">
        <div
          className="row-item"
          style={{
            gridTemplateColumns:
              '110px 2fr 140px 120px 90px 100px 90px',
            gap: 14,
            padding: '8px 16px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-3)',
            fontWeight: 600,
          }}
        >
          <span>Share ID</span>
          <span>Target</span>
          <span>Email gate</span>
          <span>Perms</span>
          <span>Uses</span>
          <span>Expires</span>
          <span />
        </div>

        {loading ? (
          <div className="empty">
            <Icon name="share" size={24} />
            <p>Loading share links…</p>
          </div>
        ) : loadError ? (
          <div className="empty">
            <Icon name="x" size={24} />
            <h3>Couldn&apos;t load share links</h3>
            <p>{loadError}</p>
            <button type="button" className="btn" onClick={refresh} style={{ marginTop: 12 }}>
              Retry
            </button>
          </div>
        ) : shares.length === 0 ? (
          <div className="empty">
            <Icon name="share" size={24} />
            <h3>No share links yet</h3>
            <p>
              Agents create share links with <span className="mono">drive_share</span>.
            </p>
          </div>
        ) : (
          shares.map((s) => (
            <ShareRow key={s.token_id} data={s} busy={busyId === s.token_id} onRevoke={() => void revoke(s)} />
          ))
        )}
      </div>
    </div>
  );
}
