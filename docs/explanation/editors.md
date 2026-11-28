# How the editors work

Folio has four document types and one rule for all of them: **the Markdown file is the document**. An editor is a view
over the text that turns each gesture into the smallest possible text change. This page explains how that is built,
for developers changing an editor. File-by-file detail is in the [source map](../reference/source-map.md); syntax is in
[FORMATS.md](../FORMATS.md).

## Core and surface

Every type is split in two:

- a **core**: pure functions `parse(text) → model` and `serialize(model) → text`, with no DOM and no Electron, run by
  the format tests in Node. A core must give back the same bytes for a document it did not change, and change only the
  lines of what was edited (invariant 1 in [AGENTS.md](../../AGENTS.md));
- a **surface**: the editor in the window, which draws the model and calls the core to write the edits.

| Type | Core | Surface | Main libraries |
|---|---|---|---|
| Page `.md` | `page-core.js`, `page-schema.js`, `page-syntax.js` | `rich.js` (+ `page-*.js`) | TipTap 3 (ProseMirror), markdown-it |
| Deck `.slides.md` | `slides-core.js`, `slides-objects.js`, `slides-motion.js` | `slides.js` (+ `slides-*.js`) | Moveable, Selecto, pptxgenjs, pptxtojson |
| Board `.board.md` | `board-core.js` | `board.js` | dagre |
| Sheet `.sheet.md` | `sheet-core.js` | `sheet.js` | hot-formula-parser, JSZip |

The **code view** of every type is the same CodeMirror editor (`editor.js`). The **Read view** of pages and the
exports go through `markdown.js` (markdown-it, DOMPurify, KaTeX, Mermaid, charts).

## How the shell hosts an editor

`app.js` decides the type from the file name (`docType()`), then:

- for a page, it shows the CodeMirror source and/or the TipTap Write view (`Mod+1` Write, `Mod+2` Split, `Mod+3` Read);
- for the other types, it loads the surface module on first use (`loadSurface()`, a separate esbuild chunk,
  [ADR 0009](../adr/0009-lazy-visual-editors.md)) and mounts it once with a **context** object (`surfaceCtx()`).

The context is the whole contract between a surface and the app. A surface calls `ctx.onChange(text, tab)` when its
document changes, where `tab` is the `docKey()` it was given that document with, and receives text with `setText(text)`;
it never touches files itself. It also has `flush({ keepEditing })`, which writes at once whatever is still waiting
(slide notes and slide text after a pause, a board label field after a pause, the board's label editor, a sheet cell
being typed in); see *Tab switch* below. The context also gives it `toast`,
`prompt`, `confirm`, `showMenu`, `resolveImage`, `readNote`, `getPath`, `exportPdf`, `saveAsset`, `saveBinary`,
`refEnv`/`openRef`/`pickRef` (references), template helpers, `pickImage`/`pickMedia` and `qa` (audience questions).
One surface instance serves every tab of its type: `docKey()` returns the active tab, and per-document undo stacks are
swapped by `perDoc()` in `history.js`, so `Mod+Z` in one file never brings back another file's text.

### Open, edit, save

1. `openFile()` reads the file through `window.folio.read` (the main process resolves the path inside the workspace).
2. The tab keeps `text` (current) and `saved` (on disk). `onEditorChange()` updates `text` and schedules `autosave`
   (650 ms debounce), which calls `saveTab()` → `window.folio.write` → atomic write in the main process.
3. The watcher sends `fs:file-changed` for changes made outside Folio; the tab reloads, or warns when it had unsaved edits.
4. The main process keeps version snapshots in `.folio/history/` (`src/main/history.js`): on the first save of a file,
   on autosaves (one per 3 minutes, the newest replacing the previous), before and after an AI edit, before a rename or
   move, before a restore, on close and when a version is named.

### Tab switch

