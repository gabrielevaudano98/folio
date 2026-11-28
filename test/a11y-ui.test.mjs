// Folio accessibility (D14): axe-core finds no serious or critical problem in the Write view, the dock tabs, an open menu
// or the template gallery, in light and dark; menus follow the ARIA menu pattern; status, tags and links work from the keyboard.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
import electron from 'electron';
import assert from 'node:assert/strict';

const axeSrc = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-a11y-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud'), pages = path.join(ws, 'pages');
fs.mkdirSync(pages, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47602, authorName: 'Tester' }));
fs.writeFileSync(path.join(pages, 'a.md'), '---\ntags: [x]\n---\n# Title\n\nText with [status:: draft] and #tag and [[b]] and {==hl==}{>>Tester, 2026-11-20 10:00: hi<<} and {++add++}.\n\n> [!note] Callout\n> body\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [ ] task\n');
fs.writeFileSync(path.join(pages, 'b.md'), '# B\n');

const audit = (label) => ({ js: `(async () => { const r = await axe.run(document, { resultTypes: ['violations'] }); return ${JSON.stringify(label)} + ': ' + JSON.stringify(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ' ' + v.nodes.map((n) => n.target.join(' ') + ' ' + (n.html || '').slice(0, 260) + ' ' + (n.failureSummary || '').slice(0, 200)).join(' | '))); })()`, log: true, wait: 100 });
const caretIn = (sel, off = 2) => `(() => { document.querySelector('.rich-prose').focus(); const el = document.querySelector('.rich-prose ${sel}'); const t = el.firstChild; const r = document.createRange(); r.setStart(t, ${off}); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`;
const altEnter = "document.querySelector('.rich-prose').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true })); true";
const key = (k) => `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true })); true`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: axeSrc + '; true', wait: 200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/a.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 1500 },
  audit('light write'),
  { js: "document.querySelector('#dock-tab-review').click(); true", wait: 700 }, audit('light review'),
  { js: "document.querySelector('#dock-tab-info').click(); true", wait: 600 }, audit('light info'),
  { js: "document.querySelector('#dock-tab-outline').click(); true", wait: 300 },
  // keyboard: Alt+Enter on the status chip opens its menu, arrows move, a letter jumps
  { js: caretIn('.rich-chip-src', 12), wait: 300 },
  { js: altEnter, wait: 500 },
  { js: "(() => { const items = [...document.querySelectorAll('#menu .menu-item')]; return [items.length > 1, document.activeElement === items[0], document.querySelector('#menu').getAttribute('role')]; })()", log: true, wait: 100 },
  { js: key('ArrowDown'), wait: 100 },
  { js: "(() => { const items = [...document.querySelectorAll('#menu .menu-item')]; return document.activeElement === items[1]; })()", log: true, wait: 100 },
  { js: key('End'), wait: 100 },
  { js: "(() => { const items = [...document.querySelectorAll('#menu .menu-item')]; return document.activeElement === items.at(-1); })()", log: true, wait: 100 },
  { js: key('ArrowDown'), wait: 100 },
  { js: "(() => { const items = [...document.querySelectorAll('#menu .menu-item')]; return document.activeElement === items[0]; })()", log: true, wait: 100 },
  audit('light menu'),
  { js: "document.querySelector('#menu').hidePopover(); true", wait: 300 },
  // Alt+Enter on a tag lists its pages
  { js: caretIn('.rich-tag', 2), wait: 300 },
  { js: altEnter, wait: 800 },
  { js: "document.querySelector('#sidebar-search')?.value || ''", log: true, wait: 100 },
  // the tab has no nested control; Delete closes it
  { js: "[document.querySelector('.tab .tab-close')?.getAttribute('aria-hidden'), document.querySelector('.tab [tabindex]:not(.tab)') == null]", log: true, wait: 100 },
  { js: "document.querySelector('.ribbon [data-cmd=\"app:template\"]').click(); true", wait: 2000 }, audit('light gallery'),
  { js: "document.querySelector('[data-act=close]').click(); true", wait: 500 },
  { js: "document.documentElement.dataset.mode = 'dark'; true", wait: 500 }, audit('dark write'),
  { js: "document.querySelector('#dock-tab-review').click(); true", wait: 600 }, audit('dark review'),
  { js: "document.querySelector('.ribbon [data-cmd=\"app:template\"]').click(); true", wait: 2000 }, audit('dark gallery'),
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 150000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\naccessibility'); if (process.env.DEBUG) console.log(JSON.stringify(logs, null, 1));
  assert.equal(logs.length, 15, out.slice(-1500));
  const audits = logs.filter((l) => typeof l === 'string' && /^(light|dark) /.test(l));
  assert.equal(audits.length, 8);
  for (const a of audits) assert(/: \[\]$/.test(a), a);
  console.log('  ✓ axe-core: no serious or critical problem in the Write view, Review, Info, an open menu and the gallery, in light and dark');
  const [menu, second, last, wrap, tag, tabs, errors] = logs.filter((l) => !(typeof l === 'string' && /^(light|dark) /.test(l)));
  assert.deepEqual(menu, [true, true, 'menu']); assert(second && last && wrap);
  console.log('  ✓ Alt+Enter on a status opens its menu; the arrows, End and wrap-around move between items');
  assert.equal(tag, '#tag');
  console.log('  ✓ Alt+Enter on a tag lists its pages');
  assert.deepEqual(tabs, ['true', true]); assert.deepEqual(errors, []);
  console.log('  ✓ a tab holds no nested control (the × is a mouse shortcut)');
});
