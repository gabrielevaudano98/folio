# Folio roadmap

The plan by milestone. Every open item is a GitHub issue; the milestone names match the ones on GitHub. For what is
half-built right now (open pull requests, unmerged branches, known bugs) read [STATUS.md](STATUS.md) first. The top
priority stays the same: an app people trust with their files.

## Now: Public release

What a first release that is not pre-alpha needs.

- **No known data-loss bug**: fast tab switch [#82](https://github.com/gabrielevaudano98/folio/issues/82); the page fixes from PR #77 [#81](https://github.com/gabrielevaudano98/folio/issues/81) (in *v1.6 Pages*).
- **Signed builds**: macOS Developer ID and notarisation [#3](https://github.com/gabrielevaudano98/folio/issues/3), Windows signing [#4](https://github.com/gabrielevaudano98/folio/issues/4); **auto-update** from GitHub Releases [#2](https://github.com/gabrielevaudano98/folio/issues/2) (built: installs on the Windows installer, notifies on macOS and portable; see [updates](explanation/updates.md)). No certificates are available, so #3 and #4 cannot be done now; they stay open until certificates exist.
- **Responsiveness**: startup and opening a long page under the 100 ms budget [#90](https://github.com/gabrielevaudano98/folio/issues/90).
- **Meeting recorder measured** on a real Windows call [#88](https://github.com/gabrielevaudano98/folio/issues/88).
- Accessibility of the board canvas and the sheet grid [#6](https://github.com/gabrielevaudano98/folio/issues/6).
- Release workflow without a third-party publish action [#83](https://github.com/gabrielevaudano98/folio/issues/83).

## Now: v1.6 Pages: Notion parity

Notion-grade page editing in plain Markdown. Built as three stacked pull requests:
[#69](https://github.com/gabrielevaudano98/folio/pull/69) (chips, dates, callouts, page icon) →
[#77](https://github.com/gabrielevaudano98/folio/pull/77) (data fixes, page actions, lock) →
[#79](https://github.com/gabrielevaudano98/folio/pull/79) (search window, reminders, page appearance).
Then wave 2 batch 2 [#85](https://github.com/gabrielevaudano98/folio/issues/85), the follow-ups [#86](https://github.com/gabrielevaudano98/folio/issues/86) and wave 3 [#87](https://github.com/gabrielevaudano98/folio/issues/87).

## Now: Sheets on Univer

Folio Sheets on [Univer](https://github.com/dream-num/univer), built on the branch `feat/sheets-univer`: Excel-grade grid,
pivots, charts, queries, scripts, Python, what-if, `.xlsx`/`.xlsm` round trip, a data engine process and new MCP tools.
Merge checklist in [#84](https://github.com/gabrielevaudano98/folio/issues/84); on merge it closes [#7](https://github.com/gabrielevaudano98/folio/issues/7) (virtual grid), [#14](https://github.com/gabrielevaudano98/folio/issues/14) (cross-sheet references), [#15](https://github.com/gabrielevaudano98/folio/issues/15) (field
types, validation, conditional formatting) and [#16](https://github.com/gabrielevaudano98/folio/issues/16) (import Excel and CSV). Afterwards: live sync and presence, an AI
copilot (area 28), streaming export of very large workbooks.

## Next: v1.2 Editors (open after 1.5; the name is historical)

- Slides: rulers and guides [#92](https://github.com/gabrielevaudano98/folio/issues/92), per-word styling and WordArt [#93](https://github.com/gabrielevaudano98/folio/issues/93), screen recording,
  screenshots and 3D [#94](https://github.com/gabrielevaudano98/folio/issues/94), video/GIF/image export [#97](https://github.com/gabrielevaudano98/folio/issues/97).
- Boards: connector waypoints [#11](https://github.com/gabrielevaudano98/folio/issues/11), sequence diagrams [#12](https://github.com/gabrielevaudano98/folio/issues/12), images and pen [#13](https://github.com/gabrielevaudano98/folio/issues/13).
- Charts: more types and axis titles [#17](https://github.com/gabrielevaudano98/folio/issues/17).

## Next: v1.3 AI-native

- Accept or reject each AI change [#18](https://github.com/gabrielevaudano98/folio/issues/18) (assistants can already propose with `suggest_edit`).
- Structured MCP tools for boards (slides done, sheets on the Univer branch) [#19](https://github.com/gabrielevaudano98/folio/issues/19).
- Ask your AI from inside Folio [#20](https://github.com/gabrielevaudano98/folio/issues/20).

## Later

Linux build [#23](https://github.com/gabrielevaudano98/folio/issues/23), meeting recorder on macOS [#89](https://github.com/gabrielevaudano98/folio/issues/89), picture background removal [#95](https://github.com/gabrielevaudano98/folio/issues/95), live captions [#96](https://github.com/gabrielevaudano98/folio/issues/96),
branch clean-up [#91](https://github.com/gabrielevaudano98/folio/issues/91).

## Shipped

Releases are on [GitHub Releases](https://github.com/gabrielevaudano98/folio/releases); all are pre-alpha and unsigned.

- **1.5.1** (27 Nov 2026): the speech model uses more threads on bigger processors, at most 5.
- **1.5.0** (27 Nov): one-click meeting recording from the sidebar; on Windows, an offer to record when another app starts
  a call (reads the microphone consent store, off by default); image fixes.
- **1.4.0–1.4.2** (21–22 Nov): web images in notes load only when asked; meeting recorder fixes (empty audio, no-sound warning).
- **1.3.0–1.3.2** (21 Nov): **Pages Studio** (D0–D16 and attachments in `.asset/`, [plan](PAGES-PLAN.md)); English and Italian interface; meeting
  recorder as an optional download (local Whisper, checked notes); Phase 2: lean installer (14 MB of app code), faster
  start, atomic writes, crash recovery, this documentation set.
- **1.2.0** (20 Nov): **Slides Studio** P0–P15 ([plan](SLIDES-PLAN.md)).
- **1.1.0** (19 Nov) and 1.0: page editor, slides-md with PowerPoint and PDF export, board-md canvas, sheet-md grid,
  charts, MCP server with live reversible AI edits, CI, CodeQL, Dependabot, AI reviews.

## Done in 1.4.0

- Web images in notes are opt-in. The preview and the editor no longer load them by themselves, so a note you did not write cannot tell that you opened it. A notice offers to load them for that note, or Settings loads them always; either way they go through the app's guarded fetch (public addresses only), and the page's security policy no longer allows `https:` images.

## Done in 1.2.3

- The MCP bridge now runs inside the app binary (`--mcp-stdio`), so the `RunAsNode` fuse is off on macOS and Linux (Windows keeps it, its exe gets no stdin). Existing client configs keep working; on macOS and Linux Connect rewrites them to the new form, while Windows keeps the legacy form. CI starts the packaged builds and talks MCP to them. Fuses are set per platform in `build/afterPack.cjs`.

## Done in 1.2.2

- Security review of the main process. A note can no longer pull a file from outside the open folder into an export (`file:` images, and links, are checked against the folder and limited to media types); remote images are fetched only from public addresses (checked by name and by what the name resolves to) and are limited to media types and 30 MB. Links inside the folder that lead outside are refused, as are hidden files and folders (`.git`, `.env`, `.ssh`) and changes to the folder itself, for the app and for AI assistants alike. Only the app page can call the main process, the window cannot be navigated to another page, only the microphone permission is granted, the settings file (which holds the MCP token) is owner-only, PDF export uses a private temporary folder, and the token is compared in constant time. Electron 45.4.1; the packaged app turns off `NODE_OPTIONS` and the inspector. Also fixes the image picker, which failed with an error, and asks macOS for microphone access so narration works in signed builds.

## Done in 1.2.1

- Undo and redo everywhere: one history per tab (pages, visual editor, slides, boards, sheets), toolbar buttons, Edit menu and palette; undo and redo for file actions (create, rename, move, trash); back and forward between notes.
- Security: transitive `image-size` and `katex` pinned to patched versions; CodeQL action v4; animation comment scanner without regex backtracking.
