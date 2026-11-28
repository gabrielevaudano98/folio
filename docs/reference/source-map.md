# Source map

Every file under `src/`, what it does, and whether it is a **core** (pure: no DOM, no Electron, tested in Node) or a
**surface** (draws and edits in the window). `test/docs-map.test.mjs` fails when a file in `src/` has no row of its own
in the table of its folder, so this list cannot fall out of date unnoticed. For the processes these files run in, see
[process model](../explanation/process-model.md); for how the editors fit together, see [editors](../explanation/editors.md).

Sizes are approximate (November 2026) and only there to show where the weight is.

## Main process — `src/main/`

Node.js inside Electron. Owns the window, the disk, the network and the MCP server. Bundled by `build.mjs` into
`dist/main.mjs`.

| File | Kind | Responsibility |
|---|---|---|
| `boot.js` | entry | One binary, two jobs: starts the app (`main.js`), or the stdio MCP bridge when run with `--mcp-stdio`. |
| `main.js` | composition root (~800 lines) | Settings (`settings.json`, batched atomic writes), window and its lockdown, workspace and file watcher (chokidar), every IPC handler (`h()`), renderer round-trips for app-only MCP tools, the MCP HTTP server on 127.0.0.1, one-click connection to AI apps, native menu, lifecycle and crash recovery. |
| `updater.js` | core (injected Electron) | Update checks and installs from GitHub releases through electron-updater: which builds can install, the state machine, the `update:*` handlers. See [updates](../explanation/updates.md). |
| `preload.cjs` | bridge | The window's only door to the system: exposes `window.folio` (requests and events). See [IPC](ipc.md). |
| `notes.js` | core (Node fs) | Every file operation: `resolve()` checks that a path stays inside the workspace, then tree, read, write, rename/move with link rewriting, search, backlinks. Shared by the app, the HTTP MCP server and the stdio bridge. (Moving to the system trash is `fs:trash` in `main.js`.) |
| `atomic.js` | core | Atomic writes: temp file in the same folder, flush, rename ([ADR 0008](../adr/0008-atomic-writes.md)). |
| `assets.js` | core (Node fs) | The hidden `.asset/` folder beside each page: content-hashed copies of pictures and attachments, unused/missing checks, refusal of folders that link outside. |
| `duplicate.js` | core (Node fs) | Duplicate a page or a folder of pages next to the original: every attachment gets its own copy in the copy's `.asset`, links stay as written; atomic, removes only what it made on failure. |
| `locks.js` | core (Node fs) | Locked pages, kept per workspace in the app settings (never in the `.md`); read by the window, the MCP write gate and the stdio bridge. |
| `reminders.js` | core (Node fs) | Reminders: finds `[[day]]{… remind …}` mentions in the workspace, fires each once while Folio is open (OS notification and toast); states kept in settings, never in the `.md`. |
| `history.js` | core (Node fs) | Version history in `<workspace>/.folio/history/`: content-addressed gzip objects plus an index per document. |
| `history-diff.js` | core | Line diff helpers for the history view (also used by the window). |
| `git-log.js` | core | Read-only `git log` / `git show` for a page, for the version timeline. |
| `critic-text.js` | core | CriticMarkup (comments, suggestions) on plain text, shared by the editor, the Read view and MCP tools. |
| `page-tools.js` | core | Section-level Markdown edits for AI tools: find a section by heading or `^block-id`, replace, insert after. |
| `mcp-tools.js` | core | The MCP tool table (zod schemas, descriptions, read/write flags) and `runTool()`; one table for both hosts. See [MCP tools](mcp-tools.md). |
| `mcp-slides.js` | core | Slide-specific MCP tools (objects, motion, links, alt text, notes, design ideas). |
| `mcp-board-sheet.js` | core | Structured MCP tools for boards (shapes, connectors, layout) and sheets (cells, sheets). |
| `ai-requests.js` | core | Queue of requests the user writes with "Ask AI"; assistants read and close them over MCP. |
| `netguard.js` | core | Is an address loopback or private? Guards every remote image fetch. |
| `permissions.js` | core | Which browser permissions the app page gets (microphone only). |
| `qa.js` | main | Audience Q&A web page on the local network, only while the presenter has it open. |
| `features/catalog.js` | core (data) | Optional features and the pinned components they download (address, SHA-256, size, licence). See [components](components.md). |
| `features/installer.js` | main | Resumable, hash-checked, atomic download and install of catalog components. |
| `features/unpack.js` | core | Reads `.tgz`/`.zip` in memory and decides which entries are safe to write. |
| `meeting/service.js` | main | Optional-features service: installs, the meeting session, the memory guard; IPC for Settings. |
| `meeting/asr-worker.js` | utilityProcess | Voice detection (Silero) and transcription (Whisper via sherpa-onnx) for one recording; bundled as `dist/meeting-asr.cjs`. |
| `meeting/transcript.js` | core | Segments in, Markdown transcript out; de-duplication of echoed lines. |
| `meeting/notes-core.js` | core | Builds the prompt and checks the model's notes against the transcript (quote must be on the cited line). |
| `meeting/notes-engine.js` | main | Starts `llama-server` as a child process for one meeting, asks it for notes, stops it. |
| `meeting/mic-watch.js` | main (Windows) | Notices when another app holds the microphone (a call) by reading the consent store with `reg query`. |
| `meeting/threads.js` | core | How many CPU threads the speech model may use (2 to 5). |

