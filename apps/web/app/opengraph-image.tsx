import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const alt =
  'AgentDrive. Start in any agent. Finish in any other.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OG() {
  const [regular, semiBold] = await Promise.all([
    readFile(join(process.cwd(), 'app/fonts/Geist-Regular.ttf')),
    readFile(join(process.cwd(), 'app/fonts/Geist-SemiBold.ttf')),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0a0b',
          display: 'flex',
          flexDirection: 'column',
          padding: '72px 80px',
          color: '#fafafa',
          fontFamily: 'Geist',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -160,
            right: -160,
            width: 520,
            height: 520,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at center, rgba(255,138,61,0.32) 0%, rgba(255,138,61,0) 70%)',
            display: 'flex',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
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
          <div
            style={{
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: '#fafafa',
              display: 'flex',
            }}
          >
            AgentDrive
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            marginTop: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              letterSpacing: '-0.035em',
              lineHeight: 1.04,
              color: '#fafafa',
              maxWidth: 1040,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>Start in any agent.</span>
            <span style={{ color: '#8a909a' }}>Finish in any other.</span>
          </div>
          <div
            style={{
              fontSize: 26,
              color: '#a1a1aa',
              lineHeight: 1.4,
              maxWidth: 980,
              display: 'flex',
            }}
          >
            One shared workspace for Claude Code, Codex, OpenCode, Cursor, Gemini CLI and Antigravity. Provenance on every artifact. Storage on R2, S3, or your own bucket.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginTop: 44,
            fontSize: 18,
            color: '#71717a',
            letterSpacing: '0.04em',
          }}
        >
          <div style={{ display: 'flex' }}>curl -fsSL agentdrive.sh/install | sh</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Geist', data: regular, weight: 400, style: 'normal' },
        { name: 'Geist', data: semiBold, weight: 600, style: 'normal' },
      ],
    },
  );
}
