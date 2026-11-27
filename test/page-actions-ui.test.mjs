// Folio X1, X2, X4: page actions from the sidebar menu and the ••• menu. Duplicate writes "<name> copy.md" with its
// own copy of the page's files and opens it; Undo removes it. Move to… picks a folder in the quick switcher and keeps
// a link in another page correct. Copy link puts [[name]] on the clipboard. Checked on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-page-actions-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(path.join(pages, '.asset'), { recursive: true }); fs.mkdirSync(path.join(ws, 'Archive')); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47619 }));
const A = '# Alpha\n\n![Pic](.asset/11111111-pic.png)\n\nSee [[b]].\n';
fs.writeFileSync(path.join(pages, 'a.md'), A);
fs.writeFileSync(path.join(pages, '.asset', '11111111-pic.png'), Buffer.from([137, 80, 78, 71, 1, 2, 3]));
fs.writeFileSync(path.join(ws, 'b.md'), '# Bravo\n\nGo to [[pages/a]].\n');
fs.writeFileSync(path.join(ws, 'Archive', 'old.md'), '# Old\n');

const menu = (sel) => `(() => { const r = document.querySelector('${sel}'); const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 5 })); return [...document.querySelectorAll('#menu .menu-item')].map((x) => x.textContent); })()`;
const pick = (label) => `(() => { const b = [...document.querySelectorAll('#menu .menu-item')].find((x) => x.textContent === ${JSON.stringify(label)}); b.click(); return true; })()`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  // 1. sidebar menu → Duplicate: the copy opens
  { js: menu('[data-file="pages/a.md"]'), log: true, wait: 200 },
  { js: pick('Duplicate'), wait: 1500 },
  { js: '[document.querySelector("#tabs [aria-selected=true]")?.dataset.tab || document.querySelector("#tabs .is-active, #tabs [data-tab].active")?.dataset.tab || "", (window.__folioToasts || []).slice(-1)[0]]', log: true, wait: 100 },
  // 2. sidebar menu → Move to…: the quick switcher lists folders; typing filters, Enter moves
  { js: menu('[data-file="pages/a.md"]'), wait: 200 },
  { js: pick('Move to…'), wait: 400 },
  { js: '[!document.querySelector("#palette").hidden, document.querySelector("#palette-input").placeholder, [...document.querySelectorAll("#palette-list .palette-title")].map((x) => x.textContent)]', log: true, wait: 100 },
  { js: "(() => { const i = document.querySelector('#palette-input'); i.value = 'Arch'; i.dispatchEvent(new Event('input', { bubbles: true })); return [...document.querySelectorAll('#palette-list .palette-title')].map((x) => x.textContent); })()", log: true, wait: 200 },
  { js: "document.querySelector('#palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); true", wait: 1800 },
  // 3. sidebar menu → Copy link on the moved page
  { js: menu('[data-file="Archive/a.md"]'), wait: 200 },
  { js: pick('Copy link'), wait: 500 },
  { js: 'folio.readClipboard().then((r) => [r.text, (window.__folioToasts || []).slice(-1)[0]])', log: true, wait: 100 },
  // 4. ••• menu → Duplicate on the open page, then Undo in the toast removes the copy
  { js: "document.querySelector('#btn-more').click(); [...document.querySelectorAll('#menu .menu-item')].slice(0, 3).map((x) => x.textContent)", log: true, wait: 200 },
  { js: pick('Duplicate'), wait: 1500 },
  { js: '[...document.querySelectorAll("[data-file]")].map((x) => x.dataset.file).filter((f) => f.includes("copy"))', log: true, wait: 100 },
  { js: "(() => { const b = [...document.querySelectorAll('.toast .btn')].pop(); b.click(); return true; })()", wait: 1800 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile, FOLIO_FAKE_TRASH: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\npage actions ui'); if (process.env.DEBUG) console.log(logs);
  assert.equal(logs.length, 8, out.slice(-1500));
  const [items, dup, picker, filtered, copied, more, copies, errors] = logs; assert.deepEqual(errors, []);
  assert(['Duplicate', 'Move to…', 'Copy link'].every((x) => items.includes(x)), items);
  const copy = fs.readFileSync(path.join(pages, 'a copy.md'), 'utf8');
  const ref = copy.match(/\.asset\/[^)]+/)[0];
  assert.notEqual(ref, '.asset/11111111-pic.png'); assert(fs.existsSync(path.join(pages, ref)));
  assert.equal(copy.replace(ref, '.asset/11111111-pic.png'), A);
  assert.equal(dup[0], 'pages/a copy.md'); assert.match(dup[1], /a copy/);
  console.log('  ✓ sidebar Duplicate writes “a copy.md” with its own copy of the picture, links unchanged, and opens it');
  assert.equal(picker[0], true); assert.match(picker[1], /Move “a” to/);
  assert(picker[2].includes('Archive') && !picker[2].includes('pages'), picker[2]);
  assert.deepEqual(filtered, ['Archive']);
  assert(!fs.existsSync(path.join(pages, 'a.md'))); assert.equal(fs.readFileSync(path.join(ws, 'Archive', 'a.md'), 'utf8').replace(/\.asset\/[^)]+/, '.asset/11111111-pic.png'), A); // its picture follows it
  assert.equal(fs.readFileSync(path.join(ws, 'b.md'), 'utf8'), '# Bravo\n\nGo to [[Archive/a]].\n');
  console.log('  ✓ Move to… lists the other folders, filters as you type, moves on Enter and updates the link in another page');
  assert.equal(copied[0], '[[a]]'); assert.match(copied[1], /\[\[a\]\]/);
  console.log('  ✓ Copy link puts [[a]] on the clipboard and says so');
  assert.deepEqual(more, ['Duplicate', 'Move to…', 'Copy link']);
  assert(copies.includes('pages/a copy copy.md'), copies);
  assert(!fs.existsSync(path.join(pages, 'a copy copy.md')), 'Undo removed the second copy');
  assert(fs.existsSync(path.join(pages, 'a copy.md')));
  const assetsLeft = fs.readdirSync(path.join(pages, '.asset')).filter((f) => !f.startsWith('.'));
  assert.equal(assetsLeft.length, 2, `the undone copy's picture went to the asset trash: ${assetsLeft}`);
  console.log('  ✓ the ••• menu offers the same actions; Undo removes the copy and its files');
  fs.rmSync(tmp, { recursive: true, force: true });
});
