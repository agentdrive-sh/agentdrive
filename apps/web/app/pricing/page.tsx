import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ALL_PLANS_INCLUDE, COMING_NEXT, PLAN_CATALOG } from '@agentdrive/shared';
import { Icon } from '@/components/icon';
import { MarketingPageShell, PageHero } from '@/components/marketing/page-shell';
import { EnterprisePlan, PlanCard, PlanGuide } from '@/components/marketing/plan-card';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Free, Pro, Team and Enterprise plans for AgentDrive, the shared workspace that lets Claude Code, Codex, OpenCode, Cursor and Antigravity resume each other’s sessions.',
  alternates: { canonical: '/pricing' },
};

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'What is a principal?',
    a: 'One human or team identity: whoever holds the API key. Run as many agents under it as your plan’s agent limit allows.',
  },
  {
    q: 'Is Free a trial?',
    a: 'No. Free has no expiry and needs no card.',
  },
  {
    q: 'What gets synced, and where does it go?',
    a: (
      <>
        Session transcripts, plus files the agent wrote in a session that git doesn&apos;t track, upload to your AgentDrive
        workspace. If you run <code>adrive watch</code>, every file under that folder uploads too, existing files included,
        except anything matched by <code>.gitignore</code> or <code>.adriveignore</code>. Known secret
        patterns are redacted before upload, files matching <code>.adriveignore</code> (and defaults like{' '}
        <code>.env</code>, keys and <code>.ssh</code>) are excluded from artifact uploads, and you can switch
        transcript or file sync off with <code>adrive privacy</code>. Redaction is best-effort, so
        avoid pasting sensitive text into synced conversations.
      </>
    ),
  },
  {
    q: 'Can I use my own bucket?',
    a: 'Yes, on Team and Enterprise. Point a workspace at your own Cloudflare R2 bucket or any S3-compatible store: AWS S3, Backblaze, Wasabi or MinIO. GCS and Azure are coming next.',
  },
  {
    q: 'Do you train on my data?',
    a: (
      <>
        No. We do not train any model on your data. Standard workspace content is embedded so semantic search works. Private Workspace encrypts content locally, so its plaintext is unavailable to server-side search. See the{' '}
        <Link className="m-link" href="/legal/privacy">
          privacy policy
        </Link>
        .
      </>
    ),
  },
  {
    q: 'How do I cancel?',
    a: (
      <>
        From the billing portal: open it from the app, or run <code>adrive billing</code>.
      </>
    ),
  },
  {
    q: 'Are limits enforced?',
    a: 'Seat, workspace and agent limits are enforced when you add one. Storage is a soft limit: warnings start at 80%, and syncing never pauses. Resuming in local mode, from the agent transcripts on one machine, is unlimited and needs no account. Free includes 10 cloud resumes a month across agents, with warnings as you approach the limit; re-opening a session in the same agent that already resumed it that month does not count again, while a different agent opening it does. Check usage with adrive plan and upgrade with adrive upgrade.',
  },
];

export default function PricingPage() {
  return (
    <MarketingPageShell screenLabel="marketing/pricing">
      <PageHero
        width="wide"
        title="Pricing"
        lede="Free runs the whole loop on one machine, with no expiry and no card. Upgrade when you run agents every day or hand work across a team."
      />

      <section className="m-wrap" aria-label="Plans">
        <div className="m-plans">
          {PLAN_CATALOG.filter((p) => p.id !== 'enterprise').map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>

        <EnterprisePlan />
        <PlanGuide />
        <div className="m-includes">
          <h2 className="m-h3">Every plan includes</h2>
          <ul className="m-list yes">
            {ALL_PLANS_INCLUDE.map((item) => (
              <li key={item}>
                <Icon name="check" size={12} />
                {item}
              </li>
            ))}
          </ul>
          <p className="m-body m-note">Coming next: {COMING_NEXT.join(', ')}.</p>
        </div>
      </section>

      <section className="m-section">
        <div className="m-wrap m-faq-layout">
          <header>
            <h2 className="m-h2">Questions</h2>
            <p className="m-body">
              Anything else? Email{' '}
              <a className="m-link" href="mailto:hello@agentdrive.sh">
                hello@agentdrive.sh
              </a>
              .
            </p>
          </header>
          <div className="m-faq">
            {FAQ.map(({ q, a }) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </MarketingPageShell>
  );
}
