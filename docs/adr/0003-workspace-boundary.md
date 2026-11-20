# 0003. One module resolves every path: the workspace boundary

- Status: Accepted
- Date: 2026-11-20

## Context and problem

Both the window and AI assistants name files. A path that leaves the open folder, through `..` or a symbolic link, could read or overwrite anything the person can.

## Options considered

- Every file operation goes through `notes.resolve()`
- Check paths at each call site

## Decision

Every path the window or an MCP tool names is resolved by `notes.resolve()` in `src/main/notes.js`, which keeps it inside the folder, follows links and refuses hidden files and anything outside. Note writes are limited to Markdown and text files. Images, fonts, video and audio are copied by IPC handlers in `src/main/main.js` (`fs:save-image`, `fs:pick-image`, `fs:pick-media`) into the note's `assets/` folder; each new file's final path is checked with `notes.contain()`, so an `assets` link that leads outside the folder is refused.

## Consequences

- One place to review and test (test/security.test.mjs).
- A check-then-write race with a link swapped in at that instant is not guarded (SECURITY.md).
