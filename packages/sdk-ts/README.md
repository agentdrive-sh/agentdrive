# @adrive/sdk

TypeScript SDK for AgentDrive — the cross-agent artifact workspace with provenance, semantic recall, and portable storage across Claude Code, Codex, Cursor, and LangGraph.

```bash
npm install @adrive/sdk
```

## Quick start

```ts
import { AgentDrive } from '@adrive/sdk';

const drive = new AgentDrive({
  apiKey: process.env.AGENTDRIVE_API_KEY!,
  agentPlatform: 'codex',   // claude-code, codex, cursor, langgraph, crewai, mcp, cli, ...
  agentRole: 'planner',     // free-text label; appears in provenance
});

// Write what your agent produced
await drive.writeFile(workspaceId, 'plan.md', '# the plan');

// Pull the context another agent left for you
const { artifacts } = await drive.context({ task: 'implement plan.md', limit: 5 });

// Semantic search across every artifact in the org
const { hits } = await drive.search({ query: 'shipping checklist' });

// Log the run so the next agent in the chain sees what you did
await drive.logRun({
  task: 'implement plan.md',
  status: 'success',
  artifacts_referenced: ['plan.md'],
  artifacts_produced: ['src/foo.ts'],
});
```

## Surface

Files: `writeFile`, `readFile`, `listFilesPage`, `listAllFiles`, `deleteFile`, `getVersionsPage`, `getAllVersions`
Memory: `search`, `context`
Provenance: `logRun`, `getRun`
Workspaces: `createWorkspace`, `listWorkspacesPage`, `listWorkspaces`
Collaboration: `createShareLink`, `addComment`, `getCommentsPage`, `getAllComments`, `getActivityPage`, `getAllActivity`
Sandbox: `sandboxClone`, `sandboxExec`, `sandboxRead`, `sandboxCommit`
Escape hatch: `rawFetch(path, init)` returns the raw `Response`

Errors throw `ApiError` carrying the HTTP status. Use `instanceof ApiError` to branch.

## Cross-agent identity

Every request gets stamped with `X-Agent-Platform` and `X-Agent-Role` headers. The same API key (= principal) can run in many sessions; the headers distinguish "Codex on Tuesday" from "Claude Code on Wednesday" in provenance records and metadata indexes. Configure once at construction.

## Pagination

List endpoints use cursors. `listAllPages` walks them to exhaustion, capped at `maxPages` (default 10) to prevent runaway loops on large workspaces. For finer control, call the `*Page` variant and loop the cursor yourself.
