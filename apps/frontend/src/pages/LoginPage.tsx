import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToken } from '../contexts/TokenContext';
import { useApiClient } from '../hooks/useApiClient';

interface AuthProviders {
  google: boolean;
  github: boolean;
  email: boolean;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

interface LoginPageProps {
  heading?: string;
  subheading?: string;
  cliAuthId?: string;
  onEmailSession?: (sessionId: string, email: string, orgId?: string) => void;
}

export default function LoginPage({
  heading = 'Sign in to your workspace',
  subheading,
  cliAuthId,
  onEmailSession,
}: LoginPageProps) {
  const navigate = useNavigate();
  const { setSession, isLoggedIn } = useToken();
  const { publicFetch } = useApiClient();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<AuthProviders>({
    google: false,
    github: false,
    email: true,
  });
  const [providersLoaded, setProvidersLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicFetch<AuthProviders>('/auth/providers')
      .then((p) => {
        if (cancelled) return;
        setProviders({
          google: !!p?.google,
          github: !!p?.github,
          email: p?.email ?? true,
        });
      })
      .catch(() => {
        // If the endpoint is missing, assume email only so the page still works
      })
      .finally(() => {
        if (!cancelled) setProvidersLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [publicFetch]);

  useEffect(() => {
    if (isLoggedIn && !cliAuthId && !onEmailSession) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, cliAuthId, onEmailSession, navigate]);

  function startOAuth(provider: 'google' | 'github') {
    const params = new URLSearchParams();
    if (cliAuthId) params.set('cli_auth_id', cliAuthId);
    const qs = params.toString();
    window.location.href = `${API_BASE}/auth/oauth/${provider}${qs ? `?${qs}` : ''}`;
  }

  async function handleSendCode() {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      await publicFetch('/auth/send-code', {
        method: 'POST',
        body: JSON.stringify({ email, purpose: 'login' }),
      });
      setStep('code');
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const result = await publicFetch<{
        session_id: string;
        email: string;
        org_id?: string;
      }>('/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      });
      setSession(result.session_id, result.email, result.org_id);
      if (onEmailSession) {
        onEmailSession(result.session_id, result.email, result.org_id);
      } else {
        navigate('/', { replace: true });
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  const googleDisabled = !providers.google;
  const githubDisabled = !providers.github;

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-white">AgentDrive</span>
          </div>
          <h1 className="text-base font-semibold text-white">{heading}</h1>
          {subheading && (
            <p className="text-xs text-zinc-500 mt-1.5">{subheading}</p>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
          <ProviderButton
            label="Continue with Google"
            disabled={googleDisabled}
            disabledReason={providersLoaded && googleDisabled ? 'Google sign-in not configured on this deployment' : undefined}
            onClick={() => startOAuth('google')}
            icon={<GoogleIcon />}
          />
          <ProviderButton
            label="Continue with GitHub"
            disabled={githubDisabled}
            disabledReason={providersLoaded && githubDisabled ? 'GitHub sign-in not configured on this deployment' : undefined}
            onClick={() => startOAuth('github')}
            icon={<GitHubIcon />}
          />

          <div className="flex items-center gap-2 py-1">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-600">or</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          {step === 'email' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                  placeholder="you@company.com"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
              <button
                onClick={handleSendCode}
                disabled={!email.trim() || loading}
                className="w-full px-4 py-2.5 bg-emerald-500 text-black text-sm font-medium rounded-lg hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 transition-colors"
              >
                {loading ? 'Sending...' : 'Continue with email'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Enter the code sent to <span className="text-white">{email}</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-white text-center text-xl tracking-[0.4em] font-mono placeholder-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  autoFocus
                />
              </div>
              <button
                onClick={handleVerify}
                disabled={code.length !== 6 || loading}
                className="w-full px-4 py-2.5 bg-emerald-500 text-black text-sm font-medium rounded-lg hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 transition-colors"
              >
                {loading ? 'Verifying...' : 'Verify & Sign In'}
              </button>
              <button
                onClick={() => { setStep('email'); setCode(''); setError(''); }}
                className="w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Use a different email
              </button>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        <p className="text-center text-xs text-zinc-600 mt-6">
          Don't have an account? Agents auto-register on first install — run{' '}
          <code className="text-zinc-400">curl -fsSL agentdrive.sh/install | sh</code>{' '}
          instead.
        </p>
      </div>
    </div>
  );
}

function ProviderButton({
  label,
  icon,
  onClick,
  disabled,
  disabledReason,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm font-medium text-white hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-800 disabled:hover:bg-zinc-950 transition-colors"
    >
      <span className="w-4 h-4 inline-flex items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.12 3.06.74.8 1.18 1.83 1.18 3.09 0 4.43-2.69 5.4-5.25 5.69.41.35.78 1.05.78 2.12v3.14c0 .31.21.66.8.55C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
