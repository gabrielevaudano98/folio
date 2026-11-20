# Pages Studio — plan v1

Goal: make the page editor (`name.md`, `src/renderer/rich.js`) as capable as **Notion**, **Google Docs**, **Microsoft Word** and **Obsidian** together — every formatting capability, the `/` and `@` menus, `[[` links and embeds, blocks you can drag — while the file stays plain Markdown that any editor and any AI can read and write.

Research base: Notion help (writing & editing basics, keyboard shortcuts, reminders & mentions, synced blocks), Google Docs help (@ menu, smart chips, dropdowns, building blocks, document tabs, pageless, Markdown detection), Word help (Navigation pane, styles, collapsible headings, TOC, find & replace, review), Obsidian help (Obsidian Flavored Markdown, callouts, embeds, block references, properties), plus comparison reviews (Notion export is lossy; Obsidian Live Preview is the reference for "Markdown that looks like a document").

## Principles

1. **The file is the truth.** Every feature has a Markdown spelling. Nothing is stored outside the `.md` file except view state (folded headings, zoom).
2. **Minimal edits.** Opening a file never rewrites it. Editing one block re-serializes that block only; every other byte stays as written (invariant 1).
3. **Borrow existing conventions.** Obsidian, GFM, Pandoc and CriticMarkup syntax before inventing anything, so Folio files open well in Obsidian, GitHub and VS Code.
4. **One engine, three doors.** The `/` menu, the `@` menu and the command palette share one registry of insertable items and actions.
5. **Keyboard first, mouse friendly.** Every action has a shortcut (Word/Docs/Notion muscle memory) and a visible control.
6. **Design system.** Grey palette, tokens only, ARIA combobox/listbox for every menu, `:focus-visible`, reduced motion (invariant 5).

## Feature inventory → Markdown

Legend: ✅ already in Folio · 🟡 partial · ⬜ to build. Source: N = Notion, G = Google Docs, W = Word, O = Obsidian.

### Inline

| Feature | Source | Markdown | Status |
|---|---|---|---|
| Bold, italic, strike, inline code, link | all | `**b**` `*i*` `~~s~~` `` `c` `` `[t](url)` | ✅ |
| Underline | N G W | `<u>text</u>` | 🟡 button exists, check round-trip |
| Highlight | N G W O | `==text==` | 🟡 check spelling on save |
| Superscript / subscript | G W | `<sup>` `<sub>` (Pandoc `^x^` `~x~` read) | ⬜ deps installed, unused |
| Inline maths | N G W O | `$e^{i\pi}$` | ⬜ preview only today |
| Footnote reference, inline footnote | W G O | `[^1]`, `^[text]` | ⬜ preview only today |
| Hidden comment | O | `%%text%%` | ⬜ |
| Wiki link with alias, heading, block | N O | `[[Note]]` `[[Note\|label]]` `[[Note#Heading]]` `[[Note#^id]]` | 🟡 drawn, not editable as a chip |
| Mention a document or part | N G | `[[…]]` inserted from `@` | ⬜ |
| Date chip, daily note | N G O | `[[2026-11-19]]` (links to `Journal/2026-11-19.md`) | ⬜ |
| Person chip | N G | `[[People/Ada Lovelace\|@Ada]]` | ⬜ |
| Status / dropdown chip | G | `[status:: In progress]` (Dataview inline field) | ⬜ |
| Tag | O | `#project/alpha` | ⬜ |
| Emoji | N G W | Unicode character, picked with `:` | ⬜ |
| Smart typography, autocorrect | G W | typed result (“ ” — → © ½) | ⬜ |
| Text colour / background | N G W | `<span data-color="…">` | ❓ decision D-1 |
| Alignment | G W | `<p align="center">` | ❓ decision D-1 |

### Blocks

