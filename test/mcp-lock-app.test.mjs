// Page locks and the running app (#86): an assistant connected over Streamable HTTP (and through the stdio relay) cannot
// change a locked page; a lock set in the window applies to the very next AI call; a board shape id or a deck link
// target that happens to match a locked page is not taken for a path. Files checked on disk.
import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { workspace, runApp } from './harness.mjs';

const PORT = 47631;
const w = workspace('mcp-lock-app', PORT);
fs.mkdirSync(path.join(w.ws, 'pages'), { recursive: true });
const A = '# A\n\nAlpha line\n', B = '# B\n\nBeta line\n', BOARD = '```board\npages: rect "Pages" @40,40\nb: rect "B" @240,40\n```\n';
fs.writeFileSync(path.join(w.ws, 'pages', 'a.md'), A); fs.writeFileSync(path.join(w.ws, 'pages', 'b.md'), B);
fs.writeFileSync(path.join(w.ws, 'Map.board.md'), BOARD);
const settingsFile = path.join(w.ud, 'settings.json');
fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')), lockedPages: { [w.ws]: { 'pages/a.md': true } } }));

// the window waits for a file the test writes, so the test and the app take turns without sleeping on guesses
const waitFor = (f) => `new Promise((r) => { const t = setInterval(() => folio.read(${JSON.stringify(f)}).then(() => { clearInterval(t); r(true); }, () => {}), 150); })`;
const steps = [
  { size: [1200, 800], wait: 500 },
  { js: waitFor('go-lock.md'), log: true, wait: 100 },
  // lock pages/b.md from the window, the way a person does it (page menu → Lock page)
  { js: "document.querySelector('[data-dir=\"pages\"]')?.click(); true", wait: 400 },
  { js: "document.querySelector('[data-file=\"pages/b.md\"]').click(); true", wait: 1200 },
  { js: "window.__folioRun('lock-page'); true", wait: 300 },
  { js: "folio.init().then((i) => Object.keys(i.settings.lockedPages[i.settings.workspace] || {}).sort())", log: true, wait: 100 },
  { js: waitFor('go-done.md'), log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];

const text = (r) => r.content?.[0]?.text || '';
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 150)); } };
let pass = 0; const ok = (m) => { pass++; console.log('  ✓', m); };

const app = runApp(w, steps, {}, 120000);
const bridgeFile = path.join(w.ud, 'mcp-bridge.json');
const result = await (async () => {
  const bridge = await until(async () => { const b = JSON.parse(fs.readFileSync(bridgeFile, 'utf8')); return b.port && b.token ? b : null; });
  const h = new Client({ name: 'lock-http', version: '1' });
  await until(async () => { await h.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${bridge.port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${bridge.token}` } } })); return true; });
  const call = (name, args) => h.callTool({ name, arguments: args });
  console.log('\nmcp and page locks, app running');

  for (const [name, args] of [
    ['write_note', { path: 'pages/a.md', content: 'gone' }],
    ['edit_note', { path: 'pages/a.md', edits: [{ oldText: 'Alpha', newText: 'Omega' }] }],
    ['append_to_note', { path: 'pages/a.md', content: 'more' }],
    ['replace_section', { path: 'pages/a.md', heading: 'A', content: 'x' }],
    ['add_comment', { path: 'pages/a.md', quote: 'Alpha', comment: 'hm' }],
    ['suggest_edit', { path: 'pages/a.md', oldText: 'Alpha', newText: 'Omega' }],
    ['move_note', { from: 'pages/a.md', to: 'pages/z.md' }],
    ['move_note', { from: 'pages', to: 'archive' }],
    ['move_note', { from: 'pages/b.md', to: 'pages/a.md' }],
  ]) {
    const r = await call(name, args);
    assert(r.isError && /pages\/a\.md is locked in Folio\. The user can unlock it from the page menu/.test(text(r)), `${name} ${JSON.stringify(args)}: ${text(r)}`);
  }
  assert.equal(fs.readFileSync(path.join(w.ws, 'pages', 'a.md'), 'utf8'), A); assert(fs.existsSync(path.join(w.ws, 'pages', 'b.md')));
  ok('every write tool refuses a locked page (and moves of it, of its folder, or onto it) with an error that says how to unlock');

  const rd = await call('read_note', { path: 'pages/a.md' }); assert(!rd.isError && text(rd).includes('Alpha line'));
  ok('a locked page can still be read');

  const c = await call('connect', { path: 'Map.board.md', from: 'pages', to: 'b' }); assert(!c.isError, text(c));
  assert.notEqual(fs.readFileSync(path.join(w.ws, 'Map.board.md'), 'utf8'), BOARD);
  ok('a board shape named like the folder of a locked page is not mistaken for that folder');

  const s = new Client({ name: 'Cursor', version: '1' });
  await s.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp-stdio.mjs', '--bridge', bridgeFile] }));
  const rs = await s.callTool({ name: 'write_note', arguments: { path: 'pages/a.md', content: 'relayed' } });
  assert(rs.isError && /locked/.test(text(rs)), text(rs)); await s.close();
  ok('the stdio bridge relaying to the running app is refused too');

  const before = await call('append_to_note', { path: 'pages/b.md', content: 'by AI' }); assert(!before.isError, text(before));
  fs.writeFileSync(path.join(w.ws, 'go-lock.md'), '');
  // the window locks pages/b.md; the next AI call sees it without a restart or a settings file round trip
  // (until then each probe is a harmless append; once refused, no later write reaches the file)
  const refused = await until(async () => { const r = await call('append_to_note', { path: 'pages/b.md', content: 'probe' }); return r.isError ? r : (() => { throw new Error('not yet'); })(); });
  assert(/pages\/b\.md is locked/.test(text(refused)), text(refused));
  const locked = fs.readFileSync(path.join(w.ws, 'pages', 'b.md'), 'utf8');
  const again = await call('write_note', { path: 'pages/b.md', content: 'after lock' }); assert(again.isError, text(again));
  assert.equal(fs.readFileSync(path.join(w.ws, 'pages', 'b.md'), 'utf8'), locked);
  ok('a page locked in the window refuses the next AI write at once');
  await h.close();
  fs.writeFileSync(path.join(w.ws, 'go-done.md'), '');
  return app;
})().catch(async (e) => { fs.writeFileSync(path.join(w.ws, 'go-lock.md'), ''); fs.writeFileSync(path.join(w.ws, 'go-done.md'), ''); await app; throw e; });

const { js, log } = await result;
assert.equal(js.length, 4, log.slice(-1500));
const [, locked, , errors] = js;
assert.deepEqual(locked, ['pages/a.md', 'pages/b.md']);
assert.deepEqual(errors, [], 'no renderer errors');
ok('the lock lives in the app settings, per workspace folder');
console.log(`\n${pass} checks passed`);
fs.rmSync(w.tmp, { recursive: true, force: true });
