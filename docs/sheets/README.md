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
│     ├─ formula-worker.js (Web Worker): Univer's formula engine, via RPC      │
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
| `src/sheets/core/` | yes | `convert.js` (sheet-md ⇄ Univer model, lossless; shared formulas), `cell-text.js` (how a value is written in a table cell), `replay.js` (script operations → Univer commands), `sheetmd.js` (blocks and workbook settings), `a1.js`, `style.js`, `collab.js` (operations, transport contract), `diff.js` (version comparison, json-diff-ts), `pivot.js` (pivot spec and computation, pivottable), `refs.js` (formula references, cycles), `fql/` (language). |
| `src/sheets/engine/` | Node | The data engine and its modules (§2). `headless.js` is Univer without a window; `xlsx-cf.js` maps conditional formatting to and from Excel. |
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
| 1 | Grid & navigation | `@univerjs/sheets-ui` (+ find-replace, sort) | `ui/univer.js`, `ui/ribbon.js`, `ui/commands.js`, `panels/series.js`, `panels/text-to-cols.js` | Univer draws the grid, sheet bar, freeze, zoom, fill handle, find and replace, undo and redo; Folio's ribbon (Home … Automate) calls Univer commands. Font, size and number format are Excel-style combo boxes (type any size or font; each format previews the active cell); every tab has the same height. Fill series and text to columns are panels that write through `applyOps`. |
| 2 | Styles & formatting | `@univerjs/sheets` (+ numfmt) | `core/style.js`, `commands.js` | Font, colours, borders, alignment, wrap, rotation, merge, format painter, number formats, cell styles. Styles map both ways to readable sheet-md keys (`bold`, `fill`, `format`…); dark mode follows Folio. |
| 3 | Rules & validation | `@univerjs/data-validation` (+ sheets-data-validation, conditional formatting, notes) | `convert.js`, `panels/cf.js`, `protection.js` | Validation, conditional formatting, notes are Univer resources saved in the sheet comment (`validation`, `cf`, `notes`). Protection: §26. |
| 4 | Formulas & calculation | `@univerjs/engine-formula` (+ sheets-formula) | `univer.js`, `headless.js` | 400+ functions, dynamic arrays, cross-sheet references, defined names, reactive recalculation. The headless copy computes what the grid shows for exports, scripts, what-if and the CLI. |
| 5 | Named ranges & tables | `@univerjs/sheets-filter` (+ sheets-table) | `convert.js`, `commands.js` | Names in the workbook settings (`names`), filters in the sheet comment, Format as table, sort. |
| 6 | PivotTables | `pivottable` | `core/pivot.js`, `panels/pivot.js` | Excel-style field pane (Filters, Columns, Rows, Values); pivottable's `PivotData` and aggregators compute; a readable ```` ```pivot ```` block is saved and placed in a sheet; Refresh all recomputes. Sources: range, FQL query, data model. |
| 7 | Charts | `echarts` | `ui/charts.js`, `panels/chart.js` | Column, bar, line, area, pie, doughnut, scatter, radar, funnel as Univer floating elements; specs in the sheet comment (`charts`), redrawn as data changes, themed from tokens. |
| 8 | Print & PDF | `puppeteer-core` (CLI), Chromium printToPDF (app) | `ui/print-ui.js`, `panels/print.js`, `cli.js` | One HTML builder: paper, orientation, margins, scale, print area, repeated title rows, gridlines and headings. The app prints through Folio's script-free export window; the CLI drives Chrome with Puppeteer (§8). |
| 9 | Import / export .xlsx .csv | `xlsx` (SheetJS) | `engine/io.js` | Import via a Univer snapshot and `fromUniver`, so imported files look hand-written (column styles hoisted). CSV is read as text: `1,5` never becomes 15. Export writes formulas with their computed values, validation, freeze panes and conditional formatting (`engine/xlsx-cf.js`: 14 kinds of rule, read back on import). |
| 10 | External data | `@duckdb/node-api` (optional component) | `engine/duck.js`, `panels/queries.js` | SQL, Parquet, large CSV and `.duckdb` files inside the folder; fresh in-memory database per query, `enable_external_access = false`, `allowed_paths` = that query's files, configuration locked. |
| 11 | Power Query | `arquero` | `core/fql/*`, `panels/queries.js` | FQL ([spec](FQL.md)): sources, 24 steps (with `case when`, `top`, `index`, `merge`, `split … into rows`, `transpose`, `transform`), parameters, errors with line and column; editor with highlighting and completion; preview; load to sheets; Refresh all. |
| 12 | Power Pivot | `arquero` | `core/fql/run.js`, `panels/model.js` | `model` blocks: tables, many-to-one relations, measures that use measures, evaluation by columns of related tables; flattened model as a pivot source. |
| 13 | Scripting & UDF | `@univerjs/core` facade semantics, Folio Script | `engine/script.js`, `panels/scripts.js`, `extensions.js` | Apps Script-like API ([Folio Script](SCRIPT.md)); macros return operations replayed with the Univer facade (`core/replay.js`, shared by the window and the headless engine); UPPER_CASE functions register as async formula functions; buttons over the grid run macros. |
| 14 | Script sandbox | `quickjs-emscripten` | `engine/script.js` | QuickJS in WebAssembly: no Node, network or files; 64 MB, 5 s per run, 1 s per function call; warm contexts for custom functions. |
| 15 | Audit, diff & versions | `json-diff-ts` | `core/diff.js`, `panels/history.js` | Any two versions compared cell by cell through the Univer model (values, formulas, formats, rules, queries, scripts); one change can be put back. |
| 16 | Formula dependencies | `@univerjs/engine-formula` | `panels/audit.js`, `core/refs.js` | Precedents (`getCellDependencyTree`) and dependents (`getRangeDependents`) of the selection, all formulas, errors with explanations, circular references, evaluate step by step, notes. |
| 17 | UI controls & forms | `@univerjs/ui` | `panels/form.js`, `floats.js`, `commands.js` | Checkbox and drop-down validation, data form (one record at a time, validation-aware), macro buttons; side panel docked like Excel's task panes. |
| 18 | Headless / batch | `@univerjs/core` | `engine/headless.js`, `cli.js` | Univer without a window, event-driven settling (~13 ms per recalculation); CLI: values, import, export, refresh, goal, check, pdf. |
| 19 | Localisation | `@univerjs/core` locales | `univer.js`, `ui/i18n.js`, `ui/locale-it.js` | Univer's en-US and it-IT catalogues plus Folio's (710 texts, tested for completeness and placeholders). |
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
| 4b. Robustness (Nov 2026) | Lossless cell text (apostrophe rule, entities; fuzz through Univer), Excel-style combo boxes and fixed ribbon height, 6× faster open of large sheets, per-sheet save cache, shared formulas for runs like `=D2*E2`, fresh unit ids in the headless engine, conditional formatting in .xlsx, FQL and Folio Script extended | Done |
| 4c. Formula worker | Univer's formula engine in a Web Worker; custom functions through the window; save baseline in the worker; save from the live model | Done |
| 4d. Sliced save | Save in ~8 ms slices that give up on an edit; writer and converter as steps; no stack overflow past 120k rows | Done |
| 4e. Assistant tools and Settings | MCP tools on the running app: `get_sheet_values` with computed values, `run_sheet_query`, `sheet_goal_seek`, `refresh_sheet`, `run_sheet_macro` (`engine/book.js`); Settings → Spreadsheet data components (status, size, what each enables, licence, Download / Cancel / Remove with confirmation, live progress; `renderer/sheets-components.js`, test/sheets-components-ui.test.mjs) | Done |
| 4f. Stability pass | Random-edit test (750 sequences, save → reopen identical), stress run, CPU profiles. Fixed: every edit re-parsed the whole file for script blocks (200 → 1 ms per edit); the worker's formula results counted as edits (extra save, logged for collaboration, `onEdit` fired); the cell editor's keystrokes and Folio's own chart drawing counted as edits; duplicate or invalid sheet names; Cancel ignored while checking a download; a formula worker that dies is now noticed (heartbeat); tab switches keep recent workbooks loaded (1.5 s → ~50 ms, flat memory) and a fast switch can no longer save text into the wrong tab | Done |
| 5. Next | Live sync service and presence; AI assistant (area 28); dynamic-array metadata in .xlsx; streaming xlsx export over ~200k rows | Planned |

