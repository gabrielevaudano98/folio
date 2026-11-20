// Folio diagrams and design ideas test: insert a diagram, change its type, apply a design idea, convert to shapes.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-smartart-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47589 }));
const file = path.join(ws, 'Ideas.slides.md');
fs.writeFileSync(file, '---\nmarp: true\n---\n\n## Our plan\n\n- Research\n- Design\n- Build\n- Launch\n\n<!--\nSay it slowly\n-->\n\n---\n\n## Diagram\n');
const menu = (label) => `[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)})).click();1`;
const steps = [
  { size: [1500, 950], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Ideas.slides.md\"]').click()", wait: 1200 },
  { js: "document.querySelector('[data-sl-ideas]').click();1", wait: 900 },
  { js: "[...document.querySelectorAll('.sl-ideas .idea-l')].map((e) => e.textContent)", log: true, wait: 100 },
  { js: "[...document.querySelectorAll('.sl-ideas .idea')].find((b) => b.textContent.includes('Process')).click();1", wait: 1200 },
  { js: "document.querySelectorAll('.sl-thumb')[1].click();1", wait: 700 },
  { js: "document.querySelector('[data-sl=insert]').click();1", wait: 300 }, { js: menu('Diagram (SmartArt)'), wait: 600 },
  { js: "document.querySelector('.sl-gallery [data-sm=cycle]').click();1", wait: 1000 },
  { js: "document.querySelector('[data-sl-format]').click();1", wait: 600 },
  { js: "(()=>{const el=document.querySelector('.sl-format [data-fk=type]');el.value='pyramid';el.dispatchEvent(new Event('change',{bubbles:true}));return 1})()", wait: 1000 },
  { js: "[document.querySelector('.sl-frame .sl-smartart')?.dataset.type, document.querySelectorAll('.sl-frame .sl-smartart .sm-label').length]", log: true, wait: 100 },
  { js: "[...document.querySelectorAll('.sl-format [data-fa]')].find((b)=>b.dataset.fa==='explode').click();1", wait: 1200 },
  { js: "[document.querySelectorAll('.sl-frame .sl-smartart').length, document.querySelectorAll('.sl-frame .sl-shape, .sl-frame .sl-path').length, document.querySelectorAll('.sl-frame .sl-box').length]", log: true, wait: 100 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 120000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\ndiagrams and ideas');
  assert.equal(logs.length, 4, out.slice(-2500));
  const [labels, diagram, exploded, errors] = logs;
  assert.deepEqual(errors, []);
  assert(['Cards', 'Process', 'Steps', 'Cycle', 'Pyramid'].every((l) => labels.includes(l)), labels.join()); console.log('  ✓ Design ideas offers diagrams and layouts for a bullet slide');
  assert.deepEqual(diagram, ['pyramid', 3]); console.log('  ✓ a diagram inserted from the gallery changes type in the Format pane');
  assert.equal(exploded[0], 0); assert(exploded[1] >= 3 && exploded[2] >= 3, JSON.stringify(exploded)); console.log('  ✓ Convert to shapes replaces the diagram with shapes and text boxes');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /## Our plan\n\n::: smartart type=process x=88 y=200 w=1104 h=260\n- Research\n- Design\n- Build\n- Launch\n:::/); assert.match(text, /Say it slowly/); console.log('  ✓ applying an idea rewrites the slide and keeps the notes');
  assert.match(text, /::: box #diagram-1-\d+ [^\n]*group=group-1/); console.log('  ✓ the converted shapes are grouped');
});
