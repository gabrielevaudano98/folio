// X3 lock page, code block tools (Copy, Wrap) and B8 expand/collapse all toggles, in the Write view. Files checked on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-lock-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47614 }));
const SRC = '# Lock\n\nAlpha line\n\n<details>\n<summary>One</summary>\n\nfirst\n\n</details>\n\n<details open>\n<summary>Two</summary>\n\nsecond\n\n</details>\n\n```js\nconst a = 1;\n```\n';
fs.writeFileSync(path.join(pages, 'a.md'), SRC);
const P = "document.querySelector('.rich-prose')";
const caretAtEnd = `(() => { const p = ${P}; p.focus(); const el = p.querySelector(':scope > p'); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`;
const type = (t) => `document.execCommand('insertText', false, ${JSON.stringify(t)}); true`;
const disk = "folio.read('pages/a.md')";
const mod = process.platform === 'darwin' ? 'metaKey' : 'ctrlKey';
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1200 },
  // 1. the code block bar has Copy and Wrap; Wrap flips a class only
  { js: "[...document.querySelectorAll('.rich-code-tool')].map((b) => b.dataset.tool)", log: true, wait: 100 },
  { js: "document.querySelector('.rich-code-tool[data-tool=wrap]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); document.querySelector('.rich-code').classList.contains('is-wrapped')", log: true, wait: 100 },
  { js: "document.querySelector('.rich-code-tool[data-tool=copy]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); true", wait: 400 },
  { js: "[...document.querySelectorAll('.toast')].some((n) => n.textContent.includes('Copied'))", log: true, wait: 100 },
  { js: `${disk}.then((t) => t === ${JSON.stringify(SRC)})`, log: true, wait: 100 },
  // 2. expand all: both toggles open, the file says so; one Ctrl+Z puts it back
  { js: "window.__folioRun('expand-toggles'); true", wait: 1200 },
  { js: `${disk}.then((t) => (t.match(/<details open>/g) || []).length)`, log: true, wait: 100 },
  { js: "window.__folioRun('collapse-toggles'); true", wait: 1200 },
  { js: `${disk}.then((t) => (t.match(/<details open>/g) || []).length)`, log: true, wait: 100 },
  { js: `${P}.focus(); ${P}.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ${mod}: true, bubbles: true, cancelable: true })); true`, wait: 1200 },
  { js: `${disk}.then((t) => (t.match(/<details open>/g) || []).length)`, log: true, wait: 100 },
  // 3. lock: badge shown, typing changes nothing, the setting is stored outside the .md
  { js: `${disk}.then((t) => { window.__before = t; return true; })`, wait: 100 },
  { js: "window.__folioRun('lock-page'); true", wait: 600 },
  { js: "[!document.querySelector('.rich-lock').hidden, document.querySelector('.rich-prose').getAttribute('contenteditable')]", log: true, wait: 100 },
  { js: caretAtEnd, wait: 100 }, { js: type(' LOCKED'), wait: 1200 },
  { js: "window.__folioRun('expand-toggles'); true", wait: 1000 },
  { js: `${disk}.then((t) => t === window.__before)`, log: true, wait: 100 },
  { js: "document.querySelector('.rich-prose').textContent.includes('LOCKED')", log: true, wait: 100 },
  // 4. unlock with the badge button, type: the file changes
  { js: "document.querySelector('.rich-unlock').click(); true", wait: 600 },
  { js: caretAtEnd, wait: 100 }, { js: type(' typed'), wait: 1500 },
  { js: `${disk}.then((t) => t.includes('Alpha line typed'))`, log: true, wait: 100 },
  // 5. a lock survives a rename (the settings key follows the file) and is listed in the sidebar menu
  { js: "window.__folioRun('lock-page'); true", wait: 800 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 200 })); [...document.querySelectorAll('#menu .menu-label')].map((n) => n.textContent)", log: true, wait: 300 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.trim().startsWith('Rename')).click(); true", wait: 500 },
  { js: "const i = document.querySelector('#prompt-input'); i.value = 'b'; i.form.requestSubmit(); true", wait: 1500 },
  { js: "folio.init().then((i) => [Object.keys(i.settings.lockedPages || {}), !document.querySelector('.rich-lock').hidden])", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nlock, code tools, toggles ui'); if (process.env.DEBUG) console.log(logs);
  assert.equal(logs.length, 14, out.slice(-1500));
  const [tools, wrapped, copied, sameFile, open1, open2, open3, lock, still, noTyped, typed, menu, moved, errors] = logs;
  assert.deepEqual(errors, [], 'no renderer errors');
  assert.deepEqual(tools, ['copy', 'wrap']); assert.equal(wrapped, true); assert.equal(copied, true); assert.equal(sameFile, true);
  console.log('  ✓ a code block has Copy (toast: Copied) and Wrap (view only, file untouched)');
  assert.equal(open1, 2); assert.equal(open2, 0); assert.equal(open3, 2);
  console.log('  ✓ expand all opens every toggle in the file, collapse all closes them, one Undo reverts the last action');
  assert.deepEqual(lock, [true, 'false']); assert.equal(still, true); assert.equal(noTyped, false);
  console.log('  ✓ a locked page shows the Locked badge and ignores typing');
  assert(menu.includes('Unlock page'), 'the sidebar menu offers Unlock page on a locked page');
  assert.deepEqual(moved, [['pages/b.md'], true]);
  const settings = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  assert.deepEqual(settings.lockedPages, { 'pages/b.md': true }, 'the lock is kept in the settings file, keyed by path');
  assert.equal(typed, true); const final = fs.readFileSync(path.join(pages, 'b.md'), 'utf8'); assert(final.includes('Alpha line typed') && !final.includes('LOCKED'));
  console.log('  ✓ Unlock makes the page editable again; the lock moves with a rename and lives only in the settings file');
});
