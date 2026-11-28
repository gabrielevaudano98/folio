# Chat mode

Status: design accepted, phase 1 (MVP) implemented. Decision record: [ADR 0013](../adr/0013-chat-mode-byok.md).

Folio has two ways of working in a folder.

| | Work mode (today) | Chat mode (new) |
|---|---|---|
| Main view | Tabs, editors, tree | A chat bound to the open folder |
| Who changes files | The person; an outside AI over MCP | The in-app AI, on request, with approvals |
| AI access | MCP server (unchanged) | The person's own API key (BYOK) |
| Editing by hand | Always | Yes: minimise the chat to a side panel |

Chat mode is a "Claude Project" for one folder: the conversation knows the folder's structure, can search and read every
note, and creates, edits, moves and removes files and folders. Risky steps wait for the person.

## Architecture

```
renderer  chat.js (view)  ──IPC chat:*──►  main  chat/agent.js (loop)
                                                    │  provider.stream()  ──► Anthropic | OpenAI(-compatible) | Google
                                                    │  policy.classify()  ──► auto | ask | deny
                                                    ▼
                                           the same tool table as MCP (mcp-tools.js, runTool)
                                           + two chat-only tools: create_folder, delete_path
                                                    ▼
                                           notes.js (workspace boundary), history, ai:edit highlight and undo
```

- **One tool layer.** The agent calls the same `TOOLS` and `runTool` as an outside assistant, through the same
  `appBackend.call`. So every rule that already guards MCP applies unchanged: the workspace boundary (`notes.resolve`),
  hidden files refused, only `.md .markdown .mdx .txt`, locked pages, "Let AI edit notes", version history before and after
  each write, and the live `ai:edit` highlight with one-click undo. Chat mode adds no second way to touch the disk.
- **Network only in the main process.** The window's CSP stays `connect-src 'self'`. Provider calls are `fetch` from the
  main process; the renderer never sees a key.
- **Providers are small adapters** (`src/main/chat/providers.js`) with one interface: `stream({system, messages, tools,
  signal, onText}) → {text, toolCalls, stop, usage}`. Messages are stored in one neutral shape and converted per provider.
- **The agent loop** (`src/main/chat/agent.js`) is pure and takes its provider, tool runner and approval function as
  arguments, so it is tested without a network or Electron. Limits: 24 model calls per turn, 30 000 characters per tool
  result, old tool results dropped from the context when it grows past about 400 000 characters, stop button aborts the
  request and the tool queue.
- **Conversations** are files in `<folder>/.folio/chat/<id>.json`, written with `atomic.js`, beside version history.
  Dot folders are not part of the workspace for the tree, search or any tool, so they never show up as notes.

## Permission model

The classification is a pure function (`src/main/chat/policy.js`), tested on its own.

| Step | Decision | Why |
|---|---|---|
| Read, list, search, outline, links, versions | auto | no change |
| Create a note, append, insert, edit text, comment, suggest, slide/board/sheet edits | auto | small, shown live, undo, kept in history |
| `write_note` over an existing note, `replace_section`, `restore_version` | ask | replaces content |
| `delete_path` (note or folder; other file types are refused) | ask, every time | goes to the system Trash |
| `create_folder` | auto | an empty folder; no content to lose (no version entry, so no undo; the person can delete it) |
| `move_note` | auto for the first two file moves of a turn; ask for a folder or from the third | bulk reorganisation |
| Any path outside the folder, hidden path, other file type | deny | no approval can lift it; `resolve()` refuses it |
| Anything when "Let AI edit notes" is off | deny (read-only) | invariant 3; the chat offers a button to turn it on |

An approval card says what will happen and shows the target. The choices are *Allow once*, *Allow overwrites in this chat*
(only for the "ask" class, never for deletes) and *Don't allow*; the model is told when a step was declined and carries on.
Approval waits as long as it takes and does not time out into "yes".

## Keys

Keys are stored with Electron `safeStorage` (Keychain on macOS, DPAPI on Windows, libsecret on Linux) in
`userData/ai-keys.json` (mode 0600, atomic write). If the OS offers no encryption backend, Folio refuses to store a key
and says so: it does not fall back to plain text. The window can set, replace, test and remove a key and learns only
whether one exists and its last four characters. The key is sent only to its provider's host; for an OpenAI-compatible
endpoint the person chooses the address (`https`, or `http` on localhost for local models such as Ollama or LM Studio).

## Provider matrix

Using a **subscription** (as opposed to an API key) is only acceptable where the provider allows it. Folio does not
reverse-engineer web sessions or reuse another product's OAuth client. State as of 28 November 2026. Anthropic's row is
from its own page, <https://code.claude.com/docs/en/legal-and-compliance> (read 28 Nov); the others are from news reports and
vendor pages and forum threads as noted per row; the Consumer Terms of Anthropic, OpenAI's developer docs, Antigravity's terms, Mistral's and xAI's terms were **not read** and a person should read them before phase 3.

