import type { Metadata } from 'next';
import Link from 'next/link';
import { InstallBlock } from '@/components/marketing/install-block';
import { MarketingPageShell, PageHero } from '@/components/marketing/page-shell';
import { PlatformGlyph } from '@/components/platform-glyph';
import { CAPTURE_HARNESSES, MCP_CLIENTS } from './data';

export const metadata: Metadata = {
  title: 'Integrations',
  description:
    'Session capture and resume for Claude Code, Codex, OpenCode, Cursor, Gemini CLI and Antigravity. Workspace tools for Cline, Zed, Continue and any MCP client.',
  alternates: { canonical: '/integrations' },
};

export default function IntegrationsIndex() {
  return (
    <MarketingPageShell screenLabel="marketing/integrations">
      <PageHero
        width="wide"
        title="Start in any agent. Finish in any other."
        lede="Six agent tools capture their sessions into your shared workspace and can resume each other's work. Any other MCP client gets the workspace tools. One API key covers all of them; provenance records which agent did what."
        actions={<InstallBlock />}
      />

      <section className="m-section tight" aria-labelledby="capture">
        <div className="m-wrap">
          <div className="m-head">
            <h2 id="capture" className="m-h2">
              Session capture and resume
            </h2>
            <p className="m-lede">
              Hooks upload each session in the background. Any of these can resume a session another one started.
            </p>
          </div>
          <ul className="m-tiles">
            {CAPTURE_HARNESSES.map((i) => (
              <li key={i.platform}>
                <Link href={`/integrations/${i.platform}`} className="m-tile">
                  <span className="m-tile-head">
                    <PlatformGlyph platform={i.platform} size={20} />
                    <span className="m-tile-title">{i.label}</span>
                    <span className="pill success">Capture + resume</span>
                  </span>
                  <span className="m-tile-body">{i.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="m-section tight" aria-labelledby="mcp">
        <div className="m-wrap">
          <div className="m-head">
            <h2 id="mcp" className="m-h2">
              Any MCP client
            </h2>
            <p className="m-lede">
              These get the workspace tools: files, versions, semantic search, run logs and session handoff through{' '}
              <code>drive_resume</code>. They have no hooks, so their own sessions are not captured. Anything else
              that speaks MCP can use the{' '}
              <Link className="m-link" href="/docs/quick-start#manual-mcp-config-fallback">
                manual config
              </Link>
              .
            </p>
          </div>
          <ul className="m-tiles">
            {MCP_CLIENTS.map((i) => (
              <li key={i.platform} className="m-tile">
                <span className="m-tile-head">
                  <PlatformGlyph platform={i.platform} size={20} />
                  <span className="m-tile-title">{i.label}</span>
                  <span className="pill">MCP only</span>
                </span>
                <p className="m-tile-body">{i.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="m-section tight" aria-labelledby="not-yet">
        <div className="m-wrap">
          <h2 id="not-yet" className="m-h3">
            Not built yet
          </h2>
          <p className="m-body m-measure">
            There are no native adapters for agent frameworks such as LangGraph, CrewAI or AutoGen, and no Python
            SDK. A framework that can launch an MCP server can use the manual config today.
          </p>
        </div>
      </section>
    </MarketingPageShell>
  );
}
