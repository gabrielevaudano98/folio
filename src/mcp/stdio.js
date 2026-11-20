// Folio — stdio MCP bridge.
// Launched by Claude Desktop, Cursor, VS Code, Windsurf, Claude Code… with the Folio binary in
// ELECTRON_RUN_AS_NODE mode, so the user needs no Node install.
// If Folio is running, every call is relayed to it (live highlights, undo, open note).
// If Folio is closed, it works directly on the last opened folder.
import fs from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer, runTool } from '../main/mcp-tools.js';
import { createNotes } from '../main/notes.js';
import { createHistory } from '../main/history.js';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const bridgePath = arg('--bridge');
const rootOverride = arg('--root');

function readBridge() {
  try { return JSON.parse(fs.readFileSync(bridgePath, 'utf8')); } catch { return {}; }
}

async function relay(name, args, ctx) {
  const b = readBridge();
  if (!b.port || !b.token) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${b.port}/api/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${b.token}` },
      body: JSON.stringify({ name, args, client: ctx.client }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json();
    if (!body.ok) throw Object.assign(new Error(body.error), { fromApp: true });
    return { value: body.value };
  } catch (e) {
    if (e.fromApp) throw e;
    return null; // app not reachable: fall back to direct mode
  }
}

const notes = createNotes(() => rootOverride || readBridge().workspace);
const history = createHistory(() => rootOverride || readBridge().workspace);

const backend = {
  capabilities() {
    const b = readBridge();
    return { app: true, write: b.allowWrite !== false };
  },
  async call(name, args, ctx) {
    const r = await relay(name, args, ctx);
    if (r) return r.value;
    if (readBridge().allowWrite === false && /create|write|edit|append|move/.test(name)) throw new Error('Folio is set to read-only for AI assistants.');
    return runTool(notes, name, args, { onWrite: async (r) => { try { if (r.before != null) await history.snapshot(r.path, r.before, { reason: 'before-ai', force: true }); await history.snapshot(r.path, r.after, { by: ctx?.client || 'AI', reason: 'ai', force: true }); } catch {} } });
  },
};

const server = buildServer(backend);
await server.connect(new StdioServerTransport());
