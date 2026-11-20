# 0007. Meeting notes come from llama.cpp's server as a child process

- Status: Accepted
- Date: 2026-11-20

## Context and problem

node-llama-cpp, the obvious Node binding, crashes inside Electron 45 (main process, utility process and run-as-node) while loading a model, most likely on V8's memory cage. Its install also brings large GPU builds.

## Options considered

- llama.cpp's `llama-server` as a child process, HTTP on 127.0.0.1 with a random key
- node-llama-cpp in a utilityProcess
- No local notes: let the person's AI summarise through MCP

## Decision

`src/main/meeting/notes-engine.js` starts `llama-server` for one meeting, asks for notes as JSON constrained by a schema, and stops it. The model only proposes: `notes-core.js` keeps an item only when its quote is on the cited line, exactly or with at least 80% of its words in the same order (small models reword slightly); owners and dates must appear on the line as written.

## Consequences

- No addon ABI issues; every byte of the model is freed when the process exits.
- One more executable to download and keep pinned.
- Summarising through MCP stays possible for people who prefer a larger model.
