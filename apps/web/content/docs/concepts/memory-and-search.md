---
title: Memory and search
description: How artifacts are embedded on write and how drive_search, drive_recall, and drive_context retrieve them.
---

Memory in AgentDrive is a feature of the workspace, not a separate product. Every artifact that is written through the API can be embedded as it lands, indexed alongside its content hash and provenance, and retrieved later by semantic similarity. The headline is still the workspace — memory is what makes the workspace useful across sessions.

## Embedding on write

When a write hits the API, after the content is committed and the metadata record is updated, the system passes the content to an embedding model and upserts the resulting vector into the managed vector index. The vector record carries org, workspace, path, content hash, agent ID, optional agent platform, timestamp and chunk metadata.

Vector IDs are scoped by org, workspace, path, content hash and chunk index, so identical content at different locations remains independently retrievable. A repeated write can run embedding inference again; content deduplication does not guarantee inference-cost deduplication.

The embedding model is Workers AI `@cf/baai/bge-base-en-v1.5`, with 768 dimensions.

## The three retrieval tools

### `drive_search`

Semantic search across a workspace or org, with keyword fallback when semantic retrieval returns no results. Use it when an agent has a question and needs to find the artifacts most likely to answer it.

```
drive_search({ query, workspace_id?, top_k?, filter? })
  -> text containing path, workspace, score, agent/platform, timestamp and snippet
```

Semantic filters support agent platform, agent ID and path prefix. Semantic scores are cosine similarity; keyword results carry `score: null` in REST and display `score=keyword` in MCP/CLI output.

### `drive_recall`

Recall currently delegates to artifact search across the org, with the same semantic and keyword fallback behavior. Automatic fact extraction and a separate fact namespace are planned, not implemented.

```
drive_recall({ query, top_k? })
  -> text containing matching artifact paths, provenance and snippets
```

Use it to look for a fact or preference in the artifacts your agents have written.

### `drive_context`

The headline tool. Given a description of the current task, return the top-N artifacts most likely to be relevant, ranked by similarity to the task and recency-boosted so that recent work is privileged.

```
drive_context({ task, workspace_id?, limit? })
  -> text containing artifact paths, agent/platform, relative age and snippets
```

This is the "right context at the right time" promise made concrete. An agent that calls `drive_context` at the start of a session gets a prepopulated working set — the planner from the prior session, the artifact the reviewer flagged, the schema the coder agreed on yesterday.

## Why the three are separate tools

Agents call these tools for different tasks: artifact search, looking up prior facts or preferences, and assembling task context. Recall currently shares the artifact-search implementation; a distinct extracted-fact result is planned. The separate names let an agent select the task it needs.

## Status

All three tools, plus the embedding-on-write pass, are live in `@adrive/mcp-server`. See the [roadmap](/docs/v1-roadmap) for what's next.
