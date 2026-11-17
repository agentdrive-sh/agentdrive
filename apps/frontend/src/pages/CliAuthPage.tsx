import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToken } from '../contexts/TokenContext';
import { useApiClient } from '../hooks/useApiClient';
import LoginPage from './LoginPage';

type Status = 'idle' | 'completing' | 'done' | 'error';

export default function CliAuthPage() {
  const [params] = useSearchParams();
  const authId = params.get('id');
  const { isLoggedIn, sessionId, email, orgId } = useToken();
  const { publicFetch } = useApiClient();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  async function completeCliAuth(sid: string) {
    if (!authId) {
      setError('Missing CLI auth id. Restart the CLI flow with adrive login.');
      setStatus('error');
      return;
    }
    setStatus('completing');
    setError('');
    try {
      await publicFetch('/auth/cli/complete', {
        method: 'POST',
        headers: { 'X-Session-Token': sid },
        body: JSON.stringify({ auth_id: authId }),
      });
      setStatus('done');
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Failed to complete CLI auth';
      setError(msg);
      setStatus('error');
    }
  }

  useEffect(() => {
    if (isLoggedIn && sessionId && status === 'idle' && authId) {
      void completeCliAuth(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, sessionId, authId]);

  if (!authId) {
    return (
      <CenteredCard>
        <h1 className="text-base font-semibold text-white mb-2">CLI sign-in</h1>
        <p className="text-sm text-zinc-400">
          Missing <code className="text-zinc-300">id</code> parameter. Run{' '}
          <code className="text-zinc-300">adrive login</code> in your terminal to start the flow.
        </p>
      </CenteredCard>
    );
  }

  if (status === 'done') {
    return (
      <CenteredCard>
        <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
          <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-base font-semibold text-white mb-2">Logged in</h1>
        <p className="text-sm text-zinc-400 mb-1">
          Signed in as <span className="text-white">{email}</span>.
        </p>
        <p className="text-sm text-zinc-400">
          You can close this window and return to your terminal.
        </p>
      </CenteredCard>
    );
  }

  if (status === 'error') {
    return (
      <CenteredCard>
        <h1 className="text-base font-semibold text-white mb-2">Something went wrong</h1>
        <p className="text-sm text-red-400 mb-3">{error}</p>
        <p className="text-xs text-zinc-500">
          The auth id may have expired. Run <code className="text-zinc-300">adrive login</code>{' '}
          in your terminal again to get a fresh link.
        </p>
        <button
          onClick={() => {
            if (sessionId) void completeCliAuth(sessionId);
          }}
          className="mt-4 px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white rounded-md transition-colors"
        >
          Retry
        </button>
      </CenteredCard>
    );
  }

  if (status === 'completing') {
    return (
      <CenteredCard>
        <h1 className="text-base font-semibold text-white mb-2">Linking your CLI</h1>
        <p className="text-sm text-zinc-400">One second...</p>
      </CenteredCard>
    );
  }

  if (isLoggedIn) {
    return (
      <CenteredCard>
        <h1 className="text-base font-semibold text-white mb-2">Confirm CLI sign-in</h1>
        <p className="text-sm text-zinc-400 mb-4">
          Signed in as <span className="text-white">{email}</span>
          {orgId && <> in <span className="text-white">{orgId}</span></>}.
          Authorize this CLI session?
        </p>
        <button
          onClick={() => sessionId && void completeCliAuth(sessionId)}
          className="w-full px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-medium rounded-lg transition-colors"
        >
          Authorize CLI
        </button>
      </CenteredCard>
    );
  }

  return (
    <LoginPage
      heading="Sign in to AgentDrive CLI"
      subheading="Authorize this device once. Your CLI will get a token after you sign in."
      cliAuthId={authId}
      onEmailSession={(sid) => {
        void completeCliAuth(sid);
      }}
    />
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center animate-in">
        {children}
      </div>
    </div>
  );
}
