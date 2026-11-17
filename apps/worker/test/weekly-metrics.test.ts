import { describe, it, expect } from 'vitest';
import { PAID_PLANS as SHARED_PAID_PLANS } from '@agentdrive/shared';
import { isoWeek as workerIsoWeek } from '../src/services/storage';
import { isoWeek, lastIsoWeeks, weeklyMetrics, formatMetrics, PAID_PLANS } from '../scripts/weekly-metrics';

describe('weekly-metrics', () => {
  it('mirrors the worker isoWeek and the shared paid plans', () => {
    for (const at of ['2026-01-01', '2026-12-31', '2027-01-03', '2027-01-04', '2020-12-31', '2021-01-03', '2026-11-09']) {
      expect(isoWeek(new Date(at))).toBe(workerIsoWeek(new Date(at)));
    }
    expect(isoWeek(new Date('2026-11-09T12:00:00Z'))).toBe('2026-W46');
    expect(isoWeek(new Date('2021-01-03'))).toBe('2020-W53');
    expect(PAID_PLANS).toEqual([...SHARED_PAID_PLANS]);
  });

  it('lists the last weeks oldest first, ending with the current one', () => {
    expect(lastIsoWeeks(new Date('2026-01-05T00:00:00Z'), 3)).toEqual(['2025-W52', '2026-W01', '2026-W02']);
  });

  it('aggregates signups, activations, resumers and paid orgs per week', () => {
    const weeks = ['2026-W45', '2026-W46'];
    const m = weeklyMetrics({
      orgs: [
        { id: 'o1', created_at: '2026-11-03T10:00:00Z', plan: 'team' },
        { id: 'o2', created_at: '2026-11-09T10:00:00Z', plan: 'trial' },
        { id: 'o3', created_at: '2026-11-10T10:00:00Z', plan: 'pro' },
        { id: 'o4', created_at: '2025-01-01T10:00:00Z', plan: 'pro' },
      ],
      activations: [
        { org_id: 'o1', at: '2026-11-04T10:00:00Z' },
        { org_id: 'o2', at: '2026-11-09T11:00:00Z' },
        { org_id: 'o4', at: '2025-02-01T10:00:00Z' },
      ],
      resumes: [
        { week: '2026-W45', org_id: 'o1', principal: 'a1' },
        { week: '2026-W46', org_id: 'o1', principal: 'a1' },
        { week: '2026-W46', org_id: 'o1', principal: 'a2' },
        { week: '2026-W46', org_id: 'o2', principal: 'a3' },
      ],
    }, weeks);

    expect(m.weeks).toEqual([
      { week: '2026-W45', new_orgs: 1, new_activations: 1, resumers: 1, resumer_orgs: 1 },
      { week: '2026-W46', new_orgs: 2, new_activations: 1, resumers: 3, resumer_orgs: 2 },
    ]);
    expect(m.paid_by_plan).toEqual({ pro: 2, team: 1 });
    expect(m.activated_orgs).toBe(3);
    expect(m.activated_paid).toBe(2);
    expect(formatMetrics(m)).toContain('activated orgs: 3, of which paid: 2');
  });
});
