import type { Metadata } from 'next';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach AgentDrive for questions, support, security reports, privacy requests and legal matters.',
  alternates: { canonical: '/contact' },
};

const ISSUES = 'https://github.com/agentdrive-sh/agentdrive-mcp/issues';

export default function ContactPage() {
  return (
    <MarketingPageShell screenLabel="marketing/contact">
      <PageHero title="Contact AgentDrive" lede="Email reaches the people who build and run the service. Pick the address that matches your question so it lands with the right owner." />
      <ProseSection>
        <section id="general"><h2>Questions, plans and Enterprise</h2>
          <p>Write to <a href="mailto:hello@agentdrive.sh">hello@agentdrive.sh</a> about what AgentDrive does, which plan fits, volume pricing or an Enterprise contract. Paying customers get email support on Pro and priority support on Team.</p>
        </section>
        <section id="bugs"><h2>Bugs and feature requests</h2>
          <p>Open an issue on the <a href={ISSUES}>public issue tracker</a>. Include the CLI version from <code>adrive --version</code>, the agent you were using and what you expected to happen. Leave out API keys and anything private from your sessions.</p>
        </section>
        <section id="security"><h2>Security</h2>
          <p>Report a vulnerability to <a href="mailto:security@agentdrive.sh">security@agentdrive.sh</a> with a reproducer. We aim to acknowledge within 24 hours and fix high or critical issues within 7 days. The <a href="/security">security page</a> describes what leaves your machine.</p>
        </section>
        <section id="privacy"><h2>Privacy and data requests</h2>
          <p>Send privacy questions, data export requests and deletion requests to <a href="mailto:privacy@agentdrive.sh">privacy@agentdrive.sh</a>. The <a href="/legal/privacy">privacy policy</a> covers what we collect and how long we keep it.</p>
        </section>
        <section id="legal"><h2>Legal</h2>
          <p>Questions about the <a href="/legal/terms">terms</a>, the <a href="/legal/dpa">Data Processing Agreement</a> or a security review go to <a href="mailto:legal@agentdrive.sh">legal@agentdrive.sh</a>.</p>
        </section>
        <section id="status"><h2>Service status</h2>
          <p>Live API and storage checks are on the <a href="/status">status page</a>. AgentDrive is operated by Roushan Inc.</p>
        </section>
      </ProseSection>
    </MarketingPageShell>
  );
}
