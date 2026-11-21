# 0002. Markdown files on disk are the only data model

- Status: Accepted
- Date: 2026-11-20

## Context and problem

People must own their documents, open them in other tools and sync them with what they already use. AI assistants work best on plain text.

## Options considered

- Markdown files plus Markdown dialects for slides, boards, sheets
- A database (SQLite) with export
- A proprietary JSON format

## Decision

Every document is a Markdown file in the open folder. Slides, boards and sheets are Markdown dialects, specified in `docs/FORMATS.md`, each with a pure parser and serializer.

## Consequences

- Files work without Folio; git, sync clients and other editors handle them.
- Every format needs a lossless round-trip: opening a file must not rewrite it (test/formats.test.mjs).
- Features that need an index (search, backlinks) compute it from the files.
