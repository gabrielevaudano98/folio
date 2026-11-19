// Folio templates test: new deck from a template, colour scheme, change template, save as template.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-templates-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47588 }));
const pick = (name) => `(()=>{const c=[...document.querySelectorAll('.tp-card')].find(c=>c.querySelector('.tp-name')?.textContent.startsWith(${JSON.stringify(name)}));c.querySelector('input').checked=true;document.querySelector('#sheet-prompt form').requestSubmit();return 1})()`;
const answer = (v) => `(()=>{const i=document.querySelector('#prompt-input');i.value=${JSON.stringify(v)};i.closest('form').requestSubmit();return 1})()`;
const steps = [
  { size: [1500, 950], wait: 1200 },
  { js: "document.querySelector('#btn-new').click();1", wait: 600 },
  { js: "(()=>{document.querySelector('input[name=type][value=slides]').click();document.querySelector('#prompt-input').value='Launch plan';document.querySelector('#sheet-prompt form').requestSubmit();return 1})()", wait: 1200 },
  { js: "document.querySelectorAll('.tp-card').length", log: true, wait: 100 },
  { js: pick('Swiss'), wait: 2500 },
  { js: "(()=>{const f=document.querySelector('.sl-frame');return [!!f.querySelector('.sl-ph-title'), f.querySelector('.sl-ph-title')?.textContent.trim(), !!f.querySelector('.sl-master .sl-obj.is-master')]})()", log: true, wait: 100 },
  { js: "document.querySelector('[data-sl-design]').click();1", wait: 600 },
  { js: "(()=>{[...document.querySelectorAll('.sl-design .dp-scheme')].find(b=>b.textContent.trim()==='Blue').click();return 1})()", wait: 900 },
  { js: "document.querySelector('.sl-design [data-da=gallery]').click();1", wait: 900 },
  { js: pick('Editorial'), wait: 2500 },
  { js: "getComputedStyle(document.querySelector('.sl-frame .slide')).getPropertyValue('--sl-bg').trim()", log: true, wait: 100 },
  { js: "document.querySelector('.sl-design [data-da=save-template]').click();1", wait: 500 },
  { js: answer('My brand'), wait: 500 }, { js: answer('Editorial look for the team'), wait: 1500 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 120000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\ntemplates');
  assert.equal(logs.length, 4, out.slice(-2500));
  const [cards, title, bg, errors] = logs;
  assert.deepEqual(errors, []);
  assert.equal(cards, 9); console.log('  ✓ the gallery shows blank plus 8 templates');
  assert.deepEqual(title, [true, 'Launch plan', true]); console.log('  ✓ a deck made from a template puts its title in the template placeholder');
  assert(fs.existsSync(path.join(ws, 'Templates/Swiss.slides.md')) && fs.existsSync(path.join(ws, 'Templates/Editorial.slides.md'))); console.log('  ✓ built-in templates are copied into the Templates folder on first use');
  const deck = fs.readFileSync(path.join(ws, 'Launch plan.slides.md'), 'utf8');
  assert.match(deck, /^---\nmarp: true\ntemplate: Templates\/Editorial\.slides\ntitle: Launch plan\n---\n/); assert.doesNotMatch(deck, /accent:/); console.log('  ✓ changing template relinks the deck and clears its own colours');
  assert.equal(bg, '#f6f1e7'); console.log('  ✓ the new template shows at once');
  const mine = fs.readFileSync(path.join(ws, 'Templates/My brand.slides.md'), 'utf8');
  assert.match(mine, /template-name: My brand\ntemplate-description: Editorial look for the team/); assert.match(mine, /paper: "#f6f1e7"/); assert.match(mine, /<!-- master -->/); console.log('  ✓ Save as template writes a template file with the design and masters');
});
