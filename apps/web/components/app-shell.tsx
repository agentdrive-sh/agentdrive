'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { CommandPalette } from './command-palette';
import { PLAN_CATALOG, catalogIdForPlan, type OrgInvite, type Plan } from '@agentdrive/shared';
import { ApiClient, type OrgDetail, type UsageStatus, type WorkspaceSummary } from '@/lib/api-client';
import { getClientSession, setClientSession } from '@/lib/session';

interface AppShellProps {
  children: ReactNode;
  workspaces: WorkspaceSummary[];
  currentWorkspaceId?: string;
}

export function AppShell({ children, workspaces, currentWorkspaceId }: AppShellProps) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [email, setEmail] = useState<string>();
  const [org, setOrg] = useState<OrgDetail | null>(null);

  useEffect(() => {
    const session = getClientSession();
    setEmail(session?.email);
    if (session?.api_key) ApiClient.fromSession(session).getOrg().then(setOrg, () => setOrg(null));
  }, []);

  const planName = org ? PLAN_CATALOG.find((p) => p.id === catalogIdForPlan(org.plan as Plan))?.name : undefined;

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  useEffect(() => setNavOpen(false), [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    sidebar.current?.querySelector<HTMLElement>('a[href]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setNavOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <Sidebar
        navRef={sidebar}
        orgName={org?.name}
        planName={planName}
        email={email}
        agentCount={org?.agents.length}
        onNavigate={() => setNavOpen(false)}
        onBlur={(e) => {
          if (navOpen && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setNavOpen(false);
        }}
      />
      <div
        className="sb-backdrop"
        aria-hidden="true"
        onClick={() => {
          setNavOpen(false);
          menuButton.current?.focus();
        }}
      />
      <main className="main">
        <Topbar
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
          onOpenCommand={() => setCmdOpen(true)}
          menuRef={menuButton}
          navOpen={navOpen}
          onOpenNav={() => setNavOpen(true)}
        />
        <div className="content">
          <UsageBanner />
          <PendingInvites />
          {children}
        </div>
      </main>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}

// Shown from 80% of storage or embeddings; nothing stops syncing at 100%.
function UsageBanner() {
  const [status, setStatus] = useState<UsageStatus | null>(null);

  useEffect(() => {
    const session = getClientSession();
    if (session?.api_key) ApiClient.fromSession(session).billingPlan().then((p) => setStatus(p.status ?? null), () => setStatus(null));
  }, []);

  if (!status?.message) return null;
  const tone = status.level === 'warn99' ? 'var(--danger, #f87171)' : 'var(--warning)';

  return (
    <div
      className="surface row gap-3"
      role="status"
      style={{ maxWidth: 1240, margin: '0 auto 16px', padding: '10px 16px', alignItems: 'center', flexWrap: 'wrap', borderLeft: `3px solid ${tone}` }}
    >
      <span className="t-sm fg-0" style={{ flex: 1, minWidth: 220 }}>
        {status.message}
      </span>
      <a className="btn primary sm" href={status.upgrade_url}>
        Upgrade
      </a>
    </div>
  );
}

function PendingInvites() {
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = getClientSession();
    // Only a signed-in person (not an API key) can see invites addressed to them.
    if (!session?.api_key || session.api_key.startsWith('agentdrive_')) return;
    ApiClient.fromSession(session).listMyInvites().then(setInvites, () => setInvites([]));
  }, []);

  async function answer(invite: OrgInvite, accept: boolean) {
    const session = getClientSession();
    if (busy || !session) return;
    setBusy(true);
    setError(null);
    try {
      const client = ApiClient.fromSession(session);
      if (accept) {
        await client.acceptInvite(invite.org_id);
        setClientSession({ ...session, org_id: invite.org_id });
        window.location.reload();
        return;
      }
      await client.declineInvite(invite.org_id);
      setInvites((prev) => prev.filter((i) => i.org_id !== invite.org_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (invites.length === 0) return null;

  return (
    <div className="col gap-2" style={{ maxWidth: 1240, margin: '0 auto 16px' }}>
      {invites.map((inv) => (
        <div
          key={inv.org_id}
          className="surface row gap-3"
          style={{ padding: '12px 16px', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <span className="t-sm muted" style={{ flex: 1, minWidth: 220 }}>
            <span className="fg-0 wt-500">{inv.invited_by}</span> invited you to join{' '}
            <span className="fg-0 wt-500">{inv.org_name}</span> as {inv.role}. Accepting
            makes it the org you sign in to. Your current org and its data are kept.
          </span>
          <div className="row gap-2">
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => answer(inv, false)}>
              Decline
            </button>
            <button type="button" className="btn primary sm" disabled={busy} onClick={() => answer(inv, true)}>
              Accept
            </button>
          </div>
        </div>
      ))}
      {error && (
        <div className="t-xs" style={{ color: 'var(--danger, #f87171)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
