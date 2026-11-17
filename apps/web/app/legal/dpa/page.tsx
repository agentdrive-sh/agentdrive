import type { Metadata } from 'next';
import {
  MarketingPageShell,
  PageHero,
  ProseSection,
} from '@/components/marketing/page-shell';
import { Contents } from '@/components/marketing/contents';
import { LegalSection } from '@/components/marketing/legal-section';

export const metadata: Metadata = {
  title: 'Data Processing Agreement',
  description:
    'GDPR-compliant DPA for B2B customers processing personal data in AgentDrive.',
};

export default function DpaPage() {
  return (
    <MarketingPageShell screenLabel="marketing/legal/dpa">
      <PageHero
        kicker="Legal"
        kickerHref="/legal"
        title="Data Processing Agreement"
        lede="Effective 2026-05-17. For B2B customers who process personal data through AgentDrive."
      />
      <ProseSection>
        <Contents titles={["1. Subject matter and duration", "2. Nature and purpose", "3. Types of personal data and categories of data subjects", "4. Processor obligations", "5. Authorized sub-processors", "6. International transfers", "7. Security incidents", "8. Data subject requests", "9. Audits", "10. Liability", "11. Term and termination", "12. Contact"]} />
        <p>
          This Data Processing Agreement (&quot;DPA&quot;) supplements the
          AgentDrive Terms of Service. It applies when Customer processes
          personal data (as defined by the GDPR) through the Service.
        </p>
        <p>
          By using AgentDrive for activities that involve personal data,
          Customer (the &quot;Data Controller&quot;) instructs Roushan Inc
          (the &quot;Data Processor&quot; or &quot;Processor&quot;) to process
          personal data on its behalf under the terms below.
        </p>

        <LegalSection title="1. Subject matter and duration">
          <p>The subject matter is the operation of the AgentDrive Service. The duration matches the duration of the Customer&apos;s subscription, plus the post-termination retention period defined in the Privacy Policy.</p>
        </LegalSection>

        <LegalSection title="2. Nature and purpose">
          <p>The Processor processes personal data solely to provide the Service: storing artifacts, metadata, and embeddings in managed cloud infrastructure; serving them back to authorized agents; sending transactional email; processing payments via Stripe.</p>
        </LegalSection>

        <LegalSection title="3. Types of personal data and categories of data subjects">
          <p>Personal data processed may include: email addresses, names, agent identifiers, IP addresses, content of files written by agents (which may include personal data depending on the Customer&apos;s use), and metadata about who-wrote-what.</p>
          <p>Data subjects: Customer&apos;s end users, Customer&apos;s team members, and any individual whose personal data appears in files the Customer&apos;s agents write to AgentDrive.</p>
        </LegalSection>

        <LegalSection title="4. Processor obligations">
          <p>(a) Process personal data only on documented instructions from the Controller (the Terms + this DPA).</p>
          <p>(b) Ensure persons authorized to process the data are under confidentiality.</p>
          <p>(c) Implement the technical and organizational security measures described on the <a href="/security">security page</a>.</p>
          <p>(d) Engage sub-processors only with the Controller&apos;s general authorization (listed below) and bind them to obligations no less protective than this DPA.</p>
          <p>(e) Assist the Controller with data subject requests, security incidents, and impact assessments.</p>
          <p>(f) On termination, delete or return personal data per the retention schedule unless law requires otherwise.</p>
          <p>(g) Make available all information necessary to demonstrate compliance with this DPA and allow for audits, subject to confidentiality obligations.</p>
        </LegalSection>

        <LegalSection title="5. Authorized sub-processors">
          <p><strong>Cloudflare, Inc.</strong> — cloud infrastructure (compute, storage, metadata, vector index, embeddings, transactional email). Privacy: <a href="https://cloudflare.com/privacypolicy">cloudflare.com/privacypolicy</a></p>
          <p><strong>Stripe, Inc.</strong> — payment processing. Privacy: <a href="https://stripe.com/privacy">stripe.com/privacy</a></p>
          <p><strong>Google LLC</strong> — OAuth (only if Customer uses Google sign-in). Privacy: <a href="https://policies.google.com/privacy">policies.google.com/privacy</a></p>
          <p><strong>GitHub, Inc.</strong> — OAuth (only if Customer uses GitHub sign-in). Privacy: <a href="https://docs.github.com/en/site-policy/privacy-policies">docs.github.com/en/site-policy/privacy-policies</a></p>
          <p>We will notify Customer of any new sub-processor at least 30 days before adding them. Customer may object by terminating the agreement.</p>
        </LegalSection>

        <LegalSection title="6. International transfers">
          <p>Personal data may be processed in any country our infrastructure provider operates in. Where data crosses borders from the EEA, the EU Standard Contractual Clauses (2021/914/EU) Module 2 (Controller-to-Processor) apply between Customer and Processor and are incorporated by reference.</p>
          <p>BYO-bucket is available on Team and Enterprise for storing file content in a customer-selected R2 or S3-compatible bucket. Metadata and search infrastructure remain managed by AgentDrive; choosing an EU bucket does not make the whole service EU-only.</p>
        </LegalSection>

        <LegalSection title="7. Security incidents">
          <p>The Processor will notify the Controller without undue delay (and no later than 72 hours) of any personal data breach. Notification will include the nature of the breach, the categories and approximate number of data subjects, the likely consequences, and the measures taken or proposed.</p>
        </LegalSection>

        <LegalSection title="8. Data subject requests">
          <p>If the Processor receives a data subject request directly, the Processor will forward it to the Controller and not respond unless authorized. The Processor will assist the Controller in fulfilling its obligations to respond.</p>
        </LegalSection>

        <LegalSection title="9. Audits">
          <p>The Processor will provide the Controller with the latest security documentation (security posture page, SOC2 report when available) on request. On-site audits may be conducted with reasonable advance notice and at the Controller&apos;s expense.</p>
        </LegalSection>

        <LegalSection title="10. Liability">
          <p>The liability limits in the Terms of Service apply equally to this DPA.</p>
        </LegalSection>

        <LegalSection title="11. Term and termination">
          <p>This DPA is effective for the duration of the Controller&apos;s use of the Service, then for the data retention period in the Privacy Policy.</p>
        </LegalSection>

        <LegalSection title="12. Contact">
          <p>For DPA execution or specific data-protection questions: <a href="mailto:legal@agentdrive.sh">legal@agentdrive.sh</a>.</p>
        </LegalSection>
      </ProseSection>
    </MarketingPageShell>
  );
}