Tests: `test/sheets.test.mjs` (15 checks: round trips, fuzz, shared formulas, 20k rows, save in slices), `test/fql.test.mjs` (11),
`test/sheets-engine.test.mjs` (27), `test/sheets-i18n.test.mjs`, `test/sheets-ui.test.mjs` (24 checks in Electron, including
the five MCP tools), `test/sheets-components-ui.test.mjs` (4: Settings → data components).

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
- **Export to .xlsx** covers fonts, fills, borders, alignment, number formats, validation, freeze panes, conditional
  formatting, notes, defined names, tab colours, hidden sheets, zoom, gridlines and the filter range; Excel recalculates
  every formula on open (`fullCalcOnLoad`). Functions newer than Excel 2007 get their `_xlfn.` prefix on the way out and
  lose it on the way in (`engine/xlsx-formula.js`), so `XLOOKUP`, `IFS` or `TEXTJOIN` never show #NAME?. Not exported:
  a rule Excel cannot express ("equal to the average", icons mixed from several sets), checkbox validation, the
  filter's criteria (the range is), charts. `FILTER`, `SORT`, `UNIQUE` are written as ordinary formulas: Excel shows
  their first value until the cell is re-entered (dynamic-array metadata is not written yet).
- **Formulas run in a Web Worker** (`ui/formula-worker.js`, a second Univer reached through `@univerjs/rpc`). Univer
  refuses to send custom functions to a worker as code, so the window sends their names and the worker asks the window
  for each value (which asks the data engine). Validation and formatting formulas, SUBTOTAL under filters and the
  formula audit work there (tested). If the worker cannot start, Folio says so and computes on the window's thread
  from the next open (`folio.sheets.worker` = `off`). The worker holds a second copy of the workbook in memory.
