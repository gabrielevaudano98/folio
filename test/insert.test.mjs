// Folio insert test: shapes, icons, tables, connectors and line end snapping on a slide, checked on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-insert-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47593 }));
const file = path.join(ws, 'Pitch.slides.md');
const menu = (label) => `[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click();1`;
const openInsert = "document.querySelector('[data-sl=insert]').click();1";
const fire = "window.__fire=(t,x,y,el)=>{const tg=el||(t=='mousemove'||t=='mouseup'?document:document.elementFromPoint(x,y));tg.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:t=='mouseup'?0:1,view:window,shiftKey:!!window.__shift}))};window.__click=(sel,fx=0.5,fy=0.5)=>{const r=document.querySelector(sel).getBoundingClientRect();const c=[r.x+r.width*fx,r.y+r.height*fy];const sh=!!window.__shift;__fire('mousedown',...c);setTimeout(()=>{window.__shift=sh;__fire('mouseup',...c);document.elementFromPoint(...c).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:c[0],clientY:c[1],shiftKey:sh}));window.__shift=false;},40);};";
const steps = [
  { size: [1500, 950], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Pitch.slides.md\"]').click()", wait: 900 },
  { js: "[...document.querySelectorAll('.sl-thumb')].find((t) => /Inserted objects/.test(t.getAttribute('aria-label'))).click();1", wait: 1500 },
  { js: "[!!document.querySelector('.sl-frame .sl-line.is-connector polygon'), document.querySelectorAll('.sl-frame .sl-icon-svg svg path, .sl-frame .sl-icon-svg svg circle').length > 0, !!document.querySelector('.sl-frame video.sl-media-el')]", log: true, wait: 100 },
  { js: openInsert, wait: 300 }, { js: menu('Shape…'), wait: 400 },
  { js: "document.querySelector('.sl-gallery [data-shape=diamond]').click();1", wait: 900 },
  { js: openInsert, wait: 300 }, { js: menu('Icon…'), wait: 900 },
  { js: "const q=document.querySelector('.slg-search');q.value='rocket';q.dispatchEvent(new Event('input'));1", wait: 900 },
  { js: "document.querySelector('.sl-gallery [data-icon=rocket]').click();1", wait: 900 },
  { js: openInsert, wait: 300 }, { js: menu('Table'), wait: 900 },
  { js: `${fire}__click('.sl-frame .sl-obj[data-id=a]');1`, wait: 300 }, { js: "window.__shift=true;__click('.sl-frame .sl-obj[data-id=b]',0.5,0.08);1", wait: 400 },
  { js: openInsert, wait: 300 }, { js: menu('Connector between two objects'), wait: 900 },
  { js: `${fire}__click('.sl-frame .sl-obj[data-id=free] .sl-line-hit');1`, wait: 500 },
  { js: "document.querySelectorAll('.sl-end').length", log: true, wait: 100 },
  { js: "(()=>{const h=document.querySelector('.sl-end[data-end=\"2\"]');const t=document.querySelector('.sl-frame .sl-obj[data-id=b]').getBoundingClientRect();const r=h.getBoundingClientRect();const x=r.x+6,y=r.y+6,tx=t.x+t.width/2,ty=t.bottom;const pe=(type,cx,cy)=>h.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,clientX:cx,clientY:cy,buttons:1}));pe('pointerdown',x,y);for(let i=1;i<=8;i++)pe('pointermove',x+(tx-x)*i/8,y+(ty-y)*i/8);pe('pointerup',tx,ty);return 1})()", wait: 1000 },
  { out: process.env.FOLIO_INSERT_SHOT || undefined, wait: 100 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
].filter((st) => !('out' in st) || st.out);
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 120000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\ninsert');
  assert.equal(logs.length, 3, out.slice(-2500));
  const [rendered, ends, errors] = logs;
  assert.deepEqual(errors, []);
  assert.deepEqual(rendered, [true, true, true]); console.log('  ✓ connectors with arrowheads, icons and video render on the slide');
  const text = fs.readFileSync(file, 'utf8');
  const slide = text.slice(text.indexOf('## Inserted objects'), text.indexOf('<!-- source: Pitch.slides#2'));
  assert.match(slide, /::: shape #shape-1 type=diamond x=\d+ y=\d+ w=\d+ h=\d+ fill=#e8e8e8/); console.log('  ✓ the shape gallery adds a shape');
  assert.match(slide, /::: icon #icon-1 name=rocket x=\d+ y=\d+ w=120 h=120 :::/); console.log('  ✓ the icon gallery searches and adds an icon');
  assert.match(slide, /::: box #box-1 [^\n]*\n\| Item \| Value \|\n\| --- \| --- \|/); console.log('  ✓ a table is a box with a Markdown table');
  assert.match(slide, /::: line #line-1 from=a to=b head=arrow :::/); console.log('  ✓ Connector joins the two selected objects');
  assert.equal(ends, 2); assert.match(slide, /::: line #free x=120 y=560 w=-?\d+ h=-?\d+ dash=true to=b\.bottom :::/); console.log('  ✓ dragging a line end onto an object snaps it to a side');
});
