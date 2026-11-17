import type { CatalogPlan, CatalogPlanId } from '@agentdrive/shared';
import { Icon } from '@/components/icon';

const CTA: Record<CatalogPlanId, { label: string; href: string }> = {
  free: { label: 'Install free', href: '/docs/quick-start' },
  pro: { label: 'Choose Pro', href: '/billing/upgrade?plan=pro' },
  team: { label: 'Choose Team', href: '/billing/upgrade?plan=team' },
  enterprise: { label: 'Contact us', href: 'mailto:hello@agentdrive.sh' },
};

export const ENTERPRISE_CTA = CTA.enterprise;

export function PlanCard({ plan }: { plan: CatalogPlan }) {
  const highlight = plan.id === 'pro';
  const cta = CTA[plan.id];
  return (
    <article className={highlight ? 'm-plan highlight' : 'm-plan'}>
      <div className="m-plan-head">
        <h3 className="m-h3">{plan.name}</h3>
        {highlight && <span className="m-plan-badge">Recommended</span>}
      </div>
      <div className="price">
        <strong>{plan.price}</strong>
        <span>{plan.cadence}</span>
      </div>
      <p className="m-body">{plan.blurb}</p>
      <ul className="m-list yes">
        {plan.features.map((f) => (
          <li key={f}>
            <Icon name="check" size={12} />
            {f}
          </li>
        ))}
      </ul>
      <a className={highlight ? 'btn lg primary' : 'btn lg secondary'} href={cta.href}>
        {cta.label}
      </a>
    </article>
  );
}

export function PlanGuide() {
  return (
    <div className="m-plan-guide">
      <p><strong>Understanding the limits.</strong> A principal is a human or team account identity. Agents are registered agent identities, not individual conversations.</p>
      <p><strong>Plan limits:</strong> workspace, seat and agent limits are enforced. Storage is a soft limit: warnings start at 80%, and new files and sessions keep syncing past it. Every plan keeps all session history. Local resumes on one machine are unlimited and need no account; Free includes 10 cloud resumes a month.</p>
      <p><strong>Private Workspace:</strong> encrypted content cannot be searched by meaning on the server. Resume decrypts locally on a machine with the key. <a className="m-link" href="/security#private-workspace">How encryption works</a></p>
    </div>
  );
}

export function EnterprisePlan() {
  return (
    <div className="m-enterprise">
      <p className="m-body"><strong className="fg-0">Enterprise.</strong> Custom limits, a security review and a DPA.</p>
      <a className="btn" href={ENTERPRISE_CTA.href}>{ENTERPRISE_CTA.label}</a>
    </div>
  );
}
