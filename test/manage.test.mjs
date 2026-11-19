// Folio slide management test: sorter, hide, sections, outline titles, find and replace, comments, accessibility, reuse.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-manage-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47590 }));
const file = path.join(ws, 'Deck.slides.md');
fs.writeFileSync(file, '---\nmarp: true\n---\n\n# Alpha\n\nRed apples\n\n---\n\n## Beta\n\n- red one\n- two\n\n---\n\n## Gamma\n\n![](assets/cover.png)\n\n---\n\n## Delta\n');
const answer = (v) => `(()=>{const i=document.querySelector('#prompt-input');i.value=${JSON.stringify(v)};i.closest('form').requestSubmit();return 1})()`;
const menu = (label) => `[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)})).click();1`;
const click = (sel, extra = '') => `(()=>{const el=document.querySelector(${JSON.stringify(sel)});el.dispatchEvent(new MouseEvent('click',{bubbles:true,${extra}}));return 1})()`;
const steps = [
  { size: [1500, 950], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Deck.slides.md\"]').click()", wait: 1200 },
  // sorter: select slides 3 and 4, move them before slide 1, hide them
  { js: "document.querySelector('[data-slv=sorter]').click();1", wait: 700 },
  { js: click('.sl-sort[data-si="2"]'), wait: 200 }, { js: click('.sl-sort[data-si="3"]', 'shiftKey:true'), wait: 300 },
  { js: "(()=>{const dt=new DataTransfer();const a=document.querySelector('.sl-sort[data-si=\"2\"]'),b=document.querySelector('.sl-sort[data-si=\"0\"]');a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));return 1})()", wait: 800 },
  { js: "[...document.querySelectorAll('.sl-sort span')].map(e=>e.textContent)", log: true, wait: 100 },
  { js: "document.querySelector('.sl-sorter').dispatchEvent(new KeyboardEvent('keydown',{key:'h',bubbles:true}));1", wait: 800 },
  // outline: rename slide 3 (Alpha)
  { js: "document.querySelector('[data-slv=outline]').click();1", wait: 600 },
  { js: "(()=>{const i=document.querySelector('[data-oi=\"2\"]');i.value='Alpha renamed';i.dispatchEvent(new Event('change',{bubbles:true}));return 1})()", wait: 800 },
  { js: "document.querySelector('[data-slv=normal]').click();1", wait: 800 },
  // section on slide 3
  { js: "(()=>{const t=document.querySelectorAll('.sl-thumb')[2];t.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:300}));return 1})()", wait: 400 },
  { js: menu('Add section here'), wait: 500 }, { js: answer('Main'), wait: 800 },
  // find and replace
  { js: "document.querySelector('.sl-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'h',ctrlKey:true,bubbles:true,cancelable:true}));1", wait: 400 },
  { js: "(()=>{const q=document.querySelector('.sl-find [data-f=q]');q.value='red';q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.sl-find [data-f=r]').value='green';return document.querySelector('.sl-find-n').textContent})()", log: true, wait: 200 },
  { js: "document.querySelector('.sl-find [data-fb=all]').click();1", wait: 800 },
  // comment
  { js: "document.querySelector('[data-sl=review]').click();1", wait: 300 }, { js: menu('Add comment'), wait: 500 }, { js: answer('Check these numbers'), wait: 900 },
  { js: "[...document.querySelectorAll('.sl-review .rv-list p')].map(e=>e.textContent)", log: true, wait: 100 },
  // accessibility
  { js: "document.querySelector('.sl-review [data-rt=a11y]').click();1", wait: 1000 },
  { js: "[...document.querySelectorAll('.sl-review .rv-list li p')].map(e=>e.textContent)", log: true, wait: 100 },
  // reuse two slides from Brand
  { js: "document.querySelector('[data-sl=review]').click();1", wait: 300 }, { js: menu('Insert slides from another deck'), wait: 600 },
  { js: "(()=>{const d=document.querySelector('#ref-doc');d.value='Brand.slides.md';d.dispatchEvent(new Event('change'));return 1})()", wait: 700 },
  { js: "(()=>{const p=document.querySelector('#ref-part');p.value='1-2';p.dispatchEvent(new Event('input'));p.closest('form').requestSubmit();return 1})()", wait: 1200 },
  { js: "document.querySelector('[data-sl=present]').click();1", wait: 700 },
  { js: "document.querySelector('.presenter .pr-bar').textContent.split(' ').slice(0,3).join(' ')", log: true, wait: 100 },
  { js: "document.querySelector('.presenter').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));1", wait: 400 },
  { out: process.env.FOLIO_MANAGE_SHOT || undefined, wait: 100 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
].filter((st) => !('out' in st) || st.out);
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 150000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nslide management');
  assert.equal(logs.length, 6, out.slice(-2500));
  const [order, found, comments, a11y, bar, errors] = logs;
  assert.deepEqual(errors, []);
  assert.deepEqual(order.map((x) => x.split(' · ')[1]), ['Gamma', 'Delta', 'Alpha', 'Beta']); console.log('  ✓ the sorter moves a multi-selection by drag and drop');
  assert.equal(found, '2 matches'); assert.deepEqual(comments, ['Check these numbers']); console.log('  ✓ find counts matches across slides; comments show in the review pane');
  assert(a11y.some((m) => /has no alternative text/.test(m)), JSON.stringify(a11y)); console.log('  ✓ the accessibility check reports the picture without a description');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /<!-- hidden -->\n## Gamma/); assert.match(text, /<!-- hidden -->\n## Delta/); console.log('  ✓ H hides the selected slides');
  assert.match(text, /<!-- section: Main -->\n# Alpha renamed/); console.log('  ✓ outline titles and sections are written to the slide');
  assert.doesNotMatch(text, /\bred\b/i); assert.match(text, /green apples/); assert.match(text, /- green one/); console.log('  ✓ Replace all changes every match');
  assert.match(text, /<!-- comment \([^)]*2026-\d\d-\d\d\): Check these numbers -->/); console.log('  ✓ comments are saved in the file with author and date');
  assert.match(text, /## Brand master/); assert.match(text, /## Brand sample/); assert.doesNotMatch(text, /<!-- master -->/); console.log('  ✓ slides from another deck are inserted as plain copies');
  assert.match(bar, /^\d+ \/ 4/); console.log('  ✓ hidden slides are skipped when presenting');
});
