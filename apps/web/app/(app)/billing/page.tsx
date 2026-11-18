import Link from 'next/link';
import { serverApiClient } from '../../../lib/server-api';
import { ApiError, type BillingPlan } from '../../../lib/api-client';
import { requireServerSession } from '../../../lib/server-session';
import { Icon } from '../../../components/icon';
import { PageHead } from '../../../components/shared';
import { UsageBars } from '../../../components/screens/usage-bars';
import type { Quota } from '../../../components/screens/usage-bars';
import { PlanCompare } from '../../../components/screens/plan-compare';
import { InvoiceRow } from '../../../components/screens/invoice-row';
import { BillingActions } from './billing-actions';
import { PLAN_CATALOG, catalogIdForPlan } from '@agentdrive/shared';

function quotaFor(
  plan: BillingPlan | null,
  usageKey: string,
  quotaKey: string,
): Quota | undefined {
  const total = plan?.quota?.[quotaKey];
  if (total === undefined) return undefined;
  return { used: plan?.usage?.[usageKey], total };
}

function gb(bytes: number): string {
  return `${Number((bytes / 1024 ** 3).toFixed(2))} GB`;
}

export default async function BillingPage() {
  const session = await requireServerSession();
  const client = serverApiClient(session);

  const [plan, invoiceResult] = await Promise.all([
    client.billingPlan(),
    client.billingInvoices().then(
      (invoices) => ({ state: 'ready' as const, invoices }),
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) throw error;
        if (error instanceof ApiError && error.status === 403) return { state: 'restricted' as const };
        return { state: 'unavailable' as const };
      },
    ),
  ]);
  const managesBilling = invoiceResult.state !== 'restricted';
  const currentId = catalogIdForPlan(plan?.plan ?? 'trial');
  const current = PLAN_CATALOG.find((p) => p.id === currentId) ?? PLAN_CATALOG[0];
  const subscribed = currentId === 'pro' || currentId === 'team';
  const seats = plan?.quota?.max_human_seats ?? 1;
  const seatLabel = `${seats} seat${seats === 1 ? '' : 's'}`;

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead
        sub="Flat monthly plans, Team billed per seat. No per-tool-call billing, no token surprises."
      />

      <div
        className="grid"
        style={{
          gridTemplateColumns: '1.4fr 1fr',
          gap: 20,
          marginBottom: 20,
        }}
      >
        <div
          className="surface"
          style={{ padding: 24, position: 'relative', overflow: 'hidden' }}
        >
          <div
            className="row"
            style={{
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <span className="pill accent" style={{ marginBottom: 12 }}>
                Current plan
              </span>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 600,
                  color: 'var(--text-0)',
                  letterSpacing: '-0.025em',
                  lineHeight: 1.1,
                  marginTop: 12,
                }}
              >
                {current.name}{' '}
                <span
                  style={{
                    color: 'var(--text-3)',
                    fontWeight: 400,
                    fontSize: 22,
                  }}
                >
                  · {current.price} {current.cadence}
                </span>
              </div>
              <div className="muted t-sm" style={{ marginTop: 6 }}>
                {seatLabel}
              </div>
            </div>
            {managesBilling && plan?.stripe_customer_id && <BillingActions />}
          </div>

          <div style={{ marginTop: 24 }}>
            <UsageBars
              bars={[
                { label: 'Storage', q: quotaFor(plan, 'storage_bytes', 'storage_bytes'), format: gb },
                { label: 'Embeddings', q: quotaFor(plan, 'embedding_count', 'embedding_count') },
                { label: 'Cross-agent resumes this month', q: quotaFor(plan, 'resume_count', 'max_resumes_month') },
                { label: 'Agents', q: quotaFor(plan, 'agent_count', 'max_agents') },
                { label: 'Workspaces', q: quotaFor(plan, 'workspace_count', 'max_workspaces') },
                { label: 'Members', q: quotaFor(plan, 'member_count', 'max_human_seats') },
              ]}
            />
          </div>

          <div
            className="t-xs muted"
            style={{
              marginTop: 18,
              padding: 12,
              background: 'var(--bg-2)',
              borderRadius: 'var(--r-md)',
              lineHeight: 1.55,
            }}
          >
            Egress is{' '}
            <span className="fg-0 wt-600">always $0</span>.
          </div>
        </div>

        <div className="surface" style={{ padding: 22 }}>
          <div
            className="t-xs muted wt-600"
            style={{
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            Plans
          </div>
          <PlanCompare
            current={currentId}
            action={(p) =>
              p.id === 'enterprise' ? (
                <a className="btn ghost sm" href="mailto:hello@agentdrive.sh">
                  Contact us
                </a>
              ) : (p.id === 'pro' || p.id === 'team') && !subscribed && managesBilling ? (
                <BillingActions plan={p.id} />
              ) : null
            }
          />
        </div>
      </div>

      <div className="surface table-scroll">
        <div
          className="row"
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            justifyContent: 'space-between',
          }}
        >
          <div className="t-md wt-600 fg-0">Invoices</div>
          {managesBilling && plan.stripe_customer_id && <Link href="/billing/portal" className="btn ghost sm">
            View all <Icon name="arrow-right" size={11} />
          </Link>}
        </div>
        <div
          className="row-item"
          style={{
            gridTemplateColumns: '120px 1fr 100px 90px 90px',
            gap: 14,
            padding: '8px 18px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-3)',
            fontWeight: 600,
          }}
        >
          <span>Invoice</span>
          <span>Date</span>
          <span>Total</span>
          <span>Status</span>
          <span />
        </div>
        {invoiceResult.state === 'unavailable' ? (
          <p className="empty" role="status">Invoice history is temporarily unavailable. Refresh this page to try again.</p>
        ) : invoiceResult.state === 'restricted' ? (
          <p className="empty">Organization owners and admins can view invoices.</p>
        ) : invoiceResult.invoices.length === 0 ? (
          <div className="empty">
            <Icon name="card" size={24} />
            <h3>No invoices yet</h3>
            <p>
              Invoices appear here once you start a paid plan. Stripe always
              keeps the source of truth — open the customer portal for the
              full history.
            </p>
          </div>
        ) : (
          invoiceResult.invoices.map((inv) => <InvoiceRow key={inv.id} inv={inv} />)
        )}
      </div>
    </div>
  );
}
