interface AgentDriveLogoProps {
  size?: number;
}

// The mark: four agent endpoints on the cardinal axes feed into a central
// workspace (rounded square outline) around a solid memory core. One source
// of truth, every agent.
export function AgentDriveLogo({ size = 22 }: AgentDriveLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <circle cx="12" cy="2.5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="21.5" r="1.6" fill="currentColor" />
      <circle cx="2.5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="21.5" cy="12" r="1.6" fill="currentColor" />

      <line
        x1="12"
        y1="4.1"
        x2="12"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="16.5"
        x2="12"
        y2="19.9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1="4.1"
        y1="12"
        x2="7.5"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1="16.5"
        y1="12"
        x2="19.9"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      <rect
        x="7.4"
        y="7.4"
        width="9.2"
        height="9.2"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
      />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  );
}
