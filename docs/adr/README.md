# Architecture decision records

Decisions in the [MADR](https://adr.github.io/madr/) format, one per file, numbered in order. A decision is changed by a new record that supersedes it, not by editing the old one.

| # | Decision | Status |
|---|---|---|
| 0001 | [Use Electron for the desktop app](0001-electron.md) | Accepted |
| 0002 | [Markdown files on disk are the only data model](0002-markdown-files-are-the-model.md) | Accepted |
| 0003 | [One module resolves every path: the workspace boundary](0003-workspace-boundary.md) | Accepted |
| 0004 | [MCP over a local HTTP server and a stdio bridge in the app binary](0004-mcp-over-http-and-stdio.md) | Accepted |
| 0005 | [Optional features download pinned components on demand](0005-optional-components-are-downloaded.md) | Accepted |
| 0006 | [Transcription runs in a utilityProcess that lives only while recording](0006-utility-process-for-transcription.md) | Accepted |
| 0007 | [Meeting notes come from llama.cpp's server as a child process](0007-llama-server-for-notes.md) | Accepted |
| 0008 | [Write files atomically](0008-atomic-writes.md) | Accepted |
| 0009 | [Load the slides, board and sheet editors on first use](0009-lazy-visual-editors.md) | Accepted |
| 0010 | [Ship only the esbuild bundle in the installer](0010-ship-the-bundle-only.md) | Accepted |
| 0011 | [Detect calls from Windows' microphone consent store](0011-detect-calls-from-the-microphone-consent-store.md) | Accepted |
