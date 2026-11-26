# Folio Sheets

Folio Sheets is the spreadsheet of Folio: Excel's density, ribbon, structured tables, shortcuts and what-if analysis,
Google Sheets' immediacy, and a file that stays plain Markdown your AI assistants can read and edit (`name.sheet.md`).
It is built on [Univer](https://github.com/dream-num/univer) (Apache-2.0) and the libraries listed below.

This document is the architecture (§1–§5), how the 27 areas are integrated (§6), the incremental plan with its status
(§7) and what is deliberately not done (§8). Formats: [FORMATS.md](../FORMATS.md#sheet-md). Languages:
[FQL](FQL.md) (queries and data models) and [Folio Script](SCRIPT.md) (macros, custom functions, hooks).
Area 28 (AI assistant / Copilot) is out of scope for this phase.

## 1. Principles

1. **The file is the model.** A workbook is a `.sheet.md` file: one `## Sheet` heading and a Markdown table per sheet,
   formatting and rules in an invisible `<!-- sheet: {…} -->` comment, workbook settings in `<!-- workbook: {…} -->`,
   queries, pivots, scripts and Python in fenced blocks. Opening a file never rewrites it; editing one sheet rewrites
   only that sheet (AGENTS.md invariant 1, tested byte for byte through a real Univer instance).
2. **Heavy or risky work never runs in the window or the main process.** Imports, exports, queries, scripts, Python,
   cryptography and what-if analysis run in the *data engine*, a separate process (invariant 6).
3. **Every change is a serialisable command.** Edits, macros, query loads and pivots all go through Univer's command
   service, so they are undoable, recorded in the operation log, refused by protection, and ready to be synchronised.
4. **No file outside the open folder.** The engine never chooses files: the main process resolves every path with
   `notes.resolve` first (invariant 2). DuckDB runs with external access off except those files; scripts and Python run
   in WebAssembly sandboxes.
5. **One design system.** The grid's theme is built from `tokens.css` at start (greys, chroma 0); the ribbon is Folio's
   shared ribbon; panels use Folio's controls; everything is bilingual (English, Italian).

## 2. Processes

```
┌─ Renderer (window, sandboxed) ──────────────────────────────────────────────┐
│ src/sheets/ui                                                               │
│  surface.js ── Univer (grid, formula bar, sheet bar, menus)  @univerjs/*     │
│     │          ribbon.js + commands.js (Folio ribbon → Univer commands)      │
│     │          panels/* (task panes)  charts.js (ECharts)  floats.js         │
│     │          protection.js  extensions.js  print-ui.js                     │
│     │          collab OpLog ◄── every mutation                               │
│     └─ engine-client.js ── window.folio.sheets(method, payload)              │
└───────────────────────────────│─────────────────────────────────────────────┘
                                │ IPC (sheets:call), paths relative to the note
┌─ Main process ────────────────▼─────────────────────────────────────────────┐
│ src/main/sheets-engine.js: start/stop, path resolution, progress, timeouts,  │
│ import dialog, optional components (installer + pinned catalog)             │
└───────────────────────────────│─────────────────────────────────────────────┘
                                │ utilityProcess.postMessage, absolute paths
┌─ Data engine (utilityProcess, stopped after 60 s idle, heap ≤ 3 GB) ────────▼┐
│ src/sheets/engine/worker.js                                                  │
│  io.js (SheetJS, xlsx-kit)   fql/run.js (Arquero)   duck.js (DuckDB, optional)│
│  script.js (QuickJS)   python.js (Pyodide, optional)   crypto.js (node-forge)│
│  whatif.js + headless.js (Univer without a window: same formula engine)      │
└──────────────────────────────────────────────────────────────────────────────┘
```

The command line (`npm run sheets -- …`, `src/sheets/cli.js`) and the tests use the same engine modules without Electron.

## 3. Source map

| Folder | Pure? | What |
|---|---|---|
| `src/sheets/core/` | yes | `convert.js` (sheet-md ⇄ Univer model, lossless), `sheetmd.js` (blocks and workbook settings), `a1.js`, `style.js`, `collab.js` (operations, transport contract), `diff.js` (version comparison, json-diff-ts), `pivot.js` (pivot spec and computation, pivottable), `refs.js` (formula references, cycles), `fql/` (language). |
| `src/sheets/engine/` | Node | The data engine and its modules (§2). `headless.js` is Univer without a window. |
| `src/sheets/ui/` | window | The surface, ribbon, commands, panels, charts, floating objects, protection, extensions, print. |
| `src/main/sheets-engine.js` | main | The engine's process, IPC and optional components. |
| `src/sheets/cli.js` | Node | Batch commands: values, import, export, refresh, goal seek, check, PDF. |
| `test/sheets*.test.mjs`, `test/fql.test.mjs` | — | Round trips, engine modules, collaboration, i18n, the app end to end. |

## 4. Renderer API (`surface`)

Panels, commands, scripts' replay and extensions all use one object (`src/sheets/ui/surface.js`); tests reach it as
`document.querySelector('.surface-sheet').__surface`.

| Group | Members |
|---|---|
| Univer | `wb()`, `ws()`, `range()`, `exec(id, params)`, `formulaApi()`, `snapshot()`, `unitId()` |
| Ranges | `read(ref)`, `readSheet(name)`, `resolve(ref)`, `write(sheet, at, grid, { prev })`, `selectionRef()`, `activate(ref)`, `allGrids()` |
| File | `text()`, `saveNow()`, `meta(id)`, `setMeta(patch)`, `workbook()`, `setWorkbook(patch)`, `fences(lang)`, `setFence(lang, name, body)` |
| Engine | `call(method, payload, { onProgress })` |
| Scripts | `runMacro(name, args)`, `applyOps(ops)`, `scriptCode()` |
| Parts | `panels`, `charts`, `floats`, `protection`, `extensions`, `oplog` |

Engine methods (`src/sheets/engine/worker.js`): `ping`, `file.import`, `file.exportXlsx`, `file.exportCsv`, `fql.inputs`,
`fql.run`, `sql.run`, `script.describe`, `script.run`, `script.call`, `python.run`, `crypto.hash|check|encrypt|decrypt|sign|verify`,
`whatif.goalSeek|dataTable|scenarios|simulate`, `calc.grids`. One call at a time; progress events for long ones.

## 5. Collaboration-ready (not live yet)

The contracts are in `src/sheets/core/collab.js` and tested with two headless replicas that converge.

- **Operation** `{ id (UUID), actor, clock (Lamport), base (version seen), unit, mutation: { id, params }, ts }` wraps
  every Univer mutation that changes the document (view state and formula results are excluded).
- **OpLog** records local operations, lists them (`since(version)` is what a transport sends), receives remote ones
  (deduplicated, ordered by `(clock, actor, id)` on every replica) and exports JSON lines for an audit trail.
- **Transport** contract: `connect(docId, { since })`, `send(ops)`, `onRemote(fn)`, `onPresence(fn)`, `disconnect()`.
  Folio ships only `createLocalTransport()`; a sync service implements the same five methods.
- **Replay** `applyWith(commandService)` executes remote mutations marked `fromCollab`, so they are not recorded again
  and formulas recompute (Univer skips recalculation for `onlyLocal` mutations, which is why that flag is not used).
- **Conflicts**: `footprint(op)` gives the cells an operation writes; `overlaps(a, b)` tells a merge step whether two
  concurrent operations touched the same cells or the structure.
- State and transport are separate: the file stays the persisted state, the log is the stream between replicas.

## 6. The 27 areas: package, module, how they talk

| # | Area | Package | Where | How it works |
|---|---|---|---|---|
| 1 | Grid & navigation | `@univerjs/sheets-ui` (+ find-replace, sort) | `ui/univer.js`, `ui/ribbon.js`, `ui/commands.js`, `panels/series.js`, `panels/text-to-cols.js` | Univer draws the grid, sheet bar, freeze, zoom, fill handle, find and replace, undo and redo; Folio's ribbon (Home … Automate) calls Univer commands. Fill series and text to columns are panels that write through `applyOps`. |
| 2 | Styles & formatting | `@univerjs/sheets` (+ numfmt) | `core/style.js`, `commands.js` | Font, colours, borders, alignment, wrap, rotation, merge, format painter, number formats, cell styles. Styles map both ways to readable sheet-md keys (`bold`, `fill`, `format`…); dark mode follows Folio. |
| 3 | Rules & validation | `@univerjs/data-validation` (+ sheets-data-validation, conditional formatting, notes) | `convert.js`, `panels/cf.js`, `protection.js` | Validation, conditional formatting, notes are Univer resources saved in the sheet comment (`validation`, `cf`, `notes`). Protection: §26. |
| 4 | Formulas & calculation | `@univerjs/engine-formula` (+ sheets-formula) | `univer.js`, `headless.js` | 400+ functions, dynamic arrays, cross-sheet references, defined names, reactive recalculation. The headless copy computes what the grid shows for exports, scripts, what-if and the CLI. |
| 5 | Named ranges & tables | `@univerjs/sheets-filter` (+ sheets-table) | `convert.js`, `commands.js` | Names in the workbook settings (`names`), filters in the sheet comment, Format as table, sort. |
| 6 | PivotTables | `pivottable` | `core/pivot.js`, `panels/pivot.js` | Excel-style field pane (Filters, Columns, Rows, Values); pivottable's `PivotData` and aggregators compute; a readable ```` ```pivot ```` block is saved and placed in a sheet; Refresh all recomputes. Sources: range, FQL query, data model. |
| 7 | Charts | `echarts` | `ui/charts.js`, `panels/chart.js` | Column, bar, line, area, pie, doughnut, scatter, radar, funnel as Univer floating elements; specs in the sheet comment (`charts`), redrawn as data changes, themed from tokens. |
| 8 | Print & PDF | `puppeteer-core` (CLI), Chromium printToPDF (app) | `ui/print-ui.js`, `panels/print.js`, `cli.js` | One HTML builder: paper, orientation, margins, scale, print area, repeated title rows, gridlines and headings. The app prints through Folio's script-free export window; the CLI drives Chrome with Puppeteer (§8). |
| 9 | Import / export .xlsx .csv | `xlsx` (SheetJS) | `engine/io.js` | Import via a Univer snapshot and `fromUniver`, so imported files look hand-written (column styles hoisted). CSV is read as text: `1,5` never becomes 15. Export writes formulas with their computed values. |
| 10 | External data | `@duckdb/node-api` (optional component) | `engine/duck.js`, `panels/queries.js` | SQL, Parquet, large CSV and `.duckdb` files inside the folder; fresh in-memory database per query, `enable_external_access = false`, `allowed_paths` = that query's files, configuration locked. |
| 11 | Power Query | `arquero` | `core/fql/*`, `panels/queries.js` | FQL ([spec](FQL.md)): sources, 18 steps, parameters, errors with line and column; editor with highlighting and completion; preview; load to sheets; Refresh all. |
| 12 | Power Pivot | `arquero` | `core/fql/run.js`, `panels/model.js` | `model` blocks: tables, many-to-one relations, measures that use measures, evaluation by columns of related tables; flattened model as a pivot source. |
| 13 | Scripting & UDF | `@univerjs/core` facade semantics, Folio Script | `engine/script.js`, `panels/scripts.js`, `extensions.js` | Apps Script-like API ([Folio Script](SCRIPT.md)); macros return operations the window replays with the Univer facade; UPPER_CASE functions register as async formula functions; buttons over the grid run macros. |
| 14 | Script sandbox | `quickjs-emscripten` | `engine/script.js` | QuickJS in WebAssembly: no Node, network or files; 64 MB, 5 s per run, 1 s per function call; warm contexts for custom functions. |
| 15 | Audit, diff & versions | `json-diff-ts` | `core/diff.js`, `panels/history.js` | Any two versions compared cell by cell through the Univer model (values, formulas, formats, rules, queries, scripts); one change can be put back. |
| 16 | Formula dependencies | `@univerjs/engine-formula` | `panels/audit.js`, `core/refs.js` | Precedents (`getCellDependencyTree`) and dependents (`getRangeDependents`) of the selection, all formulas, errors with explanations, circular references, evaluate step by step, notes. |
| 17 | UI controls & forms | `@univerjs/ui` | `panels/form.js`, `floats.js`, `commands.js` | Checkbox and drop-down validation, data form (one record at a time, validation-aware), macro buttons; side panel docked like Excel's task panes. |
| 18 | Headless / batch | `@univerjs/core` | `engine/headless.js`, `cli.js` | Univer without a window, event-driven settling (~13 ms per recalculation); CLI: values, import, export, refresh, goal, check, pdf. |
| 19 | Localisation | `@univerjs/core` locales | `univer.js`, `ui/i18n.js`, `ui/locale-it.js` | Univer's en-US and it-IT catalogues plus Folio's (717 texts, tested for completeness and placeholders). |
| 20 | Extensibility & hooks | `@univerjs/core` facade | `ui/extensions.js` | Workbook hooks (`onOpen`, `onEdit`, `onSelectionChange`) opt-in per file; `surface.extensions.register()` for commands, functions and listeners. |
| 21 | Rich data types | `@univerjs/core` (cell custom data) | `panels/entity.js`, `convert.js` | Person, company, place, product, link or custom objects in a cell (`custom.folio`, saved as the cell's `data`); fields inserted next to it. |
| 22 | Slicers & timelines | `@univerjs/sheets-filter` | `ui/floats.js`, `panels/slicer.js` | Buttons over the grid that drive Univer's filter; timeline by month spans; state saved in the sheet comment. |
| 23 | What-if & simulation | `@univerjs/engine-formula` | `engine/whatif.js`, `panels/whatif.js` | Goal seek (secant + bisection), one- and two-variable data tables, scenario manager and summary, Monte Carlo (normal, uniform, triangular, PERT, log-normal; seeded; histogram) on a headless copy. |
| 24 | Python | `pyodide` (optional component) | `engine/python.js`, `panels/python.js` | ```` ```python ```` blocks; `folio.table()` / `folio.output()`; numpy, pandas, scipy… on first import, checked against Pyodide's lock file. |
| 25 | .xlsm / binaries | `xlsx-kit` | `engine/io.js` | Import keeps the original package as an asset (`source`); export writes into a copy of it, so the VBA project, pivot caches, OLE objects and Power Query parts pass through byte for byte (tested). |
| 26 | Security & crypto | `node-forge` | `engine/crypto.js`, `ui/protection.js`, `panels/protect.js` | Sheet protection with editable ranges enforced before commands run; optional PBKDF2 password; AES-256-GCM encryption of ranges; RSA-SHA256 signatures with the public key in the file. |
| 27 | History & restore | `json-diff-ts` + Folio history | `panels/history.js`, `core/collab.js` | Folio's snapshots and git history, compare and restore; the session's operation log as Activity. |

## 7. Plan and status

| Phase | Scope | Status |
|---|---|---|
| 0. Foundations | sheet-md v2, lossless Univer conversion, headless engine, operation log | Done |
| 1. MVP grid and formulas | Univer surface, Folio ribbon (8 tabs), styles, validation, CF, notes, filters, names, tables, find, freeze, charts, protection | Done |
| 2. Data, files, charts | Data engine process, import/export xlsx/xlsm/csv/ods, FQL queries and data models, DuckDB, pivots, slicers and timelines, page setup and PDF | Done |
| 3. Automation, analysis, security, history | Folio Script in QuickJS (macros, UDF, hooks, buttons), Python in Pyodide, what-if and Monte Carlo, encryption and signatures, version compare and restore, formula auditing, data form, rich data types, extensions, CLI | Done |
| 4. Collaboration-ready | Operation, OpLog, Transport contract, replay, conflict footprint; two replicas converge in tests | Done (no server, by design) |
| 5. Next | Live sync service and presence; AI assistant (area 28); MCP tools for queries, pivots and scripts; Settings view listing the data components; virtualised export for very large sheets | Planned |

Tests: `test/sheets.test.mjs` (round trips), `test/fql.test.mjs`, `test/sheets-engine.test.mjs` (22 checks),
`test/sheets-i18n.test.mjs`, `test/sheets-ui.test.mjs` (14 checks in Electron).

## 8. Decisions and limits

- **PDF in the app uses Chromium's printToPDF, not Puppeteer.** Puppeteer needs a remote-debugging port on a Chromium
  it controls; opening one in the app would break invariant 4. Both paths render the same HTML (`buildPrintHtml`);
  Puppeteer (`puppeteer-core`) is used by the CLI with a local Chrome (`CHROME_PATH`).
- **DuckDB and Pyodide are optional downloads** (ADR 0005), pinned with SHA-256: 20–28 MB per platform for DuckDB,
  6.5 MB for Pyodide. Pyodide's scientific packages come from its CDN on first import, verified by its lock file.
- **Protection is not secrecy**: the file is Markdown. Encryption is the secret part; Folio cannot recover a lost password.
- **Data tables, pivots and query loads write values**, refreshed by Refresh all (Excel's data tables are live formulas).
- **Scripts cannot do I/O.** Anything that needs files or the network is a query (FQL) or Python with packages.
- **VBA is preserved, not run.** An `.xlsm` keeps its macros for Excel; Folio Script is the language that runs here.
- **Export of styles to .xlsx** covers fonts, fills, borders, alignment and number formats; conditional formatting rules
  are kept in Folio's file and in the source package when there is one, but not rebuilt in a new .xlsx yet.
