import type { Metadata } from 'next';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { SITE_DESCRIPTION as DESCRIPTION } from '@/components/seo/site';

export const metadata: Metadata = {
  title: 'About',
  description: 'What AgentDrive is, how it works, how it is licensed and who operates it.',
  alternates: { canonical: '/about', types: { 'text/markdown': '/about.md' } },
};

export default function AboutPage() {
  return (
    <MarketingPageShell screenLabel="marketing/about">
      <PageHero title="About AgentDrive" lede={DESCRIPTION} />
      <ProseSection>
        <section id="what"><h2>What it does</h2>
          <p>Coding agents each keep their own history, so work started in one is invisible to the next. AgentDrive gives them one workspace. Hooks in Claude Code, Codex, OpenCode, Cursor and Antigravity sync each session in the background, and any of them can resume another&apos;s session through the MCP tools, the <code>/agentdrive:resume</code> command in Claude Code or <code>adrive resume</code> in a shell.</p>
          <p>Short, sourced answers about what AgentDrive supports, stores and costs are on the <a href="/facts">facts page</a>.</p>
        </section>
        <section id="open-source"><h2>Open source</h2>
          <p>The server and web app are licensed AGPL-3.0; the CLI, SDK, MCP server and Claude Code plugin are Apache-2.0. The source is on GitHub at <a href="https://github.com/agentdrive-sh/agentdrive">agentdrive-sh/agentdrive</a>, and the <a href="/docs/self-hosting">self-hosting guide</a> covers running your own deployment.</p>
        </section>
        <section id="company"><h2>Company</h2>
          <p>AgentDrive is operated by Roushan Inc. The <a href="/manifesto">manifesto</a> explains why we build it, <a href="/pricing">pricing</a> lists the plans, and the <a href="/contact">contact page</a> lists who to write to for support, security, privacy and legal questions.</p>
        </section>
      </ProseSection>
    </MarketingPageShell>
  );
}
