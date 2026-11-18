import type { Metadata } from 'next';

export const SITE_URL = 'https://agentdrive.sh';

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
