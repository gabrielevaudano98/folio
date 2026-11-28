# Security model

The full policy and its known limits are in [`SECURITY.md`](../../SECURITY.md). In short:

- **Trust boundary: the open folder.** `notes.resolve()` checks every path the window or an AI names
  ([ADR 0003](../adr/0003-workspace-boundary.md)).
- **Documents are untrusted.** Markdown is sanitised (DOMPurify), diagrams run in strict mode, the page's Content Security
  Policy allows scripts only from the app (inline styles are allowed; web images are not, they are fetched by the app only when you ask), and the window cannot
  navigate anywhere else.
- **The window has no Node.js**: `sandbox: true`, `contextIsolation: true`, and only the preload API.
- **AI access is local and authenticated**: 127.0.0.1, bearer token, Host and Origin checks, and a read-only switch.
- **Chat mode** ([chat mode](chat-mode.md)) sends note text to the provider the person chose, with their own key kept encrypted by the OS (`safeStorage`, never plain text, never in the window). It reaches the disk only through the MCP tool layer, so every rule above applies; deleting, overwriting and bulk moves wait for the person. Note text is passed to the model as data, with an instruction not to obey it.
- **Downloaded components are pinned** by address and SHA-256 ([ADR 0005](../adr/0005-optional-components-are-downloaded.md)).
- **Updates come from this repository's GitHub releases** and are checked against the SHA-512 in the release's `latest.yml`; nothing is checked until the person asks or turns on automatic checks in Settings, and no update payload downloads without a click ([updates](updates.md)). Unsigned macOS builds cannot install updates, only announce them.
- **Electron fuses** disable `NODE_OPTIONS`, inspector flags and, on macOS and Linux, run-as-node.
