# Handoff — where work stands

Written by `node scripts/checkpoint.mjs` (2026-11-26T15:43:51Z). Read this first when resuming.

- Branch: `feat/sheets-univer` (from `origin/main` at `9ffbdb10a`)
- Last checkpoint: Sheets on Univer: 27 areas, tests green; started robustness pass (cell-text codec, checkpoint script)

## Resume in a new session

1. Get the code: a clone of the repository plus the bundle `folio-feat-sheets-univer.bundle`
   (sent in the chat, or saved in the Project / your folder), then `node scripts/checkpoint.mjs --restore <bundle>`.
2. `git checkout feat/sheets-univer && npm ci && npm run build`
3. Check that everything is green: `npm test` (or the Sheets tests alone: `node dist/test/sheets.test.mjs` and the others in `test/run.mjs`).
4. Read `docs/sheets/README.md` (architecture and status) and the section below.

## Next
Robustness pass on Folio Sheets (all 27 areas exist and pass their tests; area 28, AI, is out of scope):
1. **Cell values lossless** — `src/sheets/core/cell-text.js` written (apostrophe rule for text that reads as number/TRUE/formula, `&#32;` for edge blanks, `&lt;br>` for a literal tag). Wire it into `convert.js` (`cellFromRaw`/`rawFromCell`) and `renderer/sheet-core.js` (`evaluator` → `cellValue`), add the fuzz test (`/tmp/fz/fuzz.mjs` idea: 400 random grids, value + type must survive save/reload, second save identical) to `test/sheets.test.mjs`, document in `docs/FORMATS.md`.
2. **Ribbon** — `.rb-select` has `min-width: 9.5rem` that beats `width: 58px` (font size box 152 px) and 28 px selects make the Home ribbon 18 px taller than other tabs. Replace Font / Size / Number format with typeable comboboxes in `renderer/page-ribbon.js`, fixed ribbon height, re-check collapse with screenshots.
3. **Large sheets** — time convert / headless / export at 50k rows, fix hot spots.
4. **.xlsx** — export (and import) conditional formatting, data validation, freeze panes (documented gap in docs/sheets/README.md §8).
5. **Languages** — FQL: `replace`, `index`, `top`, `case when`; Folio Script: setFontSize/Family, setBorder, merge, sort, insert/delete rows, find.
6. Final: full test suite, screenshots, docs, Project doc `claude/SHEETS-PLAN.md`.

## Commits since main
- 294bb4a wip: Sheets on Univer: 27 areas, tests green; started robustness pass (cell-text codec, checkpoint script)
