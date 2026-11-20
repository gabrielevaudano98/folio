// Folio links test: live values and embeds render in a page and on a slide, and renaming a document rewrites references.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-links-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47595 }));
const shot = process.env.FOLIO_LINKS_SHOT;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Roadmap.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"preview\"]').click()", wait: 1500 },
  { js: "[...document.querySelectorAll('#preview .ref-value')].map((e) => e.textContent)", log: true, wait: 100 },
  { js: "[...document.querySelectorAll('#preview .ref-embed')].map((e) => (e.classList.contains('is-broken') ? 'broken' : e.querySelector('table') ? 'table' : e.querySelector('svg.ref-board') ? 'board' : e.querySelector('.ref-slide .slide') ? 'slide' : 'other'))", log: true, wait: 100 },
  ...(shot ? [{ js: "document.querySelector('#preview .ref-embed')?.scrollIntoView({block:'center'});1", wait: 400, out: shot }] : []),
  { js: "document.querySelector('[data-file=\"Pitch.slides.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"visual\"]').click();document.querySelectorAll('.sl-thumb')[6].click();1", wait: 1200 },
  { js: "document.querySelector('.sl-frame .ref-value')?.textContent", log: true, wait: 100 },
  { js: "folio.rename('Budget.sheet.md', 'Finance/Plan 2027.sheet.md').then((r) => r.changed.sort())", log: true, wait: 1500 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nlinks');
  assert.equal(logs.length, 5, out.slice(-2000));
  const [values, embeds, slideValue, changed, errors] = logs;
  assert.deepEqual(errors, []);
  assert.equal(values.length, 3); assert.match(values[0], /28[.,\s]?050/); assert.equal(values[1], 'Over budget'); assert.equal(values[2], 'Folio');
  console.log('  ✓ live values show computed sheet cells and slide titles in the page');
  assert.deepEqual(embeds, ['table', 'board', 'slide']); console.log('  ✓ embeds draw a sheet range, a board and a slide');
  assert.match(slideValue || '', /28[.,\s]?050/); console.log('  ✓ a live value works on a slide');
  assert.deepEqual(changed, ['Pitch.slides.md', 'Projects/Meeting notes.md', 'Roadmap.md']);
  const meeting = fs.readFileSync(path.join(ws, 'Projects/Meeting notes.md'), 'utf8');
  assert.match(meeting, /\[\[Plan 2027\.sheet#Costs!H6\|the total\]\]/); assert.match(meeting, /\{\{\/Finance\/Plan 2027\.sheet\.md#Costs!H6\}\}/);
  assert.match(fs.readFileSync(path.join(ws, 'Roadmap.md'), 'utf8'), /\{\{Plan 2027\.sheet#Costs!H6\}\}/);
  console.log('  ✓ renaming the sheet rewrites references in three documents');
});
