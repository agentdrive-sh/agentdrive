# AgentDrive Design System

The design tokens, primitives, and component vocabulary for AgentDrive's UI.

The CSS source of truth is `apps/web/app/globals.css` (~623 LOC). This document is the human-readable index: when you add a new screen or component, read this first; when you change a token, update both.

## Voice

- **Calm density.** Linear / Vercel feel — small radii, dense content, no decorative blobs. Not Stripe's airy whitespace; not Notion's pillowy cards.
- **Brand-first hierarchy.** Geist Sans for UI, Geist Mono for paths / IDs / commands. Never `system-ui` as the primary face.
- **OKLCH everywhere for color.** Perceptually uniform; same lightness floor works in dark + light themes without hand-tweaking.
- **One job per surface.** Dashboard greets, Timeline audits, Files lists, Settings configures. Don't fold them.
- **Subtraction default.** If an element doesn't earn its pixels, cut it.

## Tokens

### Typeface

```
--font-sans: 'Geist', system-ui, -apple-system, sans-serif
--font-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace
```

Both faces injected by `next/font` in `apps/web/app/layout.tsx`. The fallback stack is only a safety net during font-loading; do not design against it.

### Type scale (airy default)

| Token | Size | Use |
|---|---|---|
| `--t-xs` | 11px | Captions, eyebrow labels |
| `--t-sm` | 12.5px | Secondary copy, sidebar items, table headers |
| `--t-base` | 14px | Body |
| `--t-md` | 15px | Page sub-titles, prominent body |
| `--t-lg` | 17px | Card titles |
| `--t-xl` | 20px | Section heads |
| `--t-2xl` | 26px | Page heads |
| `--t-3xl` | 34px | Marketing section heads |
| `--t-display` | 56px | Marketing hero only |

Dense layout override (`[data-density="dense"]`) shifts `--t-base` to 13px and `--t-sm` to 11.5px, and tightens the 3 / 4 / 5 / 6 spacing tokens. Apply via the AppShell density toggle.

### Spacing

```
--s-1: 4px   --s-2: 8px   --s-3: 12px   --s-4: 16px
--s-5: 20px  --s-6: 24px  --s-8: 32px   --s-10: 40px
--s-12: 48px --s-16: 64px
```

Eight-step scale. Mid-range gaps (`--s-3` / `--s-4`) carry most layouts; use `--s-2` for tight inline groupings and `--s-6+` for section separations.

### Radii

```
--r-sm: 4px   (chips, input fields)
--r-md: 6px   (buttons, badges)
--r-lg: 10px  (cards, modals)
--r-xl: 14px  (large surfaces, hero blocks)
```

Never use uniform large radii everywhere — that's the "AI slop" tell. Pick the scale that fits the element's size.

### Color (OKLCH)

Dark theme is the default. Both themes share token names; only values change.

**Surfaces (bottom to top):** `--bg-0` (page) → `--bg-1` → `--bg-2` → `--bg-3` → `--bg-4` (most elevated).
**Borders:** `--border` (default), `--border-strong` (hover / active).
**Text:** `--text-0` (high emphasis) → `--text-1` (body) → `--text-2` (muted) → `--text-3` (dim) → `--text-4` (faint).

**Semantic accents** (each has `*` and `*-soft` variants for fill vs. tint):
- `--success` — green, OKLCH 0.74 0.16 145 (dark) / 0.55 0.16 145 (light)
- `--warning` — amber, OKLCH 0.82 0.15 85 / 0.62 0.15 70
- `--danger` — red,   OKLCH 0.68 0.20 25 / 0.55 0.22 25
- `--info` — blue,    OKLCH 0.72 0.14 240 / 0.52 0.16 240
- `--accent` — gold (default 45° hue), tunable via `--accent-h / --accent-c / --accent-l`. The brand accent.

**Platform tints** (defined in components, not in globals.css yet — add when stabilizing PlatformBadge):
- Claude Code: `oklch(0.65 0.18 270)` — indigo
- Codex: `oklch(0.68 0.14 175)` — teal
- Cursor: `oklch(0.65 0.18 305)` — violet
- LangGraph: `oklch(0.78 0.16 80)` — amber-gold
- Continue / Zed / Cline / Hermes / OpenClaw: `oklch(0.65 0.02 250)` — neutral

**Color contrast minimums:**
- Body text on background: ≥ 4.5:1 (WCAG AA)
- UI chrome (icons, borders, secondary text): ≥ 3:1
- Decorative elements: no minimum

### Shadows

```
--shadow-1: subtle elevation (cards, dropdowns)
--shadow-2: high elevation (modals, popovers)
```

Use sparingly — the calm-density aesthetic prefers borders over shadows for separation.

### Sidebar

`--sidebar-w: 232px` (collapsed sidebar is 84px in the design wireframes, configurable per-app).

## Utility primitives

These ship in globals.css and should be the first reach for layout work — Tailwind is not used.

