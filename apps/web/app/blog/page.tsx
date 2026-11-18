import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero } from '@/components/marketing/page-shell';
import { pageMetadata } from '@/components/seo/site';
import { BLOG_DESCRIPTION, formatPostDate, listPosts } from '@/lib/source';

export const metadata: Metadata = {
  ...pageMetadata(
    'Blog',
    BLOG_DESCRIPTION,
    '/blog',
  ),
  alternates: { canonical: '/blog', types: { 'application/rss+xml': '/blog/rss.xml' } },
};

export default function BlogIndex() {
  const posts = listPosts();
  return (
    <>
      <PageHero
        title="Notes from the workspace."
        meta={
          <>
            Subscribe via{' '}
            <a className="m-link" href="/blog/rss.xml">
              RSS
            </a>
            .
          </>
        }
      />
      <section className="m-wrap narrow m-page-body">
        {posts.length === 0 && <p className="m-body">No posts yet.</p>}
        <ul className="m-rows">
          {posts.map((post) => (
            <li key={post.url}>
              <Link href={post.url} className="m-row">
                <span className="m-row-title">{post.data.title}</span>
                <span className="m-row-meta">
                  <time dateTime={post.data.date}>{formatPostDate(post.data.date)}</time>
                  {post.data.draft && <span className="pill warning m-row-pill">draft</span>}
                </span>
                {post.data.description && <span className="m-row-body">{post.data.description}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
