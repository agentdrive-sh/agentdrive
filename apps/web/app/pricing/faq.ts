import { PLAN_CATALOG, PLAN_QUOTAS } from '@agentdrive/shared';
import type { FaqItem } from '@/components/marketing/faq';
import { list, lower } from '../facts/facts';

const plan = (id: string) => PLAN_CATALOG.find((p) => p.id === id)!;
const free = plan('free');
const team = plan('team');
const unlimited = PLAN_CATALOG.filter((p) => p.features.includes('Unlimited cross-agent resumes')).map((p) => p.name);

export const PRICING_FAQ: FaqItem[] = [
  {
    q: 'Is Free a trial?',
    a: [
      `No: Free costs ${free.price} ${free.cadence}, has no expiry and needs no card, and it includes ${list(free.features.map(lower))}.`,
      'Upgrade when you run agents every day or hand work across a team: pick a plan on this page or run `adrive upgrade`.',
    ],
  },
  {
    q: 'What counts as a cross-agent resume?',
    a: [
      'A cross-agent resume is one session from your cloud workspace opened in a different agent during a calendar month (UTC): re-opening that session in the agent that already resumed it that month does not count again, another agent opening it does, and local-mode resumes never count.',
      `Free includes ${PLAN_QUOTAS.trial.max_resumes_month} a month, with warnings as you approach the limit. ${list(unlimited)} are unlimited. Check usage with \`adrive plan\`.`,
    ],
  },
  {
    q: 'Are plan limits enforced?',
    a: [
      `Yes for seats, workspaces and agents, which are checked when you add one; storage is a soft limit, so warnings start at 80% and syncing never pauses, and the Free plan's ${PLAN_QUOTAS.trial.max_resumes_month} cross-agent resumes a month come with warnings as you approach the limit.`,
      'Check usage with `adrive plan` and upgrade with `adrive upgrade`.',
    ],
  },
  {
    q: 'What is a principal?',
    a: [
      "A principal is one human or team identity, whoever holds the API key, and you can run as many agents under it as your plan's agent limit allows, with each agent recording its platform and role on every write so provenance shows which agent did what.",
    ],
  },
  {
    q: 'How is Team billed?',
    a: [
      `Team costs ${team.price} ${team.cadence}, for ${lower(team.features[0])}, and the number of seats you buy at checkout is your organization's seat cap, so adding a member past it needs more seats from the billing portal.`,
      `Team adds ${list(team.features.slice(-3).map(lower))}.`,
    ],
  },
  {
    q: 'Can I use my own bucket?',
    a: [
      'Yes, on Team and Enterprise: a workspace can keep its file content in your own Cloudflare R2 bucket or any S3-compatible store, such as AWS S3, Backblaze, Wasabi or MinIO, while metadata and the search index stay managed by AgentDrive, so it is not whole-service data residency.',
      'GCS and Azure buckets are coming next. See https://agentdrive.sh/docs/data-residency for the storage boundary.',
    ],
  },
  {
    q: 'Do you train on my data?',
    a: [
      'No: Roushan Inc does not train any model on your data; standard workspace content is embedded only so semantic search works, and Private Workspace encrypts content on your machine before upload, so its plaintext never reaches the server and is not available to server-side search.',
      'See the privacy policy at https://agentdrive.sh/legal/privacy.',
    ],
  },
  {
    q: 'How do I cancel?',
    a: [
      'Cancel in the Stripe billing portal, which you open from the billing page in the AgentDrive app or by running `adrive billing` in a terminal; the same portal is where you change your plan, your seat count or how your organization pays.',
    ],
  },
];
