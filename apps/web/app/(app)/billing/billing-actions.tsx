'use client';

import { useMemo, useState } from 'react';
import { PLAN_CATALOG, type PaidPlan } from '@agentdrive/shared';
import { ApiClient } from '../../../lib/api-client';
import { getClientSession } from '../../../lib/session';

// With a plan: start Checkout for it. Without: open the Stripe portal, where
// existing subscribers manage or switch plans.
export function BillingActions({ plan }: { plan?: PaidPlan }) {
  const client = useMemo(() => ApiClient.fromSession(getClientSession()), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = plan
        ? (await client.billingCheckout(plan)).checkout_url
        : (await client.billingPortal()).url;
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const label = plan
    ? `Upgrade to ${PLAN_CATALOG.find((p) => p.id === plan)?.name ?? plan}`
    : 'Manage in Stripe';

  return (
    <div className="col gap-1" style={{ alignItems: 'flex-end' }}>
      <button
        type="button"
        className={plan ? 'btn primary sm' : 'btn'}
        onClick={go}
        disabled={busy}
      >
        {busy ? 'Opening…' : label}
      </button>
      {error && (
        <span className="t-xs" style={{ color: 'var(--danger, #f87171)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
