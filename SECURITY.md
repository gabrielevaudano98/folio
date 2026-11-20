# Security

Report vulnerabilities privately through GitHub's "Report a vulnerability" button on the Security tab
(https://github.com/gabrielevaudano98/folio/security/advisories/new), not in a public issue.

Folio's MCP server listens only on 127.0.0.1 and requires a token; AI assistants can reach only the folder open in Folio.
Reports about escaping that folder, bypassing the token, or running code from a document are the most valuable.

## What Folio defends

- **The open folder is the boundary for notes and their assets.** (Exports and the connection setup for AI apps write where you choose or where those apps keep their settings; they are not part of this boundary.) Every read and write of a note by the app or by an AI assistant is resolved against the folder and refused if it leaves it, also through a symbolic link. Hidden files and folders (`.git`, `.env`, `.ssh`) and the folder itself are off limits for changes. A link that stays inside the folder works; a link that leads to a hidden file or folder does not.
- **Notes are untrusted input.** Markdown is sanitised, diagrams run in strict mode, the page has a strict Content Security Policy, and when the app embeds a file or address a note names (in an export), it takes only media from inside the folder or from public internet addresses, checked by name, by what the name resolves to and at every redirect. Previews load remote images through the browser itself; see the limits below.
- **The window is locked down.** Only the app page can call the main process, it cannot be navigated elsewhere, and the only browser permission granted is the microphone (for narration).
- **Local server.** The MCP server binds to 127.0.0.1, checks the Host and Origin headers against DNS rebinding, and needs the bearer token, which is stored owner-only. The audience Q&A page is the one deliberate exception: while the presenter has Q&A open it listens on the local network, serves one form, and keeps up to 500 short questions in memory.

## Known limits

- The `RunAsNode` fuse is off: the MCP bridge for desktop AI clients runs inside the app binary (`--mcp-stdio`), so `ELECTRON_RUN_AS_NODE` cannot turn the binary into a Node runtime. Clients configured before 1.2.3 keep working through a legacy path; pressing Connect again rewrites them. Builds are not yet code-signed.
- Remote images in a note load in the preview straight from the browser engine, so a note you did not write can see that you opened it, and an image address can make a request to a service on your own network (the answer is never readable by the note).
- A change to the folder between the check and the write (a link swapped in at that instant) is not guarded against.