| Class | Use |
|---|---|
| `.row` / `.col` | Flex row / column with `align-items: center` |
| `.gap-1`..`.gap-8` | Flex gap (matches spacing tokens) |
| `.grow` | `flex: 1` |
| `.mono` | Switch to Geist Mono |
| `.t-xs` .. `.t-3xl` | Apply type-scale size |
| `.muted` / `.dim` / `.faint` | Text emphasis ladders |
| `.wt-600` | Font weight 600 (Geist's semibold) |

## Components (v1 surface)

### `<PlatformBadge>`

Used in: timeline rows, search results, context cards, dashboard activity feed, run logs, share link cards.

Variant locked at v1: **tinted pill with letter glyph** (D4 / 2A from /plan-design-review).

```
+-----+
| CC  |   <-- 20×20px, --r-md (6px), Geist Mono 10/12px semibold
+-----+
```

- Background: 18% opacity platform tint (e.g. `oklch(0.65 0.18 270 / 0.18)` for Claude)
- Foreground: solid platform tint
- Letter map: `CC` (Claude Code), `CX` (Codex), `CR` (Cursor), `LG` (LangGraph), `ZD` (Zed neutral), `CL` (Cline neutral), `CN` (Continue neutral), `HM` (Hermes neutral), `OC` (OpenClaw neutral)
- `aria-label`: full platform name (visual tint is informational only)

Dense rows can shrink to 18×18px with 9px letter — keep the letter readable on dark + light themes.

### `<TimelineRow>`

Used in: `/dashboard/timeline` route only.

Layout: dense table row with these columns at desktop (≥1024px):

```
| <PlatformBadge> | agent_role (muted) | event icon + label | <WorkspaceChip> | path (mono) | ts (text-3) |
```

- Row height: 28–32px (Geist 14px line-height 1.5, padded 6/8)
- Hover: `--bg-2` background fill, no border
- Selected: `--accent-soft` background, no border
- Event icons: `+` (write), `↻` (run), `↗` (share), `✎` (comment), `−` (delete) — 14×14px, `--text-3` default

Mobile collapse (<768px): stack into a card-list row, line 1 = badge + agent + ts, line 2 = path, line 3 = workspace + event. Row height ≥ 44px for touch targets.

### `<BucketConfigForm>`

Used in: `/settings/bucket` page only.

Single-page form (D5 / 3B from /plan-design-review) with three sections:

1. **Provider** — `<select>` of `agentdrive-r2` (default) / `cf-r2-cross-account` / `s3-hmac`
2. **Credentials** — fields specific to the chosen provider; values mask after save (never echo secrets in GET response)
3. **Honest disclosure** — inline `<bg-2>` block explaining that v1 BYO is blob-only; KV metadata, Vectorize embeddings, and run logs stay on AgentDrive

Action row: `[Verify with test write]` (primary) + `[Save]` (primary, only after verify succeeds). Health chip in the page header (`success` / `warning` / `danger` background tint).

Never call this "CMEK" or "enterprise-grade encryption" in copy. The worker holds the unwrap path; that's not customer-managed.

### `<EmptyState>`

Used in: `drive_context` results when no artifacts exist, dashboard activity feed when org is brand-new, search results when nothing matches.

Layout (D6 / 4A + D10 refinement from /plan-design-review):

```
+--------------------------------------+
|  CC  CX  CR  LG     (faded ~0.5)     |  <-- row of 4 platform glyphs
|                                      |
|  No agents have written here yet.    |  <-- --t-md, --text-0
|                                      |
|  drive_context shows artifacts from  |  <-- --t-xs, --text-3
|  prior agent sessions.               |
|                                      |
|        [ adrive init ]               |  <-- primary CTA, --accent bg
+--------------------------------------+
```

- Card: `--bg-1` background, `--border`, `--r-lg`
- Centered, max-width 480px, padding `--s-6`
- Same shape in CLI output (ASCII platform-glyph row + same copy) and dashboard
- Faded glyphs are `aria-hidden="true"`

### `<DataResidencyTable>`

Used in: `/data-residency` docs page.

Three-column table (D7 / 5A from /plan-design-review): `Data class` × `v1 location` × `v2 commitment`.

```
| Data class            | v1                                  | v2 (planned)         |
|-----------------------|-------------------------------------|----------------------|
| File content (blobs)  | your bucket OR AgentDrive R2 (chip) | your bucket (chip)   |
| File metadata         | CF KV — AgentDrive (chip)           | your KV/DB (chip)    |
| Vectorize embeddings  | Vectorize — AgentDrive (chip)       | your Vectorize (chip)|
| Run logs              | CF KV — AgentDrive (chip)           | your KV/DB (chip)    |
| Auth state · sessions | CF KV — AgentDrive (chip)           | CF KV — AgentDrive   |
| Encryption keys       | worker-managed KEK (chip)           | customer-managed (chip)|
```

- v1 chips use `--warning-soft` background; v2 chips use `--accent-soft`
- Table is copyable into procurement spreadsheets (use real `<table>`, not divs)
- Mobile: horizontal scroll with sticky `Data class` column

## What goes here (and what doesn't)

- ✅ Tokens, type scale, spacing, radii, color (semantic + platform)
- ✅ Component specs that ship in v1 user-visible surfaces
- ✅ A11y minimums (contrast, touch targets, aria patterns)
- ❌ Marketing copy variations (those live in `apps/web/content/`)
- ❌ Per-route layouts (those live in the page files themselves)
- ❌ Decorative or experimental things (don't promote until shipped)

## Tooling

- CSS is hand-written in `apps/web/app/globals.css`; no Tailwind, no CSS-in-JS
- Type-checked at build (TS for components)
- Visual QA: `/design-review` after implementation runs against the live `/dashboard/timeline` to verify the screenshot moment
- Claim-cleanup: `pnpm verify-claims` checks chrome version strings + tool counts against canonical sources

## History

- 2026-05-15 — pivot from "Drive for agents" to "persistent workspace your agents share"; design system inherited from pre-pivot dashboard verbatim
- 2026-05-19 — DESIGN.md extracted from globals.css comments as part of v1 launch readiness (CEO plan Phase 0 deliverable #6, D11 from /plan-design-review)
