import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingPageShell, PageHero } from '@/components/marketing/page-shell';
import { pageMetadata } from '@/components/seo/site';

export const metadata: Metadata = pageMetadata(
  'Legal',
  "AgentDrive's legal documents: the privacy policy, the terms of service for the hosted service, and the data processing agreement for business customers.",
  '/legal',
);

const docs = [
  {
    href: '/legal/privacy',
    title: 'Privacy Policy',
    body: 'What we collect, why, how long we keep it, and what your rights are.',
  },
  {
    href: '/legal/terms',
    title: 'Terms of Service',
    body: 'The agreement between you and AgentDrive when you use the hosted service.',
  },
  {
    href: '/legal/dpa',
    title: 'Data Processing Agreement',
    body: 'GDPR-compliant DPA for B2B customers processing personal data in AgentDrive.',
  },
];

export default function LegalIndex() {
  return (
    <MarketingPageShell screenLabel="marketing/legal">
      <PageHero title="Legal documents" />
      <section className="m-wrap narrow m-page-body">
        <ul className="m-rows">
          {docs.map((d) => (
            <li key={d.href}>
              <Link href={d.href} className="m-row">
                <span className="m-row-title">{d.title}</span>{' '}
                <span className="m-row-body">{d.body}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="m-meta">
          For questions about any of these, email{' '}
          <a className="m-link" href="mailto:legal@agentdrive.sh">
            legal@agentdrive.sh
          </a>
          .
        </p>
      </section>
    </MarketingPageShell>
  );
}
