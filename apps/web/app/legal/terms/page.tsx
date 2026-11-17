import type { Metadata } from 'next';
import {
  MarketingPageShell,
  PageHero,
  ProseSection,
} from '@/components/marketing/page-shell';
import { Contents } from '@/components/marketing/contents';
import { LegalSection } from '@/components/marketing/legal-section';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The agreement between you and AgentDrive when you use the hosted service.',
};

export default function TermsPage() {
  return (
    <MarketingPageShell screenLabel="marketing/legal/terms">
      <PageHero
        kicker="Legal"
        kickerHref="/legal"
        title="Terms of Service"
        lede="Effective 2026-10-22."
      />
      <ProseSection>
        <Contents titles={["1. Accounts", "2. Acceptable use", "3. Your content", "4. Subscriptions and payments", "5. Service availability", "6. Termination", "7. Intellectual property", "8. Disclaimer of warranties", "9. Limitation of liability", "10. Governing law", "11. Changes", "12. Contact"]} />
        <p>
          These Terms govern your use of AgentDrive (the &quot;Service&quot;)
          operated by Roushan Inc (&quot;we&quot;, &quot;us&quot;). By creating an
          account or making an API request, you agree to these Terms.
        </p>

        <LegalSection title="1. Accounts">
          <p>You may register anonymously (an API key is issued via /v1/register without an email) or claim an account via email magic-link, Google, or GitHub OAuth. You are responsible for all activity under your API keys.</p>
          <p>You must be at least 16 years old. You may not register on behalf of someone else without authorization.</p>
        </LegalSection>

        <LegalSection title="2. Acceptable use">
          <p>You agree not to use the Service to: (a) violate any law; (b) store or transmit malware, illegal content, or content that infringes third-party rights; (c) attempt to gain unauthorized access to the Service or its infrastructure; (d) reverse-engineer the hosted Worker code; (e) exceed the rate limits or quotas attached to your plan without an arrangement with us; (f) resell the Service to third parties on a hosted basis without a commercial license.</p>
          <p>The AgentDrive MCP server, CLI, SDK, and Claude Code plugin are licensed under Apache-2.0 (source at <a href="https://github.com/agentdrive-sh/agentdrive-mcp">GitHub</a> and on npm). The hosted Service is proprietary. See <a href="/legal/dpa">the DPA</a> for the data-processing terms.</p>
        </LegalSection>

        <LegalSection title="3. Your content">
          <p>You retain all rights to the files, embeddings, run logs, and other content you or your agents write to AgentDrive (&quot;Your Content&quot;). You grant us a worldwide, non-exclusive, royalty-free license to host, process, embed, and transmit Your Content solely to operate the Service for you.</p>
          <p>We do not train models on Your Content. We do not sell or share it with third parties beyond the subprocessors named in our <a href="/legal/dpa">DPA</a>.</p>
        </LegalSection>

        <LegalSection title="4. Subscriptions and payments">
          <p>The Free tier is free. Paid tiers (Pro, Team, Enterprise) are billed monthly or annually via Stripe in advance. See <a href="/pricing">pricing</a> for current plans.</p>
          <p>You authorize us (via Stripe) to charge your payment method for the recurring period. Subscriptions auto-renew until cancelled. Cancellation takes effect at the end of the current billing period; we do not refund partial periods.</p>
          <p>We may change pricing with 30 days notice; existing subscribers keep their existing rate until the next renewal after the notice period.</p>
        </LegalSection>

        <LegalSection title="5. Service availability">
          <p>We aim for 99.5% uptime but the Service is provided on an &quot;as-is, as-available&quot; basis during the beta period. No SLA applies to Free, Pro, or Team tiers. Enterprise contracts may include an SLA.</p>
          <p>We may perform maintenance with reasonable notice. Emergency security maintenance may happen without notice.</p>
        </LegalSection>

        <LegalSection title="6. Termination">
          <p>You may terminate at any time via Settings. We may terminate your account if you breach these Terms, fail to pay, or use the Service in a way that materially threatens its integrity.</p>
          <p>On termination, your data is retained per the retention schedule in our Privacy Policy. You can export Your Content via the API before termination.</p>
        </LegalSection>

        <LegalSection title="7. Intellectual property">
          <p>The Service, including its UI, brand, documentation, and the hosted Worker code, is our intellectual property and the property of our licensors. The open-source client pieces (the MCP server, CLI, SDK, and Claude Code plugin) are licensed under Apache-2.0.</p>
        </LegalSection>

        <LegalSection title="8. Disclaimer of warranties">
          <p>THE SERVICE IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We do not warrant that the Service will be uninterrupted, error-free, or completely secure.</p>
        </LegalSection>

        <LegalSection title="9. Limitation of liability">
          <p>TO THE EXTENT PERMITTED BY LAW, OUR AGGREGATE LIABILITY ARISING FROM OR RELATED TO THE SERVICE IS LIMITED TO THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) USD $100. WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES.</p>
        </LegalSection>

        <LegalSection title="10. Governing law">
          <p>These Terms are governed by the laws of India, without regard to conflict-of-law principles. Disputes will be resolved in the courts of Bangalore, Karnataka, India.</p>
        </LegalSection>

        <LegalSection title="11. Changes">
          <p>We may update these Terms with at least 30 days notice via <a href="/blog">the blog</a> and email to active accounts. Material changes that affect your rights will take effect after the notice period.</p>
        </LegalSection>

        <LegalSection title="12. Contact">
          <p><a href="mailto:legal@agentdrive.sh">legal@agentdrive.sh</a> for questions about these Terms.</p>
        </LegalSection>
      </ProseSection>
    </MarketingPageShell>
  );
}
