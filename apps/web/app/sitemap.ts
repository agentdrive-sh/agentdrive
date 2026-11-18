import type { MetadataRoute } from 'next';
import { listPosts, source } from '@/lib/source';
import { COMPETITORS } from './compare/data';
import { GLOSSARY } from './glossary/glossary';
import { CAPTURE_HARNESSES } from './integrations/data';
import { PAIRS } from './resume/data';

const SITE = 'https://agentdrive.sh';

const STATIC_ROUTES = [
  '/',
  '/pricing',
  '/integrations',
  '/compare',
  '/blog',
  '/security',
  '/status',
  '/manifesto',
  '/facts',
  '/legal',
  '/legal/terms',
  '/legal/privacy',
  '/legal/dpa',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    ...STATIC_ROUTES,
    ...CAPTURE_HARNESSES.map((i) => `/integrations/${i.platform}`),
    '/resume',
    ...PAIRS.map((p) => `/resume/${p.slug}`),
    ...COMPETITORS.map((c) => `/compare/${c.slug}`),
    '/glossary',
    ...GLOSSARY.map((t) => `/glossary/${t.slug}`),
  ];
  return [
    ...paths.map((path) => ({ url: `${SITE}${path === '/' ? '' : path}` })),
    ...source.getPages().map((p) => ({ url: `${SITE}${p.url}`, lastModified: p.data.lastModified })),
    ...listPosts().map((p) => ({ url: `${SITE}${p.url}`, lastModified: p.data.updated ?? p.data.date })),
  ];
}
