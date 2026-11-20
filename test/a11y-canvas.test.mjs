// Folio canvas keyboard and view test: Tab walks objects and announces them, zoom and fit, Alt-drag copies.
import assert from 'node:assert/strict';
import { workspace, runApp, open, pick, errors, log, step } from './harness.mjs';

const w = workspace('kbd', 47581);
const fireAlt = "window.__fa=(t,x,y)=>{const tg=t=='mousemove'||t=='mouseup'?document:document.elementFromPoint(x,y);tg.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:t=='mouseup'?0:1,altKey:true,view:window}))};";
const key = (k, extra = '') => step(`document.querySelector('.sl-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',bubbles:true,cancelable:true${extra}}))`, 400);
const r = await runApp(w, [
  { size: [1500, 950], wait: 1200 }, open('Motion.slides.md'),
  step("document.querySelector('.sl-stage').focus()", 200),
  key('Tab'), log("[[...document.querySelectorAll('.sl-frame .sl-obj.is-selected')].map(e=>e.dataset.id), document.querySelector('.sl-stage [aria-live]').textContent]"),
  key('Tab'), key('Tab', ',shiftKey:true'), key('Tab', ',shiftKey:true'), log("[...document.querySelectorAll('.sl-frame .sl-obj.is-selected')].map(e=>e.dataset.id)"),
  key('Escape'),
  log("parseFloat(document.querySelector('.sl-frame').style.width)"),
  step("document.querySelector('.surface-slides').dispatchEvent(new KeyboardEvent('keydown',{key:'=',ctrlKey:true,bubbles:true}))", 500),
  log("[parseFloat(document.querySelector('.sl-frame').style.width), document.querySelector('.sl-zoom-pct').textContent, document.querySelector('.sl-stage').classList.contains('is-zoomed')]"),
  step("document.querySelector('.sl-zoom-pct').click()", 500), log("document.querySelector('.sl-zoom-pct').textContent"),
  pick('a'), step(`${fireAlt}const r=document.querySelector('.sl-frame .sl-obj[data-id=a]').getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;__fa('mousedown',x,y);for(let i=1;i<=8;i++)__fa('mousemove',x+i*8,y+i*12);__fa('mouseup',x+64,y+96)`, 1200),
  errors,
]);
console.log('\ncanvas keyboard and view'); if (process.env.DEBUG) console.log(JSON.stringify(r.js));
assert.deepEqual(r.js.at(-1), [], JSON.stringify(r.js));
const [first, back, w0, zoomed, fit] = r.js;
assert.deepEqual(first[0], ['a']); assert.match(first[1], /^box First, a, x 100, y 200, 300 by 120\. Arrows move/); console.log('  ✓ Tab selects the first object and a live region describes it');
assert.deepEqual(back, ['b']); console.log('  ✓ Tab and Shift+Tab walk through the objects, wrapping around');
assert(zoomed[0] > w0 * 1.2); assert.equal(zoomed[1], '125%'); assert.equal(zoomed[2], true); assert.equal(fit, '100%'); console.log('  ✓ Ctrl+= zooms the canvas (it scrolls), the percentage fits it back');
const text = w.read('Motion.slides.md');
assert.match(text, /::: box #a x=100 y=200 w=300 h=120 fill=#e8e8e8\nFirst\n:::/); assert.match(text, /::: box #box-1 x=2\d\d y=3\d\d w=300 h=120 fill=#e8e8e8\nFirst\n:::/); console.log('  ✓ Alt-drag leaves the original and drops a copy with a new id');
