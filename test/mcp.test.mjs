// Folio MCP end-to-end test. `node test/mcp.test.mjs` (direct mode) or with FOLIO_APP_BRIDGE=<bridge.json> (app relay + HTTP).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';

const text = (r) => r.content.map((c) => c.text).join('');
let pass = 0; const ok = (name) => { pass++; console.log('  ✓', name); };

async function suite(client, root, label) {
  console.log(`\n${label}`);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['list_notes', 'read_note', 'search_notes', 'edit_note', 'create_note', 'append_to_note']) assert(names.includes(n), n);
  ok(`lists ${names.length} tools`);
  const list = JSON.parse(text(await client.callTool({ name: 'list_notes', arguments: {} })));
  assert(list.some((n) => n.path === 'Roadmap.md')); ok('list_notes finds Roadmap.md');
  const s = JSON.parse(text(await client.callTool({ name: 'search_notes', arguments: { query: 'pricing' } })));
  assert(s.length >= 1); ok(`search_notes finds ${s.length} notes`);
  assert(text(await client.callTool({ name: 'read_note', arguments: { path: 'Onboarding.md' } })).includes('# Onboarding')); ok('read_note');
  const out = JSON.parse(text(await client.callTool({ name: 'get_outline', arguments: { path: 'Roadmap.md' } })));
  assert(out[0].text === 'Product roadmap'); ok('get_outline');
  await client.callTool({ name: 'edit_note', arguments: { path: 'Onboarding.md', edits: [{ oldText: '3. Connect an assistant', newText: '3. Connect an assistant\n4. Ask it to tidy a note' }] } });
  assert(fs.readFileSync(path.join(root, 'Onboarding.md'), 'utf8').includes('4. Ask it')); ok('edit_note writes the file');
  const bad = await client.callTool({ name: 'edit_note', arguments: { path: 'Onboarding.md', edits: [{ oldText: 'nope-not-here', newText: 'x' }] } });
  assert(bad.isError); ok('edit_note reports a missing match as an error');
  await client.callTool({ name: 'append_to_note', arguments: { path: 'Projects/Meeting notes.md', content: '- Agreed to ship Friday', underHeading: 'Monday' } });
  assert(fs.readFileSync(path.join(root, 'Projects/Meeting notes.md'), 'utf8').includes('Agreed to ship')); ok('append_to_note under a heading');
  await client.callTool({ name: 'create_note', arguments: { path: `Inbox/${label.length}-idea.md`, content: '# Idea\n' } });
  assert(fs.existsSync(path.join(root, `Inbox/${label.length}-idea.md`))); ok('create_note makes folders');
  const guide = text(await client.callTool({ name: 'get_format_guide', arguments: { type: 'sheet' } }));
  assert(guide.includes('sheet-md') && !guide.includes('board-md')); ok('get_format_guide returns one section');
  await client.callTool({ name: 'create_note', arguments: { path: `Calc${label.length}.sheet.md`, content: '## Data\n\n| A | B |\n| --- | --- |\n| 2 | =A2*21 |\n' } });
  const sv = JSON.parse(text(await client.callTool({ name: 'get_sheet_values', arguments: { path: `Calc${label.length}.sheet.md` } })));
  assert.equal(sv[0].rows[1].values[1], 42); ok('get_sheet_values computes formulas');
  const rv = JSON.parse(text(await client.callTool({ name: 'resolve_ref', arguments: { ref: 'Budget.sheet#Costs!H7' } })));
  assert.equal(rv.value, 'Over budget'); assert.equal(rv.path, 'Budget.sheet.md'); ok('resolve_ref computes a sheet cell');
  const bl = JSON.parse(text(await client.callTool({ name: 'get_backlinks', arguments: { path: 'Budget.sheet.md' } })));
  assert(bl.some((b) => b.path === 'Roadmap.md' && b.kind === 'embed') && bl.some((b) => b.path === 'Projects/Meeting notes.md')); ok(`get_backlinks finds ${bl.length} references`);
  await client.callTool({ name: 'create_note', arguments: { path: `Broken${label.length}.md`, content: 'See {{Nowhere#A1}}\n' } });
  const br = JSON.parse(text(await client.callTool({ name: 'find_broken_links', arguments: { path: `Broken${label.length}.md` } })));
  assert.equal(br.length, 1); assert.equal(br[0].ref, '{{Nowhere#A1}}'); ok('find_broken_links reports a missing target');
  const tg = text(await client.callTool({ name: 'get_format_guide', arguments: { type: 'template' } })); assert.match(tg, /Building a Folio slide template/); assert.match(tg, /placeholder=title/); ok('get_format_guide explains how to build a template');
  const esc = await client.callTool({ name: 'read_note', arguments: { path: '../../etc/passwd' } });
  assert(esc.isError && /escapes/.test(text(esc))); ok('refuses paths outside the workspace');
  const exe = await client.callTool({ name: 'write_note', arguments: { path: 'evil.sh', content: 'x' } });
  assert(exe.isError); ok('refuses to write non-Markdown files');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-ws-'));
fs.cpSync(new URL('./fixture', import.meta.url), root, { recursive: true });

if (!process.env.FOLIO_APP_BRIDGE) {
  const t = new StdioClientTransport({ command: process.execPath, args: ['dist/mcp-stdio.mjs', '--bridge', '/nonexistent.json', '--root', root] });
  const c = new Client({ name: 'folio-test', version: '1' });
  await c.connect(t);
  await suite(c, root, 'stdio bridge, Folio closed (direct mode)');
  await c.close();
} else {
  const bridge = JSON.parse(fs.readFileSync(process.env.FOLIO_APP_BRIDGE, 'utf8'));
  const appRoot = bridge.workspace;
  const h = new Client({ name: 'http-test', version: '1' });
  await h.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${bridge.port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${bridge.token}` } } }));
  await suite(h, appRoot, 'Streamable HTTP, Folio running');
  const open = JSON.parse(text(await h.callTool({ name: 'get_open_note', arguments: {} })));
  assert(open.path === 'Roadmap.md'); ok('get_open_note sees the note the user has open');
  await h.close();
  const bad = new Client({ name: 'bad', version: '1' });
  await assert.rejects(bad.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${bridge.port}/mcp`)))); ok('HTTP without the token is rejected');
  const s = new Client({ name: 'Cursor', version: '1' });
  await s.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp-stdio.mjs', '--bridge', process.env.FOLIO_APP_BRIDGE] }));
  const r = await s.callTool({ name: 'append_to_note', arguments: { path: 'Roadmap.md', content: '- relayed through the running app' } });
  assert(!r.isError, text(r)); ok('stdio bridge relays to the running app');
  await s.close();
}
console.log(`\n${pass} checks passed`);
