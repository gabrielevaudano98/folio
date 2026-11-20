# Add an MCP tool

1. Add an entry to `TOOLS` in `src/main/mcp-tools.js`: `name` (snake_case), `title`, `description` written for an AI
   assistant, `write: true` if it changes files, `appOnly: true` if it needs the open app, `annotations` (`ro` or `rw`)
   and `input` as zod fields with `.describe()`.
2. Implement it in `runTool()` in the same file. Go through `notes` for every file access; never use `fs` directly with
   a path that came from the AI.
3. If it changes files, pass the result of the `notes` write (`{ path, before, after }`) through the `wrote(result, verb)`
   helper in `runTool()`: it calls the app's `onWrite` hook, which highlights the change and offers Undo.
4. Add a case to `test/mcp.test.mjs` (stdio always; HTTP too when `FOLIO_APP_BRIDGE` points to a running app).
5. Regenerate the reference: `node scripts/docs-reference.mjs` (the test suite fails until you do).
