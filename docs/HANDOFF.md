# Handoff — where work stands

Written by `node scripts/checkpoint.mjs` (2026-11-28T01:19:44Z). Read this first when resuming.

- Branch: `feat/sheets-univer` (from `origin/main` at `9ffbdb10a`)
- Last checkpoint: sheets: incremental recalculation (dependency trees reused, partial rebuild of changed formulas), formula cache emptied on name/sheet/table changes (fixes a stale value), first screen of a big workbook computed first (visible values 9.4 s -> 2.0 s); fuzz and preview tests

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

9. ~~**MCP tools on workbooks**~~ DONE: `src/sheets/engine/book.js` (values, refresh, macro) behind `sheets-engine.callFor`;
   tools `run_sheet_query`, `sheet_goal_seek`, `refresh_sheet`, `run_sheet_macro`; `get_sheet_values` returns computed
   values. pivot.js has no top-level await any more (jquery-lite alias, `src/sheets/core/jquery-lite.cjs`).

10. ~~**Settings → data components**~~ DONE: `src/renderer/sheets-components.js`; `sheets:components` carries name,
   licence and attribution from the catalog; en/it texts `sc.*`; test/sheets-components-ui.test.mjs (DuckDB made to look
   installed by its marker file; Remove behind a confirmation). Full `npm test` green under xvfb (586 checks).

11. ~~**Real downloads**~~ DONE: DuckDB and Pyodide downloaded for real (cancel at 30 %, resume with a Range request,
   damaged file refused); Cancel while checking/unpacking is honoured; engine errors name "Spreadsheet data components"
   and are translated (`engine-client.js`). Opt-in test/sheets-components-e2e.test.mjs (`FOLIO_COMPONENTS_READY` when
   Chromium cannot verify the proxy's certificate, as in the cloud sandbox).

12. ~~**Excel check**~~ DONE: `Folio-Compat.xlsx` (formats, 12 conditional-formatting rules, validation, freeze, filter,
   tab colours, hidden sheet, notes, names, XLOOKUP/SUMIFS/TEXT…) opened by the user in Excel on Windows: everything as
   expected. Not yet checked in Excel: an .xlsm with VBA through Folio and back. Fixed from the file itself: `_xlfn.` prefixes both ways, tab colour,
   hidden sheets, zoom, gridlines, filter range, `fullCalcOnLoad`. LibreOffice recomputes the same values.

13. ~~**Stability and speed**~~ DONE (see README §7 phase 4f and §8 "Large sheets"): opt-in test/sheets-stress.test.mjs,
   opt-in test/sheets-fuzz.test.mjs (seeded random edits; 750 runs clean after the sheet-name fix). Dev-only harness
   step `{ profile: 'start' | 'stop', profileOut }` writes a CPU profile (src/main/main.js devShot).

14. ~~**Tab switching**~~ DONE (README §8 "Large sheets"): hidden-workbook cache in src/sheets/ui/surface.js
   (`kept`, `KEEP_HIDDEN=2`, `KEEP_TEXT=8 MB`, `forget` on tab close), saves routed by tab object (`backgroundChange`
   in app.js), `drawQuietly`. Tests: test/sheets-tabs.test.mjs, test/tab-switch-save.test.mjs.

15. ~~**Values kept between sessions**~~ DONE (README §8 "Large sheets"): src/sheets/ui/value-cache.js, hooked in surface.js
   (`applyValues` on load, `storeValues` 2.5 s after the worker's results stop). File format unchanged. First open of the
   50k-row workbook after a previous one: numbers at once (was ~10 s). Known cost: a small workbook reloaded while the big
   one is hidden waits >3 s for its formulas (worker queue). Decided not to touch the ~3 s recalculation (Univer's dependency tree).

16. ~~**Where the calculation time goes**~~ DONE (README §8): measured per formula count (2k → 50 ms … 100k → 3.5 s per edit),
   profiled (Univer re-reads every formula per recalculation; no upstream fix in 1.6.2), "Calculating…" note after 0.4 s
   (src/sheets/ui/surface.js `busyEl`, test in sheets-ui). Window thread during edits is fine (3 long tasks in 12 edits).
   If this must get faster: an own incremental recalculation or an AST cache in Univer's generator, both with a fuzz
   comparison against full recalculation before shipping.

17. ~~**Recalculation 2–4× faster**~~ DONE (README §8 "Compiled-formula cache"): the cause was Univer's AST cache (5,000 entries)
   being evicted before reuse above 5,000 formulas; `src/sheets/core/formula-cache.js` raises it to 120k (worker, headless,
   window). In the app (50k rows): edit recalculation 2.6–3.1 s → 0.75–1.7 s. `test/sheets-formula-cache.test.mjs`
   (same random edits on stock vs tuned engine, identical values) is in `npm test`; benchmark `scripts/sheets-bench.mjs`.
   **Next for speed:** opening a 50k-row workbook is still ~9 s (worker builds the trees from scratch; ~3 s of it first
   calculation), a small workbook reloaded behind a big one still waits in the worker queue, and the remaining per-edit cost
   is building dependency trees (~0.5 s at 50k formulas, object construction). Ideas: measure the open phases, give a
   hidden big workbook a lower priority, evaluate keeping the dependency trees (needs the same fuzz comparison).

Open next (not started): live sync and presence (contracts ready, §5 of docs/sheets/README.md); area 28 (AI) when
decided; visual baselines on macOS/Windows for the fixed 93px ribbon; streaming xlsx export above ~200k rows.

## Commits since main
- b6242f6 wip: sheets: incremental recalculation (dependency trees reused, partial rebuild of changed formulas), formula cache emptied on name/sheet/table changes (fixes a stale value), first screen of a big workbook computed first (visible values 9.4 s -> 2.0 s); fuzz and preview tests
- c7df057 wip: sheets: Univer's compiled-formula cache raised (recalculation 2-4x faster, identical values by fuzz); bench script, handoff
- cd17ca7 wip: --help
- edf453f wip: sheets: measured calculation cost per formula count, 'Calculating…' note for recalculations over 0.4 s, docs
- aa7abfc wip: sheets: computed values of big workbooks kept between sessions (reopen shows numbers at once instead of ~10 s); value-cache tests
- a3ea89e wip: sheets: keep recent workbooks loaded across tab switches (1.5 s -> ~50 ms, flat memory); fix tab-switch save routing; undo-safe chart drawing
- d6ca0df wip: fix data loss on fast tab switch: a sheet's delayed save and the page editor's delayed change went into the tab shown next (a note or sheet overwritten); saves now name their document, pending work is flushed and the left tab written before switching; test/tab-switch-save.test.mjs
- 7a36a37 wip: Excel check passed on Windows (Folio-Compat.xlsx)
- 988613e wip: stability pass: edits 200 ms -> 1 ms (no file re-parse per edit), worker results/cell editor/chart drawing no longer count as edits, duplicate sheet names refused, worker heartbeat, hidden editor skipped for visual docs; stress, fuzz and real-download tests (opt-in); full suite green
- 0242bf3 wip: xlsx: _xlfn prefixes both ways (XLOOKUP, FILTER, IFS, TEXTJOIN… no #NAME? in Excel or Folio), tab colour, hidden sheets, zoom, gridlines, filter range both ways, full recalculation on open
- a5e8fce wip: components: Cancel honoured while checking/unpacking (verified files kept), engine errors name the right Settings section and are translated; real-download e2e test (opt-in)
- 630985a wip: docs: handoff and plan status after data components
- da78013 wip: Sheets: Settings section for data components (DuckDB, Pyodide) with status, licences, download/cancel/remove; docs
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
