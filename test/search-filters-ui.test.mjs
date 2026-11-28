// #86 in the real app: the search window's Created sort, Date and Created by filters (creators from version history),
// and Mod+P arriving twice (the page's keydown and the menu's accelerator) opening the window once without selecting
// what was typed in between. Files unchanged on disk.
import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
import { workspace, runApp } from './harness.mjs';
import { createHistory } from '../src/main/history.js';

const w = workspace('search-filters-ui', 47634);
for (const f of fs.readdirSync(w.ws)) fs.rmSync(path.join(w.ws, f), { recursive: true, force: true });
const day = 864e5, now = Date.now();
const files = { 'Alpha.md': '# Alpha\n\nzeta\n', 'Bravo.md': '# Bravo\n\nzeta\n', 'Charlie.md': '# Charlie\n\nzeta\n' };
for (const [p, t] of Object.entries(files)) fs.writeFileSync(path.join(w.ws, p), t);
// Alpha was copied in long ago (its date kept), Bravo 10 days ago, Charlie is new. (Creation is the birth time, or the
// modification time when that is older: a test cannot set a birth time, so here they move together.)
const set = (p, d) => { const t = new Date(now - d * day); fs.utimesSync(path.join(w.ws, p), t, t); };
set('Alpha.md', 200); set('Bravo.md', 10);
const h = createHistory(() => w.ws);
await h.snapshot('Charlie.md', files['Charlie.md'], { by: 'Claude Desktop', reason: 'ai', force: true });
await h.snapshot('Bravo.md', files['Bravo.md'], { reason: 'created', force: true });
await h.snapshot('Alpha.md', files['Alpha.md'], { reason: 'open', force: true });
const before = Object.keys(files).map((p) => fs.readFileSync(path.join(w.ws, p), 'utf8'));

const mod = process.platform === 'darwin' ? 'metaKey' : 'ctrlKey';
const ctrlP = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ${mod}: true, bubbles: true, cancelable: true })); true`;
const titles = "[...document.querySelectorAll('#search-list .search-item[data-path] .search-title')].map((x) => x.textContent)";
const choose = (id, v) => `(() => { const s = document.querySelector('#${id}'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
const type = (v) => `(() => { const i = document.querySelector('#search-input'); i.value = ${JSON.stringify(v)}; i.setSelectionRange(i.value.length, i.value.length); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  // 1. Mod+P from the page, then the same press through the menu: one open, the text typed in between stays as typed
  { js: ctrlP, wait: 50 }, { js: type('zet'), wait: 30 }, { menu: 'quick-open', wait: 400 },
  { js: "(() => { const i = document.querySelector('#search-input'); return [!document.querySelector('#search-win').hidden, i.value, i.selectionStart, i.selectionEnd]; })()", log: true, wait: 100 },
  { js: "document.querySelector('#search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true", wait: 300 },
  // a menu click on its own (no key press just before) still opens the window
  { menu: 'quick-open', wait: 1500 },
  { js: "!document.querySelector('#search-win').hidden", log: true, wait: 100 },
  // 2. the sort offers Created; empty query sorted by creation, newest first
  { js: "[...document.querySelectorAll('#search-sort option')].map((o) => o.value)", log: true, wait: 100 },
  { js: choose('search-sort', 'created'), wait: 400 }, { js: titles, log: true, wait: 100 },
  // 3. Date: created in the past month, edited today
  { js: choose('search-date', 'created-month'), wait: 400 }, { js: titles, log: true, wait: 100 },
  { js: choose('search-date', 'edited-today'), wait: 400 }, { js: titles, log: true, wait: 100 },
  { js: choose('search-date', ''), wait: 300 },
  // 4. Created by: the choices come from version history; each narrows the list (also while searching)
  { js: "[...document.querySelectorAll('#search-creator option')].map((o) => o.textContent)", log: true, wait: 100 },
  { js: choose('search-creator', 'Claude Desktop'), wait: 400 }, { js: titles, log: true, wait: 100 },
  { js: type('zeta'), wait: 900 }, { js: titles, log: true, wait: 100 },
  { js: choose('search-creator', ''), wait: 400 }, { js: titles, log: true, wait: 100 },
  { js: choose('search-creator', '*'), wait: 400 }, { js: titles, log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const { js, log } = await runApp(w, steps, {}, 90000);
console.log('\nsearch filters ui');
assert.equal(js.length, 12, log.slice(-1500));
const [dup, menuOpen, sorts, byCreated, createdMonth, editedToday, creators, byClaude, searchClaude, unknown, anyone, errors] = js;
assert.deepEqual(errors, [], 'no renderer errors');
assert.deepEqual(dup, [true, 'zet', 3, 3], 'the second arrival of Mod+P neither reopens nor selects the typed text');
assert.equal(menuOpen, true);
console.log('  ✓ Mod+P through the page and the menu at once opens the search window once; the menu alone still opens it');
assert.deepEqual(sorts, ['best', 'edited', 'created']);
assert.deepEqual(byCreated, ['Charlie', 'Bravo', 'Alpha']);
console.log('  ✓ Sort: Created lists the newest pages first');
assert.deepEqual(createdMonth, ['Charlie', 'Bravo']); assert.deepEqual(editedToday, ['Charlie']);
console.log('  ✓ Date: created in the past month, edited today');
assert.deepEqual(creators, ['Created by: anyone', 'Created by: you', 'Created by: Claude Desktop', 'Created by: not known']);
assert.deepEqual(byClaude, ['Charlie']); assert.deepEqual(searchClaude, ['Charlie']); assert.deepEqual(unknown, ['Alpha']); assert.equal(anyone.length, 3);
console.log('  ✓ Created by: you, the assistant that created a page, or not known (a file Folio found already there); applies to results too');
assert.deepEqual(Object.keys(files).map((p) => fs.readFileSync(path.join(w.ws, p), 'utf8')), before);
console.log('  ✓ no file changed on disk');
fs.rmSync(w.tmp, { recursive: true, force: true });
