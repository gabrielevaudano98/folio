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
| Version history: snapshots, named versions, compare, restore, recently deleted | G N W O | ✅ D15 |

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

### D6 — Tables (Docs and Notion) — done, see Progress
- Hover `+` handles for rows and columns, drag to reorder, column alignment, header row toggle, sort by column, Tab and Shift+Tab across cells, Enter in last row adds a row.
- Paste TSV/CSV from Excel or Sheets as a table. "Open as sheet" converts to a linked `name.sheet.md`.

### D7 — Navigation and long documents (Word) — done, see Progress
- Outline panel: drag a heading to move its whole section, promote/demote, collapse.
- Find and replace in the Write view (case, whole word, regex, replace all as one undo).
- Status bar: words, characters, selection count, reading time. Focus mode, typewriter scrolling, zoom.
- Format painter.

### D8 — Properties and tags (Obsidian) — done, see Progress
- Properties panel above the title: text, number, checkbox, date, list, tags, links; edits change only the YAML lines touched.
- Tags pane in the sidebar; tag rename across the workspace.

### D9 — Templates and building blocks — done, see Progress
- `Templates/` folder; variables `{{date}}`, `{{time}}`, `{{title}}`, `{{cursor}}`; `/template`; "New note from template"; daily note command.
- Starter building blocks: meeting notes, decision log, project brief, status report, review tracker.

### D10 — Comments and suggestions (Docs, Word) — done, see Progress
- CriticMarkup in the Write view: comments in a margin rail, suggest mode records insertions and deletions as `{++ ++}` `{-- --}`, accept or reject one by one or all.
- Feeds v1.3 "Accept or reject AI edits change by change": AI edits can arrive as suggestions.

### D11 — Paste, import, export — done, see Progress
- Paste HTML from Word, Google Docs, Notion and the web as clean Markdown (headings, lists, tables, links, images saved to `assets/`). Paste as plain text.
- Export: DOCX (styles mapped), PDF with page setup (pages or pageless, A4/Letter, margins, page numbers, page breaks), HTML. Import DOCX as a new page.

### D15 — Version history (Google Docs, Notion, Word, Obsidian File recovery) — done, see Progress
Every document type (pages, slides, boards, sheets), not only pages. The file stays the truth: history is kept beside it, never inside it.
- **Snapshots, automatic:** on open, then at most every few minutes while you edit (when the text really changed), before every AI edit (the MCP write tools), before a rename, a move, a template, Replace all, Accept all, an import over an existing file, and on close. Stored per workspace in `.folio/history/` (compressed, deduplicated by content hash), so they move with the folder and sync with it; `.folio/` is ignored by the tree, search, tags and backlinks.
- **Named versions (Docs):** "Name this version" (`Mod+Alt+Shift+S`) marks a snapshot; named versions are never pruned. A version can carry a short note.
- **History panel:** timeline grouped by day, with author (you, or which AI tool), size of the change (+/− words), named versions on top, filter "only named". Selecting a version shows the page as it was, read-only, with the changes against the current text (or against the previous version) highlighted word by word; next and previous change.
- **Restore:** the whole version (itself a new snapshot first, so restore can be undone), only a selected passage (copy or "restore this section"), or "Make a copy" as a new page. Compare any two versions.
- **Deleted documents:** "Recently deleted" lists files removed in Folio or outside it, with their last version; restore puts them back where they were.
- **Retention:** keep everything for 30 days, then hourly for 6 months, then daily (Obsidian-style settings: days to keep, minimum interval, maximum space); a "Clear history" per file and per workspace.
- **Git-aware:** when the workspace is a Git repository, its commits for the file appear in the same timeline (read-only), and a version can be committed.
- **For AIs (D13):** `list_versions`, `get_version`, `diff_versions`, `restore_version` MCP tools; every AI edit is undoable from history even after the app was closed.
- Tests: snapshot cadence, dedup, pruning rules, restore round-trip byte for byte, deleted-file recovery, diff accuracy.

