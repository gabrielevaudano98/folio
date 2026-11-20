# 0008. Write files atomically

- Status: Accepted
- Date: 2026-11-20

## Context and problem

Notes were written in place. A crash, a power cut or a full disk during a write could leave a truncated note, and the same for settings (which hold the MCP token and the open folder).

## Options considered

- Temporary file in the same folder, fsync, rename
- Write in place
- Keep a backup copy before each write

## Decision

`src/main/atomic.js` writes to a hidden temporary file next to the target, flushes it, then renames it over the target. On Windows it retries while another program holds the file, and falls back to writing in place where renames are refused. A symbolic link keeps its target.

## Consequences

- A file has either its old or its new content after any crash.
- A rename makes a new file: tools that track the file by inode see a new one (the watcher handles it).
