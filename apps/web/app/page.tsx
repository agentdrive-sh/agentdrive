import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { PLAN_CATALOG } from '@agentdrive/shared';
import { Icon } from '@/components/icon';
import { PlatformGlyph, PLATFORMS, type PlatformId } from '@/components/platform-glyph';
import { HandoffDemo } from '@/components/marketing/handoff-demo';
import { InstallBlock } from '@/components/marketing/install-block';
import { ENTERPRISE_CTA, PlanCard } from '@/components/marketing/plan-card';
import { MarketingNav } from '@/components/marketing/nav';
import { MarketingFooter } from '@/components/marketing/footer';
import cli from '../../../packages/cli/package.json';
import './landing.css';

const CAPTURE_HARNESSES: PlatformId[] = ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'];
const MCP_CLIENTS: PlatformId[] = ['cline', 'zed', 'continue'];
const VERSIONS: [PlatformId, string, string, string][] = [
  ['codex', 'v3', 'fix window reset', 'now'],
  ['cursor', 'v2', 'add 429 test', '1h'],
  ['claude-code', 'v1', 'add limiter', '3h'],
];
const TURNS: [string, string][] = [
  ['user', '› add rate limiting to /v1/search'],
  ['dim', '● pnpm test search'],
  ['err', '✗ expected 429, got 200'],
];
const LANES: [boolean, ReactNode][] = [
  [true, 'Prompts and replies'],
  [false, <><code>.env</code>, keys, <code>.ssh</code></>],
  [true, 'Untracked files the agent wrote, and folders you watch'],
  [false, <><code>.adriveignore</code> paths</>],
  [false, 'Recognized secrets, redacted'],
];

const enterprise = PLAN_CATALOG.find((p) => p.id === 'enterprise');
const width = (w: string) => ({ '--w': w }) as CSSProperties;

