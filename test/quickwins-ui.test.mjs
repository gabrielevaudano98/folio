// Notion quick wins, checked on screen and on disk: +name offers pages and writes a plain [[link]] (but "1 +1" stays text),
// Reopen closed tab brings back the last tab closed, and the light/dark command flips the appearance.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-quickwins-ui-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.mkdirSync(ws); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47623, theme: 'light' }));
fs.writeFileSync(path.join(ws, 'main.md'), '# Main\n\nAlpha line\n');
fs.writeFileSync(path.join(ws, 'Roadmap.md'), '# Roadmap\n');
fs.writeFileSync(path.join(ws, 'other.md'), '# Other\n');
const P = "document.querySelector('.rich-prose')";
const caretEnd = `(() => { const p = ${P}; p.focus(); const el = p.querySelectorAll(':scope > p')[0]; const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`;
const type = (t) => `document.execCommand('insertText', false, ${JSON.stringify(t)}); true`;
const key = (k) => `${P}.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true })); true`;
const menu = "[...document.querySelectorAll('.slash-item .slash-label')].map((n) => n.textContent)";
const palette = (q) => `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, metaKey: ${process.platform === 'darwin'}, shiftKey: true, bubbles: true })); const i = document.querySelector('#palette-input'); i.value = '>' + ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const paletteEnter = "document.querySelector('#palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); true";
const tabs = "[...document.querySelectorAll('#tabs .tab')].map((t) => t.dataset.tab)";
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-file=\"main.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1200 },
  // "1 +1": a digit after + opens nothing
  { js: caretEnd, wait: 100 }, { js: type(' 1 +1'), wait: 600 },
  { js: "document.querySelectorAll('.slash-item').length", log: true, wait: 100 },
  // +Road: the page is offered; Enter writes [[Roadmap]]
  { js: type(' +Road'), wait: 900 },
  { js: menu, log: true, wait: 100 },
  { js: key('Enter'), wait: 1500 },
  // tabs: open other.md, close it, reopen it from the palette
  { js: "document.querySelector('[data-file=\"other.md\"]').click()", wait: 900 },
  { js: tabs, log: true, wait: 100 },
  { js: "document.querySelector('[data-close=\"other.md\"]').click(); true", wait: 900 },
  { js: tabs, log: true, wait: 100 },
  { js: palette('Reopen closed tab'), wait: 400 }, { js: paletteEnter, wait: 1200 },
  { js: tabs, log: true, wait: 100 },
  // light → dark from the palette
  { js: 'document.documentElement.dataset.mode', log: true, wait: 100 },
  { js: palette('Switch between light and dark'), wait: 400 }, { js: paletteEnter, wait: 1500 },
  { js: 'document.documentElement.dataset.mode', log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nquick wins ui'); if (process.env.DEBUG) console.log(logs, out.slice(-800));
  assert.equal(logs.length, 8, out.slice(-1500));
  const [digitMenu, plusMenu, tabsOpen, tabsClosed, tabsReopened, modeBefore, modeAfter, errors] = logs;
  assert.deepEqual(errors, []);
  assert.equal(digitMenu, 0); console.log('  ✓ “1 +1” stays text: + opens the page menu only before a letter');
  assert.equal(plusMenu[0], 'Roadmap', JSON.stringify(plusMenu));
  const md = fs.readFileSync(path.join(ws, 'main.md'), 'utf8');
  assert.match(md, /Alpha line 1 \+1 \[\[Roadmap\]\]\n/, md); console.log('  ✓ +Road offers the page and Enter writes a plain [[Roadmap]] link');
  assert(tabsOpen.includes('other.md') && !tabsClosed.includes('other.md') && tabsReopened.includes('other.md') && tabsReopened.length === 2, JSON.stringify([tabsOpen, tabsClosed, tabsReopened]));
  console.log('  ✓ Reopen closed tab brings back the tab closed last');
  assert.deepEqual([modeBefore, modeAfter], ['light', 'dark']); console.log('  ✓ the light/dark command switches the appearance');
});
