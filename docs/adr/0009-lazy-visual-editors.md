# 0009. Load the slides, board and sheet editors on first use

- Status: Accepted
- Date: 2026-11-20

## Context and problem

The startup bundle held every editor (1.3 MB of JavaScript, including the slide canvas libraries) although most sessions open only pages.

## Options considered

- Dynamic import per document type
- Keep one bundle

## Decision

`app.js` imports `slides.js`, `board.js` and `sheet.js` the first time a document of that type is shown; esbuild splits them into chunks. The startup bundle is 237 KB.

## Consequences

- Less to parse at startup, more on slower computers.
- The first open of a deck or board waits for its chunk (local file, a few milliseconds).
