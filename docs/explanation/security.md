# Security model

The full policy and its known limits are in [`SECURITY.md`](../../SECURITY.md). In short:

- **Trust boundary: the open folder.** `notes.resolve()` checks every path the window or an AI names
  ([ADR 0003](../adr/0003-workspace-boundary.md)).
- **Documents are untrusted.** Markdown is sanitised (DOMPurify), diagrams run in strict mode, the page's Content Security
  Policy allows scripts only from the app (inline styles and remote `https:` images are allowed), and the window cannot
  navigate anywhere else.
- **The window has no Node.js**: `sandbox: true`, `contextIsolation: true`, and only the preload API.
- **AI access is local and authenticated**: 127.0.0.1, bearer token, Host and Origin checks, and a read-only switch.
- **Downloaded components are pinned** by address and SHA-256 ([ADR 0005](../adr/0005-optional-components-are-downloaded.md)).
- **Electron fuses** disable `NODE_OPTIONS`, inspector flags and, on macOS and Linux, run-as-node.