Every editor reports some changes late: the page editor 220 ms after the last key, slide notes 350 ms, text on a slide
180 ms, a board's label field 300 ms, and a sheet cell or board label only when its editor is left. Before
[#82](https://github.com/gabrielevaudano98/folio/issues/82) such a change was applied to whichever tab was active by
then, so a fast switch could write one document's text into another file. The rules now:

- **A change names its document.** Each surface keeps the tab object (`docKey()`) its document came from and passes it
  to `ctx.onChange(text, tab)`; the page editor's tab is `richTab`. A change for a tab that is no longer active goes to
  that tab (`backgroundChange()`) and is saved there. The tab object, not the path, is the key, because a rename keeps
  the object and changes the path.
- **Pending work is flushed first.** `flushSurface()` runs before `activate()` switches, before `closeTab()`, before
  the view of a surface leaves visual, before `saveAllOrAsk()` (quit, folder switch, update install) and before an
  explicit save (`saveActive()`, with `keepEditing` so the cell or text box stays open). A surface given another
  document in `setText()` also flushes what the previous one still held, to the previous one.
- **The tab being left is saved** at once, not when it is shown again, closed or at quit.
- A pending edit remembers what it was typed for (the slide for notes, the selected node or lines for a board label),
  so it never lands on another slide or node when the selection changed meanwhile.
- Text typed in the code pane reaches the surface after 250 ms only if its tab is still the active one.

`test/tab-switch-save.test.mjs` edits each editor and switches within its delay, then compares both files on disk byte
for byte.

## Pages

The page editor must handle any Markdown a person or another tool wrote, and TipTap cannot represent all of it.
`page-core.js` solves this with **blocks**:

1. The page is split into top-level blocks (markdown-it tokens give the spans).
2. Each block is tried in the editor: if TipTap's Markdown serializer gives back something that **markdown-it draws the
   same way** (the "oracle"), the block is edited richly. Otherwise it is kept as a **raw block**, drawn but edited as
   source.
3. On save, the new document is diffed by blocks (`diffArrays`) and only changed blocks are re-serialized; every other
   byte, spacing included, stays as written. `tidy()` puts back conventions the serializer escapes (`[[links]]`,
   `[key:: value]`, `[!callout]`). When the blocks can no longer be matched (the editor reshaped the document), the
   whole body is serialized again.
4. Loading text into the editor (`setMarkdown`) emits no change, and `onEditorChange` ignores text equal to the tab's,
   so opening a page writes nothing. Known exceptions on `main` are tracked in [STATUS](../STATUS.md#known-bugs-on-main).

Everything Folio adds to CommonMark (footnotes, maths, colour and alignment `[text]{color=…}`, hidden `%%comments%%`,
toggles as `<details>`, columns, callouts, CriticMarkup) has a reader and a writer in `page-syntax.js` and an extension
in `page-schema.js`, so the editor and the format tests share one definition. **Chips** (dates, people, status, tags,
links) are decorations drawn over plain text, never new node types: the file keeps `[[2026-12-01]]` or
`[status:: Done]`.

Features around the editor are separate modules with a pure part and a UI part: properties (`page-props*.js`), comments
and suggestions (`page-critic.js`, `page-review.js`), tables (`page-table.js`), find (`page-find.js`), pickers
(`page-mentions.js`, `inserts.js`), paste and import (`page-paste.js`), Word export (`page-docx.js`), templates
(`page-templates.js`), blocks (`page-blocks.js`). Attachments go to the page's `.asset/` folder through the main process
(`src/main/assets.js`).

## Slides

A deck is a superset of [Marp](https://marp.app): `---` between slides, HTML-comment directives, `![bg]` backgrounds.
`slides-core.js` splits and renders slides at 1280 × 720 units in real DOM (text stays selectable and accessible).
**Placed objects** (`::: box #id x= y= w= h= …`) are parsed by `slides-objects.js`; every object has a stable id that
animations, Morph, links and MCP tools use. `slides-canvas.js` turns a drag, resize or rotate into **one** call to the
`edit(fn)` callback `slides.js` gives it, which rewrites the object's attribute line. Motion lines (`<!-- transition: … -->`, `animate:`) are in
`slides-motion.js`, played by `slides-present.js` and written to PowerPoint XML by `slides-pptx-motion.js`.

PowerPoint export (`slides-pptx.js`) renders each slide off-screen, measures every element and hands pptxgenjs exact
positions, so the result matches what Folio shows. Import (`slides-import.js`) reads shapes with pptxtojson and the
package XML for layouts, placeholders, theme and sections. The presenter view (`slides-presenter.js`) can open an
audience window on a second display; audience Q&A runs a small page on the local network (`src/main/qa.js`) only while
it is open.

## Boards

board-md is one ```` ```board ```` fence of lines like `id: shape "Label" @x,y WxH {style}` and `a -> b "label"`.
`board-core.js` parses and serializes these lines, knows the shape library (general, flowchart, UML, ER, architecture),
draws each shape as SVG and computes connector paths and auto-layout with dagre. `board.js` is the canvas: select, move,
connect from ports, edit labels, style, export PNG and SVG.

## Sheets

On `main`, sheet-md is a set of Markdown tables: a `## Name` heading per sheet, row 1 as header, cells holding values or
`=formulas`, and an invisible `<!-- sheet: {…} -->` comment for formats and view state. `sheet-core.js` parses and
evaluates (hot-formula-parser); `sheet.js` is the grid with Kanban view; `sheet-xlsx.js` writes `.xlsx` with formulas kept.
The branch `feat/sheets-univer` replaces this surface with Univer and a separate data engine process
([status](../STATUS.md#in-flight)).

## References between documents

Any document can point into another: `[[Doc#part]]` (link), `{{Doc#part}}` (live value, such as a sheet cell or a board
label) and `![[Doc#part]]` (embed). `refs-syntax.js` is the pure syntax (parse, resolve target, rewrite on rename, find
unlinked mentions); `refs.js` resolves values and embeds and fills them into rendered HTML. The same resolver backs the
`resolve_ref`, `get_backlinks` and `find_broken_links` MCP tools. Renaming or moving a document rewrites references to it
in every document, with one Undo.

## AI edits in the window

The main process runs every MCP tool through `notes.js`; a write returns `{ path, before, after, client }` and the window
gets an `ai:edit` event. `onAiEdit()` in `app.js` then:

- for the open tab: replaces its text, marks the changed lines (`highlightAi`, in the editor and the Read view), shows a
  banner with the assistant's name, the count of changed lines, **Undo** and **Review** (a diff sheet);
- for a background tab with unsaved typing: keeps the person's draft as a version first, then replaces it;
- for a closed file: shows a toast with **Open**.

**Undo** writes `before` back (or trashes a note the assistant created). Changes within ten minutes accumulate into one
reviewable edit. Assistants that prefer to propose use `suggest_edit` and `add_comment`, which write CriticMarkup the
person accepts or rejects in the Review pane.

## Undo, history and recovery

- **Text undo**: CodeMirror and TipTap histories per tab (snapshotted on tab switch); surfaces keep per-document stacks.
- **File actions** (create, rename, move, trash): `createActionLog()` in `history.js`, `Mod+Alt+Z`.
- **Versions**: `src/main/history.js` keeps content-addressed snapshots per document in `.folio/history/`, plus git
  commits read-only; `history-view.js` compares and restores (a restore is itself undoable).
- **Crash**: a crashed window is reloaded with its tabs; settings and notes are written atomically.
