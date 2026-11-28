# Why Folio is split into processes

Folio follows the rule Apple gives for responsive apps: the thread that draws the interface never waits. In Electron that
thread lives in two places, the **main process** (windows, menus, file access) and the **window** (a sandboxed Chromium
page). Anything that can take long runs somewhere else, or asynchronously.

| Process | Lives | Does | Why separate |
|---|---|---|---|
| Main | Always | Files, watcher, IPC, MCP server, menu, downloads | It owns the operating system resources; reading and writing notes and all network work are asynchronous; the few small synchronous calls are listed below. |
| Window | Always | The interface and the editors | Sandboxed, no Node.js: a malicious document cannot reach the disk. |
| GPU, network | Always | Chromium's own helpers | Part of Electron. |
| Meeting worker | While recording and finishing the transcript | Voice detection, transcription | Uses 1–2 GB and CPU in bursts; a crash or a slow segment never freezes the app ([ADR 0006](../adr/0006-utility-process-for-transcription.md)). |
| Sheets data engine | From the first import, query, script, Python, what-if or export until 60 s idle | Files, FQL, DuckDB, QuickJS, Pyodide, node-forge, headless Univer | Heap capped at 3 GB; one call at a time, a call that runs away is stopped and the engine restarts ([ADR 0012](../adr/0012-sheets-on-univer-with-a-data-engine.md)). |
| Sheets formula worker | While a workbook is open (a Web Worker of the window) | Univer's formula engine: recalculation, dependency trees, formulas inside validation and formatting rules | A workbook with tens of thousands of formulas recalculates without freezing the grid; same sandbox as the window. `folio.sheets.worker` = `off` in the window's storage keeps formulas on the window's thread. |
| Notes engine | After a recording | Drafts meeting notes | Frees all its memory when it exits ([ADR 0007](../adr/0007-llama-server-for-notes.md)). |
| stdio bridge | While an AI app uses it | MCP over stdio | Started by the AI app, not by Folio ([ADR 0004](../adr/0004-mcp-over-http-and-stdio.md)). |

## How they talk

- **Window → main**: `window.folio.*`, defined in `src/main/preload.cjs`. Each call is an `ipcRenderer.invoke`; the main
  process answers only calls from the app page (`h()` in `main.js`). The full list: [IPC reference](../reference/ipc.md).
- **Main → window**: events (`fs:file-changed`, `ai:edit`, `meeting:state`…).
- **Window → meeting worker**: a `MessagePort` handed over by the main process, so audio blocks skip the main process.
- **Window ↔ formula worker**: Univer's RPC (`@univerjs/rpc`) carries the workbook and its mutations; a `MessageChannel`
  carries custom functions (the worker asks, the window answers through the data engine) and the save baseline.
- **Main → notes engine**: HTTP on 127.0.0.1 with a random key for that one run.

## What stays on the main thread

Startup reads `settings.json` synchronously (a few kilobytes). Setting changes are batched and written asynchronously,
with one synchronous write at quit. The remaining synchronous calls are small and bounded: path checks in
`notes.resolve()` (`realpathSync`, `lstatSync`), a few `existsSync` checks in IPC handlers, the `mcp-bridge.json` write,
and clean-up at quit. Reading, writing and listing notes, the watcher and every network call are asynchronous. Review new
code with `grep -n "Sync(" src/main` and keep that list from growing.