## MCP bridge — `src/mcp/`

| File | Kind | Responsibility |
|---|---|---|
| `stdio.js` | entry | Stdio MCP server started by AI apps. Relays to the running app over HTTP, or works directly on the last folder when Folio is closed. Bundled as `dist/mcp-stdio.mjs`. |

## Window — `src/renderer/`

A sandboxed Chromium page with no Node.js. Bundled by esbuild with code splitting: the slides, board and sheet editors
are separate chunks loaded on first use ([ADR 0009](../adr/0009-lazy-visual-editors.md)).

### Shell and shared services

| File | Kind | Responsibility |
|---|---|---|
| `index.html` | markup | The window's static layout: title bar, sidebar, tabs, panes, docks, sheets. |
| `app.js` | surface (~2,600 lines) | The shell: boot, theme, tree and tabs, view switch (Write/Split/Read, Visual/Code), open and save, surfaces' host context, AI edit banner and undo, command palette, settings, export, templates, back/forward, undo routing, assets prompts, toasts and menus. |
| `editor.js` | surface | CodeMirror 6 tuned for prose: the source view of every document type. |
| `markdown.js` | core-ish | Markdown to sanitised HTML (markdown-it + DOMPurify) for the Read view and exports, with source-line anchors and AI-edit marks; Mermaid, KaTeX, charts. |
| `history.js` | core | Per-document undo stacks for the surfaces and the file-action undo stack. |
| `history-view.js` | surface | Version history as a mode: compare, restore, name a version. |
| `i18n.js` | shared | i18next set-up and `t()`; language remembered in local storage. See [add interface text](../how-to/add-ui-text.md). |
| `locales/en.js` | data | English catalogue, the source of truth for every string the app shows. |
| `locales/it.js` | data | Italian catalogue; missing keys fall back to English. |
| `icons.js` | data | Folio's own line icons (16 px grid, `currentColor`). No icon font, no emoji. |
| `fuzzy.js` | core | Fuzzy matching for the palette and the `/`, `@`, `[[` menus. |
| `search-core.js` | core | The search window's pure core: query words and quoted phrases, content snippets, ranking and sorts, recent-pages groups, the Date and Created by filters. Shared with the main process. |
| `search-window.js` | surface | The search window on Ctrl+P: recent pages, title and content results with snippets, filters (folder, Date, Created by), sorts (Best match, Last edited, Created), read-only preview. |
| `recents.js` | core | Recently opened pages per folder (window storage): one store for the search window and the sidebar's Recent list. |
| `refs-syntax.js` | core | Reference syntax between documents: `[[Doc#part]]`, `{{Doc#part}}`, `![[Doc#part]]`; rename rewriting; unlinked mentions. |
| `refs.js` | core | Resolves a reference to a value or an embed and fills placeholders in rendered HTML; also imported by `main/mcp-tools.js` for `resolve_ref`. |
| `chart.js` | core | One chart spec (```` ```chart ````) drawn as SVG in pages, slides and sheets. |
| `callouts.js` | core | Callout types (GitHub and Obsidian), aliases, Notion-style icon and colour. |
| `tokens.css` | design tokens | Every colour, font, radius, shadow and motion value. See [design system](../explanation/design-system.md). |
| `styles.css` | styles | The shell's and the page editor's styles, built only on tokens. |
| `meeting.js` | surface | Meeting recorder in the window: Settings section, audio capture, recording bar. Loaded on demand. |
| `meeting-worklet.js` | audio thread | AudioWorklet: mono 16 kHz, 100 ms Int16 blocks to the worker. Copied as is into `dist/`. |
| `template-gallery.js` | surface | Template gallery: browse, search, preview, favourites, community templates. |
| `template-starters.js` | data | The template collection that ships with Folio. |

### Pages (`.md`)

| File | Kind | Responsibility |
|---|---|---|
| `rich.js` | surface (~1,250 lines) | The Write view: TipTap 3 (ProseMirror) with Markdown in and out, node views, bubble menu, chips, pickers, block handles. |
| `page-core.js` | core | Lossless page codec: splits a page into top-level blocks, keeps what the editor cannot hold as raw blocks, rewrites only changed blocks on save (markdown-it as the oracle). |
| `page-schema.js` | core | The TipTap extensions that define what a page can hold; shared by the editor and the format tests. |
| `page-syntax.js` | core | Syntax beyond CommonMark (sub/superscript, maths, footnotes, colour, alignment, hidden comments, toggles, columns…) and how each reads and writes Markdown. |
| `page-blocks.js` | surface | Notion-style block handle, `+`, block menu, block keyboard commands. |
| `page-table.js` | core + surface | GFM tables: grips, insert/move/sort, paste from spreadsheets, "Open as sheet". |
| `page-ui.js` | surface | Callout menus and fold, collapsible headings, live TOC, breadcrumb, page break. |
| `page-ribbon.js` | surface | The page ribbon: compact one-row layout and full Word-style tabs. |
| `inserts.js` | data + logic | Everything you can insert, in one registry read by the `/` menu, `@` menu and palette. |
| `page-mentions.js` | core | What the `[[`, `@`, `#` and `:` pickers offer (pages, people, dates, tags, emoji). |
| `page-props.js` | core | YAML front matter as typed properties; edits rewrite only that property's lines. |
| `page-props-ui.js` | surface | The Properties panel above the title. |
| `page-dates.js` | core | How a day link (`[[2026-11-23]]`) is shown: Today, Friday, 3 Dec…; parsing of typed dates. The file keeps the ISO day. |
| `page-date-ui.js` | surface | The date popover of a day chip: natural-language field, quick picks, month grid, open the daily note, remove. |
| `page-icon.js` | surface | Emoji picker for the page icon and callouts: search, categories, random, remove. |
| `page-when.js` | core | A date mention with time, end date and reminder (`[[2026-12-01]]{09:00 → 10:30 remind 30m}`): parse and write. |
| `page-appearance.js` | core | Per-page appearance in front matter (`font`, `small-text`, `full-width`, `toc`, `cover`, `cover-y`), each line written only when not the default. |
| `page-appearance-ui.js` | surface | The Appearance popover, the cover picker and the floating table of contents. |
| `page-critic.js` | core | Comments and suggestions in CriticMarkup: list, accept, reject, thread. |
| `page-review.js` | surface | Review pane: comment threads and suggestions beside the text. |
| `page-reactions.js` | core | Emoji reactions and mentions in comments, without new syntax. |
| `page-find.js` | surface | Find and replace in the Write view. |
| `page-outline.js` | core | Sections of a page (heading plus content) for the outline, moves and AI tools. |
| `page-info.js` | core | The Info tab: counts, reading time, file facts. |
| `page-help.js` | core | The help sheet: shortcuts and syntax. |
| `page-templates.js` | core | Templates: variables, prompts, merge into a page. |
| `page-paste.js` | surface helper | Paste and import: HTML from Word, Google Docs, Notion and the web to clean Markdown (turndown), as a TipTap extension. |
| `page-docx.js` | surface helper | Word export (docx) with real Word structure, tracked changes for suggestions; PDF page setup. |

### Slides (`.slides.md`)

| File | Kind | Responsibility |
|---|---|---|
| `ai-hunks.js` | core | Per-change review of an AI edit: split a diff into hunks, accept or reject one. |
| `slides-core.js` | core | slides-md engine (Marp superset): split, directives, layouts, render a slide to HTML. |
| `slides-objects.js` | core | Placed objects (`::: box #id x= y= …`): parse, serialise, geometry. |
| `slides-motion.js` | core | Transitions and animations as slides-md lines. |
| `slides-templates.js` | core | Slide templates: theme tokens, masters with placeholders, variants. |
| `slides-designer.js` | core | Design ideas: rule-based layouts for one slide. |
| `slides-smartart.js` | core | SmartArt-style diagrams from a Markdown list. |
| `slides-a11y.js` | core | Accessibility checker for a deck. |
| `slides.js` | surface (~1,350 lines) | The slide editor: thumbnails, stage, panels, insert, format, export menu. |
| `slides-canvas.js` | surface | Select, move, resize, rotate, snap (Moveable + Selecto); each gesture is one text edit. |
| `slides-text.js` | surface | Edit a box's text on the slide with a lean TipTap editor. |
| `slides-anim-pane.js` | surface | The Animations pane. |
| `slides-merge.js` | surface helper | Merge shapes (union, intersect, subtract) with polygon-clipping. |
| `slides-present.js` | surface | The slide show: build steps, transitions, Morph. |
| `slides-presenter.js` | surface | Presenter view and audience window; pen, laser, Q&A, timer. |
| `slides-handouts.js` | surface helper | Handouts and notes pages as one HTML document for PDF. |
| `slides-pptx.js` | surface helper | PowerPoint export at 1:1 (measures the rendered slide, pptxgenjs). |
| `slides-pptx-motion.js` | core | Transitions and animations as PowerPoint XML, both ways. |
| `slides-import.js` | surface helper | `.pptx` and `.potx` import (pptxtojson plus the package's own XML). |
| `slides-icons.js` | data | Lucide icons for slides, loaded on first use. |
| `slides.css` | styles | Slide editor and show styles. |

### Boards (`.board.md`) and sheets (`.sheet.md`)

| File | Kind | Responsibility |
|---|---|---|
| `board-core.js` | core | board-md: shapes, connectors, library, auto-layout (dagre), SVG of each shape. |
| `board.js` | surface | draw.io-style canvas over board-md. |
| `sheet-core.js` | core | sheet-md: Markdown tables as sheets, formulas (hot-formula-parser), formats. |
| `sheet.js` | surface | Excel-style grid, Kanban view, CSV/XLSX export. |
| `sheet-xlsx.js` | surface helper | sheet-md to a real `.xlsx` (JSZip); formulas stay formulas. |

> The sheet files above are what ships on `main`. The `feat/sheets-univer` branch replaces `sheet.js` and
> `sheet-xlsx.js` with `src/sheets/` (Univer). See [status](../STATUS.md#in-flight).

## Built-in slide templates — `src/templates/`

`Corporate`, `Editorial`, `Folio`, `Graphite`, `Mono`, `Pitch`, `Studio`, `Swiss` (`*.slides.md`): the decks the template
gallery offers. They are imported as text into the bundle. How to write one: [TEMPLATES.md](../TEMPLATES.md).

<!-- docs-map: src/templates/Corporate.slides.md src/templates/Editorial.slides.md src/templates/Folio.slides.md src/templates/Graphite.slides.md src/templates/Mono.slides.md src/templates/Pitch.slides.md src/templates/Studio.slides.md src/templates/Swiss.slides.md -->
