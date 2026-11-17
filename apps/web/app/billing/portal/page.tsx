'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { ApiClient, ApiError } from '@/lib/api-client';
import { getClientSession } from '@/lib/session';

type State =
  | 'loading'
  | 'redirecting'
  | 'cli-return'
  | 'unavailable'
  | 'auth-required'
  | 'error';

export default function BillingPortalPage() {
  return (
    <Suspense
      fallback={
        <AuthCard
          title="Opening billing portal"
          body={<p className="muted t-sm">One second...</p>}
        />
      }
    >
      <BillingPortalInner />
    </Suspense>
  );
}

function BillingPortalInner() {
  const params = useSearchParams();
  const cliMode = params.get('cli') === '1';
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const session = getClientSession();
    if (!session?.api_key) {
      setState('auth-required');
      return;
    }
    if (cliMode) {
      setState('cli-return');
      return;
    }
    let cancelled = false;
    setState('loading');
    const client = ApiClient.fromSession(session);
    client
      .billingPortal()
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
        if (err instanceof ApiError) {
          if (err.status === 503 || /stripe|not configured/i.test(err.message)) {
            setState('unavailable');
            return;
          }
          setError(err.message);
        } else {
          setError(
            err instanceof Error ? err.message : 'Failed to open billing portal',
          );
        }
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [cliMode]);

  if (state === 'loading') {
    return (
      <AuthCard
        title="Opening billing portal"
        body={<p className="muted t-sm">One second...</p>}
      />
    );
  }
  if (state === 'redirecting') {
    return (
      <AuthCard
        title="Redirecting to Stripe"
        body={
          <p className="muted t-sm">
            If you aren&apos;t redirected, refresh the page.
          </p>
        }
      />
    );
  }
  if (state === 'cli-return') {
    return (
      <AuthCard
        title="Plan changes saved"
        body={
          <p className="muted t-sm">
            You can close this window and return to your terminal.
          </p>
        }
      />
    );
  }
  if (state === 'unavailable') {
    return (
      <AuthCard
        title="Billing not yet enabled"
        body={
          <>
            <p className="muted t-sm">
              Configure Stripe to enable the billing portal. Set{' '}
              <code className="mono">STRIPE_SECRET_KEY</code> and{' '}
              <code className="mono">STRIPE_WEBHOOK_SECRET</code> on the worker,
              then redeploy.
            </p>
            <Link className="btn" href="/dashboard">
              Back to dashboard
            </Link>
          </>
        }
      />
    );
  }
  if (state === 'auth-required') {
    return (
      <AuthCard
        title="Sign in to manage billing"
        body={
          <Link className="btn primary" href="/login">
            Sign in
          </Link>
        }
      />
    );
  }
  return (
    <AuthCard
      title="Couldn't open billing portal"
      body={
        <>
          <p className="t-sm" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </>
      }
    />
  );
}
