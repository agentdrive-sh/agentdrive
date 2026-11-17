import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0a0b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 36,
        }}
      >
        <svg
          width="132"
          height="132"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
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
      </div>
    ),
    { ...size },
  );
}
