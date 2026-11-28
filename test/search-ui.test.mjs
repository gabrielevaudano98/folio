// Folio search window in the real app (Ctrl+P): recent pages grouped by day, results by title and by content with a
// highlighted snippet, the preview pane, Title only, the sort chip, Enter opens the page, Esc closes; files unchanged.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-search-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.mkdirSync(path.join(ws, 'proj'), { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47619 }));
const files = {
  'proj/Launch plan.md': '---\nicon: 🚀\n---\n# Launch plan\n\nThe zephyr release ships in March.\n',
  'Diary.md': '# Diary\n\nNothing here.\n',
  'Zephyr notes.md': '# Zephyr notes\n\nTitle hit.\n',
};
for (const [p, t] of Object.entries(files)) fs.writeFileSync(path.join(ws, p), t);
const old = new Date(Date.now() - 40 * 864e5); fs.utimesSync(path.join(ws, 'Diary.md'), old, old);
const sha = () => Object.keys(files).map((p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ws, p))).digest('hex'));
const before = sha();

const ctrlP = "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, metaKey: " + String(process.platform === 'darwin') + ", bubbles: true, cancelable: true })); true";
const type = (v) => `(() => { const i = document.querySelector('#search-input'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const key = (k) => `document.querySelector('#search-input').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true })); true`;
const rows = "[...document.querySelectorAll('#search-list .search-item')].map((li) => [li.querySelector('.search-title').textContent, li.querySelector('.search-dir')?.textContent || '', li.querySelector('.search-snippet mark')?.textContent || '', li.querySelector('.search-emoji')?.textContent || ''])";
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: ctrlP, wait: 900 },
  { js: `[!document.querySelector('#search-win').hidden, document.activeElement.id, document.querySelector('#search-win [role=dialog]') !== null, [...document.querySelectorAll('#search-list .search-group')].map((g) => g.textContent), document.querySelectorAll('#search-list [role=option]').length]`, log: true, wait: 100 },
  { js: type('zephyr'), wait: 900 },
  { js: rows, log: true, wait: 100 },
  { js: "[document.querySelector('#search-input').getAttribute('aria-activedescendant'), document.querySelector('#search-preview .search-preview-title')?.textContent || '']", log: true, wait: 100 },
  { js: "document.querySelector('#search-title-only').click(); true", wait: 500 },
  { js: rows, log: true, wait: 100 },
  { js: "document.querySelector('#search-title-only').click(); true", wait: 500 },
  { js: key('ArrowDown'), wait: 400 },
  { js: "[document.querySelector('#search-list [aria-selected=true] .search-title').textContent, document.querySelector('#search-preview .search-preview-title')?.textContent, !!document.querySelector('#search-preview .search-preview-hit')]", log: true, wait: 100 },
  { js: key('Enter'), wait: 1500 },
  { js: "[document.querySelector('#search-win').hidden, document.querySelector('.tab.is-active, [data-tab][aria-selected=true]')?.dataset.tab || '']", log: true, wait: 100 },
  { js: ctrlP, wait: 900 },
  { js: "[...document.querySelectorAll('#search-list .search-group')].map((g) => g.textContent).concat([...document.querySelectorAll('#search-list .search-title')].slice(0, 1).map((x) => x.textContent))", log: true, wait: 100 },
  { js: key('Escape'), wait: 400 },
  { js: "[document.querySelector('#search-win').hidden, window.__folioErrors || []]", log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nsearch ui'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 8, out.slice(-1500));
  const [opened, typed, active, titleOnly, moved, afterEnter, recent, closed] = logs;
  assert.equal(opened[0], true); assert.equal(opened[1], 'search-input'); assert.equal(opened[2], true);
  assert.deepEqual(opened[3], ['Today', 'Older']); assert.equal(opened[4], 3);
  console.log('  ✓ Ctrl+P opens the search window (dialog, focus in the field) with recent pages grouped Today and Older');
  assert.deepEqual(typed[0], ['Zephyr notes', '', '', ''], 'the title hit comes first');
  assert.deepEqual(typed[1], ['Launch plan', 'proj', 'zephyr', '🚀'], 'the content hit has its folder, a highlighted snippet and its icon');
  assert.equal(active[0], 'sr-0'); assert.equal(active[1], 'Zephyr notes');
  console.log('  ✓ typing finds titles first, then content with folder, icon and highlighted snippet; the preview shows the selection');
  assert.deepEqual(titleOnly.map((r) => r[0]), ['Zephyr notes']);
  console.log('  ✓ Title only drops the content match');
  assert.deepEqual(moved, ['Launch plan', 'Launch plan', true]);
  assert.equal(afterEnter[0], true); assert.equal(afterEnter[1], 'proj/Launch plan.md');
  console.log('  ✓ ↓ selects and previews the content hit (match marked); Enter opens the page and closes the window');
  assert.deepEqual(recent, ['Today', 'Older', 'Launch plan']);
  assert.equal(closed[0], true); assert.deepEqual(closed[1], []);
  console.log('  ✓ the page just opened tops the recent list; Esc closes');
  assert.deepEqual(sha(), before);
  console.log('  ✓ no file changed on disk');
});
