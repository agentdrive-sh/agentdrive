'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../../../lib/api-client';
import type { OrgDetail } from '../../../lib/api-client';
import { getClientSession } from '../../../lib/session';
import { Icon } from '../../../components/icon';
import { PageHead } from '../../../components/shared';

type Role = 'owner' | 'admin' | 'member';

export function TeamManager() {
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const client = useMemo(() => ApiClient.fromSession(getClientSession()), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setOrg(await client.getOrg());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const agentsByEmail = useMemo(() => {
    const map = new Map<string, number>();
    (org?.agents ?? []).forEach((a) => {
      if (a.agent_email) map.set(a.agent_email, (map.get(a.agent_email) ?? 0) + 1);
    });
    return map;
  }, [org]);

  const members = org?.members ?? [];
  const invites = org?.invites ?? [];
  const rows = [
    ...members.map((m) => ({ ...m, pending: false })),
    ...invites.map((i) => ({ ...i, joined_at: i.created_at, pending: true })),
  ];

  async function invite() {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await client.inviteMember(email.trim(), role);
      setEmail('');
      setRole('member');
      setFormOpen(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(memberEmail: string, pending = false) {
    if (busyEmail) return;
    const ok = window.confirm(
      pending ? `Cancel the invite to ${memberEmail}?` : `Remove ${memberEmail} from this org?`,
    );
    if (!ok) return;
    setBusyEmail(memberEmail);
    try {
      await client.removeMember(memberEmail);
      setOrg((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.filter((m) => m.email !== memberEmail),
              invites: prev.invites.filter((i) => i.email !== memberEmail),
            }
          : prev,
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyEmail(null);
    }
  }

  const count = members.length;
  const agentLabel = (n: number) => `${n} agent${n === 1 ? '' : 's'}`;

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead
        sub={
          org
            ? `Org ${org.name} · ${count} member${count === 1 ? '' : 's'}${
                invites.length ? ` · ${invites.length} pending` : ''
              }`
            : 'Org · loading'
        }
        actions={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setEmail('');
              setFormError(null);
              setFormOpen((v) => !v);
            }}
          >
            <Icon name="plus" size={13} /> {formOpen ? 'Close' : 'Invite member'}
          </button>
        }
      />

      {formOpen && (
        <div className="surface" style={{ padding: 20, marginBottom: 16 }}>
          <div className="col gap-3">
            <div className="grid" style={{ gridTemplateColumns: '1fr 160px', gap: 12 }}>
              <label className="col" style={{ gap: 6 }}>
                <span
                  className="t-xs muted wt-600"
                  style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}
                >
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void invite();
                  }}
                  placeholder="teammate@company.com"
                  className="input"
                  autoFocus
                />
              </label>
              <label className="col" style={{ gap: 6 }}>
                <span
                  className="t-xs muted wt-600"
                  style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}
                >
                  Role
                </span>
                <select
                  className="input"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
              </label>
            </div>
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
              <button type="button" className="btn ghost" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!email.trim() || submitting}
                onClick={invite}
              >
                {submitting ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="surface table-scroll">
        {loading ? (
          <div className="empty">
            <Icon name="users" size={24} />
            <p>Loading team…</p>
          </div>
        ) : loadError ? (
          <div className="empty">
            <Icon name="x" size={24} />
            <h3>Couldn&apos;t load team</h3>
            <p>{loadError}</p>
            <button type="button" className="btn" onClick={refresh} style={{ marginTop: 12 }}>
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <Icon name="users" size={24} />
            <h3>You&apos;re the only one here</h3>
            <p>Invite a teammate by email. They join once they sign in and accept.</p>
          </div>
        ) : (
          rows.map((m) => (
            <div
              key={`${m.pending ? 'invite' : 'member'}:${m.email}`}
              className="row-item"
              style={{
                gridTemplateColumns: '1.4fr 1fr 100px 120px 90px',
                gap: 14,
                padding: '14px 18px',
                borderBottom: '1px solid var(--border)',
                alignItems: 'center',
              }}
            >
              <div className="col" style={{ lineHeight: 1.25 }}>
                <span className="t-sm fg-0 wt-500">{m.email.split('@')[0]}</span>
                <span className="t-xs faint mono">{m.email}</span>
              </div>
              <span className="mono t-sm muted">
                {m.pending ? `invited by ${m.invited_by}` : agentLabel(agentsByEmail.get(m.email) ?? 0)}
              </span>
              <span className="pill">{m.role}</span>
              <span className="t-xs muted mono">
                {m.pending ? 'pending' : new Date(m.joined_at).toISOString().split('T')[0]}
              </span>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busyEmail === m.email}
                  onClick={() => remove(m.email, m.pending)}
                >
                  {busyEmail === m.email ? '…' : m.pending ? 'Cancel' : 'Remove'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
