import kleur from 'kleur';
import { CliApiClient, type TimelineEvent } from '../lib/api-client.js';
import { requireLogin } from '../lib/config.js';

export interface TimelineOptions {
  since?: string;
  today?: boolean;
  limit?: string;
}

// Platform tints inspired by D4 (variant 2A "tinted pill with letter glyph").
// Falls through to no-color on unknown / undefined platforms.
const PLATFORM_GLYPH: Record<string, { glyph: string; tint: (s: string) => string }> = {
  'claude-code': { glyph: 'CC', tint: (s) => kleur.magenta().bold(s) },
  codex: { glyph: 'CX', tint: (s) => kleur.cyan().bold(s) },
  cursor: { glyph: 'CR', tint: (s) => kleur.blue().bold(s) },
  langgraph: { glyph: 'LG', tint: (s) => kleur.yellow().bold(s) },
  crewai: { glyph: 'CA', tint: (s) => kleur.green().bold(s) },
  autogen: { glyph: 'AG', tint: (s) => kleur.green().bold(s) },
  hermes: { glyph: 'HM', tint: (s) => kleur.red().bold(s) },
  openclaw: { glyph: 'OC', tint: (s) => kleur.red().bold(s) },
};

function badge(platform: string | undefined): string {
  const key = platform ?? 'unknown';
  const entry = PLATFORM_GLYPH[key];
  if (!entry) return kleur.dim('— ');
  return entry.tint(entry.glyph);
}

function actorLabel(ev: TimelineEvent): string {
  if (ev.actor_type === 'human') return ev.actor_id;
  return ev.actor_id.length > 14 ? `${ev.actor_id.slice(0, 14)}…` : ev.actor_id;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}Z`;
}

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function cmdTimeline(opts: TimelineOptions = {}): Promise<void> {
  const cfg = await requireLogin();
  const client = new CliApiClient({
    baseUrl: cfg.api_url,
    apiKey: cfg.api_key,
    agentPlatform: cfg.agent_platform ?? 'cli',
    agentRole: cfg.agent_role,
  });

  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : undefined;
  const since = opts.today ? startOfTodayIso() : opts.since;
  const { items, truncated } = await client.timeline({ since, limit });

  if (items.length === 0) {
    process.stdout.write('No events in window.\n');
    return;
  }

  for (const ev of items) {
    const action = kleur.cyan(ev.action.padEnd(16));
    const target = ev.target_path ?? ev.target_id;
    process.stdout.write(
      `${kleur.dim(formatTimestamp(ev.created_at))}  ${badge(ev.agent_platform)}  ` +
        `${action} ${kleur.dim(actorLabel(ev))} ${kleur.dim('→')} ${target}\n`,
    );
  }

  if (truncated) {
    process.stdout.write(
      kleur.dim(`\n${items.length} shown; capped by --limit. Re-run with a tighter --since to page back.\n`),
    );
  }
}
