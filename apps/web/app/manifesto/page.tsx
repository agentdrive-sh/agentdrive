import type { Metadata } from 'next';
import Link from 'next/link';
import { InstallBlock } from '@/components/marketing/install-block';
import { pageMetadata } from '@/components/seo/site';
import {
  MarketingPageShell,
  PageHero,
  ProseSection,
} from '@/components/marketing/page-shell';

export const metadata: Metadata = pageMetadata(
  'Manifesto',
  'Agents need a shared artifact workspace with provenance. Why we built AgentDrive across Claude Code, Codex, OpenCode, Cursor and Antigravity.',
  '/manifesto',
);

export default function ManifestoPage() {
  return (
    <MarketingPageShell screenLabel="marketing/manifesto">
      <PageHero
        title="Agents need a shared artifact workspace."
        lede="Switch coding agents without losing the work. Keep files, context and authorship together."
        meta="By Rakesh Roushan · Updated November 2, 2026"
      />
      <ProseSection>

        <p>
          Every multi-agent workflow we've seen stalls on the same problem.
          Codex writes a draft. Claude Code can't see it. The user copy-pastes.
          Tomorrow Cursor opens a new session and forgets every plan from the
          last one. The user becomes the bus between agents — a manual
          serializer for a system that's supposed to feel autonomous.
        </p>

        <p>
          The industry's response has been to invent memory systems.
          Conversational memory. Episodic memory. Knowledge graphs. Mem0, Zep,
          Letta, LangMem, Cognee — each one models agent cognition as a stream
          of facts to recall.
        </p>

        <p>
          We think that's the wrong shape. Agents do not produce facts. They
          produce <strong>artifacts</strong> — files, plans, code, drafts,
          logs. A markdown spec from Claude Code is not a memory; it is the
          output of work. A TypeScript module from Codex is not a fact; it is
          code. A run log from LangGraph is not a recollection; it is
          provenance.
        </p>

        <p>
          The right abstraction is a filesystem. Versioned. Content-addressed.
          With identity attached to every write. Searchable both by name and
          by meaning. Shareable across whatever agent platform happens to be
          running this minute.
        </p>

        <h2>Three commitments</h2>

        <p>
          <strong>One.</strong> The substrate stays neutral. We are not a
          framework. We don't impose a runtime, an orchestrator, or an opinion
          about how agents should be structured. Bring Claude Code, Codex,
          Cursor, LangGraph, CrewAI, AutoGen, your homegrown stack — they all
          read and write the same files.
        </p>

        <p>
          <strong>Two.</strong> Provenance is non-optional. Every write
          records which principal, which platform, which role. Read your full
          cross-agent history at any time. If you can't audit who shipped
          what, you can't trust the work.
        </p>

        <p>
          <strong>Three.</strong> The wedge is the workflow, not the
          recall depth. We will lose to a dedicated knowledge-graph product
          when you need temporal reasoning over a million facts. We will win
          when you have three agents on three different platforms and need
          them to ship code together without a human in the loop. That's the
          job we wake up for.
        </p>

        <h2>What we will not do</h2>

        <p>
          We will not build a knowledge graph. We will not ship a vector
          database. We will not become a memory framework that locks you to
          our SDK. We will not sell your data, train on it, or share it with
          any third party beyond the payment processor and the cloud
          substrate. We also will not pretend single-platform memory is weak:
          Claude, ChatGPT, and Cursor will keep getting better inside their
          own walls. Our job is to make cross-platform work auditable and
          portable when those walls get in the way.
        </p>

        <h2>What we will do</h2>

        <p>
          We will keep adding agent platforms. We will keep the API neutral.
          We will keep the format files — readable by humans, writable by
          every agent, durable forever. We will keep provenance attached.
          We will keep the surface small enough to fit in your head.
        </p>

        <p className="m-closing">
          The workspace is the substrate. The memory is a feature. The agents
          are guests. The artifacts are what last.
        </p>

        <div className="m-cta">
          <InstallBlock />
          <Link href="/docs/quick-start" className="btn lg primary">
            Install AgentDrive
          </Link>
        </div>
      </ProseSection>
    </MarketingPageShell>
  );
}
