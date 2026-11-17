'use client';

import { Suspense, useEffect, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { AuthOptions } from '@/components/auth/auth-options';
import { authInputCSS } from '@/components/auth/email-magic-link';
import {
  clearClientSession,
  getClientSession,
  setClientSession,
} from '@/lib/session';
import { ApiClient, ApiError } from '@/lib/api-client';

type Status = 'idle' | 'completing' | 'done' | 'error' | 'refused' | 'cancelled';

class CliRefusedError extends Error {
  constructor(message: string, readonly upgradeUrl: string) {
    super(message);
  }
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'https://app.agentdrive.sh';

export default function CliAuthPage() {
  return (
    <Suspense
      fallback={
        <AuthCard
          title="Sign in to AgentDrive CLI"
          body={<p className="muted t-sm">Loading...</p>}
        />
      }
    >
      <CliAuthInner />
    </Suspense>
  );
}

// The account a CLI login would act as. Its email and org come from the worker, not the cookie.
interface Account {
  token: string;
  email: string;
  org?: string;
}

function CliAuthInner() {
  const params = useSearchParams();
  const authId = params.get('id');
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [upgradeUrl, setUpgradeUrl] = useState('');
  const [code, setCode] = useState('');
  const codeId = useId();

  function fail(err: unknown) {
    if (err instanceof CliRefusedError) {
      setError(err.message);
      setUpgradeUrl(err.upgradeUrl);
      setStatus('refused');
      return;
    }
    // The session ended after the page loaded: sign in again, and the id in the URL carries on.
    if (err instanceof ApiError && err.status === 401) {
      clearClientSession();
      setAccount(null);
      setError('Your session ended. Sign in again to finish linking the CLI.');
      setStatus('idle');
      return;
    }
    setError(err instanceof ApiError ? err.message : 'Failed to complete CLI sign-in');
    // An expired or cancelled login cannot be finished from this page; a wrong code can be retyped.
    setStatus(err instanceof ApiError && (err.status === 403 || err.status === 404) ? 'error' : 'idle');
  }

  function loadAccount(token: string) {
    new ApiClient({ apiKey: token })
      .whoami()
      .then((me) => {
        const { email, org } = me as { email?: string; org?: { name?: string } | null };
        setAccount(email ? { token, email, org: org?.name } : null);
      })
      .catch(() => setAccount(null));
  }

  useEffect(() => {
    const session = getClientSession();
    if (session?.api_key) loadAccount(session.api_key);
    else setAccount(null);
  }, []);

  // Anyone can send a link here, so the login completes only with the code from the
  // terminal that started it, typed by the person signed in.
  function authorize(id: string, token: string) {
    setStatus('completing');
    setError('');
    completeCli(id, token, code)
      .then(() => setStatus('done'))
      .catch(fail);
  }

  if (!authId) {
    return (
      <AuthCard
        title="CLI sign-in"
        body={
          <p className="muted t-sm">
            Missing <code className="mono">id</code> parameter. Run{' '}
            <code className="mono fg-0">adrive auth login</code> in your terminal to start the flow.
          </p>
        }
      />
    );
  }

  if (status === 'done') {
    return (
      <AuthCard
        title="Logged in"
        body={
          <>
            {account && (
              <p className="muted t-sm">
                Signed in as <span className="fg-0">{account.email}</span>.
              </p>
            )}
            <p className="muted t-sm">
              You can close this window and return to your terminal.
            </p>
          </>
        }
      />
    );
  }

  if (status === 'refused') {
    return (
      <AuthCard
        title="No agent slot left"
        body={
          <>
            <p className="t-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
            <p className="muted t-xs">
              Upgrade, or revoke a key you no longer use to free its slot, then
              run <code className="mono">adrive auth login</code> again.
            </p>
            <a className="btn primary" href={upgradeUrl}>
              Upgrade
            </a>
            <a className="btn" href="/keys">
              Manage keys
            </a>
          </>
        }
      />
    );
  }

  if (status === 'error') {
    return (
      <AuthCard
        title="Something went wrong"
        body={
          <>
            <p className="t-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
            <p className="muted t-xs">
              Run <code className="mono">adrive auth login</code> in your
              terminal to get a fresh link and code.
            </p>
          </>
        }
      />
    );
  }

  if (status === 'completing') {
    return (
      <AuthCard
        title="Linking your CLI"
        body={<p className="muted t-sm">One second...</p>}
      />
    );
  }

  if (status === 'cancelled') {
    return (
      <AuthCard
        title="CLI sign-in cancelled"
        body={
          <p className="muted t-sm">
            Nothing was authorized. You can close this page.
          </p>
        }
      />
    );
  }

  if (account === undefined) {
    return (
      <AuthCard
        title="Sign in to AgentDrive CLI"
        body={<p className="muted t-sm">Loading...</p>}
      />
    );
  }

  if (account) {
    return (
      <AuthCard
        title="Authorize the AgentDrive CLI"
        body={
          <form
            className="col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              authorize(authId, account.token);
            }}
          >
            <p className="muted t-sm">
              The CLI gets an API key for{' '}
              <span className="fg-0">{account.email}</span> in{' '}
              <span className="fg-0">
                {account.org ?? 'your AgentDrive organization'}
              </span>
              .
            </p>
            <div className="col gap-1">
              <label
                htmlFor={codeId}
                className="t-xs muted wt-600"
                style={{ letterSpacing: '0.04em' }}
              >
                Code shown in your terminal
              </label>
              <input
                id={codeId}
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                maxLength={12}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="auth-input mono"
                style={{ textAlign: 'center', letterSpacing: '0.2em', fontSize: 20 }}
                autoFocus
              />
            </div>
            <p className="t-sm" style={{ color: 'var(--warning)' }}>
              Only enter a code from a terminal on your own computer where you
              just ran <code className="mono">adrive auth login</code> or{' '}
              <code className="mono">adrive init</code>. AgentDrive never asks
              you to enter a code someone sent you.
            </p>
            {error && (
              <p role="alert" className="t-sm" style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            )}
            <button
              type="submit"
              className="btn primary"
              disabled={!code.trim()}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Authorize
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setStatus('cancelled')}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Cancel
            </button>
            <p className="muted t-xs">
              No code in your terminal? Your AgentDrive CLI or plugin is out of
              date: run <code className="mono">npm i -g @adrive/cli@latest</code>{' '}
              or update the plugin, then sign in again.
            </p>
            <style>{authInputCSS}</style>
          </form>
        }
      />
    );
  }

  return (
    <AuthCard
      title="Sign in to AgentDrive CLI"
      subtitle={error || 'Sign in, then enter the code shown in your terminal.'}
      body={
        <AuthOptions
          cliAuthId={authId}
          onEmailVerified={({ session_id, email, org_id }) => {
            setClientSession({ api_key: session_id, email, org_id });
            setError('');
            loadAccount(session_id);
          }}
        />
      }
    />
  );
}

async function completeCli(authId: string, sessionToken: string, userCode: string) {
  const res = await fetch(`${API_BASE}/v1/auth/cli/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': sessionToken,
    },
    body: JSON.stringify({ id: authId, user_code: userCode }),
  });
  if (res.status === 402) {
    const j = (await res.json()) as { error: string; upgrade_url: string };
    throw new CliRefusedError(j.error, j.upgrade_url);
  }
  if (!res.ok) {
    let msg = `CLI complete failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // ignore
    }
    throw new ApiError(msg, res.status);
  }
}
