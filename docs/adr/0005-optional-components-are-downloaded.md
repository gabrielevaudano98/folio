# 0005. Optional features download pinned components on demand

- Status: Accepted
- Date: 2026-11-20

## Context and problem

The meeting recorder needs native runtimes and models of up to 2 GB. Most people will never use it; the installer must stay small.

## Options considered

- Download on demand from a static catalog with pinned addresses and SHA-256
- Bundle everything in the installer
- Let people pick any URL or file

## Decision

`src/main/features/catalog.js` lists every component with a fixed address (a commit, a version or a release tag; a tag can move, the SHA-256 cannot), size and SHA-256. The installer downloads in the main process with Electron's `net` (system proxy), resumes with HTTP Range, verifies, unpacks in memory with checked paths into a staging folder, then moves the old folder aside and the new one in; if the app stops between the two moves, the next start puts the old version back. Components live in a local, non-roaming folder.

## Consequences

- Installer size and memory at rest unchanged for people who do not use the feature.
- Choosing another model later is choosing another catalog entry of the same kind.
- Downloaded native code is not signed by Folio; corporate policies (WDAC, Smart App Control) may block it, to be checked on Windows.
- Updating a component means changing the catalog and its hashes.

## Notes

Import of a local model file is a later option; arbitrary URLs are not planned.
