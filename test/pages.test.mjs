// Folio pages test: edit a page in the Write view and check on disk that only the edited lines changed.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pages-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47593 }));
const read = (f) => fs.readFileSync(path.join(ws, 'pages', f), 'utf8');
const html = read('html.md'), obs = read('obsidian.md');

const typeAtEnd = (text, add) => `(() => { const p = [...document.querySelectorAll('.rich-prose p, .rich-prose h1')].find((x) => x.textContent === ${JSON.stringify(text)}); if (!p) return false;
  document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand('insertText', false, ${JSON.stringify(add)}); return true; })()`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/html.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 900 },
  { js: "document.querySelectorAll('.rich-raw').length", log: true, wait: 100 },
  { js: typeAtEnd('Final paragraph.', ' Done'), log: true, wait: 2500 },
  { js: `(() => { const raw = [...document.querySelectorAll('.rich-raw')].find((x) => x.textContent.includes('Centred paragraph')); raw.querySelector('.rich-raw-preview').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const a = raw.querySelector('textarea'); a.value = '<p align="center">Centred text</p>'; a.dispatchEvent(new Event('input', { bubbles: true }));
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; })()`, log: true, wait: 2500 },
  { js: "document.querySelector('[data-file=\"pages/obsidian.md\"]').click()", wait: 1200 },
  { js: typeAtEnd('Research log', ' 2026'), log: true, wait: 2500 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\npages');
  assert.equal(logs.length, 5, out.slice(-2000));
  const [rawCount, typed, rawEdited, typed2, errors] = logs;
  assert.deepEqual(errors, []);
  assert(rawCount >= 5 && typed && rawEdited && typed2, JSON.stringify(logs)); console.log('  ✓ HTML the editor cannot hold is shown as raw blocks');
  assert.equal(read('html.md'), html.replace('Final paragraph.', 'Final paragraph. Done').replace('Centred paragraph', 'Centred text')); console.log('  ✓ typing in a paragraph and editing a raw block change only those lines');
  assert.equal(read('obsidian.md'), obs.replace('# Research log', '# Research log 2026')); console.log('  ✓ footnotes, maths, callouts and front matter survive an edit byte for byte');
});
