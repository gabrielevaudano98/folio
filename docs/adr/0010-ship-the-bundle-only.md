# 0010. Ship only the esbuild bundle in the installer

- Status: Accepted
- Date: 2026-11-20

## Context and problem

esbuild bundles every runtime package into `dist/`, but electron-builder also copied everything listed in `dependencies`: 22,427 files and about 300 MB inside `app.asar`.

## Options considered

- All packages as devDependencies, the asar holds dist/
- Keep dependencies and exclude them with file patterns

## Decision

Every package is a devDependency; `app.asar` is about 14 MB. A package that must exist at runtime outside the bundle (a native module) would be listed in `dependencies` on purpose.

## Consequences

- Smaller download, faster install and start.
- `npm ci --omit=dev` no longer installs what the build needs; CI uses `npm ci`.
