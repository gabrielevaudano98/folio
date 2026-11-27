// Folio per-page appearance (W2-C): the Appearance popover of the page menu (font, small text, full width, table of
// contents) in the Write and Read views, the cover (gradient, picture, reposition, remove) and the floating contents.
// Every step is checked on disk: only the page's own front matter lines change.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-appearance-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47614 }));
const ORIGINAL = '# One\n\nAlpha\n\n## Two\n\nBravo\n';
fs.writeFileSync(path.join(pages, 'a.md'), ORIGINAL);
// a small valid PNG (1x1) as the cover picture
const png = path.join(tmp, 'sky.png');
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

const A = "document.querySelector('.ap-pop')";
const read = "folio.read('pages/a.md')";
const click = (sel) => `document.querySelector(${JSON.stringify(sel)}).click(); true`;
const openMenu = [
  { js: click('#btn-more'), wait: 300 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((b) => /Appearance/.test(b.textContent)).click(); true", wait: 400 },
];
const toggle = (sel) => ({ js: click(sel), wait: 1100 });
const view = (v) => ({ js: click(`#view-switch [data-view="${v}"]`), wait: 900 });
const state = `({ font: document.querySelector('.rich-page')?.dataset.font || '', small: document.querySelector('.rich-page')?.dataset.smallText || '', full: document.querySelector('.rich-page')?.dataset.fullWidth || '', toc: [...document.querySelectorAll('.rich-scroll .page-toc:not([hidden]) .page-toc-list button')].map((b) => b.textContent), rail: document.querySelectorAll('.rich-scroll .page-toc:not([hidden]) .page-toc-rail i').length })`;
const stateRead = `({ font: document.querySelector('#preview').dataset.font || '', small: document.querySelector('#preview').dataset.smallText || '', full: document.querySelector('#preview').dataset.fullWidth || '', toc: [...document.querySelectorAll('#pane-preview .page-toc:not([hidden]) .page-toc-list button')].map((b) => b.textContent), listed: !!document.querySelector('#preview .frontmatter') })`;
/* drag the cover picture up by 60 px (pointer events) */
const drag = `(() => { const c = document.querySelector('.page-cover.is-repositioning'); const r = c.getBoundingClientRect(); const e = (t, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, clientX: r.left + 100, clientY: y })); e('pointerdown', r.top + 150); e('pointermove', r.top + 90); e('pointerup', r.top + 90); return true; })()`;

const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  view('edit'),
  // Write view: the popover; each option writes its own line
  ...openMenu, { js: `!!${A} && ${A}.querySelectorAll('.ap-font').length`, log: true, wait: 100 },   // 0: 3
  toggle('.ap-font[data-font="serif"]'), { js: read, log: true, wait: 100 },                         // 1
  toggle('.ap-row[data-opt="small-text"]'), toggle('.ap-row[data-opt="full-width"]'), toggle('.ap-row[data-opt="toc"]'),
  { js: read, log: true, wait: 100 }, { js: state, log: true, wait: 100 },                           // 2, 3
  { js: "document.querySelector('.props .prop-row') ? document.querySelector('.props').textContent : 'no properties listed'", log: true, wait: 100 }, // 4: the keys are not listed
  toggle('.ap-font[data-font=""]'), toggle('.ap-row[data-opt="small-text"]'), toggle('.ap-row[data-opt="full-width"]'), toggle('.ap-row[data-opt="toc"]'),
  { js: read, log: true, wait: 100 }, { js: state, log: true, wait: 100 },                           // 5, 6: back to the original
  { js: "document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); !document.querySelector('.ap-pop')", log: true, wait: 100 }, // 7
  // cover: a gradient, then a picture, a position, the Read view, remove
  { js: click('.props-cover-add'), wait: 400 }, toggle('.ap-grad[data-grad="3"]'), { js: read, log: true, wait: 100 }, // 8
  { js: click('[data-cover="change"]'), wait: 400 }, { js: click('.ap-act[data-act="upload"]'), wait: 1500 },
  { js: read, log: true, wait: 100 },                                                                // 9
  { js: "new Promise((r) => setTimeout(() => r(!!document.querySelector('.page-cover-img')?.src && document.querySelector('.page-cover-img').naturalWidth), 600))", log: true, wait: 100 }, // 10
  { js: click('[data-cover="reposition"]'), wait: 300 }, { js: drag, wait: 1200 }, { js: read, log: true, wait: 100 }, // 11
  view('preview'), { js: "({ cover: !!document.querySelector('#preview .page-cover-read img')?.src, listed: !!document.querySelector('#preview .frontmatter') })", log: true, wait: 300 }, // 12
  // Read view: the popover works there too and the contents float
  ...openMenu, toggle('.ap-font[data-font="mono"]'), toggle('.ap-row[data-opt="toc"]'), toggle('.ap-row[data-opt="full-width"]'),
  { js: read, log: true, wait: 100 }, { js: stateRead, log: true, wait: 100 },                       // 13, 14
  toggle('.ap-font[data-font=""]'), toggle('.ap-row[data-opt="toc"]'), toggle('.ap-row[data-opt="full-width"]'),
  { js: "document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); true", wait: 100 },
  view('edit'), { js: click('[data-cover="remove"]'), wait: 1200 }, { js: read, log: true, wait: 100 }, // 15: back to the original
  { js: 'window.__folioErrors || []', log: true, wait: 100 },                                         // 16
];
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true })); // after the last assertion, however it ends
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile, FOLIO_PICK_IMAGE: png }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 120000);
child.on('close', () => { // 'close': after the output is fully drained
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nappearance ui'); if (process.env.DEBUG) console.log(logs);
  assert.equal(logs.length, 17, out.slice(-1500));
  const fm = (lines) => `---\n${lines.map((l) => l + '\n').join('')}---\n${ORIGINAL}`;
  assert.equal(logs[0], 3);
  assert.equal(logs[1], fm(['font: serif']));
  assert.equal(logs[2], fm(['font: serif', 'small-text: true', 'full-width: true', 'toc: true']));
  assert.deepEqual([logs[3].font, logs[3].small, logs[3].full, logs[3].toc], ['serif', 'true', 'true', ['One', 'Two']]);
  assert.equal(logs[3].rail, 2);
  assert.ok(!/font|small-text|full-width|toc/.test(logs[4]), logs[4]);
  console.log('  ✓ Write view: Font, Small text, Full width and Table of contents each write their own line, are not listed as properties, and the contents appear with two headings');
  assert.equal(logs[5], ORIGINAL); assert.deepEqual([logs[6].font, logs[6].small, logs[6].full, logs[6].toc], ['', '', '', []]);
  console.log('  ✓ switched back to the defaults, the file is byte for byte the original (no front matter left)');
  assert.equal(logs[7], true);
  assert.equal(logs[8], fm(['cover: gradient-3']));
  assert.match(logs[9], /^---\ncover: \.asset\/[0-9a-f]+-sky\.png\n---\n# One/);
  assert.ok(logs[10] >= 1, 'the picture loads');
  assert.match(logs[11], /^---\ncover: \.asset\/[0-9a-f]+-sky\.png\ncover-y: \d+\n---\n/);
  const cy = Number(/cover-y: (\d+)/.exec(logs[11])[1]); assert.ok(cy > 0 && cy <= 100 && cy !== 50, `cover-y ${cy}`);
  assert.ok(fs.readdirSync(path.join(pages, '.asset')).some((f) => /-sky\.png$/.test(f)), 'the picture was copied into the page\'s .asset folder');
  console.log('  ✓ cover: a gradient, then a picture copied into .asset, dragged to a position (cover-y), each on disk');
  assert.deepEqual(logs[12], { cover: true, listed: false });
  console.log('  ✓ Read view shows the cover and does not list the cover keys');
  assert.match(logs[13], /font: mono\n/); assert.match(logs[13], /full-width: true\n/); assert.match(logs[13], /toc: true\n/); assert.match(logs[13], /cover-y: /);
  assert.deepEqual([logs[14].font, logs[14].full, logs[14].toc, logs[14].listed], ['mono', 'true', ['One', 'Two'], false]);
  console.log('  ✓ Read view: the same options write the same lines, and the floating contents show there too');
  assert.equal(logs[15], ORIGINAL);
  console.log('  ✓ removing the cover removes cover and cover-y; the file is the original again');
  assert.deepEqual(logs[16], []);
});
