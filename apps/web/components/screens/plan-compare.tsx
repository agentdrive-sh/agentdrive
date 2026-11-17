import type { ReactNode } from 'react';
import { PLAN_CATALOG, type CatalogPlan, type CatalogPlanId } from '@agentdrive/shared';

interface Props {
  current: CatalogPlanId;
  action?: (plan: CatalogPlan) => ReactNode;
}

export function PlanCompare({ current, action }: Props) {
  return (
    <div className="col gap-3">
      {PLAN_CATALOG.map((t) => {
        const active = t.id === current;
        return (
          <div
            key={t.id}
            className="row gap-3"
            style={{
              padding: 12,
              borderRadius: 'var(--r-md)',
              background: active ? 'var(--accent-soft)' : 'var(--bg-2)',
              border:
                '1px solid ' +
                (active ? 'transparent' : 'var(--border)'),
            }}
          >
            <div className="col grow" style={{ lineHeight: 1.25 }}>
              <span className="t-sm wt-600 fg-0">{t.name}</span>
              <span className="t-xs muted">{t.features.slice(0, 3).join(' · ')}</span>
            </div>
            <div className="col gap-1" style={{ alignItems: 'flex-end' }}>
              <span className="mono t-sm fg-0">{t.price}</span>
              {!active && action?.(t)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
