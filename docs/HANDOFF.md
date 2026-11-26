# Handoff — where work stands

Written by `node scripts/checkpoint.mjs` (2026-11-26T21:16:34Z). Read this first when resuming.

- Branch: `feat/sheets-univer` (from `origin/main` at `9ffbdb10a`)
- Last checkpoint: Sheets: Settings section for data components (DuckDB, Pyodide) with status, licences, download/cancel/remove; docs

## Resume in a new session

1. Get the code: `git fetch origin feat/sheets-univer && git checkout feat/sheets-univer` (pushed at every checkpoint); without access to
   GitHub, a clone plus the bundle `folio-feat-sheets-univer.bundle`
   (sent in the chat, or saved in the Project / your folder), then `node scripts/checkpoint.mjs --restore <bundle>`.
2. `git checkout feat/sheets-univer && npm ci && npm run build`
3. Check that everything is green: `npm test` (or the Sheets tests alone: `node dist/test/sheets.test.mjs` and the others in `test/run.mjs`).
4. Read `docs/sheets/README.md` (architecture and status) and the section below.

## Next
Robustness pass on Folio Sheets (all 27 areas exist and pass their tests; area 28, AI, is out of scope):
1. ~~**Cell values lossless**~~ DONE (fuzz in test/sheets.test.mjs, rule in FORMATS.md) — `src/sheets/core/cell-text.js` written (apostrophe rule for text that reads as number/TRUE/formula, `&#32;` for edge blanks, `&lt;br>` for a literal tag). Wire it into `convert.js` (`cellFromRaw`/`rawFromCell`) and `renderer/sheet-core.js` (`evaluator` → `cellValue`), add the fuzz test (`/tmp/fz/fuzz.mjs` idea: 400 random grids, value + type must survive save/reload, second save identical) to `test/sheets.test.mjs`, document in `docs/FORMATS.md`.
2. ~~**Ribbon**~~ DONE (combos in page-ribbon.js, fixed height, 4 new checks in test/sheets-ui.test.mjs; run test/visual.test.mjs: baselines may need refreshing because the ribbon is now a fixed 93px) — `.rb-select` has `min-width: 9.5rem` that beats `width: 58px` (font size box 152 px) and 28 px selects make the Home ribbon 18 px taller than other tabs. Replace Font / Size / Number format with typeable comboboxes in `renderer/page-ribbon.js`, fixed ribbon height, re-check collapse with screenshots.
3. ~~**Large sheets**~~ DONE in part. Measured at 50k rows × 7 cols: open (convert) 1.6 s → 0.24 s; first save no longer
   recomputes untouched sheets (cache by sheet id in fromUniver); debounce adapts to save time; runs of formulas such as
   =D2*E2 are opened as Univer shared formulas (`si`, `shareFormulas` in convert.js, guarded by `shareable()` and a test
   that compares files and values with and without sharing) → edit recalculation 1.6 s → 0.95 s; headless engine gives a
   fresh unit id to a reused id (stale validation rules leaked between runs). **Still open:** Univer rebuilds its
   dependency tree on every edit (~1 s at 50k formulas, on the window's thread). Next: formula engine in a Web Worker
   (`@univerjs/rpc` is installed: UniverRPCMainThreadPlugin + worker with UniverRemoteSheetsFormulaPlugin); custom
   functions (async, call the data engine) and the audit panel (getCellDependencyTree) must then go through the worker.
4. ~~**.xlsx**~~ DONE: conditional formatting both ways (`src/sheets/engine/xlsx-cf.js`, 14 rule kinds, checked in LibreOffice too); validation and freeze were already exported. Shared formulas never reach code that reads cellData itself (`toUniver` shares only with `share: true`; `expandSharedFormulas` for snapshots).
5. ~~**Languages**~~ DONE: FQL `case when`, `replace`, `index`, `top`, `merge`, `split … into rows`, `transpose`, `transform`, 13 new functions, `\d` kept in strings (test/fql.test.mjs); Folio Script: fonts, borders, merge, sort, find, rows/columns, widths, freeze, rename/delete sheet; replay shared in `src/sheets/core/replay.js` and tested on the headless engine.
6. ~~Final~~ DONE: full `npm test` green under xvfb. It found that opening Budget.sheet.md in the window rewrote it
   (an empty Univer OLE resource and a chart's default position were written): fixed (`deepEmpty` in convert.js,
   `DEFAULT_AT` in charts.js). Docs updated: docs/sheets/README.md (= Project doc `claude/SHEETS-PLAN.md`), FQL.md,
   SCRIPT.md, FORMATS.md.

7. ~~**Formula worker**~~ DONE: `src/sheets/ui/formula-worker.js` (bundled as dist/renderer/sheets-formula-worker.js,
   checked to load from app.asar with the app's CSP and sandbox). Custom functions: window sends names over a
   MessageChannel, worker asks the window for values (Univer 1.6 refuses remote function code). Save baseline computed
   in the worker; saves read Univer's live model (`surface.liveSnapshot`). 50k rows in the app: edit 0–130 ms, save
   after a pause ~0.35 s. Test step 14 in test/sheets-ui.test.mjs (UDF, audit, validation formula, SUBTOTAL+filter);
   the same suite passes with `localStorage['folio.sheets.worker'] = 'off'`.

8. ~~**Save in slices**~~ DONE: `serializeWorkbookSteps` (renderer/sheet-core.js) and `sheetSteps`/`fromUniverSteps`
   (convert.js) are generators; `fromUniver` drains them, `fromUniverAsync` runs ~8 ms slices and gives up when the
   workbook changes. The window uses it when the last save took > 40 ms (surface.js `save()`); `saveNow()` cancels a
   sliced save in progress. 50k rows: no main-thread pause from saving; 200k rows work (spreads removed).

Open next (in order): visual baselines if the fixed 93px ribbon height
changes them on macOS/Windows; MCP tools for queries, pivots and scripts; area 28 (AI) when decided.

## Commits since main
- 0e61091 wip: Sheets: Settings section for data components (DuckDB, Pyodide) with status, licences, download/cancel/remove; docs
- 1c44d31 wip: MCP: values from Univer, run_sheet_query, sheet_goal_seek, refresh_sheet, run_sheet_macro; workbook jobs in the data engine; jquery-lite (no DOM for pivots)
- 917f9f5 wip: large exports: no stack overflow past 120k rows (loops everywhere), 200k-row xlsx export 8.9 s -> 5.9 s
- e245040 wip: save in slices that yield to typing; writer and converter as steps; 200k rows without stack overflow; full suite green
- 292882b wip: formulas in a Web Worker: custom functions through the window, save baseline in the worker, saves from the live model; full suite green
- f995079 wip: full suite green; opening a sheet with a chart no longer rewrites it; docs updated
- f5351dd wip: languages: FQL case/replace/index/top/merge/split rows/transpose/transform + functions; Folio Script formats, borders, sort, find, rows, freeze, rename; shared replay
- 7ee70ab wip: xlsx: conditional formatting exported and imported (14 rule kinds); shared formulas kept out of export and scripts
- 34fcb3c wip: large sheets: 6x faster open, per-sheet save cache, shared formulas, fresh unit ids in the headless engine
- 4abfa4b wip: ribbon: Excel-style combo boxes (font, size, number format with previews), same height on every tab
- 6b505ff wip: cell values lossless: apostrophe rule and entities, fuzz test through Univer
- 75254bf wip: handoff next steps
- 574e3ee wip: Sheets on Univer: 27 areas, tests green; started robustness pass
