---
name: Harness adapter
about: Propose or claim a session capture adapter for a new agent harness
title: "Harness adapter: <harness name>"
labels: harness-adapter, good first issue
---

<!-- Adapters live in packages/cli/src/lib/transcripts/. See CONTRIBUTING.md, "Where to start". -->

## Harness

- Name and version:
- Link:
- Does it already reach AgentDrive through MCP? (yes / no / unknown)

## Proposing or claiming?

- [ ] Proposing: I would like someone to build this.
- [ ] Claiming: I will build this and open a pull request.

## Where it stores transcripts

| OS | Path |
|---|---|
| macOS | |
| Linux | |
| Windows | |

Is the location configurable (an environment variable, a settings file)? Is there one file per session, one file per project, or a database?

## Format

File type (JSONL, JSON, SQLite, Markdown, other):

Paste a short, redacted sample covering one user turn, one assistant turn and one tool call. Remove secrets, tokens, file contents and personal data.

```
<sample here>
```

## Session details

- How is a session identified (file name, id field, row key)?
- Is the working directory (cwd) recorded? Where?
- Which tool calls write files, and which field holds the path?

## Anything else

Known quirks, format changes between versions, or related harnesses.
