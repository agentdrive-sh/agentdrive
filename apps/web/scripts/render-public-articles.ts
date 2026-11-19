import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fromHtml } from 'hast-util-from-html';
import { select, selectAll } from 'hast-util-select';
import { toMdast } from 'hast-util-to-mdast';
import { gfmTableToMarkdown } from 'mdast-util-gfm-table';
import { toMarkdown } from 'mdast-util-to-markdown';
import About from '@/app/about/page';
import Contact from '@/app/contact/page';
import Integrations from '@/app/integrations/page';
import Antigravity from '@/app/integrations/antigravity/page';
import ClaudeCode from '@/app/integrations/claude-code/page';
import Codex from '@/app/integrations/codex/page';
import Cursor from '@/app/integrations/cursor/page';
import OpenCode from '@/app/integrations/opencode/page';
import Legal from '@/app/legal/page';
import Dpa from '@/app/legal/dpa/page';
import Privacy from '@/app/legal/privacy/page';
import Terms from '@/app/legal/terms/page';
import Manifesto from '@/app/manifesto/page';
import Resume from '@/app/resume/page';
import ResumePair from '@/app/resume/[pair]/page';
import { PAIRS } from '@/app/resume/data';
import Security from '@/app/security/page';
import { SITE_URL } from '@/components/seo/site';
import { frontmatter, withDirective } from '@/lib/llms';

// These articles contain JSX-authored instructions as well as data-driven sections.
// Render their public components directly so a copy edit reaches both formats together.
const articles = new Map<string, () => ReactNode | Promise<ReactNode>>([
  ['/about', About], ['/contact', Contact], ['/manifesto', Manifesto], ['/security', Security],
  ['/legal', Legal], ['/legal/dpa', Dpa], ['/legal/privacy', Privacy], ['/legal/terms', Terms],
  ['/integrations', Integrations], ['/integrations/antigravity', Antigravity],
  ['/integrations/claude-code', ClaudeCode], ['/integrations/codex', Codex],
  ['/integrations/cursor', Cursor], ['/integrations/opencode', OpenCode],
  ['/resume', Resume],
]);
for (const { slug } of PAIRS) {
  articles.set(`/resume/${slug}`, () => ResumePair({ params: Promise.resolve({ pair: slug }) }));
}

function articleMarkdown(content: ReactNode, canonical: string): string {
  const document = fromHtml(renderToStaticMarkup(content), { fragment: true });
  const main = select('main', document);
  if (!main) throw new Error(`Missing article body for ${canonical}`);

  // Put the heading first and retain the original section label below it.
  const hero = select('.m-page-hero', main);
  const heading = hero && select('h1', hero);
  if (hero && heading) hero.children = [heading, ...hero.children.filter((child) => child !== heading)];
  for (const decoration of selectAll('.m-int-badge', main)) decoration.children = [];
  for (const anchor of selectAll('a[href]', main)) {
    anchor.properties.href = new URL(String(anchor.properties.href), canonical).href;
  }
  const tree = toMdast(main, {
    handlers: {
      nav: () => undefined,
      button: () => undefined,
      summary: (state, node) => state.toFlow(state.all(node)),
    },
  });
  const body = toMarkdown(tree, { bullet: '-', fences: true, extensions: [gfmTableToMarkdown({ tableCellPadding: true, tablePipeAlign: false })] });
  const title = /^# (.+)$/m.exec(body)?.[1];
  if (!title) throw new Error(`Missing article title for ${canonical}`);
  return frontmatter({ title, canonical }) + withDirective(body);
}

async function generate() {
  const result: Record<string, string> = {};
  for (const [path, render] of articles) result[path] = articleMarkdown(await render(), SITE_URL + path);
  process.stdout.write(JSON.stringify(result));
}

void generate();
