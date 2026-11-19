import { SITE_URL as SITE } from '@/components/seo/site';

export const LLMS_DIRECTIVE = `> For the complete documentation index, see [llms.txt](${SITE}/llms.txt). Every docs page is also served as markdown at its URL plus \`.md\`, and the full docs are in one file at [llms-full.txt](${SITE}/llms-full.txt).`;

export function link(title: string, path: string, description?: string): string {
  return `- [${title}](${SITE}${path})${description ? `: ${description}` : ''}`;
}

export function markdownPath(url: string): string {
  return url === '/docs' ? '/docs.md' : `${url}.md`;
}

// Agents look for the llms.txt pointer near the top, so it goes right under the page title.
export function withDirective(markdown: string): string {
  return markdown.includes(LLMS_DIRECTIVE) ? markdown : markdown.replace(/^(# .*\n)/m, `$1\n${LLMS_DIRECTIVE}\n`);
}

// Markdown gets copied, chunked and pasted away from the URL it came from, so root-relative links would dangle.
export function absoluteLinks(markdown: string): string {
  return markdown.replace(/\]\(\//g, `](${SITE}/`);
}

export function frontmatter(fields: Record<string, string | undefined>): string {
  const lines = Object.entries(fields).flatMap(([k, v]) => (v ? [`${k}: ${JSON.stringify(v)}`] : []));
  return ['---', ...lines, '---', ''].join('\n');
}

export function markdownResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', Vary: 'Accept, User-Agent' },
  });
}

export function markdownNotFound(): Response {
  return markdownResponse(
    `# Page not found

Nothing is published at this address on AgentDrive. Start from the documentation index at [llms.txt](${SITE}/llms.txt), the docs at [${SITE}/docs](${SITE}/docs.md), or every public page in the [sitemap](${SITE}/sitemap.xml).
`,
    404,
  );
}
