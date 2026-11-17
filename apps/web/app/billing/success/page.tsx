'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PLAN_CATALOG, catalogIdForPlan } from '@agentdrive/shared';
import { AuthCard } from '@/components/auth/auth-card';
import { ApiClient } from '@/lib/api-client';
import { getClientSession } from '@/lib/session';

const POLL_MS = 1500;
const POLL_FOR_MS = 10_000;

export default function BillingSuccessPage() {
  const [planName, setPlanName] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const session = getClientSession();
    if (!session?.api_key) {
      setGaveUp(true);
      return;
    }
    const client = ApiClient.fromSession(session);
    const deadline = Date.now() + POLL_FOR_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    // The webhook usually lands within a second or two of Stripe's redirect.
    const poll = async () => {
      const plan = await client.billingPlan().catch(() => null);
      if (cancelled) return;
      if (plan && plan.plan !== 'trial' && plan.plan !== 'starter') {
        const id = catalogIdForPlan(plan.plan);
        setPlanName(PLAN_CATALOG.find((p) => p.id === id)?.name ?? plan.plan);
      } else if (Date.now() >= deadline) {
        setGaveUp(true);
      } else {
        timer = setTimeout(poll, POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const billingLink = (
    <Link className="btn primary" href="/billing">
      Go to billing
    </Link>
  );

  if (planName) {
    return <AuthCard title={`You're on ${planName}`} body={billingLink} />;
  }
  if (gaveUp) {
    return (
      <AuthCard
        title="Payment received"
        body={
          <>
            <p className="muted t-sm">Your plan updates within a minute.</p>
            {billingLink}
          </>
        }
      />
    );
  }
  return (
    <AuthCard
      title="Confirming your plan"
      body={<p className="muted t-sm">One second...</p>}
    />
  );
}
