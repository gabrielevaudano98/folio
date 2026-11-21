# 0004. MCP over a local HTTP server and a stdio bridge in the app binary

- Status: Accepted
- Date: 2026-11-20

## Context and problem

AI apps connect to tools in two ways: HTTP (Claude Code, some IDEs) and stdio (Claude Desktop, Cursor). People should not have to install Node.js.

## Options considered

- HTTP server in the main process + stdio bridge run by the Folio binary
- HTTP only
- A separate Node.js package for stdio

## Decision

The main process serves MCP on 127.0.0.1 with a bearer token and Host/Origin checks. The same binary, started with `--mcp-stdio` (`boot.js`), is the stdio bridge: it relays calls to the running app, or works on the last folder when the app is closed. One tool table (`mcp-tools.js`) serves both.

## Consequences

- Live highlights and undo when the app is open; still works when it is closed.
- RunAsNode can be off on macOS and Linux; Windows keeps it for stdin reasons (SECURITY.md).
