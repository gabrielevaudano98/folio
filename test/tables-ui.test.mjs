// Folio tables in the Write view: drag a row grip to reorder rows; the Header row switch leaves the header empty (valid GFM) and back.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-tables-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47596 }));
fs.writeFileSync(path.join(pages, 'a.md'), '# T\n\n| Name | Qty |\n| --- | --- |\n| Pear | 3 |\n| Apple | 10 |\n| Fig | 2 |\n\nEnd.\n');
const cell = (t) => `[...document.querySelectorAll('.rich-prose td, .rich-prose th')].find((c) => c.textContent === ${JSON.stringify(t)})`;
const hover = (t) => `(() => { const el = ${cell(t)}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 8, clientY: r.top + r.height / 2 })); return true; })()`;
const dragRow = (from, to) => `(() => { const g = document.querySelector('.tbl-row'); const a = g.getBoundingClientRect(); const t = ${cell(to)}.getBoundingClientRect(); const o = (x, y) => ({ bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y });
  g.dispatchEvent(new PointerEvent('pointerdown', o(a.left + 5, a.top + 5))); window.dispatchEvent(new PointerEvent('pointermove', o(a.left + 5, a.top + 20))); window.dispatchEvent(new PointerEvent('pointermove', o(t.left + 5, t.top + 2))); window.dispatchEvent(new PointerEvent('pointerup', o(t.left + 5, t.top + 2))); return true; })()`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 900 },
  { js: hover('Fig'), wait: 400 },
  { js: dragRow('Fig', 'Pear'), wait: 2500 },
  { js: "[...document.querySelectorAll('.rich-prose tbody tr')].map((r) => r.textContent).join('|')", log: true, wait: 100 },
  { js: hover('Apple'), wait: 400 },
  { js: "document.querySelector('.tbl-row').click(); [...document.querySelectorAll('.table-menu .menu-item, [role=menuitem], [role=menuitemcheckbox]')].map((b) => b.textContent.trim()).includes('Header row')", log: true, wait: 400 },
  { js: "[...document.querySelectorAll('[role=menuitem], [role=menuitemcheckbox]')].find((b) => b.textContent.trim() === 'Header row').click(); true", wait: 2500 },
  { js: "document.querySelector('.tbl-nohead') != null", log: true, wait: 100 },
  { js: hover('Apple'), wait: 400 },
  { js: "document.querySelector('.tbl-row').click(); true", wait: 400 },
  { js: "[...document.querySelectorAll('[role=menuitem], [role=menuitemcheckbox]')].find((b) => b.textContent.trim() === 'Header row').click(); true", wait: 2500 },
  { js: "document.querySelector('.tbl-nohead') != null", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
let mid = null;
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const poll = setInterval(() => { const t = fs.readFileSync(path.join(pages, 'a.md'), 'utf8'); if (/\|\s*\|\s*\|\n/.test(t) && !mid) mid = t; }, 150);
const timer = setTimeout(() => child.kill(), 120000);
child.on('exit', () => {
  clearTimeout(timer); clearInterval(poll);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\ntables ui'); if (process.env.DEBUG) console.log(logs, mid, fs.readFileSync(path.join(pages, 'a.md'), 'utf8'));
  assert.equal(logs.length, 5, out.slice(-1500));
  const [order, hasItem, hidden, shownAgain, errors] = logs; assert.deepEqual(errors, []);
  assert.equal(order, 'NameQty|Fig2|Pear3|Apple10'); console.log('  ✓ dragging a row grip moves the row');
  assert(hasItem && hidden === true); assert(mid && /\|\s*\|\s*\|\n\|\s*-+\s*\|\s*-+\s*\|\n\|\s*Name/.test(mid), mid);
  assert.equal(shownAgain, false);
  assert.equal(fs.readFileSync(path.join(pages, 'a.md'), 'utf8'), '# T\n\n| Name  | Qty |\n| ----- | --- |\n| Fig   | 2   |\n| Pear  | 3   |\n| Apple | 10  |\n\nEnd.\n');
  console.log('  ✓ Header row off leaves an empty GFM header (hidden); on removes it again, byte for byte');
});
