'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, type Ref } from 'react';
import { Icon } from './icon';
import type { WorkspaceSummary } from '@/lib/api-client';
import { rememberWorkspace, selectWorkspace } from '@/lib/workspace-selection';

interface Crumb {
  label: string;
  href: string | null;
}

const titleFor: Record<string, string> = {
  '/dashboard': 'Overview',
  '/dashboard/timeline': 'Timeline',
  '/files': 'Files',
  '/memory': 'Memory',
  '/runs': 'Runs',
  '/agents': 'Agents',
  '/shares': 'Shares',
  '/keys': 'API keys',
  '/buckets': 'Buckets',
  '/billing': 'Billing',
  '/team': 'Team',
  '/settings': 'Settings',
  '/onboarding': 'Connect your agents',
};

function deriveTitleAndCrumbs(pathname: string): {
  title: string;
  crumbs: Crumb[];
} {
  if (titleFor[pathname]) {
    return { title: titleFor[pathname], crumbs: [] };
  }

  const fileMatch = pathname.match(/^\/files\/([^/]+)$/);
  if (fileMatch) {
    return {
      title: 'Artifact',
      crumbs: [
        { label: 'Files', href: '/files' },
        { label: fileMatch[1], href: null },
      ],
    };
  }

  const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    return {
      title: 'Run',
      crumbs: [
        { label: 'Runs', href: '/runs' },
        { label: runMatch[1], href: null },
      ],
    };
  }

  return { title: 'AgentDrive', crumbs: [] };
}

interface TopbarProps {
  onOpenCommand: () => void;
  menuRef: Ref<HTMLButtonElement>;
  navOpen: boolean;
  onOpenNav: () => void;
  workspaces: WorkspaceSummary[];
  currentWorkspaceId?: string;
}

export function Topbar({ onOpenCommand, menuRef, navOpen, onOpenNav, workspaces, currentWorkspaceId }: TopbarProps) {
  const pathname = usePathname();
  const requested = useSearchParams().get('workspace');
  const selected = workspaces.some((w) => w.id === requested) ? requested! : currentWorkspaceId ?? '';
  useEffect(() => {
    if (requested && workspaces.some((w) => w.id === requested)) rememberWorkspace(requested);
  }, [requested, workspaces]);
  const { title, crumbs } = deriveTitleAndCrumbs(pathname);

  return (
    <header className="topbar">
      <div className="topbar-lead">
        <button
          ref={menuRef}
          type="button"
          className="btn ghost topbar-menu"
          aria-label="Open navigation"
          aria-controls="app-sidebar"
          aria-expanded={navOpen}
          onClick={onOpenNav}
        >
          <Icon name="menu" size={16} />
        </button>
        {crumbs.length === 0 ? (
          <h1 className="topbar-title t-md wt-600 fg-0">{title}</h1>
        ) : (
          <nav aria-label="Breadcrumb" className="topbar-title row gap-2 t-sm muted">
            {crumbs.map((c, i) => (
              <span key={i} className="row gap-2" style={{ minWidth: 0 }}>
                {c.href ? (
                  <Link href={c.href} className="muted">
                    {c.label}
                  </Link>
                ) : (
                  <span className="fg-0 mono ellipsis">{c.label}</span>
                )}
                {i < crumbs.length - 1 && <span className="faint">/</span>}
              </span>
            ))}
          </nav>
        )}
      </div>

      {workspaces.length > 0 && (
        <select
          className="input"
          aria-label="Workspace"
          value={selected}
          onChange={(event) => selectWorkspace(event.target.value, pathname)}
          style={{ maxWidth: 220, minWidth: 0, width: '100%' }}
        >
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      )}

      <button
        type="button"
        className="btn topbar-search"
        onClick={onOpenCommand}
        aria-label="Search workspace"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Icon name="search" size={14} />
        <span className="muted t-sm topbar-search-label">Search workspace…</span>
        <span className="row gap-1 topbar-search-kbd">
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </span>
      </button>

      <div className="topbar-actions row gap-2">
        <Link href="/blog" className="btn ghost" aria-label="What's new">
          <Icon name="sparkle" size={14} />
          <span className="topbar-hide-sm">What&apos;s new</span>
        </Link>
        <a
          href="https://github.com/agentdrive-sh/agentdrive-mcp"
          target="_blank"
          rel="noreferrer"
          className="btn ghost"
          aria-label="GitHub"
        >
          <Icon name="github" size={14} />
        </a>
      </div>
    </header>
  );
}
