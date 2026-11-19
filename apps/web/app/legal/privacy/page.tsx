import type { Metadata } from 'next';
import {
  MarketingPageShell,
  PageHero,
  ProseSection,
} from '@/components/marketing/page-shell';
import { Contents } from '@/components/marketing/contents';
import { LegalSection } from '@/components/marketing/legal-section';
import { pageMetadata } from '@/components/seo/site';

export const metadata: Metadata = pageMetadata(
  'Privacy Policy',
  'What AgentDrive collects, including synced session transcripts, how it is used, which subprocessors see it, how long it is kept, and your GDPR and CCPA rights.',
  '/legal/privacy',
);

export default function PrivacyPage() {
  return (
    <MarketingPageShell screenLabel="marketing/legal/privacy">
      <PageHero
        kicker="Legal"
        kickerHref="/legal"
        title="Privacy Policy"
        lede="Effective 2026-05-17. Updated 2026-11-19."
      />
      <ProseSection>
        <Contents titles={["Data we collect", "What we do not collect", "How we use it", "Third parties", "Retention", "Your rights (GDPR / CCPA)", "International transfers", "Security", "Children", "Changes", "Contact"]} />
        <p>
          AgentDrive is a hosted service operated by Roushan Inc (the
          &quot;Company&quot;, &quot;we&quot;, &quot;us&quot;). This policy
          describes how we handle data when you and your agents use AgentDrive
          at agentdrive.sh and app.agentdrive.sh (the &quot;Service&quot;).
        </p>

        <LegalSection title="Data we collect">
          <p><strong>Account data.</strong> Email address (when you sign in with a magic-link or OAuth provider), name and avatar provided by Google or GitHub during OAuth, organization name.</p>
          <p><strong>Agent data.</strong> Files your agents write to AgentDrive (content + metadata), share tokens you create, comments, run logs (task description, status, artifacts referenced/produced, duration, cost metadata).</p>
          <p><strong>Session transcripts.</strong> When session sync is on in the AgentDrive CLI or an AgentDrive plugin, we store your coding-agent session transcripts (your prompts, the agent&apos;s replies and its tool calls) and files your agents write that git does not track. Secrets are redacted on your device before upload; everything else, including any personal data in them, is stored as written. Turn session sync off with <code>adrive privacy</code>. From <code>@adrive/cli</code> 1.5.0, sessions and files from a period when sync was off are never uploaded, even after you turn it back on; with 1.4.0 and earlier, they uploaded once sync was turned back on.</p>
          <p><strong>Operational data.</strong> Request logs (IP, user-agent, request id, timestamp, response status), API key usage timestamps. We do not log request bodies.</p>
          <p><strong>Website analytics.</strong> On the public pages of agentdrive.sh (not the signed-in app), Google Analytics, loaded through Google Tag Manager, counts visits and which pages are read. It sets analytics cookies and receives the page address, your IP address and browser details.</p>
          <p><strong>Billing data.</strong> If you upgrade to a paid plan, Stripe processes your payment. We store a Stripe customer id; Stripe stores the card details. We never see card numbers.</p>
        </LegalSection>

        <LegalSection title="What we do not collect">
          <p>We do not collect: device fingerprints, advertising identifiers, your contact list, the cleartext of your API keys after issuance, or the cleartext of your share tokens after the signing operation.</p>
        </LegalSection>

        <LegalSection title="How we use it">
          <p><strong>Operate the Service.</strong> Files are stored to be served back to your agents. Metadata is used to enforce tenant isolation, versioning, and access control.</p>
          <p><strong>Semantic search.</strong> Standard workspace file content is embedded (vectorized) on write so &quot;drive_search&quot; and &quot;drive_context&quot; can return relevant artifacts. The text is not retained by the embedding model.</p>
          <p><strong>Email magic-links.</strong> Sign-in codes are sent from noreply@agentdrive.sh and expire in 10 minutes.</p>
          <p><strong>Improve the Service.</strong> Aggregated usage statistics (e.g., total artifacts, embeddings per month) inform capacity planning. We do not train any model on your data.</p>
        </LegalSection>

        <LegalSection title="Third parties">
          <p>We use a named set of subprocessors to provide the Service. The current list — including cloud infrastructure, payments, and OAuth identity — is maintained in our <a href="/legal/dpa">Data Processing Addendum</a>. Each subprocessor&apos;s privacy practices apply to data they process.</p>
          <p><strong>Stripe</strong> processes payments. Only billing data flows to Stripe.</p>
          <p><strong>Google / GitHub</strong> are OAuth providers if you choose to sign in with them. They share your profile id, email, and avatar with us. We do not request additional scopes.</p>
          <p><strong>Google Analytics</strong> measures visits to our public web pages, as described under Website analytics. It does not measure the signed-in app.</p>
          <p>We do not sell, rent, or share your data with any other third party.</p>
        </LegalSection>

        <LegalSection title="Retention">
          <p><strong>Account data:</strong> retained while your account is active and for 30 days after deletion request, then purged.</p>
          <p><strong>Agent data:</strong> retained while your plan is active. Free tier orgs that go inactive for 90 days are flagged; data is deleted at 180 days of inactivity unless you upgrade or extend.</p>
          <p><strong>Logs:</strong> 30 days, then purged.</p>
          <p><strong>Backups:</strong> our object storage is durable; we do not run additional backups beyond what our infrastructure provider provides. Deletion requests purge the live record and propagate to any replicas our infrastructure provider manages.</p>
        </LegalSection>

        <LegalSection title="Your rights (GDPR / CCPA)">
          <p>You have the right to access, correct, delete, port, or restrict processing of your personal data. To exercise any of these, email <a href="mailto:privacy@agentdrive.sh">privacy@agentdrive.sh</a> from the email on your account. We respond within 30 days.</p>
          <p>You can delete your account at any time by request from Settings or by email to privacy@agentdrive.sh; deletion is irreversible after 30 days.</p>
        </LegalSection>

        <LegalSection title="International transfers">
          <p>Our infrastructure provider serves the API globally from edge locations. Data may be processed in any country where they operate. On Team and Enterprise, BYO-bucket lets you select the region for file content. Metadata and search infrastructure remain managed by AgentDrive, so an EU bucket does not provide EU-only residency for the whole service.</p>
        </LegalSection>

        <LegalSection title="Security">
          <p>With Private Workspace enabled, the CLI encrypts new synced transcripts and files locally before upload. The service receives ciphertext and limited session metadata. Encrypted content cannot be searched by meaning on the server; resume requires the local encryption key. Enabling it does not remove earlier uploads.</p>
          <p>See <a href="/security">Security</a> for our security posture. Report vulnerabilities to <a href="mailto:security@agentdrive.sh">security@agentdrive.sh</a>.</p>
        </LegalSection>

        <LegalSection title="Children">
          <p>AgentDrive is not directed to children under 16. Do not use the Service if you are under 16.</p>
        </LegalSection>

        <LegalSection title="Changes">
          <p>Material changes to this policy will be announced via the changelog channel and via email to active accounts at least 30 days before they take effect.</p>
        </LegalSection>

        <LegalSection title="Contact">
          <p><a href="mailto:privacy@agentdrive.sh">privacy@agentdrive.sh</a> — for privacy questions.</p>
          <p><a href="mailto:security@agentdrive.sh">security@agentdrive.sh</a> — for security vulnerabilities.</p>
          <p><a href="mailto:legal@agentdrive.sh">legal@agentdrive.sh</a> — for anything else legal.</p>
        </LegalSection>
      </ProseSection>
    </MarketingPageShell>
  );
}
