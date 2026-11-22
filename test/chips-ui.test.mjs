// Folio status chips in the Write view: a click opens the page's own status words; choosing one rewrites only that field.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-chips-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47595 }));
const original = '---\nfolio:\n  status: [Idea, Design, Shipped]\n---\n# Launch\n\nState: [status:: Idea] and more text.\n';
fs.writeFileSync(path.join(pages, 'a.md'), original);
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 900 },
  { js: "const el = document.querySelector('.rich-status'); const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, button: 0, clientX: r.left + 8, clientY: r.top + r.height / 2 }; el.dispatchEvent(new MouseEvent('mousedown', o)); el.dispatchEvent(new MouseEvent('mouseup', o)); el.dispatchEvent(new MouseEvent('click', o)); [...document.querySelectorAll('#menu .menu-item')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())", log: true, wait: 400 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.includes('Shipped')).click(); true", wait: 2500 },
  { js: "document.querySelector('.rich-status')?.textContent", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nchips ui'); if (process.env.DEBUG) console.log(logs);
  assert.equal(logs.length, 3, out.slice(-1500));
  const [menu, chip, errors] = logs; assert.deepEqual(errors, []);
  assert.deepEqual(menu.map((m) => m.replace('✓ ', '')), ['Idea', 'Design', 'Shipped']); assert(menu[0].startsWith('✓'));
  assert.equal(chip, 'Shipped'); // the chip reads as its value; the file keeps the field (checked below)
  assert.equal(fs.readFileSync(path.join(pages, 'a.md'), 'utf8'), original.replace('[status:: Idea]', '[status:: Shipped]'));
  console.log('  ✓ clicking a status chip offers the words of the page’s front matter; the choice rewrites only that field');
});
