# 0012. Sheets on Univer, with a separate data engine process

- Status: Accepted
- Date: 2026-11-26

## Context and problem

The first sheet editor drew an HTML table and evaluated formulas with hot-formula-parser. It could not grow into an
Excel replacement: no virtualised grid, partial function coverage, no dynamic arrays, no pivots, queries, scripts,
Python, protection or what-if analysis, and every heavy job would have run in the window.

## Options considered

- Univer (Apache-2.0): canvas grid, formula engine with dynamic arrays and dependency trees, facade API, plugins for
  validation, conditional formatting, filters, notes, tables, drawings; runs headless in Node.
- Keep the table editor and add features one by one.
- A commercial grid (Handsontable, SpreadJS): licences incompatible with AGPL distribution.

## Decision

The sheet surface is Univer with Folio's ribbon and side panels (`src/sheets/ui`). The `.sheet.md` file stays the only
model (ADR 0002): `src/sheets/core/convert.js` maps it to Univer's workbook data and back, rewriting only the sheets that
changed. Files, queries (FQL on Arquero, DuckDB), scripts (QuickJS), Python (Pyodide), cryptography (node-forge) and
what-if analysis run in a utilityProcess started on first use (`src/sheets/engine/worker.js`, `src/main/sheets-engine.js`),
the same pattern as ADR 0006. DuckDB and Pyodide are optional components (ADR 0005).

## Consequences

- One formula engine everywhere: the grid, the engine's headless copy, the CLI and the tests compute the same values.
- Every change is a Univer mutation, so undo, protection, the operation log and future synchronisation share one path.
- The sheet chunk is larger (Univer and React, loaded only when a sheet opens, ADR 0009); the engine bundle is ~16 MB.
- PDF from the app keeps using Chromium's printToPDF; Puppeteer serves the CLI, because a debugging port in the app
  would weaken invariant 4.
