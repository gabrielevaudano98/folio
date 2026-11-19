// Folio synced slide copies: a copy that differs from its source offers Update, and Update replaces only that slide.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-sync-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47594 }));
const file = path.join(ws, 'Pitch.slides.md'); const original = fs.readFileSync(file, 'utf8');
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Pitch.slides.md\"]').click()", wait: 900 },
  { js: "[...document.querySelectorAll('.sl-thumb')].at(-2).click()", wait: 1200 },
  { js: "[!document.querySelector('.sl-sync').hidden, !!document.querySelector('[data-sync=update]')]", log: true, wait: 100 },
  { js: "document.querySelector('[data-sync=update]').click();1", wait: 1500 },
  { js: "[document.querySelector('.sl-sync').textContent.includes('Up to date'), !!document.querySelector('[data-sync=update]')]", log: true, wait: 100 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nsynced slides');
  assert.equal(logs.length, 3, out.slice(-2000));
  const [before, after, errors] = logs;
  assert.deepEqual(errors, []);
  assert.deepEqual(before, [true, true]); console.log('  ✓ a copy that drifted from its source shows Update');
  assert.deepEqual(after, [true, false]); console.log('  ✓ after Update the copy is up to date');
  const text = fs.readFileSync(file, 'utf8');
  const a = original.indexOf('<!-- source: Pitch.slides#2'), z = original.indexOf('## Placed objects');
  assert(text.startsWith(original.slice(0, a))); assert(text.endsWith(original.slice(original.lastIndexOf('\n---\n', z)))); assert.match(text, /<!-- source: Pitch\.slides#2 -->\n## Why now/); assert.doesNotMatch(text, /Old text/);
  console.log('  ✓ Update rewrote only the copy, from slide 2');
});
