// Human-readable relative time. Mirrors the design's `window.human()`.

export function humanTime(input: string | number | Date): string {
  const ts =
    typeof input === 'number'
      ? input
      : input instanceof Date
        ? input.getTime()
        : Date.parse(input);
  if (Number.isNaN(ts)) return '—';
  const mins = (Date.now() - ts) / 60_000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 7 * 24 * 60) return `${Math.round(mins / 60 / 24)}d ago`;
  return `${Math.round(mins / 60 / 24 / 7)}w ago`;
}
