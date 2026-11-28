// Folio blocks, Notion style, in the Write view: the / menu offers "insert" and "· Turn into" on a line with text,
// colours and actions (/red, /delete with an Undo toast), and a block dragged by its handle lands under the 3 px line
// or, past the right edge of another block, beside it in new columns. Checked on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-blocks-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47613 }));
fs.writeFileSync(path.join(pages, 'a.md'), '# Plan\n\nAlpha line\n\nBravo line\n\nCharlie line\n\nDelta line\n\nEcho line\n\nFoxtrot line\n');
const P = "document.querySelector('.rich-prose')";
const caretAtEnd = (n) => `(() => { const p = ${P}; p.focus(); const el = p.querySelectorAll(':scope > p')[${n}]; const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`;
const type = (t) => `document.execCommand('insertText', false, ${JSON.stringify(t)}); true`;
const key = (k) => `${P}.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true })); true`;
const rows = "[...document.querySelectorAll('.slash-item')].slice(0, 3).map((n) => n.querySelector('.slash-label').textContent)";
const hover = (n) => `(() => { const a = ${P}.querySelectorAll(':scope > p')[${n}]; const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 10, clientY: r.top + 5 })); return true; })()`;
/* drag the hovered block onto paragraph n: below it, or past its right edge */
const drag = (n, right) => `(() => { const b = ${P}.querySelectorAll(':scope > p')[${n}]; const g = document.querySelector('.block-grip'); const dt = new DataTransfer();
  g.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const r = b.getBoundingClientRect(); const x = ${right} ? r.right - 6 : r.left + 20, y = r.top + r.height * 0.8;
  b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  const line = document.querySelector('.block-drop:not([hidden])'); const shown = [!!line, line?.classList.contains('is-vertical')];
  const t = document.elementFromPoint(x, y); t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  g.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  return shown; })()`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1200 },
  // 1. on "Alpha line", /h2 offers Heading 2 (insert below) and Heading 2 · Turn into; choose Turn into
  { js: caretAtEnd(0), wait: 100 }, { js: type(' /h2'), wait: 700 },
  { js: rows, log: true, wait: 100 },
  { js: key('ArrowDown'), wait: 100 }, { js: key('Enter'), wait: 700 },
  // 2. /red colours the whole "Bravo line"
  { js: caretAtEnd(0), wait: 100 }, { js: type(' /red'), wait: 700 },
  { js: rows, log: true, wait: 100 },
  { js: key('Enter'), wait: 700 },
  // 3. /delete removes "Charlie line" and offers Undo
  { js: caretAtEnd(1), wait: 100 }, { js: type(' /delete'), wait: 700 }, { js: key('Enter'), wait: 900 },
  { js: '[window.__folioToasts || [], !!document.querySelector(".toast .btn")]', log: true, wait: 100 },
  // 4. drag "Delta line" (now the 3rd paragraph… after delete it is index 1) past the right edge of "Bravo line": two columns
  { js: hover(1), wait: 300 }, { js: drag(0, true), log: true, wait: 1800 },
  // 5. Esc selects "Echo line", Shift+↓ adds "Foxtrot line": "2 blocks"; Ctrl+D duplicates both under them
  { js: caretAtEnd(0), wait: 100 }, { js: key('Escape'), wait: 150 },
  { js: `${P}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })); true`, wait: 200 },
  { js: `document.querySelectorAll('.is-block-selected').length`, log: true, wait: 100 },
  { js: `${P}.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, metaKey: process.platform === 'darwin', bubbles: true, cancelable: true })); true`.replace('process.platform === \'darwin\'', String(process.platform === 'darwin')), wait: 800 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nblocks ui'); if (process.env.DEBUG) console.log(logs);
  assert.equal(logs.length, 6, out.slice(-1500));
  const [h2, red, del, dropped, selected, errors] = logs; assert.deepEqual(errors, []);
  assert.deepEqual(h2.slice(0, 2), ['Heading 2', 'Heading 2 · Turn into']);
  console.log('  ✓ on a line with text, / offers a block twice: insert below, or “· Turn into”');
  assert.deepEqual(red.slice(0, 2), ['Red text', 'Red background']);
  console.log('  ✓ /red finds the colours of the block');
  assert(del[0].includes('Block deleted') && del[1]);
  console.log('  ✓ /delete removes the block and offers Undo');
  assert.deepEqual(dropped, [true, true]);
  console.log('  ✓ past the right edge of a block the drop line turns into a vertical bar');
  assert.equal(fs.readFileSync(path.join(pages, 'a.md'), 'utf8'), '# Plan\n\n## Alpha line\n\n:::: columns\n::: column\n[Bravo line]{color=red}\n:::\n::: column\nDelta line\n:::\n::::\n\nEcho line\n\nFoxtrot line\n\nEcho line\n\nFoxtrot line\n');
  assert.equal(selected, 2);
  console.log('  ✓ Esc then Shift+↓ selects two blocks; Ctrl+D duplicates both');
  console.log('  ✓ on disk: the turned heading, the red block, the deleted line gone and the two new columns');
});
