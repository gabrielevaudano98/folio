// Folio format test: the Format pane, picture tools, freeform drawing, editing points and merging shapes, checked on disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-format-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47592 }));
const file = path.join(ws, 'Pitch.slides.md');
const slideText = () => { const t = fs.readFileSync(file, 'utf8'); return t.slice(t.indexOf('## Inserted objects'), t.indexOf('<!-- source: Pitch.slides#2')); };
const helpers = "window.__fire=(t,x,y,el,o={})=>{const tg=el||(t=='mousemove'||t=='mouseup'?document:document.elementFromPoint(x,y));tg.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:t=='mouseup'?0:1,view:window,...o}))};"
  + "window.__click=(sel,sh=false)=>{const r=document.querySelector(sel).getBoundingClientRect();const c=[r.x+r.width/2,r.y+r.height*0.25];__fire('mousedown',...c,null,{shiftKey:sh});setTimeout(()=>{__fire('mouseup',...c,null,{shiftKey:sh});document.elementFromPoint(...c).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:c[0],clientY:c[1],shiftKey:sh}));},40);};"
  + "window.__set=(k,v)=>{const el=document.querySelector(`.sl-format [data-fk=\"${k}\"]`);if(el.type==='checkbox')el.checked=v;else el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));};1";
const menu = (label) => `[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click();1`;
const steps = [
  { size: [1500, 950], wait: 1200 },
  { js: "document.querySelector('[data-file=\"Pitch.slides.md\"]').click()", wait: 900 },
  { js: "[...document.querySelectorAll('.sl-thumb')].find((t) => /Inserted objects/.test(t.getAttribute('aria-label'))).click();1", wait: 1200 },
  { js: helpers, wait: 50 },
  { js: "document.querySelector('[data-sl-format]').click();1", wait: 300 },
  { js: "__click('.sl-frame .sl-obj[data-id=a]');1", wait: 500 },
  { js: "__set('fill-type','linear');1", wait: 700 },
  { js: "__set('fill-2','#333333');__set('shadow','soft');1", wait: 900 },
  { js: "[!!document.querySelector('.sl-frame .sl-obj[data-id=a] linearGradient'), getComputedStyle(document.querySelector('.sl-frame .sl-obj[data-id=a]')).filter.includes('drop-shadow')]", log: true, wait: 100 },
  // merge a and b
  { js: "__click('.sl-frame .sl-obj[data-id=b]', true);1", wait: 500 },
  { js: "document.querySelector('[data-sl=arrange]').click();1", wait: 300 }, { js: menu('Merge shapes: union'), wait: 1200 },
  { js: "[document.querySelectorAll('.sl-frame .sl-path').length, document.querySelectorAll('.sl-frame .sl-obj[data-id=a], .sl-frame .sl-obj[data-id=b]').length]", log: true, wait: 100 },
  // freeform
  { js: "document.querySelector('[data-sl=insert]').click();1", wait: 300 }, { js: menu('Freeform (draw)'), wait: 500 },
  { js: "(()=>{const v=document.querySelector('.sl-draw');const r=v.getBoundingClientRect();const pe=(t,x,y)=>v.dispatchEvent(new PointerEvent(t,{bubbles:true,pointerId:1,clientX:x,clientY:y,buttons:1}));const cx=r.x+r.width*0.3,cy=r.y+r.height*0.75;pe('pointerdown',cx,cy);for(let i=1;i<=40;i++){const a=i/40*Math.PI*2;pe('pointermove',cx+Math.sin(a)*60,cy-60+Math.cos(a)*60)}pe('pointerup',cx,cy);return 1})()", wait: 1200 },
  { js: "document.querySelectorAll('.sl-vtx').length", log: true, wait: 100 },
  { js: "(()=>{const h=document.querySelector('.sl-vtx');const r=h.getBoundingClientRect();const pe=(t,x,y)=>h.dispatchEvent(new PointerEvent(t,{bubbles:true,pointerId:2,clientX:x,clientY:y,buttons:1}));pe('pointerdown',r.x+5,r.y+5);pe('pointermove',r.x+45,r.y+25);pe('pointerup',r.x+45,r.y+25);return 1})()", wait: 1000 },
  { out: process.env.FOLIO_FORMAT_SHOT || undefined, wait: 100 },
  { js: "window.__folioErrors||[]", log: true, wait: 100 },
].filter((st) => !('out' in st) || st.out);
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const before = slideText();
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 120000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\nformat');
  assert.equal(logs.length, 4, out.slice(-2500));
  const [styled, merged, vtx, errors] = logs;
  assert.deepEqual(errors, []);
  assert.deepEqual(styled, [true, true]); console.log('  ✓ the Format pane applies a gradient fill and a shadow');
  const text = slideText();
  assert.deepEqual(merged, [1, 0]); assert.match(text, /::: path #path-1 x=120 y=260 w=840 h=200 d="M[^"]+" fill="?linear\(#[0-9a-f]+,#333333,90\)"? shadow=soft :::/); assert.doesNotMatch(text, /::: shape #a /);
  console.log('  ✓ Merge shapes: union replaces two shapes with one outline that keeps the style');
  assert(vtx >= 3, `vertex handles: ${vtx}`); assert.match(text, /::: path #path-2 x=\d+ y=\d+ w=\d+ h=\d+ points="[^"]+" closed=true smooth=true fill=#e8e8e8 :::/);
  console.log('  ✓ drawing a closed loop makes a smooth free shape with editable points');
  assert.notEqual(text.match(/#path-2[^\n]*/)[0], before.match(/#path-2[^\n]*/)?.[0]); console.log('  ✓ dragging a point rewrites the shape');
  assert.doesNotMatch(text, /::: line #ab /); console.log('  ✓ a connector between two merged shapes is removed');
});
