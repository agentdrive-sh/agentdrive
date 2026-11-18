import type { Metadata } from 'next';
import { PLAN_CATALOG } from '@agentdrive/shared';
import type { source } from '@/lib/source';

export const SITE_URL = 'https://agentdrive.sh';

export const SITE_TITLE = 'AgentDrive — start in any agent, finish in any other';
export const SITE_DESCRIPTION =
  "The shared workspace that lets Claude Code, Codex, OpenCode, Cursor and Antigravity pick up each other's sessions, with provenance on every artifact.";

export const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: 'AgentDrive',
  url: SITE_URL,
  logo: `${SITE_URL}/apple-icon`,
};

export const SOFTWARE_ID = `${SITE_URL}/#software`;

export const OPEN_GRAPH_BASE = { type: 'website', siteName: 'AgentDrive', locale: 'en_US' } as const;

// A page-level openGraph replaces the root one and drops the root opengraph-image file, so name it again.
export function pageMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...OPEN_GRAPH_BASE, title, description, url: path, images: '/opengraph-image' },
  };
}

export function breadcrumbList(crumbs: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: `${SITE_URL}${crumb.path === '/' ? '' : crumb.path}`,
    })),
  };
}

const PLAN_BILLING: Record<string, Record<string, unknown>> = {
  pro: { billingDuration: 'P1M' },
  team: { billingDuration: 'P1M', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'seat' } },
};

export const SOFTWARE_APPLICATION = {
  '@type': 'SoftwareApplication',
  '@id': SOFTWARE_ID,
  name: 'AgentDrive',
  url: SITE_URL,
  license: ['https://spdx.org/licenses/AGPL-3.0-only.html', 'https://spdx.org/licenses/Apache-2.0.html'],
  description: SITE_DESCRIPTION,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'macOS, Linux',
  publisher: { '@id': ORGANIZATION['@id'] },
  offers: PLAN_CATALOG.filter((p) => p.price.startsWith('$')).map((p) => {
    const price = p.price.slice(1);
    return {
      '@type': 'Offer',
      name: p.name,
      price,
      priceCurrency: 'USD',
      description: p.blurb,
      ...(PLAN_BILLING[p.id] && {
        priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: 'USD', ...PLAN_BILLING[p.id] },
      }),
    };
  }),
};

type DocsPage = ReturnType<typeof source.getPages>[number];

export function techArticle(page: DocsPage) {
  const url = `${SITE_URL}${page.url}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${url}#article`,
    headline: page.data.title,
    name: page.data.title,
    description: page.data.description,
    dateModified: page.data.lastModified?.toISOString(),
    publisher: ORGANIZATION,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
  };
}
