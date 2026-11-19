// Folio canvas test: drag, nudge and undo a placed object in the real app and check the file on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-canvas-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47598 }));
const file = path.join(ws, 'Pitch.slides.md');
const original = fs.readFileSync(file, 'utf8');
const opener = "[...document.querySelectorAll('.cm-line')].map((l) => l.textContent).find((t) => t.startsWith('::: box #claim'))";
const fire = "window.__fire=(t,x,y)=>{const tg=t=='mousemove'||t=='mouseup'?document:document.elementFromPoint(x,y);tg.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:t=='mouseup'?0:1,view:window}))};";
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Pitch.slides.md\"]').click()", wait: 900 },
  { js: "document.querySelector('.sl-thumb:last-child').click()", wait: 900 },
  { js: `${fire}const r=document.querySelector('.sl-frame .sl-obj[data-id=claim]').getBoundingClientRect();window.__c=[r.x+r.width/2,r.y+r.height/2];__fire('mousedown',...window.__c);__fire('mouseup',...window.__c);1`, wait: 500 },
  { js: "const [x,y]=window.__c;__fire('mousedown',x,y);for(let i=1;i<=6;i++)__fire('mousemove',x+i*10,y+i*5);__fire('mouseup',x+60,y+30);1", wait: 1200 },
  { js: opener, log: true, wait: 100 },
  { js: "document.querySelector('.sl-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));1", wait: 1200 },
  { js: opener, log: true, wait: 100 },
  { js: "document.querySelector('.sl-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));1", wait: 1200 },
  { js: opener, log: true, wait: 100 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\ncanvas');
  assert.equal(logs.length, 4, out.slice(-2000));
  const [dragged, nudged, undone, errors] = logs;
  const px = (l) => Number(l.match(/ x=(-?\d+)/)[1]);
  assert.deepEqual(errors, []);
  assert(px(dragged) > 80 + 40, `drag moved the box right (${dragged})`); assert.match(dragged, /^::: box #claim x=\d+ y=\d+ w=520 h=240 fill=#f2f2f2 radius=12$/);
  console.log('  ✓ dragging a box writes whole-pixel x and y and nothing else on its line');
  assert.equal(px(nudged), px(dragged) + 10); console.log('  ✓ Shift+Arrow nudges by 10');
  assert.equal(px(undone), px(dragged)); console.log('  ✓ Ctrl+Z undoes the nudge');
  const after = fs.readFileSync(file, 'utf8').split('\n'), before = original.split('\n');
  assert.equal(after.length, before.length); assert.equal(after.filter((l, i) => l !== before[i]).length, 1); console.log('  ✓ only one line of the file changed on disk');
});
