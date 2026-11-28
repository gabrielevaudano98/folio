# Security model

The full policy and its known limits are in [`SECURITY.md`](../../SECURITY.md). In short:

- **Trust boundary: the open folder.** `notes.resolve()` checks every path the window or an AI names
  ([ADR 0003](../adr/0003-workspace-boundary.md)).
- **Documents are untrusted.** Markdown is sanitised (DOMPurify), diagrams run in strict mode, the page's Content Security
  Policy allows scripts only from the app (inline styles are allowed; web images are not, they are fetched by the app only when you ask), and the window cannot
  navigate anywhere else.
- **The window has no Node.js**: `sandbox: true`, `contextIsolation: true`, and only the preload API.
- **AI access is local and authenticated**: 127.0.0.1, bearer token, Host and Origin checks, a read-only switch, and page locks: a page the user locked (page menu → Lock page) refuses every write tool, whether Folio is running (HTTP or stdio relay) or closed (the stdio bridge reads the locks from `settings.json`).
- **Downloaded components are pinned** by address and SHA-256 ([ADR 0005](../adr/0005-optional-components-are-downloaded.md)).
- **Updates come from this repository's GitHub releases** and are checked against the SHA-512 in the release's `latest.yml`; nothing is checked until the person asks or turns on automatic checks in Settings, and no update payload downloads without a click ([updates](updates.md)). Unsigned macOS builds cannot install updates, only announce them.
- **Electron fuses** disable `NODE_OPTIONS`, inspector flags and, on macOS and Linux, run-as-node.
