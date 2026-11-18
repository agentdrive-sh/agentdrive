---
title: Content-addressing
description: 'How AgentDrive stores artifacts by the sha256 of their content, so identical content shares storage and history is immutable, and what that means for agents.'
---

Artifact bytes live in the selected object store, keyed by the sha256 of the supplied content. A managed metadata store tracks the path, version number, actor, and message that points at each blob.

## Why content-addressing

Three properties matter for agent workflows:

1. **Idempotent writes.** Re-uploading the same draft is a no-op at the storage layer. This matters when agents retry or when an embedding-on-write pass reprocesses prior content.
2. **Cheap dedup.** Two agents that produce the same artifact share one stored object. Storage cost is paid once.
3. **Immutable versions.** Each version's content hash is fixed at write time. Version 3 retains its original content hash and storage locator even after versions 4, 5 or 6 are written.

## What a write looks like

```
agent --POST /v1/workspaces/:wid/files--> API
  -> hash(content) -> object store (idempotent put)
  -> metadata append: { path, version, content_hash, actor_id, agent_platform, agent_role, message, timestamp }
  -> embed(content) -> vector index upsert
```

The metadata record is the source of truth for "what is this path right now." The object store holds the bytes. The hash is the bridge.

## Implications for agents

- **File reads return the latest version.** The version-list endpoint exposes historical metadata; the file-read endpoint has no version selector.
- **Deletes remove the current file metadata and path index.** Blob bytes and historical version records remain, but normal file and version-list routes return 404 after deletion. Retrieval excludes the deleted file while vector cleanup propagates.
- **Diffs are content-aware.** Comparing `v3` to `v5` compares hashes first — equal hashes mean no real change happened between those versions even if the timestamps moved.
