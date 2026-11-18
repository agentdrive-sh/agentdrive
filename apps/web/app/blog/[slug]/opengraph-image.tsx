import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';
import { getPost, listPosts } from '@/lib/source';

export const alt = 'AgentDrive blog post';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Pre-render the finite set so Workers serves assets without runtime file access.
export function generateStaticParams() {
  return listPosts().map((post) => ({ slug: post.slugs[0] }));
}

export default async function BlogPostImage({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  if (!post) notFound();
  const [regular, semiBold] = await Promise.all([
    readFile(join(process.cwd(), 'app/fonts/Geist-Regular.ttf')),
    readFile(join(process.cwd(), 'app/fonts/Geist-SemiBold.ttf')),
  ]);
  return new ImageResponse(
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0a0a0b', color: '#fafafa', padding: '64px 72px', fontFamily: 'Geist' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <svg width="48" height="48" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="2.5" r="1.6" fill="#ff8a3d" />
          <circle cx="12" cy="21.5" r="1.6" fill="#ff8a3d" />
          <circle cx="2.5" cy="12" r="1.6" fill="#ff8a3d" />
          <circle cx="21.5" cy="12" r="1.6" fill="#ff8a3d" />
          <line x1="12" y1="4.1" x2="12" y2="7.5" stroke="#ff8a3d" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="12" y1="16.5" x2="12" y2="19.9" stroke="#ff8a3d" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="4.1" y1="12" x2="7.5" y2="12" stroke="#ff8a3d" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="16.5" y1="12" x2="19.9" y2="12" stroke="#ff8a3d" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="7.4" y="7.4" width="9.2" height="9.2" rx="2.6" stroke="#ff8a3d" strokeWidth="1.6" fill="none" />
          <circle cx="12" cy="12" r="2.1" fill="#ff8a3d" />
        </svg>
        <div style={{ display: 'flex', color: '#ff8a3d', fontSize: 28 }}>AgentDrive · Blog</div>
      </div>
      <div style={{ display: 'flex', marginTop: 60, fontSize: 64, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.03em', maxWidth: 1040 }}>
        {post.data.title}
      </div>
      <div style={{ display: 'flex', fontSize: 22, color: '#a1a1aa', marginTop: 'auto' }}>agentdrive.sh{post.url}</div>
    </div>, { ...size, fonts: [
      { name: 'Geist', data: regular, weight: 400, style: 'normal' },
      { name: 'Geist', data: semiBold, weight: 600, style: 'normal' },
    ] },
  );
}
