import type { ReactNode } from 'react';
import { AgentDriveLogo } from '@/components/agentdrive-logo';

interface AuthCardProps {
  title: string;
  subtitle?: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}

export function AuthCard({
  title,
  subtitle,
  body,
  footer,
  maxWidth = 380,
}: AuthCardProps) {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth }}>
        <div
          className="row gap-2"
          style={{
            justifyContent: 'center',
            color: 'var(--accent)',
            marginBottom: 28,
          }}
        >
          <AgentDriveLogo size={22} />
          <span className="t-md wt-600 fg-0">AgentDrive</span>
        </div>

        <div
          className="surface"
          style={{
            padding: 28,
            background: 'var(--bg-1)',
            borderRadius: 'var(--r-xl)',
          }}
        >
          <h1
            className="fg-0"
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-0.015em',
              margin: '0 0 6px',
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <div className="muted t-sm" style={{ marginBottom: 22 }}>
              {subtitle}
            </div>
          )}
          <div className="col gap-3" style={{ marginTop: subtitle ? 0 : 18 }}>
            {body}
          </div>
        </div>

        {footer && (
          <div
            className="muted t-xs"
            style={{ textAlign: 'center', marginTop: 22, lineHeight: 1.6 }}
          >
            {footer}
          </div>
        )}
      </div>
    </main>
  );
}
