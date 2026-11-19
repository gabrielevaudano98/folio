// Folio design test: template decks, masters, the Design pane and slide backgrounds, checked on screen and on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-design-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47591 }));
const file = path.join(ws, 'Report.slides.md');
const set = (k, v) => `(()=>{const el=document.querySelector('.sl-design [data-dk="${k}"]');el.value=${JSON.stringify(v)};el.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`;
const thumb = (n) => `document.querySelectorAll('.sl-thumb')[${n}].click();1`;
const steps = [
  { size: [1500, 950], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Report.slides.md\"]').click()", wait: 1800 },
  { js: "[...document.querySelectorAll('.sl-thumb-n')].map((e) => e.textContent)", log: true, wait: 100 },
  { js: thumb(1), wait: 800 },
  { js: "(()=>{const f=document.querySelector('.sl-frame');return [!!f.querySelector('.sl-master .sl-obj.is-master'), f.querySelector('.sl-master')?.textContent.includes('Acme Corp'), !!f.querySelector('.sl-master .sl-shape'), getComputedStyle(f.querySelector('.slide h1')).fontFamily.includes('Georgia'), f.querySelector('.slide').classList.contains('theme-paper')]})()", log: true, wait: 100 },
  { js: thumb(2), wait: 800 },
  { js: "(()=>{const f=document.querySelector('.sl-frame');return [f.querySelector('.sl-master')?.textContent.includes('Acme Corp'), !!f.querySelector('.sl-master .sl-shape'), f.querySelector('.sl-num')?.textContent]})()", log: true, wait: 100 },
  { js: "document.querySelector('[data-sl-design]').click();1", wait: 500 },
  { js: set('accent', '#aa2200'), wait: 900 },
  { js: set('bg-type', 'gradient'), wait: 900 },
  { js: "[...document.querySelectorAll('.sl-design [data-da]')].find((b)=>b.dataset.da==='bg-all').click();1", wait: 900 },
  { out: process.env.FOLIO_DESIGN_SHOT || undefined, wait: 100 },
  { js: "document.querySelector('[data-sl=present]').click();1", wait: 800 },
  { js: "document.querySelector('.presenter .pr-bar').textContent", log: true, wait: 100 },
  { js: "document.querySelector('.presenter').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));1", wait: 400 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
].filter((st) => !('out' in st) || st.out);
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 120000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\ndesign');
  assert.equal(logs.length, 5, out.slice(-2500));
  const [nums, titleSlide, plainSlide, bar, errors] = logs;
  assert.deepEqual(errors, []);
  assert.deepEqual(nums, ['M', '1', '2']); console.log('  ✓ master slides are marked M and not numbered');
  assert.deepEqual(titleSlide, [true, true, true, true, true]); console.log('  ✓ a title slide shows the template master, its own title master, the template theme and font');
  assert.deepEqual(plainSlide, [true, false, '2']); console.log('  ✓ other slides get only the masters for all slides, and numbers skip masters');
  assert.match(bar, /^2 \/ 2/); console.log('  ✓ presenting skips master slides');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^---\nmarp: true\ntemplate: Brand\.slides\ntitle: Quarterly report\naccent: #aa2200\nbackgroundImage: linear-gradient\(135deg, #ffffff, #d9d9d9\)\n---\n/); console.log('  ✓ the Design pane writes colours and an all-slides background to front matter');
  assert.doesNotMatch(text, /_backgroundImage/); console.log('  ✓ applying to all slides removes the slide-level background');
});
