import { ALL_PLANS_INCLUDE, COMING_NEXT, PLAN_CATALOG } from '@agentdrive/shared';
import { SITE_URL as SITE } from '@/components/seo/site';
import { frontmatter, LLMS_DIRECTIVE, markdownResponse } from '@/lib/llms';

export const dynamic = 'force-static';

export function GET() {
  const plans = PLAN_CATALOG.map((p) =>
    [`## ${p.name}: ${p.price} ${p.cadence}`, '', p.blurb, '', ...p.features.map((f) => `- ${f}`)].join('\n'),
  );
  return markdownResponse(
    [
      frontmatter({
        title: 'AgentDrive pricing',
        description: 'Plans, prices and limits for AgentDrive. Prices are in USD.',
        canonical: `${SITE}/pricing`,
      }),
      '# AgentDrive pricing',
      '',
      LLMS_DIRECTIVE,
      '',
      'Prices are in USD. Free needs no card and does not expire. Upgrade from the dashboard or with `adrive upgrade`.',
      '',
      ...plans.flatMap((p) => [p, '']),
      '## Every plan includes',
      '',
      ...ALL_PLANS_INCLUDE.map((f) => `- ${f}`),
      '',
      '## Coming next',
      '',
      ...COMING_NEXT.map((f) => `- ${f}`),
      '',
      `Compare plans in full at [${SITE}/pricing](${SITE}/pricing).`,
      '',
    ].join('\n'),
  );
}
