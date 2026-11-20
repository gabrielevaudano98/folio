# Security

Report vulnerabilities privately through GitHub's "Report a vulnerability" button on the Security tab
(https://github.com/gabrielevaudano98/folio/security/advisories/new), not in a public issue.

Folio's MCP server listens only on 127.0.0.1 and requires a token; AI assistants can reach only the folder open in Folio.
Reports about escaping that folder, bypassing the token, or running code from a document are the most valuable.

## What Folio defends

- **The open folder is the boundary.** Every read and write by the app or by an AI assistant is resolved against the folder and refused if it leaves it, also through a symbolic link. Hidden files and folders (`.git`, `.env`, `.ssh`) and the folder itself are off limits for changes. A link that stays inside the folder works.
- **Notes are untrusted input.** Markdown is sanitised, diagrams run in strict mode, the page has a strict Content Security Policy, and a note that names a file or address to embed can only pull in media from inside the folder or from the public internet.
- **The window is locked down.** Only the app page can call the main process, it cannot be navigated elsewhere, and the only browser permission granted is the microphone (for narration).
- **Local server.** The MCP server binds to 127.0.0.1, checks the Host and Origin headers against DNS rebinding, and needs the bearer token, which is stored owner-only. The audience Q&A page is the one deliberate exception: while the presenter has Q&A open it listens on the local network, serves one form, and keeps up to 500 short questions in memory.

## Known limits

- The packaged app keeps Electron's `RunAsNode` fuse on because the MCP bridge for desktop AI clients starts the app binary as Node. Builds are not yet code-signed.
- Remote images in a note are fetched by your computer when you open it, so a note you did not write can see that you opened it.
- A change to the folder between the check and the write (a link swapped in at that instant) is not guarded against.
