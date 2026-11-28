// #86 appearance in the app: the cover's Change and Remove in the Read and Split views (not on a locked page), the page
// icon on the cover's lower edge (Write and Read), and the app-wide page defaults in Settings (font, small text, full
// width) that a page follows unless its own front matter says otherwise. Every change is checked on disk.
import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
import { workspace, runApp } from './harness.mjs';

const w = workspace('appearance-defaults-ui', 47636);
fs.mkdirSync(path.join(w.ws, 'pages'), { recursive: true });
const A = '---\nicon: 🚀\ncover: gradient-2\n---\n# Trip\n\nBody.\n';
const B = '---\nfont: sans\n---\n# Own font\n\nBody.\n';
fs.writeFileSync(path.join(w.ws, 'pages', 'a.md'), A); fs.writeFileSync(path.join(w.ws, 'pages', 'b.md'), B);
const click = (sel) => `document.querySelector(${JSON.stringify(sel)}).click(); true`;
const view = (v) => ({ js: click(`#view-switch [data-view="${v}"]`), wait: 900 });
const open = (p) => ({ js: click(`[data-file="${p}"]`), wait: 1000 });
// the icon's box against the cover's: it starts above the cover's bottom edge and ends below it
const iconGeo = (cover, icon) => `(() => { const c = document.querySelector(${JSON.stringify(cover)}).getBoundingClientRect(), i = document.querySelector(${JSON.stringify(icon)}).getBoundingClientRect(); return [Math.round(i.top) < Math.round(c.bottom), Math.round(i.bottom) > Math.round(c.bottom), Math.round(i.left) >= Math.round(c.left)]; })()`;
const setSetting = (id, v) => `(() => { const el = document.querySelector('${id}'); if (el.type === 'checkbox') el.checked = ${JSON.stringify(v)}; else el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
const readState = "[document.querySelector('#preview').dataset.font || '', document.querySelector('#preview').dataset.smallText || '', document.querySelector('#preview').dataset.fullWidth || '']";
const steps = [
  { size: [1400, 900], wait: 1500 },
  open('pages/a.md'),
  // 1. Write: the icon sits on the cover's lower edge
  view('edit'), { js: iconGeo('.props .page-cover', '.props .page-icon'), log: true, wait: 100 }, // 0
  // 2. Read: the same, and the cover has Change and Remove
  view('preview'), { js: iconGeo('#preview .page-cover-read', '#preview .page-icon-read'), log: true, wait: 100 }, // 1
  { js: "[...document.querySelectorAll('#preview .page-cover-read .page-cover-btn')].map((b) => b.textContent)", log: true, wait: 100 }, // 2
  { js: click('#preview [data-cover-read="change"]'), wait: 400 },
  { js: click('.ap-cover-pop [data-grad="5"]'), wait: 1500 },
  { js: "folio.read('pages/a.md')", log: true, wait: 100 }, // 3
  { js: "document.querySelector('#preview .page-cover-read').className", log: true, wait: 100 }, // 4
  // 3. Split: Change and Remove there too; Remove takes the cover off
  view('split'), { js: "document.querySelectorAll('#preview .page-cover-read .page-cover-btn').length", log: true, wait: 100 }, // 5
  { js: click('#preview [data-cover-read="remove"]'), wait: 1500 },
  { js: "folio.read('pages/a.md')", log: true, wait: 100 }, // 6
  // 4. a locked page shows no cover buttons in Read
  { js: "folio.write('pages/a.md', " + JSON.stringify(A) + "); true", wait: 1500 },
  view('preview'), { js: "window.__folioRun('lock-page'); true", wait: 900 },
  { js: "[!!document.querySelector('#preview .page-cover-read'), document.querySelectorAll('#preview .page-cover-btn').length]", log: true, wait: 100 }, // 7
  { js: "window.__folioRun('lock-page'); true", wait: 900 },
  // 5. Settings: page defaults; a page that says nothing follows them, one with its own font keeps it
  { js: "window.__folioRun('settings'); true", wait: 800 },
  { js: "[!!document.querySelector('#set-page-font'), !!document.querySelector('#set-page-small'), !!document.querySelector('#set-page-full')]", log: true, wait: 100 }, // 8
  { js: setSetting('#set-page-font', 'serif'), wait: 500 }, { js: setSetting('#set-page-small', true), wait: 500 }, { js: setSetting('#set-page-full', true), wait: 800 },
  { js: "(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true", wait: 500 },
  { js: readState, log: true, wait: 100 }, // 9
  view('edit'), { js: "[document.querySelector('.rich-page').dataset.font || '', document.querySelector('.rich-page').dataset.smallText || '', document.querySelector('.rich-page').dataset.fullWidth || '']", log: true, wait: 100 }, // 10
  open('pages/b.md'), view('preview'), { js: readState, log: true, wait: 100 }, // 11
  // 6. the Appearance popover shows the effective font; choosing Serif (the default) removes the page's own line
  { js: click('#btn-more'), wait: 300 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((b) => /Appearance/.test(b.textContent)).click(); true", wait: 400 },
  { js: "[...document.querySelectorAll('.ap-pop .ap-font')].map((b) => [b.textContent.replace('Ag', ''), b.getAttribute('aria-checked')])", log: true, wait: 100 }, // 12
  { js: click('.ap-pop [data-font="serif"]'), wait: 1500 },
  { js: "folio.read('pages/b.md')", log: true, wait: 100 }, // 13
  { js: 'window.__folioErrors || []', log: true, wait: 100 }, // 14
];
const { js, log } = await runApp(w, steps, {}, 150000);
console.log('\nappearance: cover controls in Read and Split, icon on the cover, page defaults in Settings, ui');
assert.equal(js.length, 15, log.slice(0, 5000));
assert.deepEqual(js[14], [], 'no renderer errors');
assert.deepEqual(js[0], [true, true, true], 'Write: the icon overlaps the cover’s lower edge');
assert.deepEqual(js[1], [true, true, true], 'Read: the icon overlaps the cover’s lower edge');
console.log('  ✓ with a cover, the page icon sits on its lower edge, half over it (Write and Read)');
assert.deepEqual(js[2], ['Change cover', 'Remove cover']);
assert.equal(js[3], A.replace('gradient-2', 'gradient-5')); assert.match(js[4], /cover-g5/);
assert.equal(js[5], 2); assert.equal(js[6], A.replace('cover: gradient-2\n', ''));
assert.deepEqual(js[7], [true, 0], 'a locked page shows its cover without buttons');
console.log('  ✓ the cover has Change and Remove in the Read and Split views too (one line written), none on a locked page');
assert.deepEqual(js[8], [true, true, true]);
assert.deepEqual(js[9], ['serif', 'true', 'true'], 'Read: a page that says nothing follows the Settings defaults');
assert.deepEqual(js[10], ['serif', 'true', 'true'], 'Write: the same');
assert.deepEqual(js[11], ['', 'true', 'true'], 'a page with `font: sans` keeps its own font');
assert.deepEqual(js[12], [['Sans', 'true'], ['Serif', 'false'], ['Mono', 'false']]);
assert(!/font:/.test(js[13]), 'choosing the default font removes the page’s own line: ' + JSON.stringify(js[13]));
const st = JSON.parse(fs.readFileSync(path.join(w.ud, 'settings.json'), 'utf8'));
assert.deepEqual([st.pageFont, st.pageSmallText, st.pageFullWidth], ['serif', true, true], 'kept in settings.json');
console.log('  ✓ Settings has page defaults (font, small text, full width): pages follow them, a page’s own line wins, choosing the default removes it');
fs.rmSync(w.tmp, { recursive: true, force: true });
