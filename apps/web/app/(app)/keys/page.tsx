'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../../../lib/api-client';
import type { ApiKeyRecord, CreatedApiKey } from '../../../lib/api-client';
import { getClientSession } from '../../../lib/session';
import { humanTime } from '../../../lib/time';
import { Icon } from '../../../components/icon';
import { PageHead } from '../../../components/shared';

export default function KeysPage() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [revealed, setRevealed] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const client = useMemo(() => ApiClient.fromSession(getClientSession()), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await client.listApiKeys();
      setKeys(page.items);
      setCursor(page.cursor);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await client.listApiKeys(cursor);
      setKeys((prev) => [...prev, ...page.items]);
      setCursor(page.cursor);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [client, cursor]);

  async function create() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await client.createApiKey(name.trim());
      setRevealed(created);
      setCopied(false);
      setName('');
      setFormOpen(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(keyId: string) {
    if (busyId) return;
    const ok = window.confirm(
      'Revoke this key? Any agent or tool authenticating with it will immediately lose access, and the share links and workspace roles it granted stop working.',
    );
    if (!ok) return;
    setBusyId(keyId);
    setRevokeError(null);
    try {
      await client.revokeApiKey(keyId);
      setKeys((prev) => prev.filter((k) => k.key_id !== keyId));
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function copySecret() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.api_key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead
        sub="Each key is its own principal. Per-request X-Agent-Platform headers distinguish which tool is calling."
        actions={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setName('');
              setFormError(null);
              setFormOpen((v) => !v);
            }}
          >
            <Icon name="plus" size={13} /> {formOpen ? 'Close' : 'Generate key'}
          </button>
        }
      />

      {revealed && (
        <div
          className="surface"
          style={{
            marginBottom: 16,
            padding: 18,
            border: '1px solid var(--accent)',
            background: 'var(--accent-soft)',
          }}
        >
          <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
            <div style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }}>
              <Icon name="key" size={18} />
            </div>
            <div className="col grow" style={{ gap: 8 }}>
              <div className="t-sm wt-600 fg-0">
                Copy your new key now — it won&apos;t be shown again
              </div>
              <div
                className="row gap-2"
                style={{ alignItems: 'center', flexWrap: 'wrap' }}
              >
                <code
                  className="mono t-sm fg-0"
                  style={{
                    padding: '8px 10px',
                    background: 'var(--bg-1)',
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border)',
                    wordBreak: 'break-all',
                  }}
                >
                  {revealed.api_key}
                </code>
                <button type="button" className="btn sm" onClick={copySecret}>
                  <Icon name="copy" size={12} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button
                type="button"
                className="btn ghost sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setRevealed(null)}
              >
                I&apos;ve saved it
              </button>
            </div>
          </div>
        </div>
      )}

      {formOpen && (
        <div className="surface" style={{ padding: 20, marginBottom: 16 }}>
          <div className="col gap-3">
            <label className="col" style={{ gap: 6 }}>
              <span
                className="t-xs muted wt-600"
                style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                Key name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                }}
                placeholder="ci-runner, my-laptop, prod-agent…"
                className="input"
                autoFocus
              />
            </label>
            {formError && (
              <div
                className="t-xs"
                style={{
                  padding: 10,
                  background: 'var(--bg-2)',
                  color: 'var(--danger, #f87171)',
                  borderRadius: 'var(--r-md)',
                }}
              >
                {formError}
              </div>
            )}
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!name.trim() || submitting}
                onClick={create}
              >
                {submitting ? 'Generating…' : 'Generate key'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="surface"
        style={{
          marginBottom: 16,
          padding: 18,
          background: 'linear-gradient(180deg, var(--bg-1), var(--bg-2))',
        }}
      >
        <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }}>
            <Icon name="lock" size={18} />
          </div>
          <div className="col grow">
            <div className="t-sm wt-600 fg-0">Treat keys like passwords</div>
            <div className="t-sm muted" style={{ marginTop: 4 }}>
              The full secret is shown{' '}
              <span className="fg-0">once at creation</span>. Revoking a key
              cuts it off instantly, along with the share links and workspace
              roles it issued. Owners can revoke any key; members only the
              keys they created.
            </div>
          </div>
        </div>
      </div>

      {revokeError && (
        <div
          role="alert"
          className="t-sm row gap-2"
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: 'var(--bg-2)',
            color: 'var(--danger, #f87171)',
            borderRadius: 'var(--r-md)',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Couldn&apos;t revoke key: {revokeError}</span>
          <button type="button" className="btn ghost sm" onClick={() => setRevokeError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="surface table-scroll">
        {loading ? (
          <div className="empty">
            <Icon name="key" size={24} />
            <p>Loading keys…</p>
          </div>
        ) : loadError ? (
          <div className="empty">
            <Icon name="x" size={24} />
            <h3>Couldn&apos;t load keys</h3>
            <p>{loadError}</p>
            <button
              type="button"
              className="btn"
              onClick={refresh}
              style={{ marginTop: 12 }}
            >
              Retry
            </button>
          </div>
        ) : keys.length === 0 ? (
          <div className="empty">
            <Icon name="key" size={24} />
            <h3>No keys yet</h3>
            <p>
              Generate a key to authenticate the CLI, MCP server, or SDK.
              Each key is a distinct principal in your provenance trail.
            </p>
          </div>
        ) : (
          keys.map((k) => (
            <div
              key={k.key_id}
              className="row-item"
              style={{
                gridTemplateColumns: '1.4fr 1fr 1fr 120px',
                gap: 14,
                padding: '14px 18px',
                borderBottom: '1px solid var(--border)',
                alignItems: 'center',
              }}
            >
              <div className="col" style={{ lineHeight: 1.25 }}>
                <span className="t-sm wt-600 fg-0">{k.name}</span>
                <span className="t-xs muted mono">{k.prefix}</span>
              </div>
              <div className="col" style={{ lineHeight: 1.25 }}>
                <span className="t-xs muted">created</span>
                <span className="t-sm muted">{humanTime(k.created_at)}</span>
              </div>
              <div className="col" style={{ lineHeight: 1.25 }}>
                <span className="t-xs muted">last used</span>
                <span className="t-sm muted">
                  {k.last_used_at ? humanTime(k.last_used_at) : 'never'}
                </span>
              </div>
              <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  title="revoke key"
                  disabled={busyId === k.key_id}
                  onClick={() => revoke(k.key_id)}
                >
                  {busyId === k.key_id ? '…' : 'Revoke'}
                </button>
              </div>
            </div>
          ))
        )}

        {cursor && (
          <div
            className="row"
            style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--border)',
              justifyContent: 'center',
            }}
          >
            <button type="button" className="btn ghost" onClick={loadMore}>
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