| Provider | API key (BYOK) | Subscription in a third-party app |
|---|---|---|
| Anthropic | Yes, phase 1 | **Not through Folio's own sign-in.** Anthropic's page: it "does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users", and apps "may not collect, store, or intermediate Claude.ai credentials or session tokens". **Allowed route:** the person signs in to the *unmodified Claude Code binary* with their own subscription, and a product may run that binary ("The Claude Code binary must not be modified"). So phase 3 can add a "Claude Code (your subscription)" provider that runs the person's installed `claude` and never touches their credentials. The Consumer Terms page was not read. |
| OpenAI | Yes, phase 1 (also any OpenAI-compatible endpoint) | **Possible, for approved partners and open-source tools only.** OpenAI's help page ([Using your ChatGPT plan in other apps and sites](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)): plan use works in "participating commercial apps and sites", "launched with a limited set of partners", commercial developers complete an interest form, and "supported open-source tools remain available to all ChatGPT users" (Go, Plus, Pro, Business; usage counts against the plan). The developer rules are in the Sign in with ChatGPT developer docs (developers.openai.com/siwc), **not yet read**. Folio is AGPL open source, so it may qualify: check there. |
| Google | Yes, phase 1 | **Not allowed.** A Gemini CLI maintainer (GitHub discussion #20632, 27 Feb 2026): using "third-party software, tools, or services to harvest or piggyback on Gemini CLI's OAuth authentication ... is a direct violation", same for Antigravity quotas. Forum replies (unverified as staff) say consumer plans are for first-party surfaces only and accounts can be suspended. One later forum note says launching the unmodified `antigravity-acp` binary may be allowed: undocumented, do not rely on it. API key only. |
| Mistral | Yes, phase 1 (Mistral's own API; also reachable as OpenAI-compatible) | **Nothing official.** Mistral's Vibe 2.0 post offers Vibe with Le Chat Pro/Team or "your own API key" and says nothing on third-party apps. Community notes describe undocumented sign-in endpoints. Treat as not allowed. Mistral's terms not read. |
| OpenRouter, xAI (Grok) | Yes, phase 1 (OpenAI wire format, fixed address) | OpenRouter: n/a (pay-per-use). xAI: reported by a competitor's blog only (not xAI's pages) that SuperGrok sign-in works in Grok Build and OpenCode; unverified, with reports of HTTP 403. |
| Other OpenAI-compatible services | Yes, phase 1 (address field) | n/a |
| Local models | Phase 2b: one-click download, see below | n/a |

So "connect my ChatGPT, Claude or Gemini subscription" is: not in phase 1. For Claude the sanctioned way is to drive the
person's own Claude Code (phase 3); for Gemini probably no way; for ChatGPT to be checked. Folio ships what is allowed and
adds a subscription route only where the provider's own terms say it is fine.

## Local models (phase 2b)

A simple flow to download a model and run it inside Folio, reusing the pinned-download and `llama-server` machinery of the
meeting notes ([ADR 0005](../adr/0005-optional-components-are-downloaded.md), [ADR 0007](../adr/0007-llama-server-for-notes.md)).
At first use Folio reads the computer's cores, RAM and free disk (no special permission), recommends a model, and asks before
downloading. The catalogue holds at least 12 open models in quantised GGUF form, from a 1B-class model that runs on a dual-core
PC with 8 GB of RAM up to larger ones for strong machines, each pinned by address and SHA-256, with licence shown. Tool
calling quality drops with size, so small models start in a read-and-suggest mode and the UI says so. Tracked in [#115](https://github.com/gabrielevaudano98/folio/issues/115).

## Experience

- A segmented **Work | Chat** control in the title bar (also in the command palette). The choice is remembered per folder.
- **Chat, full:** the chat fills the window. A header names the folder, model and a conversation menu (new, switch,
  delete). The composer sends on Enter, Shift+Enter for a new line, a stop button replaces send while it runs.
- **Chat, minimised:** the chat becomes a 380 px panel on the right and the normal editor shows beside it. The same
  conversation continues; edits it makes light up in the margin exactly as they do for an outside assistant.
- Tool steps show as quiet one-line rows ("Read Roadmap.md", "Edited Plan.md", "Created Ideas/") that link to the note.
  Approvals are cards in the stream. After a delete, the row has a *Restore* button.
- Empty state: a missing key leads straight to *Add an API key* (Settings → AI).
- Grey palette, tokens only, visible focus, reduced motion respected (invariant 5).

## Phases

1. **MVP (this PR).** BYOK Anthropic, OpenAI, Google and OpenAI-compatible; keychain storage; agent loop with streaming;
   policy and approval cards; `create_folder`, `delete_path`; conversations on disk; Work/Chat switch with full and
   minimised layouts; Settings → AI; tests.
2. **Project context.** Per-folder instructions and memory file, `@note` mentions, relevant-note auto-selection,
   prompt caching, token and cost meter, retry, cancel per tool. Turn-level undo (restore every file a turn touched).
3. **Subscriptions** where allowed (OpenAI sign-in; Claude Code as a local backend), after reading each provider's terms.
4. **Project management.** Plan-then-approve for large reorganisations; tasks and milestones kept as ordinary `.board.md`
   and `.md` files the person can edit; the per-change accept/reject review ([#18](https://github.com/gabrielevaudano98/folio/issues/18))
   inside the chat; the "Ask AI" command on a selection ([#20](https://github.com/gabrielevaudano98/folio/issues/20))
   on the same agent. Work mode keeps MCP and gets the in-app helper later, as asked.

## Out of scope

Accounts, Folio-hosted models, sharing a chat, sending note text anywhere except the provider the person chose, and any
write outside the open folder.
