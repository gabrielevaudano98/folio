# 0003. One module resolves every path: the workspace boundary

- Status: Accepted
- Date: 2026-11-20

## Context and problem

Both the window and AI assistants name files. A path that leaves the open folder, through `..` or a symbolic link, could read or overwrite anything the person can.

## Options considered

- Every file operation goes through `notes.resolve()`
- Check paths at each call site

## Decision

All file access by the app and by MCP tools goes through `src/main/notes.js`, which resolves the path inside the folder, follows links and refuses hidden files and anything outside. Writes are limited to Markdown and text files; images go to assets.

## Consequences

- One place to review and test (test/security.test.mjs).
- A check-then-write race with a link swapped in at that instant is not guarded (SECURITY.md).
