// Folio file drop and Page info: files dropped from the system onto a page are copied into its .asset folder (pictures shown,
// other files as a link that reads as a file card); the Details panel opens from the page menu and counts backlinks.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-drop-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.mkdirSync(ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47616 }));
fs.writeFileSync(path.join(ws, 'a.md'), '# Plan\n\nFirst line\n');
fs.writeFileSync(path.join(ws, 'b.md'), '# B\n\nSee [[a]]\n');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const drop = `(() => { const pane = document.querySelector('#pane-rich'); const dt = new DataTransfer();
  const bin = Uint8Array.from(atob('${PNG}'), (c) => c.charCodeAt(0));
  dt.items.add(new File([bin], 'dot.png', { type: 'image/png' })); dt.items.add(new File(['report body'], 'report.pdf', { type: 'application/pdf' }));
  const p = document.querySelector('.rich-prose p'); const r = p.getBoundingClientRect();
  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + 5 }); pane.dispatchEvent(over);
  const marked = pane.classList.contains('is-file-drop');
  pane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + 5 }));
  return [over.defaultPrevented, marked]; })()`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-file=\"a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1200 },
  { js: drop, log: true, wait: 2500 },
  { js: "[document.querySelectorAll('.rich-prose img').length, document.querySelectorAll('.rich-filecard').length, [...document.querySelectorAll('.rich-prose > *')].map((e) => e.tagName + '.' + e.className + ':' + e.textContent.slice(0, 30))]", log: true, wait: 200 },
  { js: "document.querySelector('#btn-more').click(); true", wait: 300 },
  { js: "(() => { const b = [...document.querySelectorAll('#menu .menu-item')].find((e) => /Page info/.test(e.textContent)); if (!b) return null; b.click(); return true; })()", log: true, wait: 900 },
  { js: "(() => { const d = document.querySelector('#dock-info'); return [d.hidden, [...d.querySelectorAll('dt')].map((e) => e.textContent)]; })()", log: true, wait: 300 },
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
  console.log('\nfile drop ui'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 5, out.slice(-2000)); assert.deepEqual(logs.at(-1), []);
  assert.deepEqual(logs[0], [true, true]);
  const assetDir = path.join(ws, '.asset'); const names = fs.readdirSync(assetDir).filter((n) => !n.startsWith('.')).map((n) => n.replace(/^[0-9a-f]{8}-/, '')).sort();
  assert.deepEqual(names, ['dot.png', 'report.pdf']);
  console.log('  ✓ dropping files on a page shows the drop outline and copies them into the page’s .asset folder');
  const md = fs.readFileSync(path.join(ws, 'a.md'), 'utf8');
  assert.match(md, /!\[dot\]\(\.asset\/[0-9a-f]{8}-dot\.png\)/); assert.match(md, /\[report\.pdf\]\(\.asset\/[0-9a-f]{8}-report\.pdf\)/);
  assert.deepEqual(logs[1].slice(0, 2), [1, 1]); assert.deepEqual(logs[1][2].map((x) => x.replace(/^(\w+)\.[^:]*:/, '$1:')), ['H1:Plan', 'P:First line', 'FIGURE:', 'P:report.pdf']);
  console.log('  ✓ the picture is shown and the other file reads as a file card; the page keeps its other lines');
  assert.equal(logs[2], true); assert.equal(logs[3][0], false);
  assert.ok(logs[3][1].includes('Backlinks') && logs[3][1].includes('Words'));
  console.log('  ✓ Page info in the page menu opens the Details panel, which now counts backlinks');
});
