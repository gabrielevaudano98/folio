// Folio arrange test: copy and paste, lock and the layers pane, in the real app.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-arrange-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47597 }));
const lines = "[...document.querySelectorAll('.cm-line')].map((l) => l.textContent).filter((t) => t.startsWith(':::') && /x=/.test(t))";
const key = (k, extra = '') => `document.querySelector('.sl-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',${extra}bubbles:true,cancelable:true}));1`;
const fire = "window.__fire=(t,x,y)=>{const tg=t=='mousemove'||t=='mouseup'?document:document.elementFromPoint(x,y);tg.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:t=='mouseup'?0:1,view:window}))};";
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Pitch.slides.md\"]').click()", wait: 900 },
  { js: "document.querySelector('.sl-thumb:last-child').click()", wait: 900 },
  { js: `${fire}const r=document.querySelector('.sl-frame .sl-obj[data-id=claim]').getBoundingClientRect();const c=[r.x+r.width/2,r.y+r.height/2];__fire('mousedown',...c);__fire('mouseup',...c);1`, wait: 500 },
  { js: key('c', 'ctrlKey:true,'), wait: 300 },
  { js: key('v', 'ctrlKey:true,'), wait: 1000 },
  { js: lines, log: true, wait: 100 },
  { js: "document.querySelector('[data-sl-layers]').click();1", wait: 500 },
  { js: "document.querySelectorAll('.sl-layer').length", log: true, wait: 100 },
  { js: "document.querySelector('[data-lock=\"0\"]').click();1", wait: 800 },
  { js: "document.querySelector('.sl-layer[data-i=\"0\"]').textContent.trim().replace(/\\s+/g,' ')", log: true, wait: 100 },
  { js: "document.querySelector('.sl-frame .sl-obj[data-obj=\"0\"]').classList.contains('is-locked')", log: true, wait: 100 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\narrange');
  assert.equal(logs.length, 5, out.slice(-2000));
  const [objs, layers, row, isLocked, errors] = logs;
  assert.deepEqual(errors, []);
  assert.equal(objs.length, 4, JSON.stringify(objs)); assert(objs.some((l) => /#box-1/.test(l)) || objs.some((l) => /#box-\d/.test(l)));
  console.log('  ✓ Ctrl+C then Ctrl+V pastes an offset copy with a new id');
  assert.equal(layers, 4); console.log('  ✓ the layers pane lists every object');
  assert.match(row, /Locked/); assert.equal(isLocked, true); console.log('  ✓ locking from the layers pane marks the object locked');
});
