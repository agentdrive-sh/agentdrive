'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from './icon';

interface PaletteItem {
  label: string;
  icon: IconName;
  action: () => void;
}

interface PaletteGroup {
  group: string;
  items: PaletteItem[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const go = useCallback(
    (path: string) => {
      router.push(path);
    },
    [router],
  );

  const groups = useMemo<PaletteGroup[]>(() => {
    const nav = (label: string, icon: IconName, path: string): PaletteItem => ({
      label: `Go to ${label}`,
      icon,
      action: () => go(path),
    });
    const all: PaletteGroup[] = [
      {
        group: 'Navigate',
        items: [
          nav('Overview', 'dashboard', '/dashboard'),
          nav('Timeline', 'clock', '/dashboard/timeline'),
          nav('Files', 'folder', '/files'),
          nav('Memory', 'brain', '/memory'),
          nav('Runs', 'play', '/runs'),
          nav('Agents', 'plug', '/agents'),
          nav('Shares', 'share', '/shares'),
          nav('API keys', 'key', '/keys'),
          nav('Buckets', 'archive', '/buckets'),
          nav('Billing', 'card', '/billing'),
          nav('Team', 'users', '/team'),
          nav('Settings', 'settings', '/settings'),
        ],
      },
      {
        group: 'Actions',
        items: [
          { label: 'Search memory', icon: 'search', action: () => go('/memory') },
          { label: 'New API key', icon: 'key', action: () => go('/keys') },
          { label: 'Invite a teammate', icon: 'users', action: () => go('/team') },
          { label: 'Wire a new agent', icon: 'plug', action: () => go('/onboarding') },
        ],
      },
    ];
    if (!q) return all;
    const Q = q.toLowerCase();
    return all
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => it.label.toLowerCase().includes(Q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [q, go]);

  const flatItems = useMemo(
    () => groups.flatMap((g) => g.items),
    [groups],
  );

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      setQ('');
      setIdx(0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => (i + 1) % Math.max(flatItems.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx(
          (i) =>
            (i - 1 + Math.max(flatItems.length, 1)) %
            Math.max(flatItems.length, 1),
        );
      } else if (e.key === 'Enter') {
        const it = flatItems[idx];
        if (it) {
          it.action();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, flatItems, idx, onClose]);

  if (!open) return null;

  let counter = -1;
  return (
    <div className="cpal-overlay" onClick={onClose}>
      <div className="cpal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cpal-input"
          placeholder="Jump to a page or action…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
        />
        <div className="cpal-list">
          {groups.map((g) => (
            <div key={g.group}>
              <div className="cpal-group">{g.group}</div>
              {g.items.map((it) => {
                counter++;
                const isActive = counter === idx;
                const myIndex = counter;
                return (
                  <div
                    key={it.label}
                    className={'cpal-item' + (isActive ? ' active' : '')}
                    onMouseEnter={() => setIdx(myIndex)}
                    onClick={() => {
                      it.action();
                      onClose();
                    }}
                  >
                    <Icon name={it.icon} />
                    <span>{it.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {flatItems.length === 0 && (
            <div
              style={{
                padding: '32px 14px',
                textAlign: 'center',
                color: 'var(--text-3)',
              }}
            >
              No matches. To search artifact content, open Memory.
            </div>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 14,
            padding: '8px 14px',
            borderTop: '1px solid var(--border)',
            fontSize: 'var(--t-xs)',
            color: 'var(--text-3)',
          }}
        >
          <span className="row gap-1">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span className="row gap-1">
            <span className="kbd">↵</span> select
          </span>
          <span className="row gap-1">
            <span className="kbd">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
