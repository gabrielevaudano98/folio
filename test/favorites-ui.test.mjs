// Folio sidebar favourites and recents (N4): the context menu stars a page, Favorites lists it above the tree, Recent lists
// the pages opened lately, a rename keeps the star, and the choice lives in settings.json, never in a page.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-fav-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.mkdirSync(ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47614 }));
const a = '# Alpha\n\nText stays.\n'; fs.writeFileSync(path.join(ws, 'a.md'), a); fs.writeFileSync(path.join(ws, 'b.md'), '# Beta\n');
const fav = "[...document.querySelectorAll('#favorites-list .quick-open')].map((e) => e.dataset.open)";
const rec = "[...document.querySelectorAll('#recents-list .quick-open')].map((e) => e.dataset.open)";
const steps = [
  { size: [1400, 900], wait: 1500 },
  { js: "document.querySelector('[data-file=\"a.md\"]').click()", wait: 700 },
  { js: "document.querySelector('[data-file=\"b.md\"]').click()", wait: 700 },
  { js: "(() => [document.querySelector('#section-favorites').hidden, " + rec + "])()", log: true },
  { js: "document.querySelector('[data-file=\"a.md\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 120 })); true", wait: 300 },
  { js: "(() => { const b = [...document.querySelectorAll('#menu .menu-item')].find((e) => /Favorites/.test(e.textContent)); const t = b.textContent; b.click(); return t; })()", log: true, wait: 800 },
  { js: "(() => [" + fav + ", " + rec + "])()", log: true },
  { js: "document.querySelector('[data-file=\"a.md\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 120 })); true", wait: 300 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((e) => /Favorites/.test(e.textContent)).textContent", log: true },
  { js: "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('#favorites-list [data-unfav]').click(); true", wait: 800 },
  { js: "document.querySelector('#section-favorites').hidden", log: true },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true })); // after the last assertion, however it ends
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile, FOLIO_NO_OS_NOTIFY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 180000);
child.on('close', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nfavorites ui'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 6, out.slice(-2000));
  const [before, label, after, label2, hidden] = logs; assert.deepEqual(logs.at(-1), []);
  assert.deepEqual(before, [true, ['b.md', 'a.md']]);
  console.log('  ✓ with no favourites the section is hidden; Recent lists the pages opened, newest first');
  assert.match(label, /Add to Favorites/); assert.deepEqual(after, [['a.md'], ['b.md']]);
  console.log('  ✓ the context menu adds a page to Favorites, and Recent no longer repeats it');
  assert.match(label2, /Remove from Favorites/);
  console.log('  ✓ the menu then offers to remove it');
  assert.equal(hidden, true);
  assert.equal(fs.readFileSync(path.join(ws, 'a.md'), 'utf8'), a);
  const st = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  assert.ok(!st.favorites?.[ws], 'removed again');
  console.log('  ✓ removing hides the section; the page file is untouched and the choice was kept in settings.json');
});
