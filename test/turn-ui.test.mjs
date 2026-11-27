// Shortcut and sidebar fixes, checked on screen and on disk: Mod+Alt+C fires only the Format painter (not a code block),
// a sidebar item dropped on a note goes into that note's folder (on a folder, into the folder), and the / menu and the
// block menu mark the current block type with a check and aria-current.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-turn-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.mkdirSync(path.join(ws, 'docs'), { recursive: true }); fs.mkdirSync(path.join(ws, 'other')); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47619, expanded: ['docs', 'other'] }));
fs.writeFileSync(path.join(ws, 'main.md'), '## Title\n\nAlpha line\n');
fs.writeFileSync(path.join(ws, 'r1.md'), 'one\n'); fs.writeFileSync(path.join(ws, 'r2.md'), 'two\n');
fs.writeFileSync(path.join(ws, 'docs', 'a.md'), 'a\n'); fs.writeFileSync(path.join(ws, 'other', 'b.md'), 'b\n');
fs.mkdirSync(path.join(ws, 'other', 'sub'));
const P = "document.querySelector('.rich-prose')";
const caretIn = (sel, n) => `(() => { const p = ${P}; p.focus(); const el = p.querySelectorAll(${JSON.stringify(sel)})[${n}]; const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`;
const type = (t) => `document.execCommand('insertText', false, ${JSON.stringify(t)}); true`;
const key = (k) => `${P}.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true })); true`;
const drop = (from, onSel) => `(() => { const src = document.querySelector('[data-file="${from}"]'); const dt = new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const t = document.querySelector(${JSON.stringify(onSel)}); t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const hl = [...document.querySelectorAll('.drop-target')].map((x) => x.dataset.dir);
  t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); return hl; })()`;
const current = "[...document.querySelectorAll('.slash-item[aria-current=\"true\"]')].map((n) => n.querySelector('.slash-label').textContent + '|' + !!n.querySelector('.slash-check svg'))";
const steps = [
  { size: [1400, 900], wait: 1200 },
  // sidebar drops
  { js: drop('r1.md', '[data-file="docs/a.md"]'), log: true, wait: 900 },
  { js: drop('r2.md', '[data-dir="other"]'), log: true, wait: 900 },
  { js: "document.querySelector('[data-file=\"main.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1200 },
  // Mod+Alt+C on a paragraph: painter on, no code block
  { js: caretIn(':scope > p', 0), wait: 100 },
  { js: `${P}.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, metaKey: ${process.platform === 'darwin'}, altKey: true, bubbles: true, cancelable: true })); true`, wait: 400 },
  { js: "[!!document.querySelector('.is-painting'), document.querySelectorAll('.rich-prose pre, .rich-code').length]", log: true, wait: 100 },
  { js: key('Escape'), wait: 200 },
  // / menu on the heading: Heading 2 is current; on the paragraph: Text
  { js: caretIn(':scope > h2', 0), wait: 100 }, { js: type(' /h'), wait: 700 },
  { js: current, log: true, wait: 100 },
  { js: key('Escape'), wait: 300 },
  // block menu on the paragraph
  { js: `(() => { const a = ${P}.querySelectorAll(':scope > p')[0]; const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 10, clientY: r.top + 5 })); return true; })()`, wait: 300 },
  { js: "document.querySelector('.block-grip').click(); true", wait: 400 },
  { js: "[...document.querySelectorAll('.block-turn[aria-current=\"true\"]')].map((n) => n.dataset.turn + '|' + !!n.querySelector('.block-mi-check svg'))", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nturn ui'); if (process.env.DEBUG) console.log(logs, out.slice(-800));
  assert.equal(logs.length, 6, out.slice(-1500));
  const [d1, d2, painter, slash, block, errors] = [logs[0], logs[1], logs[2], logs[3], logs[4], logs[5]];
  assert.deepEqual(errors, []);
  assert(fs.existsSync(path.join(ws, 'docs', 'r1.md')) && !fs.existsSync(path.join(ws, 'r1.md')), 'r1.md should be in docs/');
  console.log('  ✓ a note dropped on a note row goes into that note\'s folder, not the root');
  assert(fs.existsSync(path.join(ws, 'other', 'r2.md')) && !fs.existsSync(path.join(ws, 'r2.md')));
  console.log('  ✓ a note dropped on a folder goes into that folder');
  assert.deepEqual(painter, [true, 0]); console.log('  ✓ Mod+Alt+C turns on the Format painter only: no code block appears');
  assert.deepEqual(slash, ['Heading 2 · Turn into|true']); console.log('  ✓ the / menu marks the current block type (Heading 2) with a check and aria-current');
  assert.deepEqual(block, ['text|true']); console.log('  ✓ the block menu marks the current type (Text) with a check and aria-current');
});
