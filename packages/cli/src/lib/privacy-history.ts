import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

// Every interval (epoch ms) during which transcript or artifact sync was off.
// It lives apart from config.json so logout, which deletes the config, keeps it,
// and so CLI 1.4.0, which rewrites the config and the sync manifest, never sees it.
// Sync computes from it, at upload time, whether a session may leave the machine.

export interface OffInterval {
  at: number;
  until: number | null;
}

export interface PrivacyHistory {
  transcripts_off: OffInterval[];
  artifacts_off: OffInterval[];
}

const TOGGLES = [
  ['transcripts_off', 'capture_transcripts'],
  ['artifacts_off', 'capture_artifacts'],
] as const;

export type Toggles = Record<(typeof TOGGLES)[number][1], boolean>;

export function historyPath(dir: string): string {
  return join(dir, 'privacy-history.json');
}

export function historyTemp(dir: string): string {
  return `${historyPath(dir)}.${process.pid}.tmp`;
}

// Created beside the history once one exists, and never removed (except, with the history,
// when the config write that created both fails: see snapshotHistory). It is a separate file,
// not a config.json field, because 1.4.0 rewrites config.json without unknown fields
// and logout deletes it, and because hooks writing config.json could race adrive privacy.
function markerPath(dir: string): string {
  return join(dir, 'privacy-history.marker');
}

function isIntervals(value: unknown): value is OffInterval[] {
  return Array.isArray(value) && value.every((i) => typeof i?.at === 'number' && (i.until === null || typeof i.until === 'number'));
}

// Null when the file can't be read or parsed, or is missing although the marker says
// one was written: a lost history must not read as "never off". Any entry at the marker
// path counts as present (lstat, so a dangling link does too), and one that isn't a
// regular file counts as damage.
export async function readHistory(dir: string): Promise<PrivacyHistory | null> {
  const marker = await fs.lstat(markerPath(dir)).catch(() => null);
  if (marker && !marker.isFile()) return null;
  let raw: string;
  try {
    raw = await fs.readFile(historyPath(dir), 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' && !marker ? { transcripts_off: [], artifacts_off: [] } : null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PrivacyHistory>;
    return isIntervals(parsed.transcripts_off) && isIntervals(parsed.artifacts_off)
      ? { transcripts_off: parsed.transcripts_off, artifacts_off: parsed.artifacts_off }
      : null;
  } catch {
    return null;
  }
}

// Only a signed-in config with saved preferences states a choice. Local mode, and
// the key-only config sign-in writes before consent, carry none, so their defaults
// never read as "sync off", which would cancel the first sync after sign-in.
function choice(config: unknown): Toggles | undefined {
  const c = config as { api_key?: unknown; preferences?: Partial<Toggles> } | null;
  if (!c?.api_key || !c.preferences) return undefined;
  return { capture_transcripts: !!c.preferences.capture_transcripts, capture_artifacts: !!c.preferences.capture_artifacts };
}

async function savedConfig(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// Brings the history in line with the toggles. With `next`, the config about to
// be written replaces the saved one, so a known on->off change opens its interval
// now; `before` overrides what the saved config says the toggles were (adrive
// privacy knows the effective ones even when none were saved). Without `next`,
// the saved config is checked as is: an off toggle with no open interval (an
// upgrade from 1.4.0, a hand edit) opens one from the last known change, or from
// 0, and an on toggle closes its open one now. `held` throws if the config lock was lost,
// and is called right before the history is replaced.
export async function recordToggles(
  configFile: string,
  next?: unknown,
  before?: Toggles,
  now = Date.now(),
  held?: () => void,
): Promise<PrivacyHistory | null> {
  const dir = dirname(configFile);
  const saved = await savedConfig(configFile);
  const after = choice(next ?? saved);
  const was = next ? (before ?? choice(saved)) : undefined;
  const history = await readHistory(dir);
  if (!history) return history;
  // Re-created whenever a history exists, so nothing that removes it outlasts the history.
  if (await fs.access(historyPath(dir)).then(() => true, () => false)) await mark(dir);
  if (!after) return history;
  let changed = false;
  for (const [key, pref] of TOGGLES) {
    const list = history[key];
    const last = list[list.length - 1];
    const open = last?.until === null;
    if (after[pref]) {
      if (open) last!.until = Math.max(now, last!.at);
      else if (was && !was[pref]) list.push({ at: last?.until ?? 0, until: now });
      else continue;
    } else if (!open) {
      list.push({ at: was?.[pref] ? now : (last?.until ?? 0), until: null });
    } else continue;
    changed = true;
  }
  if (changed) {
    await save(dir, JSON.stringify(history), held);
    await mark(dir);
  }
  return history;
}

async function save(dir: string, text: string, held?: () => void): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = historyTemp(dir);
  try {
    await fs.writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
    held?.();
    await fs.rename(tmp, historyPath(dir));
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

// The history and marker as they are, and a function that puts them back: for a config
// write that fails after recordToggles changed the history for it.
export async function snapshotHistory(dir: string): Promise<(held: () => void) => Promise<void>> {
  const read = () => fs.readFile(historyPath(dir), 'utf8').catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? null : undefined));
  const marked = async () => !!(await fs.lstat(markerPath(dir)).catch(() => null));
  const raw = await read();
  const wasMarked = await marked();
  return async (held) => {
    // Unreadable (undefined): recordToggles left it alone too.
    const now = await read();
    if (raw !== undefined && now !== raw) {
      if (raw === null) {
        held();
        await fs.rm(historyPath(dir), { force: true });
      } else await save(dir, raw, held);
    }
    if (!wasMarked && (await marked())) {
      held();
      await fs.rm(markerPath(dir), { force: true });
    }
  };
}

async function mark(dir: string): Promise<void> {
  await fs.writeFile(markerPath(dir), '', { flag: 'wx', mode: 0o600 }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'EEXIST') throw err;
  });
}

export function overlapsOff(list: OffInterval[], start: number, end: number): boolean {
  return list.some((i) => start <= (i.until ?? Infinity) && end >= i.at);
}

// Whether a file must stay local: artifact sync is off right now (so a running sync or
// watch stops), or either of its times falls while it was off. mtime catches an edit;
// ctime, which userland can't set, catches content copied in with an old mtime (cp -p,
// touch). Either alone blocks, so a later chmod or rename can't release an off-period
// edit; a real edit after sync is back on moves both past the interval.
export function fileHeldBack(history: PrivacyHistory, st: { mtimeMs: number; ctimeMs: number }): boolean {
  const off = history.artifacts_off;
  return off[off.length - 1]?.until === null || changedWhileOff(history, st);
}

export function changedWhileOff(history: PrivacyHistory, st: { mtimeMs: number; ctimeMs: number }): boolean {
  const off = history.artifacts_off;
  return overlapsOff(off, st.mtimeMs, st.mtimeMs) || overlapsOff(off, st.ctimeMs, st.ctimeMs);
}
