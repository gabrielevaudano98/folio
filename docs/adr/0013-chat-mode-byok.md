# 0013. Chat mode runs in the main process on the person's own API key

- Status: Accepted
- Date: 2026-11-28
- Number 0012 is kept for the Folio Sheets decision on `feat/sheets-univer` (see issue #84).

## Context and problem

Folio is edited by outside assistants over MCP. People also want a chat inside Folio, bound to the open folder, that
creates and edits files for them. It must not weaken the workspace boundary, the Electron sandbox or the data-safety rules,
and it needs an AI account without Folio running a service.

## Options considered

- Agent loop in the main process, calling providers with `fetch`, reusing the MCP tool table
- Agent loop in the window (needs `connect-src` opened and keys in the page)
- Bundle a coding-agent SDK or CLI
- Reuse subscription sign-ins of ChatGPT, Claude or Gemini

## Decision

The loop lives in `src/main/chat/`. It calls Anthropic, OpenAI (and compatible endpoints) and Google directly with the
person's own key, stored with `safeStorage`, and runs tools through `appBackend.call`, so each existing guard applies.
Risky steps need approval by a pure policy (`policy.js`). Subscriptions are not used in phase 1: per the sources read so far (not all primary), Anthropic and Google do not allow third-party sign-in and
OpenAI allows it only for partners and open-source tools (see the provider matrix, with what was and was not read, in
[chat mode](../explanation/chat-mode.md)).

## Consequences

- Note and folder edits reuse the existing write path, so undo, history and highlights work for chat edits. Conversations in `.folio/chat/` and the key file are new files, written atomically.
- The window's CSP and sandbox are unchanged; keys never reach the renderer.
- Note text goes to the provider the person chose; the UI says so at first use.
- Each provider's wire format is ours to maintain (three small adapters, tested against a fake server).
