# Folio roadmap

High-level plan. Each item is an issue on GitHub (labels `area:*`, milestones below). The top priority is quality: an app people trust with their files.

## v1.1 Quality

Make what exists trustworthy: fidelity, tests, signed builds, updates.

- **Markdown fidelity corpus for the page editor** — Collect 50+ real-world Markdown files (GFM, footnotes, HTML, front matter, Obsidian syntax). For each: open in the Write view, make one edit, assert that only the edited lines change. Run in CI. Fix every lossy construct found.
- **Auto-update from GitHub Releases** — Use electron-updater with the GitHub provider. Check on start and once a day, download in the background, offer "Restart to update". Respect a setting to turn it off.
- **Sign and notarize the macOS build** — Add Developer ID certificate and notarization secrets to the Release workflow (already wired, see release.yml). Verify Gatekeeper opens the app without a warning.
- **Sign the Windows installer** — Choose a code-signing route (Azure Trusted Signing or an OV certificate), add it to electron-builder, verify SmartScreen reputation.
- **Render footnotes and maths in the page editor** — Footnotes and KaTeX maths are shown as source in the Write view. Draw them like callouts (decorations or node views) without changing the Markdown.
- **Accessibility audit of the canvas and the grid** — Keyboard-only creation and connection of shapes, screen-reader names for shapes and cells, focus order in the inspector. WCAG 2.2 AA.
- **Virtualize the sheet grid** — Render only visible rows and columns so a 10,000 row sheet scrolls at 60 fps; recalculate only dependants of an edited cell.

## v1.2 Slides Studio (shipped in 1.2.0)

PowerPoint and Google Slides capabilities with full user control, in plain slides-md, with links between Folio documents. Full plan and feature coverage: [SLIDES-PLAN.md](SLIDES-PLAN.md).

- **P0** Model · **P1** Canvas · **P2** Arrange · **P3** Text in boxes
- **P4** Cross-document links (link, value, embed, synced copy)
- **P5** Insert · **P6** Format and picture tools · **P7** Themes and masters · **P8** Slide management
- **P9** SmartArt and Designer · **P10** Transitions, animations, Morph · **P11** Interactivity and Zoom
- **P12** Present and record · **P13** PPTX interop · **P14** MCP and AI · **P15** Polish
- All phases done. Still open: 3D models, screen recording, background removal, per-word colour and WordArt, rulers.

## v1.2 Editors

Deeper visual editing for slides, boards and sheets.

- **Edit slides directly on the stage** — Click a text block on the slide to edit it in place; drag images to swap sides; the Markdown updates. Keep the per-slide Markdown editor.
- **Incremental lists and transitions in slides** — Support Marp fragmented lists (`*` bullets) in the presenter, and the `transition` directive, and export them to PowerPoint animations.
- **Presenter view with notes on a second screen** — When two displays are connected, show the slide full screen on one and notes, timer and next slide on the other.
- **Manual connector routing on boards** — Draggable waypoints on connectors, reconnect endpoints by dragging, store waypoints in board-md (`{via: 120,40 200,40}`).
- **Sequence diagrams on boards** — Messages between lifelines ordered top to bottom, activation bars, return messages; written as `a ->> b "call"` in board-md.
- **Images and freehand drawing on boards** — Drop images on the canvas (saved to assets/), and a pen tool whose strokes are stored as compact paths.
- **Cross-sheet references and named ranges** — Support `=Rates!B2` and `=SUM(Costs!D2:D5)`, plus named ranges stored in the sheet comment.
- **Field types, validation and conditional formatting** — Airtable-style column types (single select, checkbox, date, link), dropdown validation, and rules such as "value > 1000 is bold".
- **Import Excel and CSV** — Open .xlsx and .csv as a new sheet-md file, keeping formulas, number formats and several sheets.
- **More chart types and axis titles** — Donut, combo (bars and line), axis titles, value labels; same in PowerPoint export.

## v1.3 AI-native

Structured MCP tools and per-change review of AI edits.

- **Accept or reject AI edits change by change** — Turn the Review sheet into a per-hunk review: accept, reject or edit each change an assistant made, like a tracked-changes view.
- **Structured MCP tools for slides, boards and sheets** — Add tools such as add_slide, set_layout, add_shape, connect, set_cell and add_chart so assistants edit without rewriting whole files.
- **Ask your AI from inside Folio** — A command palette entry that sends the selection to the user's connected assistant and shows the answer as a reviewable edit.

## Later

Bigger bets after 1.3.

- **Italian and other interface languages** — Externalize strings, ship Italian first.
- **Version history with git** — Optional git-backed history per folder: timeline, diff, restore.
- **Linux build** — AppImage and .deb from CI.

## Done in 1.0 and 1.1

- Page editor (Word-style), slides-md with PowerPoint and PDF export, board-md canvas, sheet-md grid with formulas, charts in sheets, pages and slides.
- MCP server with live, reversible AI edits; one-click connection to Claude, Cursor, VS Code, Windsurf, LM Studio, Claude Code.
- CI with format, MCP and UI smoke tests; CodeQL; Dependabot; cubic and Claude reviews.

## Done in 1.2.2

- Security review of the main process. A note can no longer pull a file from outside the open folder into an export (`file:` images, and links, are checked against the folder and limited to media types); remote images are fetched only from public addresses (checked by name and by what the name resolves to) and are limited to media types and 30 MB. Links inside the folder that lead outside are refused, as are hidden files and folders (`.git`, `.env`, `.ssh`) and changes to the folder itself, for the app and for AI assistants alike. Only the app page can call the main process, the window cannot be navigated to another page, only the microphone permission is granted, the settings file (which holds the MCP token) is owner-only, PDF export uses a private temporary folder, and the token is compared in constant time. Electron 45.4.1; the packaged app turns off `NODE_OPTIONS` and the inspector. Also fixes the image picker, which failed with an error, and asks macOS for microphone access so narration works in signed builds.

## Done in 1.2.1

- Undo and redo everywhere: one history per tab (pages, visual editor, slides, boards, sheets), toolbar buttons, Edit menu and palette; undo and redo for file actions (create, rename, move, trash); back and forward between notes.
- Security: transitive `image-size` and `katex` pinned to patched versions; CodeQL action v4; animation comment scanner without regex backtracking.
