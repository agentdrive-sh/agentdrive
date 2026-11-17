'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PAID_PLANS, TEAM_SEATS, type PaidPlan } from '@agentdrive/shared';
import { AuthCard } from '@/components/auth/auth-card';
import { ApiClient, ApiError } from '@/lib/api-client';
import { getClientSession } from '@/lib/session';

const STARTING = (
  <AuthCard
    title="Starting checkout"
    body={<p className="muted t-sm">One second...</p>}
  />
);

export default function BillingUpgradePage() {
  return (
    <Suspense fallback={STARTING}>
      <BillingUpgradeInner />
    </Suspense>
  );
}

function BillingUpgradeInner() {
  const params = useSearchParams();
  const raw = params.get('plan');
  const plan = PAID_PLANS.find((p) => p === raw) as PaidPlan | undefined;
  const seats = plan === 'team' ? Number(params.get('seats') ?? TEAM_SEATS.min) : undefined;
  const [error, setError] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (!plan || ran.current) return;
    ran.current = true;
    const session = getClientSession();
    if (!session?.api_key) {
      const next = `/billing/upgrade?plan=${plan}${seats === undefined ? '' : `&seats=${seats}`}`;
      window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    ApiClient.fromSession(session)
      .billingCheckout(plan, seats)
      .then(({ checkout_url }) => window.location.assign(checkout_url))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 503) {
          setError('Billing is not available right now. Please try again later.');
        } else if (err instanceof ApiError && err.status === 502) {
          setError(`Stripe could not start checkout: ${err.message}`);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to start checkout');
        }
      });
  }, [plan, seats]);

  if (!plan) {
    return (
      <AuthCard
        title="Unknown plan"
        body={
          <Link className="btn primary" href="/pricing">
            See plans
          </Link>
        }
      />
    );
  }
  if (error) {
    return (
      <AuthCard
        title="Couldn't start checkout"
        body={
          <>
            <p className="t-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
            <Link className="btn" href="/billing">
              Go to billing
            </Link>
          </>
        }
      />
    );
  }
  return STARTING;
}
