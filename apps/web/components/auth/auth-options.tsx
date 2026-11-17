'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ApiClient, type AuthProviders } from '@/lib/api-client';
import { EmailMagicLink } from './email-magic-link';

interface AuthOptionsProps {
  cliAuthId?: string;
  onEmailVerified: (result: {
    session_id: string;
    email: string;
    org_id?: string;
  }) => void | Promise<void>;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'https://app.agentdrive.sh';

export function AuthOptions({
  cliAuthId,
  onEmailVerified,
}: AuthOptionsProps) {
  const [providers, setProviders] = useState<AuthProviders>({
    google: false,
    github: false,
    email: true,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const client = new ApiClient();
    client
      .getAuthProviders()
      .then((p) => {
        if (cancelled) return;
        setProviders({
          google: !!p?.google,
          github: !!p?.github,
          email: p?.email ?? true,
        });
      })
      .catch(() => {
        // If endpoint is missing, keep email-only fallback.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const oauthHref = (provider: 'google' | 'github') => {
    const after = cliAuthId
      ? `/cli-auth?id=${encodeURIComponent(cliAuthId)}`
      : '/signin/callback';
    return `${API_BASE}/auth/oauth/${provider}?redirect_after=${encodeURIComponent(after)}`;
  };

  return (
    <div className="col gap-3">
      <ProviderButton
        disabled={loaded && !providers.google}
        disabledHint="Google sign-in not configured on this deployment"
        href={oauthHref('google')}
        icon={<GoogleIcon />}
        label="Continue with Google"
      />
      <ProviderButton
        disabled={loaded && !providers.github}
        disabledHint="GitHub sign-in not configured on this deployment"
        href={oauthHref('github')}
        icon={<GitHubIcon />}
        label="Continue with GitHub"
      />

      <div
        className="row"
        style={{ gap: 8, margin: '6px 0' }}
        aria-hidden="true"
      >
        <div
          style={{
            flex: 1,
            height: 1,
            background: 'var(--border)',
          }}
        />
        <span
          className="t-xs muted mono"
          style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}
        >
          or
        </span>
        <div
          style={{
            flex: 1,
            height: 1,
            background: 'var(--border)',
          }}
        />
      </div>

      <EmailMagicLink onVerified={onEmailVerified} />
    </div>
  );
}

interface ProviderButtonProps {
  href: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  disabledHint?: string;
}

function ProviderButton({
  href,
  icon,
  label,
  disabled,
  disabledHint,
}: ProviderButtonProps) {
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledHint}
        className="btn"
        style={{
          width: '100%',
          justifyContent: 'center',
          opacity: 0.4,
          cursor: 'not-allowed',
        }}
      >
        <span className="row" style={{ gap: 10 }}>
          {icon}
          {label}
        </span>
      </button>
    );
  }
  return (
    <a
      href={href}
      className="btn"
      style={{ width: '100%', justifyContent: 'center' }}
    >
      <span className="row" style={{ gap: 10 }}>
        {icon}
        {label}
      </span>
    </a>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
      style={{ color: 'var(--text-0)' }}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.12 3.06.74.8 1.18 1.83 1.18 3.09 0 4.43-2.69 5.4-5.25 5.69.41.35.78 1.05.78 2.12v3.14c0 .31.21.66.8.55C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
