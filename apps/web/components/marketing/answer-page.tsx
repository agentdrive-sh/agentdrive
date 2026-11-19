import type { Metadata } from 'next';

export const SITE = 'https://agentdrive.sh';

export interface Faq {
  q: string;
  a: string;
}

// Copy strings mark inline code with backticks, so one string feeds both the page and its JSON-LD.
export function plain(text: string): string {
  return text.replaceAll('`', '');
}

export function Rich({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>;
}

export function FaqSection({ faq }: { faq: Faq[] }) {
  return (
    <section id="faq">
      <h2>Frequently asked questions</h2>
      {faq.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>
            <Rich text={f.a} />
          </p>
        </div>
      ))}
    </section>
  );
}

export function faqLd(faq: Faq[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: plain(f.a) },
    })),
  };
}

export function breadcrumbLd(crumbs: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${SITE}${c.path === '/' ? '' : c.path}`,
    })),
  };
}

// A page-level openGraph or twitter replaces the root one wholesale, image included, so it is restated here.
export function pageMetadata(title: string, description: string, path: string, image = '/opengraph-image'): Metadata {
  const images = [{ url: image, width: 1200, height: 630, alt: title }];
  return {
    title,
    description,
    alternates: { canonical: path, types: { 'text/markdown': `${path}.md` } },
    openGraph: { title, description, url: path, siteName: 'AgentDrive', type: 'website', locale: 'en_US', images },
    twitter: { card: 'summary_large_image', title, description, images },
  };
}
