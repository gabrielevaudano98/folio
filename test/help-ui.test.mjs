// Folio D14 in the real app: the help sheet (palette command, F1 in the menu) lists shortcuts and syntax and filters; the
// Language setting translates the interface; and typing in a long page does not rebuild the heading chevrons (the perf fix).
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-help-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47603, authorName: 'Tester' }));
const long = Array.from({ length: 4000 }, (_, i) => `${i % 5 === 0 ? `## Section ${i}\n\n` : ''}Paragraph ${i} of the long page, with a few words in it.`).join('\n\n');
fs.writeFileSync(path.join(pages, 'long.md'), `# Long\n\n${long}\n`);
fs.writeFileSync(path.join(pages, 'a.md'), '# A\n\nHello, see [[Nowhere]] and [[b]].\n');
fs.writeFileSync(path.join(pages, 'b.md'), '# B\n\nBack to A is not linked, but [[Missing page]] is.\n');

const runCmd = (id) => `(() => { const b = document.createElement('button'); b.dataset.cmd = 'app:${id}'; document.querySelector('.ribbon').append(b); b.click(); b.remove(); return true; })()`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1500 },
  { js: runCmd('help'), wait: 600 },
  { js: "(() => { const d = document.querySelector('#sheet-help'); return [d.open, d.getAttribute('aria-labelledby'), document.activeElement.id, d.querySelectorAll('.help-list > div').length > 30, /Ctrl\\+N|⌘N/.test(d.textContent)]; })()", log: true, wait: 100 },
  { js: "(() => { const i = document.querySelector('#help-search'); i.value = 'callout'; i.dispatchEvent(new Event('input', { bubbles: true })); return [...document.querySelectorAll('#help-body h3')].map((h) => h.id); })()", log: true, wait: 200 },
  { js: "(() => { const i = document.querySelector('#help-search'); i.value = 'qqzzxx'; i.dispatchEvent(new Event('input', { bubbles: true })); return document.querySelector('#help-body').textContent.trim(); })()", log: true, wait: 200 },
  { js: "document.querySelector('#sheet-help [data-close-sheet]').click(); document.querySelector('#sheet-help').open", log: true, wait: 300 },
  // link check over the whole workspace: broken references grouped by page, Create page fixes one
  { js: runCmd('link-health'), wait: 1200 },
  { js: "(() => { const d = document.querySelector('#sheet-links'); return [d.open, [...d.querySelectorAll('h3')].map((h) => h.textContent).sort(), d.querySelectorAll('[data-create]').length]; })()", log: true, wait: 100 },
  { js: "document.querySelector('#sheet-links [data-create=Nowhere]').click(); true", wait: 1500 },
  { js: "(() => { const d = document.querySelector('#sheet-links'); return [d.open, [...d.querySelectorAll('.bl-ref')].map((x) => x.textContent)]; })()", log: true, wait: 100 },
  { js: "document.querySelector('#sheet-links [data-close-sheet]').click(); true", wait: 300 },
  // language: Italian translates the settings sheet, the Info tab and <html lang>
  { js: "document.querySelector('#dock-tab-info').click(); true", wait: 800 },
  { js: "document.querySelector('#dock-info .side-head').textContent", log: true, wait: 100 },
  { js: "document.querySelector('#btn-more').click(); true", wait: 300 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((b) => /^Settings/.test(b.textContent)).click(); true", wait: 400 },
  { js: "(() => { const s = document.querySelector('#set-lang'); s.value = 'it'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()", wait: 3500 },
  // the window reloads in the new language (menus and tables are built at load): the shell, the dock and the palette speak Italian
  { js: "[document.documentElement.lang, document.querySelector('#btn-new').getAttribute('aria-label'), document.querySelector('#sidebar-search').placeholder, document.querySelector('#dock-tab-outline').textContent, localStorage.getItem('folio.lang')]", log: true, wait: 200 },
  { js: "document.querySelector('#dock-tab-info').click(); true", wait: 800 },
  { js: "document.querySelector('#dock-info .side-head').textContent", log: true, wait: 100 },
  // perf regression: typing in a long page keeps the heading chevrons (they used to be rebuilt on every key)
  { js: "document.querySelector('[data-file=\"pages/long.md\"]').click(); true", wait: 3500 },
  { js: "(() => { const hs = document.querySelectorAll('.rich-hfold'); hs.forEach((b) => { b.dataset.keep = '1'; }); const p = document.querySelectorAll('.rich-prose > p')[3]; document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.setStart(p.firstChild, 3); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return [hs.length > 100, document.querySelector('.rich-prose').classList.contains('rich-large') || document.querySelector('#pane-rich').classList.contains('rich-large') || !!document.querySelector('.rich-large')]; })()", log: true, wait: 400 },
  { js: "(() => { const t0 = performance.now(); for (let i = 0; i < 8; i++) document.execCommand('insertText', false, 'x'); const ms = (performance.now() - t0) / 8; const hs = [...document.querySelectorAll('.rich-hfold')]; return [hs.length, hs.filter((b) => b.dataset.keep === '1').length, ms < 600, Math.round(ms)]; })()", log: true, wait: 600 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 150000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nhelp, language and long pages'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 12, out.slice(-1500));
  const [sheet, filtered, none, closed, health1, health2, infoEn, lang, infoIt, ready, perf, errors] = logs;
  assert.deepEqual(sheet.slice(0, 4), [true, 'help-title', 'help-search', true]); assert.equal(sheet[4], true);
  console.log('  ✓ the help sheet opens on its search field and lists the shortcuts from the commands');
  assert.deepEqual(filtered, ['help-syntax']); assert.match(none, /Nothing matches/); assert.equal(closed, false);
  console.log('  ✓ typing filters it, with a message when nothing matches; the close button closes it');
  assert.deepEqual(health1, [true, ['a', 'b'], 2]); assert.deepEqual(health2, [true, ['[[Missing page]]']]);
  assert(fs.existsSync(path.join(ws, 'Nowhere.md')), 'Create page wrote the page');
  console.log('  ✓ the link check lists every broken reference by page; Create page makes the page and the list updates');
  assert.equal(infoEn, 'Details'); assert.deepEqual(lang, ['it', 'Nuova nota', 'Cerca note', 'Struttura', 'it']); assert.equal(infoIt, 'Dettagli');
  console.log('  ✓ the Language setting reloads the window in Italian: the shell, the side panel and the Info tab are translated, and <html lang> follows');
  assert.deepEqual(ready[0], true);
  assert.equal(perf[0], perf[1], `heading chevrons were rebuilt while typing: ${JSON.stringify(perf)}`); assert(perf[2], `typing took ${perf[3]} ms per key`);
  console.log(`  ✓ typing in a ${'4,000-paragraph'} page keeps every heading chevron (${perf[1]} of ${perf[0]}), ${perf[3]} ms per key`);
  assert.deepEqual(errors, []);
});
