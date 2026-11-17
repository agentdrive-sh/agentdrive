'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { FocusEvent, Ref } from 'react';
import { Icon, type IconName } from './icon';
import { AgentDriveLogo } from './agentdrive-logo';
import { SignOutButton } from './shared';
import cli from '../../../packages/cli/package.json';

interface SidebarItem {
  id: string;
  href: string;
  label: string;
  icon: IconName;
  count?: number;
}

const navItems: SidebarItem[] = [
  { id: 'dashboard', href: '/dashboard', label: 'Overview', icon: 'dashboard' },
  { id: 'timeline', href: '/dashboard/timeline', label: 'Timeline', icon: 'clock' },
  { id: 'files', href: '/files', label: 'Files', icon: 'folder' },
  { id: 'memory', href: '/memory', label: 'Memory', icon: 'brain' },
  { id: 'runs', href: '/runs', label: 'Runs', icon: 'play' },
];

const identityItems: SidebarItem[] = [
  { id: 'agents', href: '/agents', label: 'Agents', icon: 'plug' },
  { id: 'shares', href: '/shares', label: 'Shares', icon: 'share' },
  { id: 'keys', href: '/keys', label: 'API keys', icon: 'key' },
];

const accountItems: SidebarItem[] = [
  { id: 'buckets', href: '/buckets', label: 'Buckets', icon: 'archive' },
  { id: 'billing', href: '/billing', label: 'Billing', icon: 'card' },
  { id: 'team', href: '/team', label: 'Team', icon: 'users' },
  { id: 'settings', href: '/settings', label: 'Settings', icon: 'settings' },
];

interface SidebarProps {
  orgName?: string;
  planName?: string;
  email?: string;
  agentCount?: number;
  navRef?: Ref<HTMLElement>;
  onNavigate?: () => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
}

export function Sidebar({ orgName = '', planName, email, agentCount, navRef, onNavigate, onBlur }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const renderItems = (items: SidebarItem[]) =>
    items.map((it) => (
      <Link
        key={it.id}
        href={it.href}
        className={'sb-item' + (isActive(it.href) ? ' active' : '')}
      >
        <Icon name={it.icon} />
        <span>{it.label}</span>
        {it.count != null && (
          <span className="count">{it.count.toLocaleString()}</span>
        )}
      </Link>
    ));

  const initials = orgName
    .split(/[-_ ]/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toLowerCase();

  const orgMeta = [
    planName,
    agentCount != null && `${agentCount} ${agentCount === 1 ? 'agent' : 'agents'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <aside
      ref={navRef}
      id="app-sidebar"
      className="sidebar"
      onBlur={onBlur}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) onNavigate?.();
      }}
    >
      <div
        className="row gap-2"
        style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}
      >
        <div style={{ color: 'var(--accent)' }}>
          <AgentDriveLogo size={20} />
        </div>
        <div className="col" style={{ lineHeight: 1.15 }}>
          <span className="wt-600 fg-0" style={{ fontSize: 'var(--t-base)' }}>
            AgentDrive
          </span>
          <span className="t-xs faint mono">v{cli.version}</span>
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        <div className="sb-section">{renderItems(navItems)}</div>
        <div className="sb-section">
          <div className="sb-label">Identity</div>
          {renderItems(identityItems)}
        </div>
        <div className="sb-section">
          <div className="sb-label">Account</div>
          {renderItems(accountItems)}
        </div>
      </div>

      <div className="sb-account">
        <Link href="/settings" className="sb-account-org" title="Organization settings">
          <span className="sb-org-mark">{initials}</span>
          <span className="col" style={{ minWidth: 0, lineHeight: 1.2 }}>
            <span className="t-sm wt-500 fg-0 ellipsis">{orgName}</span>
            {orgMeta && <span className="t-xs faint ellipsis">{orgMeta}</span>}
          </span>
        </Link>
        <div className="row gap-2" style={{ paddingLeft: 9 }}>
          <span className="t-xs muted grow ellipsis" title={email}>
            {email}
          </span>
          <SignOutButton className="btn ghost sm" />
        </div>
      </div>
    </aside>
  );
}
