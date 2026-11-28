# Project status

**As of 27 November 2026 · `main` at 1.5.1 (pre-alpha) plus the new app icon (#80) · maintainer: Gabriele Vaudano.**

This is the page to read first when you pick Folio up: what ships, what is half-built and where, what is broken, what
comes next, and what only a person can do. It is written by hand; update it in the same pull request that changes the
picture (merging a branch, closing a milestone, finding a bug). The live list of work is
[GitHub Issues](https://github.com/gabrielevaudano98/folio/issues); open work below links to an issue where one exists.

- [At a glance](#at-a-glance)
- [What ships on main](#what-ships-on-main)
- [In flight](#in-flight): open pull requests and unmerged branches
- [Known bugs on main](#known-bugs-on-main)
- [Not started](#not-started)
- [Waiting on a person](#waiting-on-a-person)
- [How to pick up work](#how-to-pick-up-work)

## At a glance

| Area | On `main` | In flight | Main gaps |
|---|---|---|---|
| App shell (files, tabs, search, undo, history, i18n) | Shipped | Search window, favourites, page actions (PR stack [#69](https://github.com/gabrielevaudano98/folio/pull/69) → [#77](https://github.com/gabrielevaudano98/folio/pull/77) → [#79](https://github.com/gabrielevaudano98/folio/pull/79)) | Linux build is in CI on this branch (first AppImage unchecked on a real desktop) |
| Pages (`.md`) | Pages Studio D0–D16 and `.asset/` attachments shipped | Notion gap waves 1–2 on the PR stack | Data bugs fixed only on #77 ([#81](https://github.com/gabrielevaudano98/folio/issues/81)) |
| Slides (`.slides.md`) | Slides Studio P0–P15 shipped (1.2.0) | — | Leftovers: video/GIF export, live captions, WordArt, rulers |
| Boards (`.board.md`) | Canvas, shape libraries, UML, auto-layout | — | Waypoints, sequence messages, images and pen |
| Sheets (`.sheet.md`) | Light grid (hot-formula-parser) | **Folio Sheets on Univer** on `feat/sheets-univer`, no PR yet | Merge plan ([#84](https://github.com/gabrielevaudano98/folio/issues/84)) |
| AI / MCP | 52 tools (board and sheet tools included), HTTP and stdio, one-click connect, per-change review, Ask AI ([#20](https://github.com/gabrielevaudano98/folio/issues/20)) | Sheet tools on the Univer branch | `set_cells` to reconcile with Univer |
| Meeting recorder (optional, Windows) | Shipped (1.5.x): one-click, call detection | — | Real-call measurements on Windows ([#88](https://github.com/gabrielevaudano98/folio/issues/88)) |
| Release | Tests and CodeQL on pull requests to `main`; Windows and macOS packages on every push to `main`; a release when `package.json` changes | 5 Dependabot PRs | Code signing and notarisation (no certificates available) |

Quality bar on `main`: `npm test` green (formats, MCP end to end, security, atomic writes, components, UI tests under
xvfb). The two performance budgets that are over: the longest task at startup and when opening a 400-section page
([budget](performance/budget.md), [#90](https://github.com/gabrielevaudano98/folio/issues/90)).

## What ships on main

Version history of what landed is in [ROADMAP.md](ROADMAP.md#shipped). By area:

- **Shell.** Open a folder; tree with drag and drop, rename, system trash; tabs; Write / Split / Read for pages and
  Visual / Split / Code for the other types; command palette (`Mod+Shift+P`), Go to note (`Mod+P`), search in all notes
  (`Mod+Shift+F`); undo and redo per tab, undo of file actions, back and forward; autosave and reload when the file
  changes on disk; export PDF, HTML and Word; version history (`.folio/history/` plus read-only git log); templates,
  template gallery and community templates; link health; English and Italian interface (i18next); Settings.
- **Pages** ([PAGES-PLAN.md](PAGES-PLAN.md); its *Progress* section is current, its feature-inventory marks are not): lossless page codec, `/` and `@` menus, `[[` links and embeds, block handles,
  callouts, toggles, columns, maths, footnotes, tables, properties and tags, templates, comments and suggestions
  (CriticMarkup), paste and import from Word, Google Docs and Notion, backlinks and unlinked mentions, find and replace,
  attachments in `.asset/`, ribbon (compact and full).
- **Slides** ([SLIDES-PLAN.md](SLIDES-PLAN.md)): free placement, arrange, text on the slide, themes and masters, templates,
  SmartArt and Design ideas, transitions, animations and Morph, links and Zoom, presenter view with audience window,
  pen and laser, narration, audience Q&A, PowerPoint in and out with native motion, handouts and PDF.
- **Boards**: draw.io-style canvas on board-md; general, flowchart, UML, ER and architecture shapes; UML connectors;
  auto-layout (dagre); PNG and SVG export.
- **Sheets (light)**: grid over Markdown tables, ~390 functions (hot-formula-parser), formats, fill, copy and paste with
  Excel, several sheets, Kanban view, charts, `.xlsx` and CSV export.
- **AI**: MCP server on `127.0.0.1:47321` with token and Host/Origin checks, stdio bridge inside the app binary, one-click
  setup for Claude Desktop, Cursor, VS Code, Windsurf, LM Studio and a command for Claude Code; 52 tools
  ([reference](reference/mcp-tools.md)); every AI write is highlighted with Undo and kept in version history.
- **Meeting recorder** ([explanation](explanation/meeting-recorder.md)): optional download, local Whisper transcription,
  notes checked against the transcript, one-click start, offer to record when a call starts.
- **Safety**: workspace boundary, atomic writes, sandboxed window with strict CSP, web images only when asked, pinned
  downloads, Electron fuses ([security](explanation/security.md), [data safety](explanation/data-safety.md)).

## In flight

Work that exists in code but is not on `main`. Nothing here ships until it is merged.

### Pages: the Notion gap (stacked pull requests)

The plan lives in the Folio project notes (`NOTION-GAP-PLAN.md`, `NOTION-EXECUTION-PLAN.md`); the pull requests carry the
summary. They are **stacked**: each one's base is the previous branch, so they merge in this order.

| Order | PR | Branch | What | State |
|---|---|---|---|---|
| 1 | [#69](https://github.com/gabrielevaudano98/folio/pull/69) | `pages-ui-notion-pass` → `main` | Chips for dates, links, people, status; date popover and Settings → Date format; callouts with icon gutter; page icon; compact `/` menu | Open since 22 Nov; has merge conflicts with `main` (`mergeable_state: dirty`): rebase on 1.5.x |
| 2 | [#77](https://github.com/gabrielevaudano98/folio/pull/77) | `notion-gap-wave1` → `pages-ui-notion-pass` | Data fixes F1–F3, shortcut/UI fixes F4–F6, Duplicate page, Move to…, Copy link, Lock page, code block Copy/Wrap, expand/collapse all | Open; **no CI has run on it** (see below); its description reports 547 checks green locally |
| 3 | [#79](https://github.com/gabrielevaudano98/folio/pull/79) | `notion-gap-wave2` → `notion-gap-wave1` | Search window on `Mod+P`, dates with time, end date and reminders, per-page appearance (font, width, cover, floating TOC) | Open; no CI has run on it; its "not done" list is tracked in [#86](https://github.com/gabrielevaudano98/folio/issues/86) |

**CI does not run on #77 and #79**: `ci.yml` and `codeql.yml` start only for pull requests whose base is `main`, so a
stacked PR is untested in CI until it is retargeted to `main` or the one below it merges. Run `xvfb-run -a npm test`
locally on each branch before merging. The stack adds 12 files to `src/` (for example `page-dates.js`, `main/locks.js`,
`main/reminders.js`, `search-window.js`): each needs a line in the [source map](reference/source-map.md), or
`test/docs-map.test.mjs` fails.

Wave 2 batch 2 is on `notion-gap-wave2b` ([#85](https://github.com/gabrielevaudano98/folio/issues/85)): Turn into page
(block menu), files dropped on a page copied into `.asset/`, Page info (menu and command, Details panel with backlinks),
Favorites and Recent in the sidebar. Still open from #85: image options and the clickable breadcrumb. Wave 3 (bulk sidebar actions, importers, backlinks mode, RTL, peek…) in [#87](https://github.com/gabrielevaudano98/folio/issues/87).

### Sheets: Folio Sheets on Univer (`feat/sheets-univer`, no pull request)

Branched from `main` at 1.4.2 (`9ffbdb1`), 21 commits named `wip: …`. A replacement of the light sheet grid by [Univer](https://github.com/dream-num/univer): Excel-grade grid, 400+ functions
in a Web Worker, pivots, charts (ECharts), queries (FQL on Arquero, optional DuckDB), scripts (QuickJS), Python
(optional Pyodide), what-if analysis, protection and encryption, `.xlsx`/`.xlsm` round trip, a separate *data engine*
process, and new MCP tools. 27 of 28 planned areas are done (area 28, an AI copilot, is out of scope for now); the
branch's own docs are `docs/sheets/README.md`, `FQL.md`, `SCRIPT.md` and `docs/HANDOFF.md`.

Before it can merge ([#84](https://github.com/gabrielevaudano98/folio/issues/84)):

- It is 21 commits ahead of and 5 behind `main` (1.5.0 and 1.5.1 landed after it branched).
- Its ADR `0011-sheets-on-univer-with-a-data-engine.md` collides with `main`'s ADR 0011 (call detection): renumber it 0012.
- It removes `src/renderer/sheet.js` and `sheet-xlsx.js` and adds about 3,500 lines to `package-lock.json`: check the
  installer size and startup budgets ([budget](performance/budget.md)) and the licences of every new package.
- Its fix for the tab-switch data-loss bug ([#82](https://github.com/gabrielevaudano98/folio/issues/82)) is now on `main`
  for pages (the page editor's delayed change and the left tab's save); the sheet half (a Univer sheet's delayed save naming
  its document) is still only in `d6ca0df`. Expect a small conflict in `app.js` `activate()` and `rich.js`.
- It adds 67 files under `src/` (`src/sheets/**`, `src/main/sheets-engine.js`, `src/renderer/sheets-components.js`): each
  needs its own line in the [source map](reference/source-map.md) (`test/docs-map.test.mjs`). It adds 4 MCP tools, so
  re-run `node scripts/docs-reference.mjs` and update the tool counts here, in [overview](overview.md) and in README.
  Expect conflicts with this documentation in `AGENTS.md`, `docs/README.md`, `docs/architecture/README.md` and `docs/reference/`.
- Squash the `wip:` commits into a few meaningful ones (engine, UI, xlsx, MCP, docs) before review.
- Already checked: a compatibility workbook (formats, 12 conditional-formatting rules, validation, filters, XLOOKUP,
  SUMIFS…) opened in Excel on Windows as expected; LibreOffice computes the same values.
- Open on the branch: live sync and presence (contracts only), visual baselines for the 93 px ribbon on macOS and
  Windows, streaming `.xlsx` export above ~200k rows, an `.xlsm` with VBA checked in Excel.

### Dependency updates

Dependabot pull requests [#71](https://github.com/gabrielevaudano98/folio/pull/71) (editor group, 19 packages),
[#72](https://github.com/gabrielevaudano98/folio/pull/72) (lucide-static), [#73](https://github.com/gabrielevaudano98/folio/pull/73)
(pixelmatch 5 → 8, a major version used by the visual tests), [#74](https://github.com/gabrielevaudano98/folio/pull/74)
(pptxtojson), [#75](https://github.com/gabrielevaudano98/folio/pull/75) (dompurify, the sanitiser: merge soon).
Dependabot allows at most 5 open npm pull requests, so **it cannot open another one, a security update included, until
one of these is merged or closed**.

### Old branches

About 30 remote branches belong to merged pull requests (`release-*`, `fix-*`, `security/*`, `slides-p10-p15`, `pages`,
`pages-studio`, `meeting-recorder`…). They can be deleted; keep `feat/sheets-univer`, the three `pages-ui-notion-pass` /
`notion-gap-wave*` branches and open Dependabot branches ([#91](https://github.com/gabrielevaudano98/folio/issues/91)).

## Known bugs on main

| Bug | Impact | Where the fix is | Issue |
|---|---|---|---|
| Bold, italic, link or code in a toggle title are lost on save (F1) | Data loss | PR #77 | [#81](https://github.com/gabrielevaudano98/folio/issues/81) |
| Resolve removes a comment thread (F2); on `main` this is the intended design ("the comments go, the text stays"), PR #77 keeps resolved threads instead | Feature gap, can surprise | PR #77 | [#81](https://github.com/gabrielevaudano98/folio/issues/81) |
| Editing a property rewrites CRLF front matter as LF (F3) | Unrelated bytes change (invariant 1) | PR #77 | [#81](https://github.com/gabrielevaudano98/folio/issues/81) |
| `Mod+Alt+C` fires two commands; a sidebar drop on a note goes to the root; the interface uses content colours (F4–F6) | UI | PR #77 | [#81](https://github.com/gabrielevaudano98/folio/issues/81) |
| Paste as plain text fails on Electron 45 (`clipboard:read`) | UI | PR #77 | [#81](https://github.com/gabrielevaudano98/folio/issues/81) |
| The same delayed-change problem in the slides, board and sheet surfaces: a change they report after a pause is applied to whichever tab is then active (the page editor is fixed). Found in review of the #82 fix; not reproduced yet | Possible data loss | Needs surfaces to name their document, as `d6ca0df` does for sheets | [#82](https://github.com/gabrielevaudano98/folio/issues/82) |
| Startup and opening a long page go over the 100 ms budget | Responsiveness | — | [#90](https://github.com/gabrielevaudano98/folio/issues/90) |

## Not started

Each is an open issue with its milestone. The ones that matter most for a first public release are in bold.

- Release workflow without a third-party publish action ([#83](https://github.com/gabrielevaudano98/folio/issues/83)).
- Signed and notarised builds for macOS ([#3](https://github.com/gabrielevaudano98/folio/issues/3)) and Windows
  ([#4](https://github.com/gabrielevaudano98/folio/issues/4)): **not possible for now, there are no certificates**; kept open only for the day they exist.
- Auto-update ([#2](https://github.com/gabrielevaudano98/folio/issues/2)) is built, see [updates](explanation/updates.md); it needs a manual check on Windows after the first release that carries `latest.yml`.
- Accessibility audit of the board canvas and the sheet grid ([#6](https://github.com/gabrielevaudano98/folio/issues/6)).
- Boards: connector waypoints ([#11](https://github.com/gabrielevaudano98/folio/issues/11)), sequence messages
  ([#12](https://github.com/gabrielevaudano98/folio/issues/12)), images and pen ([#13](https://github.com/gabrielevaudano98/folio/issues/13)).
- Slides leftovers: incremental lists ([#9](https://github.com/gabrielevaudano98/folio/issues/9)), rulers and guides
  ([#92](https://github.com/gabrielevaudano98/folio/issues/92)), per-word styling and WordArt ([#93](https://github.com/gabrielevaudano98/folio/issues/93)),
  screen recording, screenshots and 3D ([#94](https://github.com/gabrielevaudano98/folio/issues/94)), background removal
  ([#95](https://github.com/gabrielevaudano98/folio/issues/95)), live captions ([#96](https://github.com/gabrielevaudano98/folio/issues/96)),
  video/GIF/image export ([#97](https://github.com/gabrielevaudano98/folio/issues/97)).
- More chart types and axis titles ([#17](https://github.com/gabrielevaudano98/folio/issues/17)).
- Meeting recorder on macOS (system sound capture) ([#89](https://github.com/gabrielevaudano98/folio/issues/89)).

Sheet issues [#7](https://github.com/gabrielevaudano98/folio/issues/7), [#14](https://github.com/gabrielevaudano98/folio/issues/14),
[#15](https://github.com/gabrielevaudano98/folio/issues/15) and [#16](https://github.com/gabrielevaudano98/folio/issues/16)
are done on the Univer branch and close when it merges.

## Waiting on a person

Things an agent cannot do from a cloud machine.

| What | Who | Why it blocks | Issue |
|---|---|---|---|
| Record a real one-hour Teams call on Windows with headphones and read `worker_peak_mb`, `app_peak_mb`, `transcription_speed` from the note | Maintainer | The recorder's go/no-go gates and the Whisper vs Parakeet choice | [#88](https://github.com/gabrielevaudano98/folio/issues/88) |
| Turn on *Offer to record when a call starts* and join a call | Maintainer | Call detection is tested only with sample data | [#88](https://github.com/gabrielevaudano98/folio/issues/88) |
| Buy or set up signing (Apple Developer ID, a Windows route such as Azure Trusted Signing) and add the secrets | Maintainer | Unsigned builds warn on first open | [#3](https://github.com/gabrielevaudano98/folio/issues/3), [#4](https://github.com/gabrielevaudano98/folio/issues/4) |
| Open an `.xlsm` with VBA through Folio Sheets and back in Excel | Maintainer | Last unchecked Excel round trip | [#84](https://github.com/gabrielevaudano98/folio/issues/84) |
| Decide merge order: the Notion PR stack and the Univer branch both change `app.js`, `page-ribbon.js` and the locales | Maintainer | Whichever merges second needs a rebase | [#84](https://github.com/gabrielevaudano98/folio/issues/84) |

## How to pick up work

1. Read [`AGENTS.md`](../AGENTS.md) (invariants, map, commands), then this page, then the issue you are taking.
2. `npm ci && npm run build && npm test` (on Linux `xvfb-run -a npm test`). Everything must be green before you start.
3. Find your way in the code with the [source map](reference/source-map.md) and [how the editors work](explanation/editors.md).
4. Work on a branch from `main`. If you continue an in-flight branch, read its pull request description and, for Sheets,
   `docs/HANDOFF.md` on that branch.
5. A change to a file format updates [FORMATS.md](FORMATS.md) and adds a round-trip test in `test/formats.test.mjs`.
   A change to MCP tools, IPC or the component catalog is followed by `node scripts/docs-reference.mjs`. A new file in
   `src/` gets a line in the source map. New interface text goes through [i18n](how-to/add-ui-text.md).
6. Open a pull request against `main` (a PR on another base gets no CI); CI runs the tests, cubic and CodeAnt review it,
   and the maintainer merges. `main` has no branch protection: do not push to it directly.
   A merge that changes the version in `package.json` publishes a release ([how-to](how-to/release.md)).
7. Update this page and close or comment on the issue.
