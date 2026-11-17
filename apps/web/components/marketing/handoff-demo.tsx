'use client';

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { AgentDriveLogo } from '@/components/agentdrive-logo';
import { PlatformGlyph } from '@/components/platform-glyph';
import { cn } from '@/lib/cn';

const at = (s: number) => ({ '--s': s }) as CSSProperties;

// The whole loop is driven by one animated custom property (--t, landing.css);
// each piece derives its state from it, so it renders complete without JS.
// Stopping drops the loop, which returns --t to its finished frame.
export function HandoffDemo() {
  const ref = useRef<HTMLElement>(null);
  const [stopped, setStopped] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    setHydrated(true);
    const el = ref.current;
    if (!el) return;
    // The loops cost nothing visible offscreen, but they keep the compositor and battery busy.
    const io = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <figure
      ref={ref}
      className={cn('l-relay', stopped && 'stopped', offscreen && 'offscreen')}
      aria-labelledby="handoff-caption"
    >
      <figcaption id="handoff-caption" className="m-sr">
        A Codex session hits its usage limit on a failing test. AgentDrive has synced the session, and
        Claude Code resumes from a brief of its goal, files and recent turns.
      </figcaption>
      <div className="l-win from" aria-hidden="true">
        <div className="l-win-bar">
          <PlatformGlyph platform="codex" size={14} /> Codex
          <span className="l-win-tag l-ln" style={at(0.24)}>limit hit</span>
        </div>
        <div className="l-win-body">
          <span className="l-ln user" style={at(0.03)}>› add rate limiting to /v1/search</span>
          <span className="l-ln dim" style={at(0.1)}>● pnpm test search</span>
          <span className="l-ln err" style={at(0.17)}>✗ expected 429, got 200</span>
        </div>
      </div>

      <div className="l-hub">
        <span className="l-hub-art" aria-hidden="true">
          <span className="l-hub-path" />
          <span className="l-hub-node"><AgentDriveLogo size={18} /></span>
          <span className="l-hub-label l-ln" style={at(0.36)}>synced</span>
          <span className="l-packet">brief</span>
        </span>
        {hydrated && (
          <button
            type="button"
            className="l-relay-toggle"
            aria-label={stopped ? 'Play animation' : 'Stop animation'}
            onClick={() => setStopped(!stopped)}
          >
            <span className={stopped ? 'play' : 'stop'} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="l-win to" aria-hidden="true">
        <div className="l-win-bar">
          <PlatformGlyph platform="claude-code" size={14} /> Claude Code
          <span className="l-win-tag live l-ln" style={at(0.52)}>resumed</span>
        </div>
        <div className="l-win-body">
          <span className="l-ln user" style={at(0.55)}>› /agentdrive:resume</span>
          <span className="l-chips">
            <i className="l-ln" style={at(0.61)}>goal</i>
            <i className="l-ln" style={at(0.64)}>2 files</i>
            <i className="l-ln" style={at(0.67)}>recent turns</i>
          </span>
          <span className="l-ln" style={at(0.73)}>
            ● fixing the window reset<span className="l-caret" />
          </span>
        </div>
      </div>
    </figure>
  );
}
