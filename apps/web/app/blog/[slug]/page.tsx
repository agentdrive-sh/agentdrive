import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/json-ld';
import { breadcrumbList, ORGANIZATION, SITE_URL } from '@/components/seo/site';
import { formatPostDate, getPost, listPosts } from '@/lib/source';

export const dynamicParams = false;

export function generateStaticParams() {
  return listPosts().map((post) => ({ slug: post.slugs[0] }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const post = getPost(slug);
  if (!post) notFound();
  return {
    title: post.data.title,
    description: post.data.description,
    alternates: { canonical: post.url },
    robots: post.data.draft ? { index: false, follow: false } : undefined,
    openGraph: {
      type: 'article',
      title: post.data.title,
      description: post.data.description,
      url: post.url,
      siteName: 'AgentDrive',
      publishedTime: post.data.date,
      modifiedTime: post.data.updated,
      authors: [post.data.author],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.data.title,
      description: post.data.description,
    },
  };
}

export default async function BlogPost(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const post = getPost(slug);
  if (!post) notFound();
  const MDX = post.data.body;
  const url = `${SITE_URL}${post.url}`;

  return (
    <article className="blog-post">
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.data.title,
            description: post.data.description,
            datePublished: post.data.date,
            dateModified: post.data.updated,
            author: { '@type': 'Person', name: post.data.author },
            publisher: ORGANIZATION,
            mainEntityOfPage: { '@type': 'WebPage', '@id': url },
            url,
            image: `${url}/opengraph-image`,
          },
          breadcrumbList([
            { name: 'Home', path: '/' },
            { name: 'Blog', path: '/blog' },
            { name: post.data.title, path: post.url },
          ]),
        ]}
      />
      <header className="blog-post-head">
        <p className="m-crumb">
          <Link href="/blog">Blog</Link>
        </p>
        <h1 className="m-h1 page">{post.data.title}</h1>
        {post.data.description && <p className="m-lede">{post.data.description}</p>}
        <p className="blog-byline">
          <span>
            By <span className="author">{post.data.author}</span>
          </span>
          <time dateTime={post.data.date}>{formatPostDate(post.data.date)}</time>
          {post.data.draft && <span className="pill warning">draft, not published</span>}
        </p>
      </header>
      <div className="blog-prose">
        <MDX />
      </div>
      <footer className="blog-post-foot">
        <Link href="/blog">All posts</Link>
        <a href="/blog/rss.xml">Subscribe via RSS</a>
      </footer>
    </article>
  );
}
