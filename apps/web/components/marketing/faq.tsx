import { JsonLd } from '@/components/seo/json-ld';

// Answers are plain strings so the visible text, the FAQPage JSON-LD and the markdown
// mirrors cannot disagree. `code` and bare https:// URLs are the only inline markup.
export interface FaqItem {
  q: string;
  a: string[];
}

const INLINE = /(`[^`]+`|https:\/\/[^\s]*[^\s.,;:)])/;

export function Inline({ text }: { text: string }) {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return (
      <a key={i} className="m-link" href={part}>
        {part}
      </a>
    );
  });
}

export function plainText(text: string): string {
  return text.replace(/`([^`]+)`/g, '$1');
}

export function faqPageJsonLd(items: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a.map(plainText).join('\n\n') },
    })),
  };
}

export function faqMarkdown(items: FaqItem[], level = '##'): string {
  return items.map(({ q, a }) => [`${level} ${q}`, ...a].join('\n\n')).join('\n\n');
}

export function FaqSection({ id, title, items }: { id: string; title: string; items: FaqItem[] }) {
  return (
    <section className="m-section" aria-labelledby={id}>
      <div className="m-wrap m-faq-layout">
        <header>
          <h2 id={id} className="m-h2">
            {title}
          </h2>
          <p className="m-body">
            Anything else? Email{' '}
            <a className="m-link" href="mailto:hello@agentdrive.sh">
              hello@agentdrive.sh
            </a>
            .
          </p>
        </header>
        <div className="m-faq">
          {items.map(({ q, a }) => (
            <div key={q}>
              <h3>{q}</h3>
              {a.map((p) => (
                <p key={p}>
                  <Inline text={p} />
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
      <JsonLd data={faqPageJsonLd(items)} />
    </section>
  );
}
