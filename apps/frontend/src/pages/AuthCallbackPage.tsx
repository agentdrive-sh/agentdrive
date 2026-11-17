import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToken } from '../contexts/TokenContext';
import { useApiClient } from '../hooks/useApiClient';

type Phase = 'processing' | 'cli-complete' | 'cli-done' | 'cli-error' | 'no-session';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setSession } = useToken();
  const { publicFetch } = useApiClient();
  const [phase, setPhase] = useState<Phase>('processing');
  const [error, setError] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const sessionId = params.get('session');
    const email = params.get('email') || '';
    const orgId = params.get('org_id') || undefined;
    const cliAuthId = params.get('cli_auth_id');

    if (!sessionId) {
      setPhase('no-session');
      return;
    }

    setSession(sessionId, email, orgId);

    if (cliAuthId) {
      setPhase('cli-complete');
      publicFetch('/auth/cli/complete', {
        method: 'POST',
        headers: { 'X-Session-Token': sessionId },
        body: JSON.stringify({ auth_id: cliAuthId }),
      })
        .then(() => setPhase('cli-done'))
        .catch((err: unknown) => {
          setError((err as Error).message || 'Failed to complete CLI auth');
          setPhase('cli-error');
        });
      return;
    }

    navigate('/', { replace: true });
  }, [params, setSession, navigate, publicFetch]);

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center animate-in">
        {phase === 'processing' && (
          <>
            <h1 className="text-base font-semibold text-white mb-2">Signing you in</h1>
            <p className="text-sm text-zinc-400">One second...</p>
          </>
        )}

        {phase === 'cli-complete' && (
          <>
            <h1 className="text-base font-semibold text-white mb-2">Linking your CLI</h1>
            <p className="text-sm text-zinc-400">Almost done...</p>
          </>
        )}

        {phase === 'cli-done' && (
          <>
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-base font-semibold text-white mb-2">CLI signed in</h1>
            <p className="text-sm text-zinc-400">
              You can close this window and return to your terminal.
            </p>
          </>
        )}

        {phase === 'cli-error' && (
          <>
            <h1 className="text-base font-semibold text-white mb-2">CLI link failed</h1>
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <p className="text-xs text-zinc-500">
              Run <code className="text-zinc-300">adrive login</code> in your terminal to retry.
            </p>
          </>
        )}

        {phase === 'no-session' && (
          <>
            <h1 className="text-base font-semibold text-white mb-2">Sign-in didn't complete</h1>
            <p className="text-sm text-zinc-400 mb-3">
              No session token in the callback URL.
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white rounded-md transition-colors"
            >
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
