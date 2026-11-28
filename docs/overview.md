# Folio in ten minutes

For product, leadership and anyone new to the project. No code. Technical readers continue with
[architecture](architecture/README.md); the live state of the work is in [STATUS.md](STATUS.md).

## What Folio is

Folio is a desktop app for Windows and macOS in which a person and their AI assistants work on the same documents.
Everything the person creates is a plain Markdown file in a folder they choose: pages, slide decks, whiteboards and
spreadsheets. Folio gives each file a visual editor (Word-like for pages, PowerPoint-like for slides, draw.io-like for
boards, Excel-like for sheets) and opens the folder to AI assistants such as Claude, Cursor or VS Code through the
**Model Context Protocol (MCP)**. When an assistant changes a document, the change appears highlighted, live, with one
click to undo it.

It is open source (AGPL-3.0 with an attribution term), local-first, and has no accounts, no server and no telemetry.

## Who it is for

- **People who already use an AI assistant for real work** and want it to write into their documents, not into a chat
  window they then copy from.
- **Knowledge workers in an Office or Notion world** who want the same comfort (ribbon, slash menu, templates,
  comments, PowerPoint and Excel export) without giving their files to a cloud service.
- **Teams who keep documents in a synced folder or in git**: every Folio document is a text file that diffs and merges.

## The bet

1. **Files are the model.** No database, no proprietary format. A Folio deck is Marp-compatible Markdown; a sheet is a
   set of Markdown tables. Other editors can open them, and an AI reads and writes them natively.
2. **AI edits are visible and reversible.** Trust comes from seeing what changed and undoing it in one click, not from
   reading a log afterwards. Assistants can also *propose* changes as tracked suggestions.
3. **Office-grade editing on top of plain text.** The visual editors must never damage the text: opening a file never
   rewrites it, and editing one part changes only that part. This is the hardest engineering constraint in Folio and
   it is enforced by tests; the few known exceptions are tracked as bugs in [STATUS.md](STATUS.md#known-bugs-on-main).

## What you can do today (version 1.5.1, pre-alpha)

| Document | File | Highlights |
|---|---|---|
| Page | `name.md` | Write view with `/` and `@` menus, links between pages, callouts, tables, maths, footnotes, properties, templates, comments and suggestions, import from Word, Google Docs and Notion, export to PDF, HTML and Word. |
| Slide deck | `name.slides.md` | Free placement of objects, themes and masters, 8 templates, SmartArt, transitions and animations, presenter view with a second screen, PowerPoint import and export with native animations. |
| Board | `name.board.md` | Flowcharts, UML, ER and architecture diagrams with auto-layout; PNG and SVG export. |
| Sheet | `name.sheet.md` | A light spreadsheet with ~390 functions, formats, Kanban view, Excel and CSV export. A much richer version (Folio Sheets on Univer) is built and waiting to be merged. |

Across all of them: version history, undo everywhere, English and Italian interface, a template gallery, and an
optional **meeting recorder** (Windows) that transcribes a call on the computer itself and writes checked meeting notes.

## How AI fits in

Folio runs a small MCP server on the computer. One click in **Connect AI Assistants** configures Claude Desktop, Cursor,
VS Code, Windsurf or LM Studio; Claude Code gets a ready command. The assistant then has 50 tools ([list](reference/mcp-tools.md)): list, read and search
notes; edit a section; suggest a change; read a spreadsheet's computed values; place and style objects on a slide;
compare and restore versions. Assistants only see the open folder, and a switch makes them read-only.

## What Folio deliberately does not do

Real-time co-editing, accounts and sharing, a cloud sync service, a built-in AI model for writing, Notion-style
databases beyond sheets and boards, and loading remote content into documents without asking. Sync is left to whatever
the person already uses (OneDrive, iCloud, Dropbox, git).

## Where the project stands

- **Shipped**: the four editors, the MCP integration, the meeting recorder, version history, two languages; releases
  1.1.0 to 1.5.1 between 19 and 27 November 2026, all marked pre-alpha.
- **Built, not merged**: a Notion-parity pass on pages (three stacked pull requests) and Folio Sheets on Univer (a
  long-lived branch). Both are large and need review and merge decisions.
- **Before a public release**: code signing on macOS and Windows (no certificates yet), the known data-loss bugs on `main` fixed, the
  responsiveness budget met, the meeting recorder measured on a real Windows call. These are in the *Public release*
  milestone.

## Risks a decision-maker should know

| Risk | Why it matters | Mitigation in place |
|---|---|---|
| One maintainer | Bus factor of one; large branches wait on one person | These docs, `AGENTS.md` for AI agents, issue-tracked status |
| Long-lived branches | Pages and Sheets work grows apart from `main` | Merge order decision tracked in [#84](https://github.com/gabrielevaudano98/folio/issues/84) |
| Unsigned builds | Windows SmartScreen and macOS Gatekeeper warn on first open | macOS signing and notarisation are wired in the release workflow and wait for secrets ([#3](https://github.com/gabrielevaudano98/folio/issues/3)); Windows signing is not set up yet ([#4](https://github.com/gabrielevaudano98/folio/issues/4)) |
| Electron footprint | ~600 MB memory at rest measured on Linux | Measured budgets; a Tauri port was costed at 45–77 person-days in the project notes (`TAURI-ANALYSIS.md`, 21 Nov 2026) and not recommended for now; [ADR 0001](adr/0001-electron.md) says to revisit only if memory at rest becomes the main complaint |
| Data integrity in a visual editor over plain text | One bad save loses trust | Round-trip tests for every format, atomic writes, version history, undo |
| AGPL-3.0 | Anyone who distributes or serves a modified Folio must publish its source | Chosen on purpose: changes come back to the project |

## Words used in these docs

*Workspace* or *folder*: the folder open in Folio. *Page, deck, board, sheet*: the four document types. *MCP*: the
protocol assistants use to call Folio's tools. *Core / surface*: the pure model of a document type and its editor.
*Optional component*: a file an optional feature downloads, such as a speech model. More in the
[architecture glossary](architecture/README.md#12-glossary).
