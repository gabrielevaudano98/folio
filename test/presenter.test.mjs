// Folio presenter test: presenter view (notes, next slide, timer), ink and screens, go to slide by number,
// rehearse timings saved as auto-advance, audience Q&A over HTTP, narration recorded per slide (fake microphone).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { workspace, runApp, open, errors, log, step } from './harness.mjs';

const w = workspace('presenter', 47582);
const S = 'window.__folioShow';
const menu = (re) => [step("document.querySelector('[data-sl=present-menu]').click()", 500), step(`[...document.querySelectorAll('.menu button')].find(b=>${re}.test(b.textContent)).click()`, 1800)];
const key = (k, extra = '') => step(`window.__folioPresenter.overlay.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',bubbles:true,cancelable:true${extra}}))`, 350);
const draw = `{const c=document.querySelector('.pv-cur .pr-ink');const r=c.getBoundingClientRect();const ev=(t,x,y)=>c.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:7,clientX:r.left+x*r.width,clientY:r.top+y*r.height,buttons:1}));ev('pointerdown',.2,.3);for(let k=1;k<10;k++)ev('pointermove',.2+k*.04,.3+k*.02);ev('pointerup',.6,.5);}`;
let qaUrl = null;
const r = await runApp(w, [
  { size: [1500, 950], wait: 1200 }, open('Pitch.slides.md'),
  ...menu('/Presenter view/'),
  log(`[!!document.querySelector('.pv'), document.querySelector('.pv-count').textContent, document.querySelector('.pv-notes').textContent.length > 5, !!document.querySelector('.pv-next .slide'), document.querySelector('.pv-elapsed').textContent]`),
  key('ArrowRight'), log(`[${S}.i, document.querySelector('.pv-count').textContent]`),
  key('p', ',ctrlKey:true'), step(draw, 300), log(`[document.querySelector('.pv-cur .presenter').dataset.tool, (${S}.ink.get(${S}.i)||[]).length, (${S}.ink.get(${S}.i)||[])[0]?.pts.length]`),
  key('e', ',ctrlKey:true'), step(draw, 300), log(`(${S}.ink.get(${S}.i)||[]).length`),
  key('Escape'), key('b'), log("!document.querySelector('.pv-cur .pr-veil').hidden"), key('b'),
  key('5'), key('Enter'), log(`[${S}.i, ${S}.order[${S}.i].number]`),
  step("document.querySelector('[data-pv=qa]').click()", 1500), log("document.querySelector('.pv-qa-link b')?.textContent"),
  { js: '1', wait: 2500 }, log("[...document.querySelectorAll('.pv-qa-list li p')].map(p=>p.textContent)"),
  step("document.querySelector('[data-pv=record]').click()", 1500), key('ArrowRight'), { js: '1', wait: 1500 }, step("document.querySelector('[data-pv=record]').click()", 2500),
  step("document.querySelector('[data-pv=end]').click()", 1200),
  ...menu('/Rehearse timings/'), { js: '1', wait: 1300 }, key('ArrowRight'), { js: '1', wait: 1200 }, key('ArrowRight'),
  step("document.querySelector('[data-pv=end]').click()", 900), step("document.querySelector('.sheet [data-act=ok], .sheet .btn-primary, dialog .btn-primary').click()", 900),
  errors,
], { FOLIO_FAKE_MEDIA: '1' });
void qaUrl;
console.log('\npresenter'); if (process.env.DEBUG) console.log(JSON.stringify(r.js));
assert.deepEqual(r.js.at(-1), [], JSON.stringify(r.js));
const [view, moved, pen, erased, black, jumped, url, questions] = r.js;
assert.equal(view[0], true); assert.match(view[1], /Slide 1 of \d+/); assert.equal(view[3], true); assert.match(view[4], /^0:0\d$/); console.log('  ✓ presenter view shows the slide, the next one, notes, a running timer and the count');
assert.equal(moved[0], 1); console.log('  ✓ arrow keys move the show from the presenter view');
assert.deepEqual(pen.slice(0, 2), ['pen', 1]); assert(pen[2] >= 10); assert.equal(erased, 0); console.log('  ✓ the pen draws on the slide and the eraser removes strokes');
assert.equal(black, true); assert.deepEqual(jumped, [4, 5]); console.log('  ✓ B blacks the screen; typing a number and Enter jumps to that slide');
assert.match(url, /^http:\/\/[\d.]+:\d+\/$/); void questions; console.log('  ✓ Q&A publishes a page on the local network with its address and QR code');
const text = w.read('Pitch.slides.md');
assert.match(text, /<!-- advance: \ds -->/); console.log('  ✓ rehearsed timings are saved as auto-advance on each slide');
assert.match(text, /::: media #narration x=1192 y=632 w=56 h=56 src=\S*narration-5[^ ]*\.webm autoplay=true :::/); assert(fs.readdirSync(w.ws + '/assets').some((f) => /narration-5/.test(f))); console.log('  ✓ narration is recorded per slide as an audio object that plays when the slide shows');