- **Large sheets.** Measured in the app at 50,000 rows × 7 columns and 100,000 formulas (`test/sheets-stress.test.mjs`,
  opt-in): an edit holds the window for 1 ms (median; 16 ms at worst) and the worker brings the totals up to date in
  ~3 s; 50 undos take 75 ms; the workbook opens with totals in ~10 s (2 s of it on the window's thread) and reopens in
  1.5 s; the data engine, killed, restarts on the next call (0.4 s). Switching tabs keeps up to 2 hidden workbooks loaded
  (`KEEP_HIDDEN`, and no more than 8 MB of their text, `KEEP_TEXT`): going back to the 50k-row workbook takes ~50 ms
  instead of 1.5 s and memory stays flat (JS heap ~80 MB after 12 switches, RSS 718 → ~450 MB). A hidden workbook's
  edits are saved by tab, not by whichever tab is active (a fast switch used to be able to write one workbook's text
  into another); `activate()` flushes pending edits and saves on leaving. Folio's chart drawing runs through
  `drawQuietly`, which restores the undo stacks so Ctrl+Z never undoes a chart box. Saving never blocks typing: a
  workbook whose save takes more than 40 ms is saved in slices of ~8 ms (`fromUniverAsync`, the same steps as
  `fromUniver`), reading Univer's live model; an edit during the save makes it give up and start again, and
  `saveNow()` takes over from it. 200,000 rows open, save and come back byte for byte (no argument spreads that
  overflow the stack).
- **Shared formulas** are only how Univer holds a run of formulas in memory: the file always lists each formula, and
  code that reads Univer data itself (export, scripts, version compare) never sees `si` cells (`expandSharedFormulas`).
