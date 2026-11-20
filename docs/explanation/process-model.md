# Why Folio is split into processes

Folio follows the rule Apple gives for responsive apps: the thread that draws the interface never waits. In Electron that
thread lives in two places, the **main process** (windows, menus, file access) and the **window** (a sandboxed Chromium
page). Anything that can take long runs somewhere else, or asynchronously.

| Process | Lives | Does | Why separate |
|---|---|---|---|
| Main | Always | Files, watcher, IPC, MCP server, menu, downloads | It owns the operating system resources; all its disk and network work is asynchronous after startup. |
| Window | Always | The interface and the editors | Sandboxed, no Node.js: a malicious document cannot reach the disk. |
| GPU, network | Always | Chromium's own helpers | Part of Electron. |
| Meeting worker | While recording | Voice detection, transcription | Uses 1–2 GB and CPU in bursts; a crash or a slow segment never freezes the app ([ADR 0006](../adr/0006-utility-process-for-transcription.md)). |
| Notes engine | After a recording | Drafts meeting notes | Frees all its memory when it exits ([ADR 0007](../adr/0007-llama-server-for-notes.md)). |
| stdio bridge | While an AI app uses it | MCP over stdio | Started by the AI app, not by Folio ([ADR 0004](../adr/0004-mcp-over-http-and-stdio.md)). |

## How they talk

- **Window → main**: `window.folio.*`, defined in `src/main/preload.cjs`. Each call is an `ipcRenderer.invoke`; the main
  process answers only calls from the app page (`h()` in `main.js`). The full list: [IPC reference](../reference/ipc.md).
- **Main → window**: events (`fs:file-changed`, `ai:edit`, `meeting:state`…).
- **Window → meeting worker**: a `MessagePort` handed over by the main process, so audio blocks skip the main process.
- **Main → notes engine**: HTTP on 127.0.0.1 with a random key for that one run.

## What stays on the main thread

Startup reads `settings.json` synchronously (a few kilobytes) and writes it atomically when a setting changes. Nothing
else in the main process uses synchronous file or network calls; a review keeps it so (`grep "Sync(" src/main`).