function HarnessGroup({ title, ids, secondary }: { title: string; ids: PlatformId[]; secondary?: boolean }) {
  return (
    <div className={secondary ? 'm-harness-group secondary' : 'm-harness-group'}>
      <h2>{title}</h2>
      <ul>
        {ids.map((id) => (
          <li key={id}>
            <Link href={secondary ? '/integrations#mcp' : `/integrations/${id}`}>
              <PlatformGlyph platform={id} size={22} />
              {PLATFORMS[id].label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MarketingHome() {
  return (
    <div className="marketing landing" data-screen-label="marketing/home">
      <a className="m-skip" href="#main">Skip to content</a>
      <MarketingNav />

      <main id="main">
        <section className="l-hero" aria-labelledby="l-hero-title">
          <div className="l-backdrop" aria-hidden="true" />
          <div className="m-wrap l-hero-grid">
            <div className="l-hero-copy">
              <p className="pill accent l-hero-pill">
                <span className="dot" />
                Public beta
                <span className="l-hero-ver">v{cli.version}</span>
              </p>
              <h1 id="l-hero-title" className="m-h1 l-h1">
                Start in any agent.
                <br />
                <span className="l-accent">Finish in any other.</span>
              </h1>
              <p className="m-lede">
                Hit a usage limit in one coding agent? Keep going in another. AgentDrive syncs each
                session to your workspace, and any of your other agents can resume it.
              </p>
              <InstallBlock />
              <div className="m-actions">
                <Link className="btn lg primary" href="/docs/quick-start">
                  Install AgentDrive
                </Link>
                <a className="btn lg" href="#how">
                  How it works
                </a>
              </div>
            </div>
            <HandoffDemo />
          </div>

          <div className="m-wrap">
            <div className="m-harnesses l-harnesses">
              <HarnessGroup title="Capture and resume" ids={CAPTURE_HARNESSES} />
              <HarnessGroup title="MCP tools" ids={MCP_CLIENTS} secondary />
            </div>
          </div>
        </section>

        <section id="how" className="m-section" aria-labelledby="l-steps-title">
          <div className="m-wrap">
            <div className="m-head">
              <h2 id="l-steps-title" className="m-h2">
                How it works
              </h2>
            </div>
            <ol className="l-steps">
              <li>
                <span className="l-step-n" aria-hidden="true">01</span>
                <h3 className="m-h3">Install</h3>
                <pre className="l-snippet">
                  <span><span className="dim">$ </span>curl -fsSL agentdrive.sh/install | sh</span>
                  <span>Codex        <b className="ok">wired</b></span>
                  <span>Cursor       <b className="ok">wired</b></span>
                  <span>OpenCode     <b className="ok">wired</b></span>
                </pre>
              </li>
              <li>
                <span className="l-step-n" aria-hidden="true">02</span>
                <h3 className="m-h3">Work normally</h3>
                <div className="l-snippet l-capture" role="img" aria-label="Each turn of the session uploads in the background">
                  <span className="l-cap-head">
                    <i className="l-live" />
                    syncing
                    <PlatformGlyph platform="claude-code" size={12} />
                  </span>
                  {TURNS.map(([tone, text]) => (
                    <span key={text} className="l-turn">
                      <span className={tone}>{text}</span>
                      <Icon name="upload" size={12} />
                    </span>
                  ))}
                </div>
              </li>
              <li>
                <span className="l-step-n" aria-hidden="true">03</span>
                <h3 className="m-h3">Resume anywhere</h3>
                <pre className="l-snippet">
                  <span><span className="dim">$ </span>adrive resume</span>
                  <span className="dim">Handoff from a claude-code session …</span>
                  <span className="h">## Goal</span>
                  <span>add rate limiting to /v1/search</span>
                </pre>
              </li>
            </ol>
          </div>
        </section>

        <section className="m-section" aria-labelledby="l-pillars-title">
          <div className="m-wrap">
            <div className="m-head">
              <h2 id="l-pillars-title" className="m-h2">
                One workspace for every agent
              </h2>
            </div>
            <div className="l-outcomes">
              <article>
                <div className="l-art l-art-share" aria-hidden="true">
                  <span className="l-url">
                    <Icon name="share" size={12} />
                    <span>agentdrive.sh/s/eyJ…</span>
                    <Icon name="copy" size={12} />
                  </span>
                  <span className="l-scopes">
                    <i className="on">view</i>
                    <i>5 uses</i>
                    <i>email-gated</i>
                  </span>
                  <span className="l-ttl">
                    <Icon name="clock" size={12} />
                    <span className="l-ttl-bar" />
                    <span>24h</span>
                  </span>
                </div>
                <h3 className="m-h3">Share by link</h3>
                <Link className="m-link" href="/docs/concepts/workspaces">How sharing works <Icon name="arrow-right" size={14} /></Link>
              </article>
              <article>
                <ul className="l-art l-art-versions" aria-hidden="true">
                  {VERSIONS.map(([platform, v, message, when]) => (
                    <li key={v}>
                      <PlatformGlyph platform={platform} size={14} />
                      <b>{v}</b>
                      <span className="msg">{message}</span>
                      <span className="when">{when}</span>
                    </li>
                  ))}
                </ul>
                <h3 className="m-h3">Trace every write</h3>
                <Link className="m-link" href="/docs/concepts/cross-agent-identity">How provenance works <Icon name="arrow-right" size={14} /></Link>
              </article>
              <article>
                <div className="l-art l-art-search" aria-hidden="true">
                  <span className="l-q"><Icon name="search" size={12} /><span className="l-q-text">rate limit window</span></span>
                  <span className="l-hit" style={width('92%')}><Icon name="file" size={12} />rate-limit.ts<span className="l-score" /></span>
                  <span className="l-hit" style={width('58%')}><Icon name="file" size={12} />search.ts<span className="l-score" /></span>
                </div>
                <h3 className="m-h3">Search by meaning</h3>
                <Link className="m-link" href="/docs/concepts/memory-and-search">How search works <Icon name="arrow-right" size={14} /></Link>
              </article>
            </div>
          </div>
        </section>

        <section className="m-section l-band" aria-labelledby="l-privacy-title">
          <div className="m-wrap">
            <div className="m-head l-head-split">
              <h2 id="l-privacy-title" className="m-h2">
                What leaves your machine
              </h2>
              <p className="m-lede">
                Switch any of it off with <code>adrive privacy</code>.
              </p>
            </div>
            <div className="l-boundary">
              <div className="l-flow">
                <h3 className="l-flow-head">
                  <Icon name="x" size={12} />
                  Stays local
                </h3>
                <h3 className="l-flow-head">
                  <Icon name="upload" size={12} />
                  Synced
                </h3>
                <ul className="l-lanes">
                  {LANES.map(([sent, item], i) => (
                    <li key={i} className={sent ? 'sent' : 'kept'}>
                      <span className="l-chip">
                        <Icon name={sent ? 'check' : 'x'} size={12} />
                        <span className="m-sr">{sent ? 'Synced: ' : 'Stays local: '}</span>
                        <span>{item}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="l-encrypt">
                <li>
                  <Icon name="lock" size={14} />
                  <span>
                    <strong>Private Workspace</strong> encrypts on your machine. Not searchable by meaning.
                  </span>
                </li>
                <li>
                  <Icon name="archive" size={14} />
                  <span>
                    <strong>Your own bucket</strong> on Team: R2 or S3.
                  </span>
                </li>
              </ul>
            </div>
            <p className="m-body m-note">
              Redaction is best-effort, and ignore rules cover files, not pasted text.{' '}
              <Link className="m-link" href="/security">
                How we store your data
              </Link>
            </p>
          </div>
        </section>

        <section className="m-section" aria-labelledby="l-pricing-title">
          <div className="m-wrap">
            <div className="m-head l-head-split">
              <h2 id="l-pricing-title" className="m-h2">
                Pricing
              </h2>
              <p className="m-lede">Free has no expiry and needs no card.</p>
            </div>
            <div className="m-plans">
              {PLAN_CATALOG.filter((p) => p.id !== 'enterprise').map((p) => (
                <PlanCard key={p.id} plan={p} />
              ))}
            </div>
            {enterprise && (
              <div className="m-enterprise">
                <p className="m-body">
                  <strong className="fg-0">{enterprise.name}.</strong> {enterprise.blurb}
                </p>
                <div className="m-actions">
                  <a className="btn" href={ENTERPRISE_CTA.href}>
                    {ENTERPRISE_CTA.label}
                  </a>
                  <Link className="btn" href="/pricing">
                    Compare plans
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="l-final" aria-labelledby="l-final-title">
          <div className="m-wrap">
            <div className="l-final-inner">
              <h2 id="l-final-title" className="m-h2 l-final-title">
                Hand off your <span className="l-accent">next session.</span>
              </h2>
              <InstallBlock />
              <div className="m-actions">
                <Link className="btn lg primary" href="/docs/quick-start">
                  Install AgentDrive
                </Link>
                <Link className="btn lg" href="/docs">
                  Read the docs
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
