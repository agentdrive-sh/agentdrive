import type { Metadata } from 'next';
import { ALL_PLANS_INCLUDE, COMING_NEXT, PLAN_CATALOG } from '@agentdrive/shared';
import { Icon } from '@/components/icon';
import { FaqSection } from '@/components/marketing/faq';
import { MarketingPageShell, PageHero } from '@/components/marketing/page-shell';
import { EnterprisePlan, PlanCard, PlanGuide } from '@/components/marketing/plan-card';
import { alt, size } from '../opengraph-image';
import { PRICING_FAQ } from './faq';
import { OPEN_GRAPH_BASE } from '@/components/seo/site';

const DESCRIPTION =
  'Free, Pro, Team and Enterprise plans for AgentDrive, which lets Claude Code, Codex, OpenCode, Cursor and Antigravity resume each other’s sessions.';

export const metadata: Metadata = {
  title: 'Pricing',
  description: DESCRIPTION,
  alternates: { canonical: '/pricing', types: { 'text/markdown': '/pricing.md' } },
  openGraph: {
    ...OPEN_GRAPH_BASE,
    url: '/pricing',
    title: 'Pricing — AgentDrive',
    description: DESCRIPTION,
    images: [{ url: '/opengraph-image', ...size, alt }],
  },
};

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

      <FaqSection id="pricing-faq-title" title="Questions" items={PRICING_FAQ} />
    </MarketingPageShell>
  );
}
