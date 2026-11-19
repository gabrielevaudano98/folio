// Folio text test: edit a shape's label on the slide, and refuse a box the text editor cannot keep.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-text-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47596 }));
const file = path.join(ws, 'Pitch.slides.md'); const original = fs.readFileSync(file, 'utf8');
const dbl = (id) => `document.querySelector('.sl-frame .sl-obj[data-id=${id}]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));!!document.querySelector('.is-editing')`;
const steps = [
  { size: [1500, 900], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Pitch.slides.md\"]').click()", wait: 900 },
  { js: "document.querySelector('.sl-thumb:last-child').click()", wait: 900 },
  { js: dbl('claim'), log: true, wait: 600 },
  { js: dbl('dot'), log: true, wait: 600 },
  { js: "const pm=document.querySelector('.is-editing .ProseMirror');pm.focus();document.execCommand('selectAll');document.execCommand('insertText',false,'Hello **world**');1", wait: 800 },
  { js: "document.querySelector('[data-tx=bold]').click();document.querySelector('[data-at=size]').value='36';document.querySelector('[data-at=size]').dispatchEvent(new Event('change',{bubbles:true}));1", wait: 700 },
  { js: "document.querySelector('.is-editing .ProseMirror').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));!!document.querySelector('.is-editing')", log: true, wait: 1200 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\ntext');
  assert.equal(logs.length, 4, out.slice(-2000));
  const [claimOpened, dotOpened, stillEditing, errors] = logs;
  assert.deepEqual(errors, []);
  assert.equal(claimOpened, false); console.log('  ✓ a box with a nested container is not opened for inline editing');
  assert.equal(dotOpened, true); assert.equal(stillEditing, false); console.log('  ✓ a shape label opens, and Escape finishes editing');
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /::: shape #dot type=ellipse x=700 y=220 w=200 h=200 fill=#111 size=36\n\nHello \*\*world\*\*\n:::/); console.log('  ✓ the text and size are written to the shape');
  const strip = (t) => t.replace(/::: shape #dot[\s\S]*?\n:::\n/, '');
  assert.equal(strip(after), strip(original)); console.log('  ✓ everything else in the file is unchanged');
});
