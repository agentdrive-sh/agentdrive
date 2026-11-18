#!/usr/bin/env node
// Phase 0 deliverable #3: prevent claim drift between code and docs.
//
// Reads the canonical sources of truth (mcp-server/package.json, the live
// MCP server registry, embeddings.ts chunking config) and asserts every
// claim about them in docs + web copy matches. Exits non-zero on drift.
//
// Run via:  pnpm verify-claims
// Wired into CI in scripts/ci.sh.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const errors = [];

function report(file, msg) {
  errors.push(`${file}: ${msg}`);
}

async function readText(rel) {
  return readFile(join(repoRoot, rel), 'utf8');
}

async function readJson(rel) {
  return JSON.parse(await readText(rel));
}

// 1. Resolve canonical values.
const mcpPkg = await readJson('packages/mcp-server/package.json');
const mcpVersion = mcpPkg.version;

const mcpRegistry = await readText('packages/mcp-server/src/registry.ts');
const toolCount = (mcpRegistry.match(/name: 'drive_/g) ?? []).length;

const embeddings = await readText('apps/worker/src/services/embeddings.ts');
const chunkSizeMatch = embeddings.match(/export const CHUNK_SIZE\s*=\s*(\d+)/);
const maxChunksMatch = embeddings.match(/export const MAX_CHUNKS\s*=\s*(\d+)/);
const chunkSize = chunkSizeMatch ? Number(chunkSizeMatch[1]) : null;
const maxChunks = maxChunksMatch ? Number(maxChunksMatch[1]) : null;
if (!chunkSize || !maxChunks) {
  report('apps/worker/src/services/embeddings.ts', 'could not parse CHUNK_SIZE / MAX_CHUNKS');
}

console.log(`canonical: mcp-server v${mcpVersion} (${toolCount} tools); chunks=${maxChunks} x ${chunkSize}`);

// 2. Version strings in the site chrome are read from package.json at build time, so they can't drift.

// 3. Guards: tool-count claims in copy.
// Positive assertion: any file that mentions "tools" at all must also include
// the current canonical count somewhere. Historical citations of older counts
// ("12 MCP tools at v0.2.x, 16 at v0.3.0, 20 at v0.4.0") stay valid as long
// as the current count is also present.
const TOOL_COUNT_FILES = [
  'README.md',
  'docs/strategy/STRATEGY.md',
  'docs/strategy/POSITIONING.md',
  'apps/web/app/integrations/claude-code/page.tsx',
];

for (const file of TOOL_COUNT_FILES) {
  const content = await readText(file).catch(() => null);
  if (content == null) continue;
  if (!/\btools?\b/i.test(content)) continue; // file doesn't mention tools at all
  const canonicalRe = new RegExp(`\\b${toolCount}\\b`);
  if (!canonicalRe.test(content)) {
    report(
      file,
      `mentions tools but never the canonical count of ${toolCount} — add the current number`,
    );
  }
}

// Negative assertion: any "N tools" / "N MCP tools" phrase in public copy must
// be the total, stable or experimental count. Catches "the other 9 MCP tools".
const experimentalCount = (mcpRegistry.match(/name: 'drive_sandbox_/g) ?? []).length;
const allowedCounts = new Set([toolCount, toolCount - experimentalCount, experimentalCount]);
const COUNT_DIRS = ['apps/web/content', 'apps/web/app', 'apps/web/components', 'docs/gtm/launch', 'docs/marketing'];
const countFiles = ['README.md'];
for (const dir of COUNT_DIRS) {
  const entries = await readdir(join(repoRoot, dir), { recursive: true }).catch(() => []);
  countFiles.push(...entries.filter((f) => /\.(mdx?|tsx?)$/.test(f)).map((f) => `${dir}/${f}`));
}
for (const file of countFiles) {
  const content = await readText(file).catch(() => null);
  if (content == null) continue;
  for (const m of content.matchAll(/\b(\d+)\s+(?:MCP\s+)?tools\b/gi)) {
    if (!allowedCounts.has(Number(m[1]))) {
      report(file, `says "${m[0]}" — the registry has ${toolCount} tools (${toolCount - experimentalCount} stable + ${experimentalCount} experimental)`);
    }
  }
}

// 4. Guards: stale chunking copy. Multi-chunk shipped at 16 x 1500 chars.
const CHUNK_GUARDS = ['docs/strategy/STRATEGY.md', 'docs/strategy/ROADMAP.md'];
const STALE_CHUNK = ['single chunk, 8000-char cap', 'single-chunk only at 8000-char'];
for (const file of CHUNK_GUARDS) {
  const content = await readText(file).catch(() => null);
  if (content == null) continue;
  for (const stale of STALE_CHUNK) {
    if (content.includes(stale)) {
      report(file, `still describes embeddings as "${stale}" — actual is ${maxChunks} x ${chunkSize}`);
    }
  }
}

// 5. Guards: stale npm scope. The repo shipped under @adrive/* in e7b97ce.
const STALE_NPM = ['agentdrive-mcp', '@agentdrive/cli', '@agentdrive/sdk', '@agentdrive/mcp-server'];
const NPM_GUARDS = [
  'README.md',
  'docs/strategy/STRATEGY.md',
  'docs/strategy/POSITIONING.md',
  'docs/strategy/PIVOT.md',
  'docs/strategy/ROADMAP.md',
  'docs/strategy/GTM.md',
];
for (const file of NPM_GUARDS) {
  const content = await readText(file).catch(() => null);
  if (content == null) continue;
  for (const stale of STALE_NPM) {
    // Allow historical references that explicitly call out the pre-rename
    // package name in context (e.g. "formerly agentdrive-mcp"). Naive guard
    // only flags bare unqualified mentions. agentdrive-sh/agentdrive-mcp is the
    // public GitHub repo (plugin marketplace), not an npm name.
    const re = new RegExp(`(?<!formerly\\s)(?<!was\\s)(?<!agentdrive-sh/)\\b${stale.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'g');
    const m = content.match(re);
    if (m) {
      report(file, `contains stale npm name "${stale}" (${m.length}x) — rename to @adrive/* per e7b97ce`);
    }
  }
}

if (errors.length > 0) {
  console.error('');
  console.error(`verify-claims found ${errors.length} drift issue${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  -', e);
  console.error('');
  console.error('Fix the docs to match the code, or update the canonical source if the code itself is wrong.');
  process.exit(1);
}

console.log('verify-claims: clean.');
