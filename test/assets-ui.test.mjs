// Folio assets in the UI: removing a picture from a page asks whether to remove the file, the answer moves it to the
// asset trash, and Undo brings both the picture and the file back.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-assets-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(path.join(pages, '.asset'), { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47594 }));
fs.writeFileSync(path.join(pages, 'a.md'), '# A\n\nText\n\n![x](.asset/aaaaaaaa-team.png)\n\nAfter.\n');
fs.copyFileSync(new URL('../build/icon.png', import.meta.url), path.join(pages, '.asset', 'aaaaaaaa-team.png'));
const file = path.join(pages, '.asset', 'aaaaaaaa-team.png'), trash = path.join(pages, '.asset', '.trash');

const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 900 },
  { js: "document.querySelectorAll('.rich-prose img').length", log: true, wait: 100 },
  { js: "(() => { const img = document.querySelector('.rich-prose img'); const el = img.closest('p, figure, .rich-img') || img.parentElement; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 20, clientY: r.top + 6 })); return true; })()", wait: 300 },
  { js: "document.querySelector('.block-grip').click(); document.querySelector('.block-menu [data-act=delete]').click(); document.querySelectorAll('.rich-prose img').length", log: true, wait: 7000 },
  { js: "document.querySelector('.asset-toast')?.textContent.includes('Remove the file') || false", log: true, wait: 100 },
  { js: "document.querySelector('.asset-toast [data-remove]').click(); true", wait: 1200 },
  { js: "document.body.textContent.includes('Moved 1 file to the asset trash')", log: true, wait: 100 },
  { js: "(() => { document.querySelector('.rich-prose').focus(); document.querySelector('.rich-prose').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true })); return document.querySelectorAll('.rich-prose img').length; })()", log: true, wait: 7000 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
let trashedSeen = null;
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const poll = setInterval(() => { if (!fs.existsSync(file) && fs.existsSync(trash) && fs.readdirSync(trash).length) trashedSeen = fs.readdirSync(trash); }, 200);
const timer = setTimeout(() => child.kill(), 120000);
child.on('exit', () => {
  clearTimeout(timer); clearInterval(poll);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nassets ui'); if (process.env.DEBUG) console.log(logs);
  assert.equal(logs.length, 6, out.slice(-2000));
  const [before, after, asked, moved, undone, errors] = logs;
  assert.deepEqual(errors, []);
  assert.equal(before, 1); assert.equal(after, 0); assert.equal(asked, true, 'the removal question appears');
  assert(trashedSeen && trashedSeen[0].endsWith('~aaaaaaaa-team.png'), 'the file went to the asset trash'); assert.equal(moved, true);
  console.log('  ✓ removing a picture from the page asks about the file; Remove moves it to the hidden asset trash');
  assert.equal(undone, 1); assert(fs.existsSync(file), 'the file is back'); assert.equal(fs.readdirSync(trash).length, 0);
  assert(fs.readFileSync(path.join(pages, 'a.md'), 'utf8').includes('![x](.asset/aaaaaaaa-team.png)'));
  console.log('  ✓ Undo brings the picture back and the file returns from the trash');
});
