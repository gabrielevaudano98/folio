# AGENTS.md — context for AI coding and review agents

Folio is an Electron desktop app (Windows, macOS) for Markdown documents that
AI assistants edit through MCP. Everything the user creates is a `.md` file.

## Map
- `src/main/` main process: window, IPC, file watcher, MCP HTTP server, AI app config writers.
- `src/main/notes.js` all file operations; every path goes through `resolve()` and must stay inside the workspace.
- `src/main/mcp-tools.js` MCP tool table shared by the HTTP server and `src/mcp/stdio.js`.
- `src/renderer/app.js` shell: tabs, tree, views, AI edit banner and undo.
- Document types, each a pure core plus a surface: `rich.js` (pages, TipTap), `slides-core.js`/`slides.js`/`slides-pptx.js`,
  `board-core.js`/`board.js`, `sheet-core.js`/`sheet.js`/`sheet-xlsx.js`, `chart.js` (shared charts).
- Formats are specified in `docs/FORMATS.md`. That file is also served to AI assistants by the `get_format_guide` tool.

## Invariants (reviewers: flag violations)
1. **Lossless round-trip.** Opening a file must not rewrite it. Editing one thing must not reformat unrelated text.
   Every format change ships with a test in `test/formats.test.mjs`.
2. **Workspace boundary.** No file access outside the open folder; writes only to `.md .markdown .mdx .txt` (images go to `assets/`).
3. **MCP safety.** HTTP server binds 127.0.0.1, checks the bearer token and Host/Origin. Write tools respect "Let AI edit notes".
4. **Electron security.** `contextIsolation: true`, `sandbox: true`, no `nodeIntegration`, no remote content in the app window.
5. **Design system.** Colours, fonts, radii and motion only through `src/renderer/tokens.css`. Grey palette only (chroma 0).
   No uppercase tracked labels, no emoji as icons, visible `:focus-visible`, `prefers-reduced-motion` respected.
   Exception: colours an author gives to page content (`[text]{color=…}`) use the `--content-*` tokens; the interface itself never does.
6. **Attribution.** Never remove "Based on Folio by Gabriele Vaudano" from NOTICE, README or the About window.

## Commands
- `npm ci` · `npm run build` · `npm test` (formats, MCP end to end, UI smoke test under xvfb on Linux) · `npm start`
- Packaging: `npm run dist:win`, `npm run dist:mac` (CI does both on tags).
