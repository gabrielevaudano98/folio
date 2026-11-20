// The MCP bridge must answer when launched through the Electron binary itself (no ELECTRON_RUN_AS_NODE),
// both with the new `--mcp-stdio` flag and with the script path that configs written before 1.2.3 use.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const electron = process.env.FOLIO_BINARY || createRequire(import.meta.url)('electron');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-stdio-'));
fs.writeFileSync(path.join(root, 'Hello.md'), '# Hello\n');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'));
env.FOLIO_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-ud-'));
let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.log('  ✗ ' + m); };

const sandbox = !process.env.FOLIO_BINARY && process.platform === 'linux' ? ['--no-sandbox'] : [];
async function probe(label, args) {
  const c = new Client({ name: 'stdio-binary-test', version: '1' });
  try {
    await c.connect(new StdioClientTransport({ command: electron, args: [...sandbox, ...args, '--bridge', '/nonexistent.json', '--root', root], env }));
    const tools = (await c.listTools()).tools;
    tools.length > 5 ? ok(`${label}: initialize + ${tools.length} tools`) : bad(`${label}: too few tools`);
    const r = await c.callTool({ name: 'list_notes', arguments: {} });
    JSON.stringify(r).includes('Hello') ? ok(`${label}: reads the workspace`) : bad(`${label}: list_notes missed Hello.md`);
  } catch (e) { bad(`${label}: ${e.message}`); }
  finally { await c.close().catch(() => {}); }
}
console.log('\nstdio bridge through the app binary');
// FOLIO_BINARY = a packaged build (CI): the app is inside it, so only the flag is passed
const packaged = !!process.env.FOLIO_BINARY;
await probe('--mcp-stdio', [...(packaged ? [] : ['dist/main.mjs']), '--mcp-stdio']);
if (!packaged) await probe('legacy script path', ['dist/main.mjs', 'dist/mcp-stdio.mjs']);
process.exit(failed ? 1 : 0);
