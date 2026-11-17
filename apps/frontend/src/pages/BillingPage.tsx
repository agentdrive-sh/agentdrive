import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useToken } from '../contexts/TokenContext';
import { useApiClient } from '../hooks/useApiClient';

type State = 'loading' | 'redirecting' | 'cli-return' | 'unavailable' | 'auth-required' | 'error';

export default function BillingPage() {
  const [params] = useSearchParams();
  const cliMode = params.get('cli') === '1';
  const { isLoggedIn } = useToken();
  const { apiFetch } = useApiClient();
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoggedIn) {
      setState('auth-required');
      return;
    }
    if (cliMode) {
      // After a Stripe portal round-trip the CLI just needs a confirmation page.
      // We can't intercept Stripe's redirect — show a friendly close hint.
      setState('cli-return');
      return;
    }
    let cancelled = false;
    setState('loading');
    apiFetch<{ url: string }>('/billing/portal', { method: 'POST' })
      .then((res) => {
        if (cancelled) return;
        if (res?.url) {
          setState('redirecting');
          window.location.href = res.url;
        } else {
          setState('unavailable');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = (err as Error).message || '';
        if (/503|not configured|stripe/i.test(msg)) {
          setState('unavailable');
        } else {
          setError(msg || 'Failed to open billing portal');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, cliMode, apiFetch]);

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center animate-in">
        {state === 'loading' && (
          <>
            <h1 className="text-base font-semibold text-white mb-2">Opening billing portal</h1>
            <p className="text-sm text-zinc-400">One second...</p>
          </>
        )}

        {state === 'redirecting' && (
          <>
            <h1 className="text-base font-semibold text-white mb-2">Redirecting to Stripe</h1>
            <p className="text-sm text-zinc-400">If you aren't redirected, refresh the page.</p>
          </>
        )}

        {state === 'cli-return' && (
          <>
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-base font-semibold text-white mb-2">Plan changes saved</h1>
            <p className="text-sm text-zinc-400">
              You can close this window and return to your terminal.
            </p>
          </>
        )}

        {state === 'unavailable' && (
          <>
            <h1 className="text-base font-semibold text-white mb-2">Billing not yet enabled</h1>
            <p className="text-sm text-zinc-400 mb-4">
              Manage your plan at <a href="https://agentdrive.sh" className="text-emerald-500 hover:text-emerald-400">agentdrive.sh</a> once Stripe is configured.
            </p>
            <Link
              to="/"
              className="inline-block px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white rounded-md transition-colors"
            >
              Back to dashboard
            </Link>
          </>
        )}

        {state === 'auth-required' && (
          <>
            <h1 className="text-base font-semibold text-white mb-2">Sign in to manage billing</h1>
            <Link
              to="/login"
              className="inline-block mt-2 px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-medium rounded-md transition-colors"
            >
              Sign in
            </Link>
          </>
        )}

        {state === 'error' && (
          <>
            <h1 className="text-base font-semibold text-white mb-2">Couldn't open billing portal</h1>
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white rounded-md transition-colors"
            >
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}
