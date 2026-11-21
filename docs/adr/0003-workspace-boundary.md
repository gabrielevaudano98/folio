# 0003. One module resolves every path: the workspace boundary

- Status: Accepted
- Date: 2026-11-20

## Context and problem

Both the window and AI assistants name files. A path that leaves the open folder, through `..` or a symbolic link, could read or overwrite anything the person can.

## Options considered

- Every file operation goes through `notes.resolve()`
- Check paths at each call site

## Decision

Every path the window or an MCP tool names is resolved by `notes.resolve()` in `src/main/notes.js`, which keeps it inside the folder, follows links and refuses hidden files and anything outside. Note writes are limited to Markdown and text files. Pictures, fonts, media and other attached files are copied by `src/main/assets.js` into the note's `.asset/` folder, whose real location is checked against the workspace before anything is written, so a `.asset` link that leads outside the folder is refused.

## Consequences

- One place to review and test (test/security.test.mjs).
- A check-then-write race with a link swapped in at that instant is not guarded (SECURITY.md).
