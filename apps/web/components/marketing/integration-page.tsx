import type { ReactNode } from 'react';
import Link from 'next/link';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { PlatformGlyph } from '@/components/platform-glyph';
import { CodeBlock } from './code-block';
import type { PlatformId } from '@/components/platform-glyph';
import { JsonLd } from '@/components/seo/json-ld';
import { INTEGRATION_PAGES } from '@/app/integrations/data';
import { PAIRS } from '@/app/resume/data';
import { FaqSection, Rich, breadcrumbLd, faqLd, pageMetadata } from './answer-page';

interface IntegrationLayoutProps {
  platform: PlatformId;
  label: string;
  children: ReactNode;
}

export function integrationMetadata(platform: PlatformId) {
  const page = INTEGRATION_PAGES[platform]!;
  return pageMetadata(page.title, page.description, `/integrations/${platform}`);
}

export function IntegrationLayout({ platform, label, children }: IntegrationLayoutProps) {
  const page = INTEGRATION_PAGES[platform]!;
  return (
    <MarketingPageShell screenLabel={`marketing/integrations/${platform}`}>
      <JsonLd
        data={[
          faqLd(page.faq),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Integrations', path: '/integrations' },
            { name: label, path: `/integrations/${platform}` },
          ]),
        ]}
      />
      <section className="m-wrap narrow m-page-hero">
        <p className="m-crumb">
          <Link href="/integrations">Integrations</Link>
        </p>
        <div className="m-int-badge">
          <PlatformGlyph platform={platform} size={26} />
          <span className="pill success">Sync + resume</span>
        </div>
        <h1 className="m-h1 page">AgentDrive for {label}</h1>
        <p className="m-lede">
          <Rich text={page.answer} />
        </p>
        <div className="m-actions">
          <Link href="#install" className="btn lg primary">
            Install AgentDrive
          </Link>{' '}
          <Link href="/docs/quick-start" className="btn lg secondary">
            Quick start
          </Link>
        </div>
      </section>
      <ProseSection>
        <nav className="m-toc" aria-label="On this page">
          <strong>Your first handoff</strong>
          <a href="#install">1. Install</a><a href="#capture">2. Sync</a><a href="#resume">3. Resume</a><a href="#files">Files</a><a href="#faq">FAQ</a><a href="#troubleshooting">Troubleshooting</a>
        </nav>
        {children}
        <IntegrationSection id="files" title={`What setup writes for ${label}`}>
          <ul>
            {page.files.map((f) => (
              <li key={f.path}>
                <strong>
                  <Rich text={f.path} />
                </strong>
                : <Rich text={f.what} />
              </li>
            ))}
          </ul>
        </IntegrationSection>
        <FaqSection faq={page.faq} />
        <IntegrationSection id="handoffs" title={`Hand off from ${label}`}>
          <ul>
            {PAIRS.filter((p) => p.from.id === platform).map((p) => (
              <li key={p.slug}>
                <Link href={`/resume/${p.slug}`}>Continue {p.from.article} {label} session in {p.to.label}</Link>
              </li>
            ))}
          </ul>
        </IntegrationSection>
        <IntegrationSection id="troubleshooting" title="If the session does not appear">
          <p>Restart {label} after setup so it loads the MCP connection and hooks. Use the same project directory and AgentDrive account in both agents.</p>
          <p>In a terminal, check your sync settings, run a sync, then list the uploaded sessions:</p>
          <Snippet>{'adrive privacy --show\nadrive sync\nadrive resume --list'}</Snippet>
          <p>If transcript sync is off, a handoff brief is unavailable. For an encrypted session, run <code>adrive resume &lt;session-id&gt;</code> on the machine holding its encryption key.</p>
          <p>Still stuck? See the <a href="/docs/concepts/sessions">session reference</a> or <a href="mailto:hello@agentdrive.sh">contact us</a>.</p>
        </IntegrationSection>
      </ProseSection>
    </MarketingPageShell>
  );
}

export function IntegrationSection({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Snippet({ children }: { children: string }) {
  return <CodeBlock>{children}</CodeBlock>;
}

export function PromptExample({ children }: { children: ReactNode }) {
  return <blockquote>{children}</blockquote>;
}

export function WorkspaceTools({ label }: { label: string }) {
  return (
    <details className="m-reference">
      <summary>Advanced: workspace tools</summary>
      <p>
        Beyond sessions, {label} gets the full workspace over MCP: 22 tools, 18 stable plus 4 experimental sandbox
        tools.
      </p>
      <ul>
        <li>Sessions: <code>drive_sessions</code>, <code>drive_resume</code></li>
        <li>Files: <code>drive_write</code>, <code>drive_read</code>, <code>drive_list</code>, <code>drive_delete</code></li>
        <li>Provenance: <code>drive_activity</code>, <code>drive_versions</code>, <code>drive_log_run</code></li>
        <li>Search: <code>drive_search</code>, <code>drive_recall</code>, <code>drive_context</code></li>
        <li>Sharing: <code>drive_share</code>, <code>drive_comment</code>, <code>drive_feedback</code></li>
        <li>Org: <code>drive_invite</code>, <code>drive_roles</code>, <code>drive_org</code></li>
      </ul>
      <p>
        Full reference: <a href="/docs/mcp-tools">MCP tools</a>.
      </p>
    </details>
  );
}

export { PageHero };
