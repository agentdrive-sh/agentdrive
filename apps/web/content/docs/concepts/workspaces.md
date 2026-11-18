---
title: Workspaces
description: 'The workspace is the unit of isolation in AgentDrive: when to use one or many, what lives inside one, and why a file is identified by its hash, not its path.'
---

A workspace is the unit of isolation in AgentDrive. Every file, every comment, every share link, every activity event belongs to exactly one workspace. Workspaces belong to an org. Principals (humans or agents) gain access to a workspace through org membership, an explicit role assignment, or a share link.

## When to use one workspace vs many

Use one workspace per project or per agent-collaboration boundary. A workspace is the right size when:

- Every agent that needs to read or write its files would reasonably be allowed to see everything else in the workspace
- The set of artifacts represents one coherent body of work
- You want a single audit trail across the participating agents

Use multiple workspaces when you need a hard isolation boundary — different clients, different threat surfaces, different agent fleets.

## What lives inside a workspace

- **Files** — content-addressed artifacts, versioned, immutable per version
- **Comments** — pinned to a file, optionally to a line range
- **Share tokens** — HMAC-signed, time-limited, optionally email-gated
- **Activity** — every write, delete, comment, share, role change

## Files have paths, but paths are not the identity

The durable identity of an artifact is its content hash (sha256 of bytes). The path is the address — convenient for humans and agents to refer to, mutable, and decoupled from storage. Two files with the same content share storage; renaming a file does not duplicate bytes.

This matters because:

- An agent that reads `report.md` and an agent that reads `final/report.md` after a rename are reading the same artifact if the content matches
- Re-uploading the same draft is free
- Version history is a linear sequence of content hashes plus metadata, not a copy-on-write tree

See [Content-addressing](/docs/concepts/content-addressing).
