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

`src/main/atomic.js` writes to a hidden temporary file next to the target, flushes it, then renames it over the target. On Windows it retries for about 1.6 s while another program holds the file; if it is still locked the write fails with a clear message and the old file is untouched (no in-place fallback, which could leave half a file). The new file keeps the old one's mode, a read-only file is refused, and a symbolic link keeps its target.

## Consequences

- A file has either its old or its new content after any crash.
- A rename makes a new file: tools that track the file by inode see a new one (the watcher handles it).
