'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from './icon';
import { PlatformChip, type PlatformId } from './platform-glyph';
import { ApiClient } from '../lib/api-client';
import { clearClientSession, getClientSession } from '../lib/session';

// The session lives in a client cookie, so signing out clears it here; the
// server-side revoke is best effort and never blocks leaving.
export function SignOutButton({ className = 'btn' }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const session = getClientSession();
    if (session?.api_key) await ApiClient.fromSession(session).logout().catch(() => undefined);
    clearClientSession();
    window.location.assign('/login');
  }

  return (
    <button type="button" className={className} onClick={signOut} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

// Spark — micro bar-chart used in stat tiles and run summaries.
interface SparkProps {
  data: number[];
  height?: number;
}

export function Spark({ data, height = 36 }: SparkProps) {
  const max = Math.max(...data, 1);
  return (
    <div className="spark" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className="bar"
          style={{
            height: `${(v / max) * 100}%`,
            opacity: 0.5 + (v / max) * 0.5,
          }}
        />
      ))}
    </div>
  );
}

// ProvRibbon — the cross-agent identity strip ("authored by X → referenced by Y")
interface ProvRibbonProps {
  from: { platform: PlatformId | string };
  to: { platform: PlatformId | string };
}

export function ProvRibbon({ from, to }: ProvRibbonProps) {
  return (
    <div className="prov-ribbon">
      <span className="muted t-xs">authored by</span>
      <PlatformChip platform={from.platform} />
      <span className="arrow">→</span>
      <span className="muted t-xs">referenced by</span>
      <PlatformChip platform={to.platform} />
    </div>
  );
}

// StatusPill — semantic state badge with color-coded dot
export type StatusKind =
  | 'success'
  | 'failed'
  | 'partial'
  | 'running'
  | 'pending'
  | 'ready'
  | 'idle'
  | 'live'
  | 'sleeping'
  | 'active'
  | 'revoked';

interface StatusPillProps {
  status: StatusKind | string;
}

export function StatusPill({ status }: StatusPillProps) {
  const map: Record<StatusKind, { cls: string; label: string }> = {
    success: { cls: 'success', label: 'success' },
    failed: { cls: 'danger', label: 'failed' },
    partial: { cls: 'warning', label: 'partial' },
    running: { cls: 'accent', label: 'running' },
    pending: { cls: 'info', label: 'pending' },
    ready: { cls: 'success', label: 'ready' },
    idle: { cls: '', label: 'idle' },
    live: { cls: 'success', label: 'live' },
    sleeping: { cls: '', label: 'sleeping' },
    active: { cls: 'success', label: 'active' },
    revoked: { cls: 'danger', label: 'revoked' },
  };
  const m = map[status as StatusKind] ?? { cls: '', label: status };
  return (
    <span className={'pill ' + m.cls}>
      <span className="dot" />
      {m.label}
    </span>
  );
}

// FileIcon — small 22x22 typed badge (MD, TS, {}, TXT).
export type FileKind = 'markdown' | 'typescript' | 'json' | 'text';

interface FileIconProps {
  kind: FileKind | string;
}

export function FileIcon({ kind }: FileIconProps) {
  const colorMap: Record<string, string> = {
    markdown: 'oklch(0.72 0.18 240)',
    typescript: 'oklch(0.72 0.18 220)',
    json: 'oklch(0.74 0.16 145)',
    text: 'var(--text-3)',
  };
  const c = colorMap[kind] ?? 'var(--text-3)';
  const label =
    kind === 'markdown'
      ? 'MD'
      : kind === 'typescript'
        ? 'TS'
        : kind === 'json'
          ? '{}'
          : 'TXT';
  return (
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 700,
          color: c,
          letterSpacing: 0,
        }}
      >
        {label}
      </span>
    </span>
  );
}

// ProgressBar — flat horizontal bar with theme-aware fill.
interface ProgressBarProps {
  value: number;
  max: number;
  color?: string;
}

export function ProgressBar({
  value,
  max,
  color = 'var(--accent)',
}: ProgressBarProps) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div
      style={{
        width: '100%',
        height: 6,
        background: 'var(--bg-3)',
        borderRadius: 100,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: pct + '%',
          height: '100%',
          background: color,
          borderRadius: 100,
          transition: 'width 240ms',
        }}
      />
    </div>
  );
}

// CopyableCode — code block with a click-to-copy button in the corner.
interface CopyableCodeProps {
  children: string;
  oneLine?: boolean;
}

export function CopyableCode({ children, oneLine = false }: CopyableCodeProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div style={{ position: 'relative' }}>
      <pre
        className="code"
        style={
          oneLine
            ? { whiteSpace: 'nowrap', overflowX: 'auto', paddingRight: 70 }
            : { paddingRight: 70 }
        }
      >
        {children}
      </pre>
      <button
        type="button"
        className="btn sm"
        onClick={copy}
        style={{ position: 'absolute', top: 8, right: 8 }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={11} />
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <button type="button" className="btn sm" onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? 'Copied' : label}
    </button>
  );
}

// The topbar renders the page's h1, so a PageHead only adds a heading when it
// says something the title doesn't (the overview greeting).
interface PageHeadProps {
  heading?: string;
  sub?: ReactNode;
  actions?: ReactNode;
}

export function PageHead({ heading, sub, actions }: PageHeadProps) {
  return (
    <div className="page-head">
      <div className="col">
        {heading && <h2>{heading}</h2>}
        {sub && <span className="sub">{sub}</span>}
      </div>
      {actions && <div className="row gap-2">{actions}</div>}
    </div>
  );
}
