# 0001. Use Electron for the desktop app

- Status: Accepted
- Date: 2026-11-20

## Context and problem

Folio must run on Windows and macOS from one code base maintained by one person, embed rich web editors (CodeMirror, TipTap) and run Node.js for file access and the MCP server.

## Options considered

- Electron
- Tauri (Rust + system webview)
- Native apps per platform

## Decision

Electron. One JavaScript code base for the editors and the main process; the same Chromium everywhere, so the editors behave the same on every computer.

## Consequences

- One language and one rendering engine; mature tooling (electron-builder, fuses, utilityProcess).
- Larger download and memory than a system-webview app.
- Security depends on configuring Electron strictly (sandbox, context isolation, CSP, fuses), which `src/main/main.js` (sandbox, context isolation, navigation lock), `src/renderer/index.html` (CSP) and `build/afterPack.cjs` (fuses) do.

## Notes

Revisit only if memory at rest becomes the main complaint; the cores are pure JavaScript and would move.