| Feature | Source | Markdown | Status |
|---|---|---|---|
| Paragraph, H1–H6 | all | `#`…`######` | 🟡 style menu stops at H4 |
| Bulleted, numbered, checklist, nesting | all | `-` `1.` `- [ ]` | ✅ |
| Numbered list start, list style | G W | `3.` keeps start | ⬜ check |
| Quote | all | `>` | ✅ |
| Callouts: all Obsidian types, title, foldable | N O | `> [!tip]+ Title` | 🟡 5 GitHub types, no fold, no title |
| Toggle (collapsible block) | N | `<details><summary>…</summary>…</details>` | ⬜ |
| Collapsible headings | N W | view state only | ⬜ |
| Code block with language and highlighting | all | ```` ```js ```` | 🟡 no highlighting in Write view |
| Mermaid diagram, chart | N | ```` ```mermaid ```` ```` ```chart ```` | ✅ |
| Maths block | N G W O | `$$ … $$` | ⬜ |
| Table with header, alignment | all | GFM table `:---:` | 🟡 no alignment, no hover handles |
| Image with size, caption, alignment | all | `![alt\|400](a.png "caption")` | 🟡 no size or caption |
| Video, audio, PDF, file | N O | `![[clip.mp4]]` `![[doc.pdf]]` | ⬜ |
| Web bookmark card | N | `[title](url)` alone on a line, drawn as a card | ⬜ |
| Embed a note, section or block (synced block) | N O | `![[Note]]` `![[Note#Heading]]` `![[Note#^id]]` | ⬜ |
| Embed slide, board, sheet range | Folio | `![[Pitch.slides#5]]` `![[Budget.sheet#Summary!A1:D9]]` | ⬜ shared with SLIDES-PLAN P4 |
| Block id (link target) | O | ` ^abc123` at end of block | ⬜ |
| Table of contents | N W G | `[[toc]]` | ⬜ |
| Columns | N | `::: columns` / `::: column` (markdown-it-container, as slides) | ⬜ |
| Divider | all | `---` | ✅ |
| Page break (print/export) | G W | `<div class="page-break"></div>` | ⬜ |
| Footnote definitions | W G O | `[^1]: text` | ⬜ |
| Properties (front matter) | O N | YAML front matter | 🟡 kept, not editable |
| Comments and suggestions | G W | CriticMarkup `{>>c<<}` `{++a++}` `{--d--}` `{~~a~>b~~}` `{==h==}` | ⬜ |

### Menus and triggers

| Trigger | Source | Opens |
|---|---|---|
| `/` at any position | N (G W O equivalents) | Insert and turn-into menu: every block above, templates, Folio docs |
| `@` | N G | Documents and their parts, people, dates (`@today`, `@next monday`), status chips, building blocks |
| `[[` | N O | Link picker: documents, `#` headings, `^` blocks, create new note |
| `![[` | O | Embed picker, same targets |
| `#` after a space | O | Tag picker |
| `:` + 2 letters | N G | Emoji picker |
| `Mod+/` on a block | N | Turn into… |
| `+` and `⋮⋮` in the margin | N G | Insert below, block menu (move, duplicate, turn into, copy link, delete) |

### Document tools

| Feature | Source | Status |
|---|---|---|
| Outline with drag-to-reorder sections | W | 🟡 outline lists headings, no drag |
| Find and replace (case, whole word, regex) in Write view | all | ⬜ |
| Word, character, selection count, reading time | G W | 🟡 words only |
| Focus mode, typewriter scrolling, zoom | W O | ⬜ |
| Format painter | G W | ⬜ |
| Paste: HTML from Word, Docs, Notion, web → clean Markdown; URL on selection → link; TSV → table | all | 🟡 images only |
| Templates and building blocks (meeting notes, decision log…) | G N O | ⬜ |
| Backlinks and unlinked mentions | N O | ⬜ shared with SLIDES-PLAN P4 |
| Export DOCX, PDF (pages or pageless, margins, page numbers), HTML; import DOCX | G W | ⬜ |

## Keyboard map (target)

Kept from today: `Mod+B/I/U/K/E`, `Mod+Shift+S` strike, `Mod+Shift+H` highlight, `Mod+Alt+0…3` styles, `Mod+L` checklist, `Tab`/`Shift+Tab` indent.

Added: `Mod+Alt+4…6` H4–H6 · `Mod+Shift+7/8/9` numbered, bulleted, checklist (Docs) · `Mod+.` / `Mod+,` superscript, subscript (Docs) · `Mod+Shift+M` inline maths · `Mod+Enter` toggle checkbox (Notion) · `Mod+D` duplicate block · `Mod+Shift+↑/↓` move block (Notion) · `Mod+/` turn into · `Mod+Alt+M` comment (Docs) · `Mod+Shift+E` suggest mode · `Mod+F` / `Mod+H` find, replace · `Mod+Shift+C` counts (Docs) · `Mod+Shift+V` paste as plain text · `Mod+Alt+Enter` page break · `Mod+Alt+L` copy link to block.

Markdown typed at line start (Notion, Docs, Obsidian): `# `…`###### `, `- ` `* ` `+ `, `1. `, `[] `, `[x] `, `> `, `>> ` toggle, `> [!` callout, ```` ``` ````, `$$`, `---`, `|a|b|` + Enter table. Inline: `**`, `*`, `~~`, `==`, `` ` ``, `$…$`, `[^`.

## Steps

Each step is one pull request: code, `docs/FORMATS.md`, tests in `test/formats.test.mjs` (round-trip) and the UI smoke test. Done means `npm test` is green and the step's checklist passes by hand.

### D0 — Fidelity foundation (blocks everything else)
Today `getMarkdown()` re-serializes the whole document on every keystroke, so one edit can reformat unrelated lines (bullet markers, emphasis style, tables, unknown syntax).
- Keep the original source range of every top-level block (map ProseMirror top-level nodes to markdown-it token line ranges at load).
- On change, re-serialize only the dirty top-level blocks and splice them into the original text. Untouched blocks keep their bytes.
- Unknown or unsupported syntax becomes an opaque "raw block" that shows its source and is written back verbatim.
- Fidelity corpus `test/fixture/pages/` (GFM, footnotes, maths, HTML, front matter, Obsidian syntax, CriticMarkup, Notion and Docs exports): open → no change; edit one paragraph → only those lines differ.
- Done: corpus green; v1.1 roadmap item "Markdown fidelity corpus" closed.

### D1 — Inline formatting and typing
- Underline, highlight `==`, superscript, subscript, inline maths (KaTeX node view, click to edit source), `%%comments%%` (dimmed, toggle to show), footnote references (number badge, hover shows the note).
- Input rules and paste rules for all inline Markdown; URL pasted on a selection becomes a link; smart typography and autocorrect (setting).
- Bubble menu: all inline marks, link editor inline (not a prompt), turn-into, comment.
- Full keyboard map above. Paragraph style menu H1–H6.

### D2 — Block system (Notion)
- Margin handle `⋮⋮` on hover: drag to move, click for block menu (turn into, duplicate, move up or down, copy link to block, delete).
- `+` on an empty line opens the `/` menu. Multi-block selection (Shift+click, Esc to select current block).
- Copy link to block writes a ` ^id` (6 chars) at the block end — the only time Folio adds an id.
- `Mod+D`, `Mod+Shift+↑/↓`, `Mod+/`.

### D3 — `/` menu engine
- Shared registry `src/renderer/inserts.js`: id, label, aliases, category, icon, shortcut, `insert(editor)`, `turnInto(editor)`. Command palette reads it too.
- Fuzzy search with aliases (`/h2`, `/todo`, `/callout`, `/math`, `/toc`, `/table 3x4`), categories (Basic, Lists, Media, Embeds, Advanced, Folio, Templates), recent items first, ARIA combobox, keyboard and mouse.
- Ships with every block that exists; each later step registers its items.

### D4 — New blocks
- Callouts: all Obsidian types and aliases, custom title, foldable `+`/`-`, change type from a menu.
- Toggle `<details>`, collapsible headings (view state), maths block, table of contents `[[toc]]` (live), columns, page break, footnote definitions section, code highlighting with language picker.
- Image: resize handles (`|400`), caption (title), alignment; video, audio, PDF, file embeds from `assets/`; bookmark card for a lone URL.

### D5 — Links, mentions and chips (`[[`, `![[`, `@`, `#`, `:`) — done, see Progress
- Link picker over the workspace: every Folio document, `#` headings, `^` blocks, "Create note …". Links are chips; Ctrl/⌘-click opens; hover previews.
- Embeds `![[…]]` render the target (page section or block live, read-only with "Open"); slide, board and sheet embeds use the **shared resolver** of SLIDES-PLAN P4 — build it here if pages land first.
- `@`: documents, people (`People/` folder), dates with natural language (`@tomorrow`, `@next friday`) linking to `Journal/` daily notes, status chips (`[status:: …]` with options from front matter `folio.status`), building blocks.
- `#tag` picker, `:emoji` picker.

### D6 — Tables (Docs and Notion)
- Hover `+` handles for rows and columns, drag to reorder, column alignment, header row toggle, sort by column, Tab and Shift+Tab across cells, Enter in last row adds a row.
- Paste TSV/CSV from Excel or Sheets as a table. "Open as sheet" converts to a linked `name.sheet.md`.

### D7 — Navigation and long documents (Word)
- Outline panel: drag a heading to move its whole section, promote/demote, collapse.
- Find and replace in the Write view (case, whole word, regex, replace all as one undo).
- Status bar: words, characters, selection count, reading time. Focus mode, typewriter scrolling, zoom.
- Format painter.

### D8 — Properties and tags (Obsidian)
- Properties panel above the title: text, number, checkbox, date, list, tags, links; edits change only the YAML lines touched.
- Tags pane in the sidebar; tag rename across the workspace.

### D9 — Templates and building blocks
- `Templates/` folder; variables `{{date}}`, `{{time}}`, `{{title}}`, `{{cursor}}`; `/template`; "New note from template"; daily note command.
- Starter building blocks: meeting notes, decision log, project brief, status report, review tracker.

### D10 — Comments and suggestions (Docs, Word)
- CriticMarkup in the Write view: comments in a margin rail, suggest mode records insertions and deletions as `{++ ++}` `{-- --}`, accept or reject one by one or all.
- Feeds v1.3 "Accept or reject AI edits change by change": AI edits can arrive as suggestions.

### D11 — Paste, import, export
- Paste HTML from Word, Google Docs, Notion and the web as clean Markdown (headings, lists, tables, links, images saved to `assets/`). Paste as plain text.
- Export: DOCX (styles mapped), PDF with page setup (pages or pageless, A4/Letter, margins, page numbers, page breaks), HTML. Import DOCX as a new page.

### D12 — Backlinks and link health
- Backlinks panel with unlinked mentions ("link it"), broken-link check, rename and move rewrite inbound links in one undoable step. Shared with SLIDES-PLAN P4.

### D13 — MCP tools for pages
- `get_outline`, `read_section`, `replace_section`, `insert_after` (heading or `^id`), `add_comment`, `suggest_edit`, `resolve_link`. FORMATS.md documents every page syntax for `get_format_guide`.

### D14 — Polish
- 10,000-line document stays at 60 fps (lazy node views, decorations only in viewport).
- Accessibility audit of every menu and chip, strings ready for translation, in-app cheat sheet (`/help`).

## Decisions to confirm

- **D-1 Colour and alignment — decided: Folio-flavoured Markdown.** Folio reads attribute syntax that other editors treat as plain text, and **Export → Markdown (portable)** removes it so the exported `.md` shows no Folio markup. Syntax (Pandoc-compatible): inline `[text]{color=red bg=yellow}`, block attributes on the line after a block `{align=center}`. Built in D1, export in D11.
- **D-2 Dependencies — decided: reuse everything that can be reused.** Already in and reused: markdown-it and its plugins (oracle for D0, preview), `diff` (block diff in D0), KaTeX, highlight.js, Mermaid, DOMPurify, TipTap extensions (subscript, superscript, text-align, text-style, typography are installed and unused today). To add when their step starts: `docx` (export) and `mammoth` (import) for D11, `@tiptap/suggestion` for the `/` and `@` menus (D3, D5), `@tiptap/extension-drag-handle` for D2, `chrono-node` for natural-language dates (D5), `turndown` + `turndown-plugin-gfm` for HTML paste (D11). All MIT.
- **D-3 Order.** D0 → D1 → D3 → D2 → D4 → D5 → D6 → D7 → D8 → D9 → D10 → D11 → D12 → D13 → D14.

## Progress

- **D0 — done.** `page-core.js` splits a page into top-level blocks, checks each against markdown-it (the oracle), keeps what the editor cannot hold as raw blocks, and on save splices only changed blocks. Fixed real data loss: before D0 any edit turned footnotes into links (`Text[^1](note)`), escaped HTML (`&lt;details&gt;`) and broke foldable callouts. Corpus: `test/fixture/pages/` (GFM, Obsidian, HTML, CriticMarkup, Notion and Google Docs exports); tests in `test/formats.test.mjs` and `test/pages.test.mjs`.
- **D1 — done.** `page-syntax.js`: superscript, subscript, inline and block maths (KaTeX, Pandoc `$` rules), footnotes (reference, inline, definition), `%%hidden comments%%`, colour `[text]{color= bg=}` and alignment `{align=}` (TipTap TextAlign reused). Editor: KaTeX views edited in place, footnotes with hover text and Ctrl/⌘-click to the note, Footnote command that adds the note at the end (Word), colour popover with Notion's nine colours, alignment group, H1–H6, bubble with Turn into, underline, inline link editor. Smart quotes and dashes (setting), `[text](url)` typed becomes a link, `$$` + space starts a maths block. Read view and exports draw colour and alignment and hide comments. Export as portable Markdown. Format guide for AIs has a Pages section (`get_format_guide type=page`). An Obsidian page is now fully editable (no raw blocks).
  Shortcuts that differ from the plan because the app menu owns them: superscript `Mod+Shift+.`, subscript `Mod+Shift+,`, centre `Mod+Alt+E` (`Mod+.` and `Mod+Shift+E` are menu commands). Copy link to block (D2) moves to `Mod+Alt+L`, since `Mod+Shift+L` is now align left.
  Not reused: `@tiptap/extension-mathematics` needs KaTeX ≤ 0.18 (Folio has 0.19); its Markdown design is reused in Folio's own nodes.
- **D3 — done.** `inserts.js`: one registry of 29 items in six groups (Basic, Lists, Media and data, Advanced, Callouts, Links and embeds), each with aliases, icon, shortcut, the Markdown the source view types, and either *turn into* (keeps the text) or *insert*. The / menu (`@tiptap/suggestion`, same version as TipTap): opens after a space or at a line start, never in code; recent items first; fuzzy search over labels and aliases (`/h2`, `/todo`, `/equation`, `/[[`); `/3x4` inserts a 3 × 4 table; arrows, Home/End, Enter/Tab, Esc, mouse; listbox/option with `aria-activedescendant`. Blocks you cannot type in (divider, image, maths) leave the cursor in a paragraph below. The command palette lists every item too (`Insert: …`, `Turn into: …`); fuzzy search is shared (`fuzzy.js`). Links, live values and embeds reuse the P4 reference picker.
- **D2 — done.** `page-blocks.js`: ⋮⋮ handle and + in the margin of the block under the pointer (list items have their own); drag moves the block through ProseMirror's own drop (drop cursor, undo); + opens the / menu on a new line below; block menu with Turn into (current type marked), Duplicate, Move up/down, Copy link to block, Delete, full keyboard navigation. Keys: `Mod+D` duplicate, `Mod+Shift+↑/↓` move, `Mod+/` block menu, `Mod+Alt+L` copy link, `Esc` selects the block. Copy link adds an Obsidian `^id` (shown faint) and copies `[[Note#^id]]`, which P4 references already resolve.
  Not reused: `@tiptap/extension-drag-handle` has Yjs collaboration packages as peer dependencies; its technique (`view.dragging` with a NodeSelection) is reused.
- **D4 — in progress.** Scope widened to every Notion block type (Gabriele, 19 Nov).
  - **D4a — done: structure.** `callouts.js`: all GitHub and Obsidian callout types and aliases, custom title, fold (`-`/`+`), Notion icon and colour as Obsidian metadata (`[!callout|💡 yellow]`); Read view draws foldable callouts as `<details>`. Write view: type menu on the label, fold chevron (view state), collapsible headings (view state, Word/Notion). Toggles and toggle headings as `<details>` (official `@tiptap/extension-details` with Folio's Markdown), columns 2–5 (`:::: columns` / `::: column`, markdown-it-container reused), `[TOC]` (live), `[BREADCRUMB]`, page break (print/PDF). / menu: Toggle list, Toggle heading 1–3, Callout, Page (creates a sub-page and links it), 2–5 columns, Table of contents, Breadcrumb, Page break, Synced block, Table database and Board database (a new sheet, kanban view for boards, embedded with `![[…]]`).
  - **Fixed a data-loss risk found by the D4 tests:** soft line breaks were `\n` characters inside text; when the browser re-read the page (native edits, IME, autocorrect) they became hard breaks and unrelated blocks were rewritten. They are now a `softBreak` node (`<br data-soft>`, written as a newline). Callout markers with metadata are no longer escaped.
  - TOC syntax is `[TOC]`, not `[[toc]]` as first planned: `[[…]]` is a wiki link.
  - **D4b — done: media.** Image syntax for everything, as in Obsidian: width `![Alt|400](…)`, caption from the title, video and audio players, PDF and file cards (open with the system app through a new `shell:open-file` that stays inside the workspace), web embeds for 14 providers as cards (YouTube thumbnails); a paragraph that is one link is a bookmark or file card. Write view: drag handle to resize, caption edited in place. / menu: Video, Audio, PDF, File, Web bookmark, Embed from the web. The window's CSP does not allow other sites in frames, so web embeds open in the browser instead of playing inline.
  - **D4c — done: code.** Syntax colours in the Write view from highlight.js (already used by the Read view) as decorations, cached per block; language menu on each block (26 languages, plus any name the file already uses).
- **D4 — done.**
- **D5 — done, except embeds in place.**
  - **Everything the pickers write is plain Markdown text** (`[[Note#Heading]]`, `[[2026-11-21]]`, `[status:: Done]`, `#tag`, the emoji character), so pages stay portable and lossless; chips are only drawn over that text (decorations in the Write view, markdown-it rules in the Read view). No new node types.
  - `page-mentions.js` (pure, tested in Node): `[[` documents and people by fuzzy name, `Note#` headings, `Note#^` blocks that already have an id, "Create …" (makes the page next to the current one); `@` people (`People/`), dates in English and Italian (`chrono-node`: `tomorrow`, `next friday`, `domani`, `tra 3 giorni`) written as `[[YYYY-MM-DD]]`, pages and status chips; `#` tags collected from the workspace (front matter `tags:` and `#tag` in text, cached 30 s); `:` emoji (`gemoji`, loaded on first use). Reuses `@tiptap/suggestion`, the `/` menu renderer and `fuzzy.js`.
  - Day links open `Journal/YYYY-MM-DD.md`, created on first use. The folder name is a constant for now (D14: a setting).
  - Chips: people, days, tags, inline fields, status colours (Not started grey, In progress blue, Blocked red, Done green, Review purple); links to missing pages get a wavy red underline. Hover card on `[[…]]`: the start of the page, the section or the block.
  - `/today`, `/tomorrow`, `/status` in the `/` menu. Round-trip test `pages/chips.md`; the serializer's escaping of `[key:: value]` is undone in `tidy`.
  - **Not done, moved to D12/D14:** `![[Note#Heading]]` drawn live inside the Write view (the Read view and slides already draw it; in the Write view it is text with a chip); changing a status by clicking the chip; status options from front matter `folio.status` (the picker takes a list, the host does not pass one yet); a click on a tag does nothing until the Tags pane (D8).
- **Branch.** Rebased on `main` after slides P4–P8 landed; work continues on `pages` (the remote `pages-studio` holds the pre-rebase D0–D1 and can be deleted).
- **Reuse from slides P4 for D5/D12:** references (`[[…]]`, `{{…}}`, `![[…]]`), the reference picker, backlinks panel ("Linked from"), rename rewriting links, `resolve_ref`/`get_backlinks`/`find_broken_links` MCP tools. D5 becomes the inline `@`/`[[` pickers on top of these; D12 shrinks to unlinked mentions.

## Not planned

Real-time multi-user editing, per-run fonts and sizes (themes handle typography), Word sections with different page layouts, Notion databases (that is the sheet type).
