import type { CSSProperties, ReactNode } from 'react';

export type IconName =
  | 'file'
  | 'folder'
  | 'search'
  | 'dashboard'
  | 'brain'
  | 'play'
  | 'plug'
  | 'key'
  | 'share'
  | 'users'
  | 'card'
  | 'settings'
  | 'plus'
  | 'arrow-right'
  | 'arrow-left'
  | 'check'
  | 'x'
  | 'copy'
  | 'clock'
  | 'history'
  | 'hash'
  | 'tag'
  | 'chat'
  | 'star'
  | 'terminal'
  | 'logo'
  | 'eye'
  | 'lock'
  | 'download'
  | 'upload'
  | 'globe'
  | 'sparkle'
  | 'archive'
  | 'github'
  | 'menu';

interface IconProps {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, ReactNode> = {
  file: (
    <path
      d="M3 1.5h6.5L13 5v9.5H3z M9 1.5V5h4"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinejoin="round"
    />
  ),
  folder: (
    <path
      d="M2 4a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinejoin="round"
    />
  ),
  search: (
    <>
      <circle
        cx="7"
        cy="7"
        r="4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <line
        x1="10.5"
        y1="10.5"
        x2="13.5"
        y2="13.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  ),
  dashboard: (
    <>
      <rect
        x="2"
        y="2"
        width="5"
        height="6"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <rect
        x="9"
        y="2"
        width="5"
        height="3.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <rect
        x="9"
        y="7.5"
        width="5"
        height="6.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <rect
        x="2"
        y="10"
        width="5"
        height="4"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
    </>
  ),
  brain: (
    <path
      d="M5 3a3 3 0 0 0-3 3 3 3 0 0 0 1 2.2V11a3 3 0 0 0 5 1 3 3 0 0 0 5-1V8.2A3 3 0 0 0 14 6a3 3 0 0 0-3-3 3 3 0 0 0-3 1 3 3 0 0 0-3-1zM8 4v10"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinejoin="round"
    />
  ),
  play: <path d="M4 2.5 L13 8 L4 13.5 Z" fill="currentColor" />,
  plug: (
    <path
      d="M5 1.5v3 M11 1.5v3 M3 5h10v3a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4z M8 12v3"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinecap="round"
    />
  ),
  key: (
    <>
      <circle
        cx="5"
        cy="11"
        r="3"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M7 9 L13.5 2.5 M11.5 4.5 L13 6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  ),
  share: (
    <path
      d="M11 3a2 2 0 1 0 0 0.01 M11 13a2 2 0 1 0 0 0.01 M4 8a2 2 0 1 0 0 0.01 M5.7 7 L9.3 4 M5.7 9 L9.3 12"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinecap="round"
    />
  ),
  users: (
    <>
      <circle
        cx="6"
        cy="5"
        r="2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M2 13c0-2 2-3.5 4-3.5s4 1.5 4 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M10 5.5a2 2 0 1 1 0 3 M11.5 9.5c1.5 0.3 2.5 1.5 2.5 3"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
    </>
  ),
  card: (
    <>
      <rect
        x="1.5"
        y="3.5"
        width="13"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <line
        x1="1.5"
        y1="6.5"
        x2="14.5"
        y2="6.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </>
  ),
  settings: (
    <>
      <circle
        cx="8"
        cy="8"
        r="2"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M8 1.5v2 M8 12.5v2 M14.5 8h-2 M3.5 8h-2 M12.5 3.5 L11 5 M5 11 L3.5 12.5 M12.5 12.5 L11 11 M5 5 L3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  ),
  plus: (
    <path
      d="M8 3v10 M3 8h10"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
  'arrow-right': (
    <path
      d="M3 8h10 M9 4l4 4-4 4"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  'arrow-left': (
    <path
      d="M13 8H3 M7 4l-4 4 4 4"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  check: (
    <path
      d="M3 8.5 L6.5 12 L13 4.5"
      stroke="currentColor"
      strokeWidth="1.6"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  menu: (
    <path
      d="M2.5 4.5h11 M2.5 8h11 M2.5 11.5h11"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  ),
  x: (
    <path
      d="M4 4l8 8 M12 4l-8 8"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  ),
  copy: (
    <>
      <rect
        x="5"
        y="2"
        width="9"
        height="9"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M11 11v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
    </>
  ),
  clock: (
    <>
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M8 4.5V8L10.5 9.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
    </>
  ),
  history: (
    <>
      <path
        d="M2 8a6 6 0 1 0 1.8-4.2 M2 2v3.5h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 4.5V8L10.5 9.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
    </>
  ),
  hash: (
    <path
      d="M5 2L4 14 M11 2L10 14 M2 5.5h12 M2 10.5h12"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  ),
  tag: (
    <path
      d="M2 2h6L14 8l-6 6-6-6V2z M5 5h.01"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  ),
  chat: (
    <path
      d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 3v-3H3a1 1 0 0 1-1-1z"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinejoin="round"
    />
  ),
  star: (
    <path
      d="M8 1.8L9.85 5.55 14 6.15 11 9.05 11.7 13.2 8 11.25 4.3 13.2 5 9.05 2 6.15 6.15 5.55Z"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinejoin="round"
    />
  ),
  terminal: (
    <>
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M4 6L6.5 8 4 10 M8 10.5h4"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  logo: (
    <>
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
      <circle cx="5.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="10.5" cy="5" r="1.4" fill="currentColor" />
      <circle cx="10.5" cy="11" r="1.4" fill="currentColor" />
      <path
        d="M6.7 7.4L9.3 5.6 M6.7 8.6L9.3 10.4"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </>
  ),
  eye: (
    <>
      <path
        d="M1.5 8s2-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2 4.5-6.5 4.5S1.5 8 1.5 8z"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <circle
        cx="8"
        cy="8"
        r="2"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
    </>
  ),
  lock: (
    <>
      <rect
        x="3"
        y="7"
        width="10"
        height="7.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M5 7V4.5a3 3 0 0 1 6 0V7"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
    </>
  ),
  download: (
    <path
      d="M8 2v8 M4 7l4 4 4-4 M2.5 13.5h11"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  upload: (
    <path
      d="M8 14V6 M4 8l4-4 4 4 M2.5 2.5h11"
      stroke="currentColor"
      strokeWidth="1.3"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  globe: (
    <>
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <ellipse
        cx="8"
        cy="8"
        rx="2.5"
        ry="6.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <line
        x1="1.5"
        y1="8"
        x2="14.5"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </>
  ),
  sparkle: (
    <path
      d="M8 1.5L9.5 6 14 7.5 9.5 9 8 13.5 6.5 9 2 7.5 6.5 6Z M12.5 1.5L13 3 14.5 3.5 13 4 12.5 5.5 12 4 10.5 3.5 12 3Z"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
      strokeLinejoin="round"
    />
  ),
  archive: (
    <>
      <rect
        x="1.5"
        y="3"
        width="13"
        height="3"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M3 6v8h10V6 M6.5 9.5h3"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  github: (
    <path
      d="M8 1a7 7 0 0 0-2.2 13.6c.35.07.5-.15.5-.34v-1.2c-2 .44-2.4-.95-2.4-.95-.33-.83-.8-1.05-.8-1.05-.65-.45.05-.44.05-.44.72.05 1.1.74 1.1.74.64 1.1 1.67.78 2.08.6.06-.47.25-.78.45-.96-1.6-.18-3.27-.8-3.27-3.55 0-.78.28-1.42.74-1.93-.07-.18-.32-.92.07-1.92 0 0 .6-.2 1.97.74A6.85 6.85 0 0 1 8 3.85a6.85 6.85 0 0 1 1.8.24c1.37-.94 1.97-.74 1.97-.74.4 1 .14 1.74.07 1.92.46.5.74 1.15.74 1.93 0 2.76-1.68 3.36-3.28 3.54.26.22.48.65.48 1.32v1.96c0 .19.14.41.5.34A7 7 0 0 0 8 1z"
      fill="currentColor"
    />
  ),
};

export function Icon({ name, size = 16 }: IconProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    display: 'block',
    flexShrink: 0,
  };
  const content = paths[name] ?? (
    <circle cx="8" cy="8" r="3" fill="currentColor" />
  );
  return (
    <svg viewBox="0 0 16 16" style={style} className="ico">
      {content}
    </svg>
  );
}
