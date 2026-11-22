// Folio day chips in the Write view: [[2026-11-23]] reads as "@Tomorrow" (no brackets, no ISO), a click opens the date
// popover and choosing a day rewrites only that link; the caret inside a chip shows its source; Backspace removes a chip whole.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-dates-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47611 }));
const pad = (n) => String(n).padStart(2, '0'); const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(); const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
const original = `# Plan\n\nDue [[${key(tomorrow)}]] and [status:: Done] then [[${key(today)}]] end\n`;
fs.writeFileSync(path.join(pages, 'a.md'), original);
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1200 },
  // chips read as words, the source is still in the text
  { js: "[[...document.querySelectorAll('.rich-chip')].map((c) => c.textContent), document.querySelector('.rich-prose p').textContent.includes('[[')]", log: true, wait: 100 },
  // a click opens the popover; a typed day is picked with Enter
  { js: "(() => { const el = document.querySelector('.rich-chip.is-date'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 3, clientY: r.top + 3 })); return [!!document.querySelector('.date-pop'), document.activeElement?.className]; })()", log: true, wait: 400 },
  { js: "(() => { const i = document.querySelector('.date-input'); i.value = '2030-01-15'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()", wait: 2500 },
  { js: "[...document.querySelectorAll('.rich-chip.is-date')].map((c) => c.dataset.day).join(',')", log: true, wait: 100 },
  // the caret inside a chip shows its source
  { js: "(() => { const p = document.querySelector('.rich-prose'); p.focus(); const src = p.querySelector('.rich-chip-src'); const r = document.createRange(); r.setStart(src.firstChild, 4); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()", wait: 400 },
  { js: "[document.querySelectorAll('.rich-chip').length, document.querySelectorAll('.rich-chip-src').length]", log: true, wait: 100 },
  // Backspace right after a chip removes it whole: put the caret just after the last day chip (before " end")
  { js: "(() => { const p = document.querySelector('.rich-prose'); const srcs = [...p.querySelectorAll('.rich-chip-src')]; const last = srcs.at(-1); const r = document.createRange(); r.setStartAfter(last); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()", wait: 400 },
  { js: "document.querySelector('.rich-prose').dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })); true", wait: 2500 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\ndate chips ui'); if (process.env.DEBUG) console.log(logs);
  assert.equal(logs.length, 5, out.slice(-1500));
  const [labels, pop, days, inside, errors] = logs; assert.deepEqual(errors, []);
  assert.deepEqual(labels[0], ['Tomorrow', 'Done', 'Today']); assert.equal(labels[1], true);
  console.log('  ✓ day links and a status read as words; the source stays in the text');
  assert.equal(pop[0], true); assert.match(pop[1], /date-input/);
  assert.equal(days.split(',')[0], '2030-01-15');
  console.log('  ✓ a click opens the date popover with the field focused; a typed day is written as [[YYYY-MM-DD]]');
  assert.equal(inside[0], 2); assert.equal(inside[1], 2);
  console.log('  ✓ with the caret inside a chip, that chip shows its source');
  assert.equal(fs.readFileSync(path.join(pages, 'a.md'), 'utf8'), `# Plan\n\nDue [[2030-01-15]] and [status:: Done] then  end\n`);
  console.log('  ✓ only the picked link changed in the file, and Backspace after a chip removed it whole');
});