### D16 — UX pass: templates, review, history (asked by Gabriele, 20 Nov: "they look bad") — done in part, see Progress
One design for the three, so they feel like one product (references: Google Docs side panels and version history, Notion's empty page and template picker, Confluence's template wizard, Word's review pane).
- **One side dock** on the right with tabs (Comments, History, Outline, Info) instead of panes that each push the page; same header, same cards, same keyboard (`Mod+Alt+M` comments, `Mod+Alt+Shift+H` history), remembered width, closes with Esc.
- **Review in place (Docs):** comment cards beside the line they belong to (aligned, stacked when they collide), bubble markers in the margin when the window is narrow; hover or click on a suggestion shows Accept / Reject right on the text; a mode switch in the top bar — Editing / Suggesting / Viewing — with a colour cue, instead of a checkbox; reactions and @mentions in comments; "resolved" kept in history, not lost.
- **Templates as a start, not a dialog (Notion, Confluence):** a new or empty page shows "Start with": empty, a few suggested templates, the gallery, import; the gallery opens as a full view with large visual thumbnails of each template and a big preview; **template prompts** (`{{ask:Project name}}`, `{{ask:Owner|people}}`) fill a short form before the page is made (Confluence variables); one click to use, keyboard first.
- **History as a mode (Docs):** the page full width with the changes highlighted, versions on the right (named first, grouped by day, authors as avatars), a top bar with "Restore this version", "Make a copy", "Compare with…", "Back to editing".
- Shared visual language: one card component, one empty-state style, avatars and colours per author, motion only where it explains (reduced motion respected), every action reachable from the keyboard and the command palette, screenshots reviewed at 1024 and 1440 px, light and dark.

### D12 — Backlinks and link health — done, see Progress
- Backlinks panel with unlinked mentions ("link it"), broken-link check, rename and move rewrite inbound links in one undoable step. Shared with SLIDES-PLAN P4.

### D13 — MCP tools for pages
- `get_outline`, `read_section`, `replace_section`, `insert_after` (heading or `^id`), `add_comment`, `suggest_edit`, `resolve_link`. FORMATS.md documents every page syntax for `get_format_guide`.

### D14 — Polish
- 10,000-line document stays at 60 fps (lazy node views, decorations only in viewport).
- Accessibility audit of every menu and chip, strings ready for translation, in-app cheat sheet (`/help`).

## Decisions to confirm

- **D-1 Colour and alignment — decided: Folio-flavoured Markdown.** Folio reads attribute syntax that other editors treat as plain text, and **Export → Markdown (portable)** removes it so the exported `.md` shows no Folio markup. Syntax (Pandoc-compatible): inline `[text]{color=red bg=yellow}`, block attributes on the line after a block `{align=center}`. Built in D1, export in D11.
- **D-2 Dependencies — decided: reuse everything that can be reused.** Already in and reused: markdown-it and its plugins (oracle for D0, preview), `diff` (block diff in D0), KaTeX, highlight.js, Mermaid, DOMPurify, TipTap extensions (subscript, superscript, text-align, text-style, typography are installed and unused today). To add when their step starts: `docx` (export) and `mammoth` (import) for D11, `@tiptap/suggestion` for the `/` and `@` menus (D3, D5), `@tiptap/extension-drag-handle` for D2, `chrono-node` for natural-language dates (D5), `turndown` + `turndown-plugin-gfm` for HTML paste (D11). All MIT.
- **D-3 Order.** D0 → D1 → D3 → D2 → D4 → D5 → D6 → D7 → D8 → D9 → D10 → D11 → D15 + D16 (version history and the UX pass, added 20 Nov) → D12 → D13 → D14.

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
- **D6 — done.** `page-table.js`: grips over the column and beside the row under the pointer open a menu (insert, move, align column, sort, delete, open as sheet); `+` bars under and to the right of the table add a row or column (Notion). Column alignment is GFM's `:---:` rule (TipTap's table already reads and writes it). Sort keeps the header row and compares numbers by value (`1,000`, `€`, `%` understood), empty cells last. Move rows (body only: GFM's first row is the header) and columns with `Alt+Shift+arrows`. Cells copied from Excel, Google Sheets or Numbers (tab-separated, quoted cells) paste as a table, or fill the current table from the cursor, growing it. **Open as sheet** moves the table to a new `Name.sheet.md` (named after the heading above it) and leaves `![[Name]]` in its place. Insert → Table has Word's size grid.
  - Not done: header row on/off (GFM tables always have one), drag to reorder rows and columns (menu and keys instead), CSV paste (only tab-separated text is unambiguous).
- **D7 — done.** Find and replace in the Write view (`page-find.js`): match case, whole words, regular expressions with `$1`, matches highlighted and counted, Replace all is one undo step (`Mod+F`, `Ctrl+H` / `⌘⌥H`). Outline: drag a heading to move its whole section, `Alt+Shift+↑/↓` move, `Alt+Shift+←/→` promote and demote with sub-headings, fold children; the right-click menu has the same. Source view does the same on text (`page-outline.js`, setext headings included); the outline now lists setext headings (`Title` + `=====`), which it missed before. Status bar: words, characters, selection counts, reading time, page zoom (`−  100%  +`, `Ctrl`+wheel); Word count box (`Mod+Shift+C`). Focus mode (existing) and typewriter scrolling in View. Format painter (`Mod+Alt+C`, double-click keeps it on, Esc stops): copies marks, paragraph style and alignment. Page width narrow, normal, full; fold and unfold all headings.
- **D8 — done.** `page-props.js` (pure, tested) reads the front matter as typed properties — text, number, checkbox, date, date and time, list, tags, link (`"[[Page]]"`) — inferred from the value as Obsidian does (`tags`/`tag` are always tags). Changing one rewrites only its lines: comments elsewhere, order, quoting, list style (`[a, b]` or `- a`) and nested maps stay as written; nested maps are shown read-only ("edit in source"). The first property creates the front matter, removing the last removes it. `page-props-ui.js`: the Properties panel above the title (foldable; type icon opens a menu to change type, rename or remove; chips for lists and tags with suggestions from the workspace; date pickers; links open with Ctrl/⌘ click); "Add property" on hover for pages without front matter, also in Insert → Pages and `/property`. Property edits are not in the editor's undo history (as in Obsidian).
  - Tags: a Tags section in the sidebar (nested tags under their parent, counts, parents listed even when only `#a/b` is used); click, or Ctrl/⌘ click a `#tag` in the Write view, or click it in the Read view, lists its pages in the sidebar (`#tag` or `tag:x` typed in search does the same); right click → **Rename tag…** across the workspace: text outside code, nested tags and front matter lists, open tabs included.
  - Not done: status options from front matter (D5 leftover) and property types stored per workspace (Obsidian's `types.json`): a type is inferred from the value each time.
- **D9 — done.** `page-templates.js` (pure, tested): a template is a page in `Templates/` or one of six starters (Daily note, Meeting notes, Decision log, Project brief, Status report, Review tracker), each fully editable (no raw blocks). Variables as Obsidian's core Templates: `{{title}}`, `{{date}}`, `{{date:dddd D MMMM YYYY}}` (moment tokens), `{{time}}`, `{{datetime}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{weekday}}`, `{{cursor}}`; any other `{{…}}` (Folio live values) is left alone. **Insert template** (`Mod+Alt+T`, Insert → Templates, `/template`): its properties join the page's (new keys added, tags joined, existing values kept), its body goes at the cursor without its `# title`, the caret lands at `{{cursor}}`. **New note from template**: a Template choice in the New document sheet. **Daily note** (`Mod+Alt+D`, day links from D5) uses the `Daily note` template. **Edit templates…** copies the starters into `Templates/` to customise. **Template button** (Notion): a ```` ```template-button ```` fence (`label:`, `template:`, `where: above|below`) drawn as a button in the Write and Read views; it inserts the template next to itself; elsewhere it reads as a code block.
- **D10 — done.** Comments and suggestions in **CriticMarkup**, which other editors show as plain text: `{++added++}`, `{--deleted--}`, `{~~old~>new~~}`, `{==highlighted==}{>>comment<<}`. A comment may start with its author and time (`{>>Ada, 2026-11-20 14:05: text<<}`); comments that follow each other are a thread (replies). `page-critic.js`: pure helpers for any text (`listChanges`, `accept`, `reject` one or all, `resolveAll`, `clean`), never inside code; the editor's marks (`criticIns`, `criticDel`, `criticHl`) and atoms (`criticSub`, `criticComment`) round-trip byte for byte (spaces at the edges of a marked span are pinned while serializing, because the serializer would move them out). **Suggest mode** (Suggesting): typing becomes `{++ ++}`, Backspace/Delete/cut mark text `{-- --}` (your own suggested text really goes), single-line paste is suggested; Enter still splits paragraphs (not representable in CriticMarkup). `page-review.js`: the review pane beside the page (opens when a page has comments or suggestions; can be hidden): filter All / Comments / Suggestions, Accept or Reject each, Accept all / Reject all, threads with the highlighted quote, reply, resolve (the comments go, the text stays), delete a comment. New comment `Mod+Alt+M` (selection or the word at the cursor), also in the selection bubble and the Review tab (New comment, Show comments, Resolve all, Suggesting, Accept/Reject and move to the next, Previous/Next, Accept all/Reject all). The author is `authorName` in settings, or the system user name. Read view draws insertions, deletions, substitutions, highlights and comment markers.
  - Feeds v1.3 (AI edits as suggestions) and D13 (`suggest_edit`, `add_comment`): the pure helpers are what the MCP tools will use.
- **Template gallery** (asked by Gabriele, 20 Nov: "templates direct the work"): `template-gallery.js`, modelled on Confluence's and Notion's galleries. Left: search, All templates, Recently used, Favourites (★), My templates (all, and by category), the **Folio collection** by category (16 templates in Meetings, Planning, Product, Engineering, Reports, Docs, Personal: `template-starters.js`), **Community** (online). Middle: cards with icon, description, category, source. Right: a live preview of the filled page and its properties, with **Use in “page”** (merge), **New page**, and **Customise** (collection) / **Download** (community) to copy it into `Templates/`, or **Edit** and a menu (rename, change category, duplicate, delete) for your own. **New template**, **Import** from files or from a link (a raw `.md`), **Save this page as a template**. A template describes itself in a `template:` map in its front matter (`description`, `category`, `icon`, `source`), which never reaches pages made from it; folders inside `Templates/` are categories too. Favourites and recent templates are kept in settings.
  - **Community gallery**: `community/templates/` in this repository (`index.json`, eight templates: Sprint planning, PR/FAQ, Lean canvas, SWOT, Customer journey map, Launch checklist, Competitive analysis, Interview scorecard; README on how to contribute). Folio reads the index from `settings.templateGallery` (default: this repository's `main` branch on raw.githubusercontent.com, so it works once merged). Downloads run in the main process: HTTPS only (or this machine, for tests), text only, 1 MB at most, 12 s timeout; the index can only point at files next to it.
- **Ribbon — redone** (asked by Gabriele, 20 Nov): `page-ribbon.js`. Two layouts of the same commands, as Microsoft 365: **simplified** (one row: undo, style, character formats, lists, alignment menu, Insert menu, find; the Table group appears in a table) and **full** (Word tabs Home, Insert, Layout, Review, View, plus the contextual Table tab; labelled groups; large buttons for the main command of a group; style gallery). The chevron at the right switches, double-clicking a tab goes back to simplified, the choice is remembered. Narrow windows fold groups into a button that opens them, least important first (Word). Undo and redo sit left of the tabs (quick access).
- **D11 — done.** `page-paste.js`: HTML from Word (lists from `mso-list`, headings, highlight), Google Docs (CSS styles → bold/italic/strike/code, checklists), Notion and the web goes through turndown + the GFM plugin into plain Markdown, then through the page codec like typed text; `data:` and `file:` images are saved to `assets/`. Several pasted blocks start new blocks after the current line; in Suggesting mode a paste is an insertion. Plain text that looks like Markdown is parsed; **Paste as plain text** (Ctrl/⌘ Shift V) keeps it as text. `page-docx.js`: the Read-view HTML becomes a `.docx` with real headings, numbered and bulleted lists, tasks, tables with alignment, code, callouts (shaded with a bar), columns, footnotes, a contents field, page breaks, images (diagrams and charts as pictures), header and footer with page numbers, and the properties as document properties; CriticMarkup becomes **Word tracked changes and comments with threaded replies**, or is dropped with "Final text only". **Export…** (Ctrl/⌘ Shift E) asks for format, paper (A4, Letter, A5, Legal), orientation, margins, page numbers and header, and remembers them; PDF uses the same setup through `printToPDF`. **Import Word or HTML** (mammoth) makes a new page.
- **D15 — done.** `src/main/history.js`: every document keeps its versions in `<workspace>/.folio/history/` (content-addressed gzip objects shared across files plus one small index per document), nothing in the document itself. Snapshots: the disk text before the first edit, automatic ones at most every 3 minutes by the same author, forced ones before and after every AI edit (by the client's name), on create, on close, before a restore, and when a version is named. Retention: everything for 30 days, then hourly to 6 months, then daily; named versions, the first and the newest are never dropped. Rename and delete follow the file; deleted files are listed under **Deleted pages** with their last version. **Version history** (More menu, palette, Ctrl/⌘ Alt Shift H) is a full-width mode: the document with a word-level diff against the current text (or any other version), next/previous change, a *put back* button on each change, a Version view, versions grouped by day with author and +/- words, *Only named versions*, **Name this version** (Ctrl/⌘ Alt Shift S), **Make a copy**, **Restore this version** (the current text is kept first and the toast offers Undo), Clear history. Works for every document type (non-page documents show the Markdown source).
- **D16 — done in part.** **One right dock** (`#outline`): tabs *Outline* | *Review* (badge with the count) share one column instead of Review squeezing the page between two panes; the dock opens on Review when you comment or open a page that has comments, goes back to Outline when a page has none, and floats over the page in narrow windows. **Mode switch** Editing / Suggesting / Viewing (colour cue; Viewing makes the page read-only) replaces the checkbox. **Start with**: an empty page shows its title and, under it, your templates, the usual starters, *All templates…* and *Import…*. **Template questions**: `{{ask:Project name}}`, `{{ask:Owner|people}}` (written as a link, suggestions from `People/`), `{{ask:Due|date}}`, `{{ask:Notes|long}}` open a short form before the page is made or the template inserted; previews show `[Label]`. Export sheet and segmented controls no longer overflow. History stays a full-width mode (D15).
  - **Not done:** comment cards aligned beside their line (the Review tab lists them and highlights the active one), Accept / Reject on hover over a suggestion in the text, large visual thumbnails in the gallery (it has icons, a category list and a live preview), an Info tab.
- **D12 — done.** The *Outline* tab of the dock lists **Linked from** (existing), **Unlinked mentions** (other documents that write this page's name without a link: whole words, outside front matter, code, links and references; the *Link* button turns one into `[[Name]]`, or `[[Name|as written]]` if the case differs, in the open tab or on disk, with Undo) and **broken references** with *Create page* for a plain `[[Name]]`. Renaming or moving a document still rewrites inbound links (`rewriteAfterMove`); now every rewritten document first gets a history version ("Before links were updated") and the toast has **Undo** (it renames back, which rewrites the links back). `findMentions` / `linkMention` live in `refs-syntax.js` (pure, tested); `fs:unlinked` IPC.
  - Not done: a workspace-wide link health view (broken links across all documents; `find_broken_links` already exists for AIs) and *Link all*.
- **Branch.** Rebased on `main` after slides P4–P8 landed; work continues on `pages` (the remote `pages-studio` holds the pre-rebase D0–D1 and can be deleted).
- **Reuse from slides P4 for D5/D12:** references (`[[…]]`, `{{…}}`, `![[…]]`), the reference picker, backlinks panel ("Linked from"), rename rewriting links, `resolve_ref`/`get_backlinks`/`find_broken_links` MCP tools. D5 becomes the inline `@`/`[[` pickers on top of these; D12 shrinks to unlinked mentions.

## Not planned

Real-time multi-user editing, per-run fonts and sizes (themes handle typography), Word sections with different page layouts, Notion databases (that is the sheet type).
