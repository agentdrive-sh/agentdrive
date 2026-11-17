import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';
import { COMPETITORS, getCompetitor } from '../data';

export const alt = 'AgentDrive comparison: which tool fits your workflow?';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Pre-render the finite set so Workers serves assets without runtime file access.
export function generateStaticParams() {
  return COMPETITORS.map(({ slug }) => ({ slug }));
}

export default async function ComparisonImage({ params }: { params: Promise<{ slug: string }> }) {
  const competitor = getCompetitor((await params).slug);
  if (!competitor) notFound();
  const [regular, semiBold] = await Promise.all([
    readFile(join(process.cwd(), 'app/fonts/Geist-Regular.ttf')),
    readFile(join(process.cwd(), 'app/fonts/Geist-SemiBold.ttf')),
  ]);
  return new ImageResponse(
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0a0a0b', color: '#fafafa', padding: '64px 72px', fontFamily: 'Geist' }}>
      <div style={{ display: 'flex', color: '#ff8a3d', fontSize: 28 }}>AgentDrive · Compare</div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 60, fontSize: 64, fontWeight: 600, lineHeight: 1.1 }}>
        <span>AgentDrive vs</span><span>{competitor.name}</span>
      </div>
      <div style={{ display: 'flex', fontSize: 28, color: '#a1a1aa', marginTop: 32, lineHeight: 1.4 }}>Which tool fits your workflow?</div>
      <div style={{ display: 'flex', fontSize: 22, color: '#a1a1aa', marginTop: 'auto' }}>agentdrive.sh/compare/{competitor.slug}</div>
    </div>, { ...size, fonts: [
      { name: 'Geist', data: regular, weight: 400, style: 'normal' },
      { name: 'Geist', data: semiBold, weight: 600, style: 'normal' },
    ] },
  );
}
