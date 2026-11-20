// Folio motion test: the Animations pane writes animation and transition lines; the show builds step by step.
import assert from 'node:assert/strict';
import { workspace, runApp, open, pick, errors, log, step } from './harness.mjs';

const w = workspace('motion', 47586);
const vis = (id) => `getComputedStyle(document.querySelector('.presenter .pr-layer:last-child .sl-obj[data-id="${id}"]')).visibility`;
const r = await runApp(w, [
  { size: [1500, 950], wait: 1200 }, open('Motion.slides.md'),
  log("[...document.querySelectorAll('.sl-frame .sl-obj[data-anim]')].map(e=>e.dataset.id+':'+e.dataset.anim).join(',')"),
  step("document.querySelector('[data-sl-anim]').click()", 700),
  log("document.querySelectorAll('.sl-anim .an-item').length"),
  pick('a'), step("const s=document.querySelector('.sl-anim [data-an=add-effect]');s.value='zoom-in';s.dispatchEvent(new Event('change',{bubbles:true}))", 200),
  step("document.querySelector('.sl-anim [data-an=add]').click()", 900),
  step("const s=document.querySelector('.sl-anim .an-item:nth-child(1) [data-af=trigger]');s.value='after';s.dispatchEvent(new Event('change',{bubbles:true}))", 900),
  step("document.querySelector('.sl-anim .an-item:nth-child(4) [data-an=up]').click()", 900),
  step("const s=document.querySelector('.sl-anim [data-an=t-name]');s.value='push-left';s.dispatchEvent(new Event('change',{bubbles:true}))", 900),
  // present: steps reveal objects one click at a time
  step("document.querySelector('[data-sl=present]').click()", 1500),
  log(`[${vis('a')}, ${vis('b')}]`),
  step("window.__folioShow.next()", 1500), log(`[${vis('a')}, ${vis('b')}, window.__folioShow.step]`),
  step("window.__folioShow.next()", 1500), log(`[${vis('b')}, window.__folioShow.step]`),
  step("window.__clicks=0;window.__adv=setInterval(()=>{const sh=window.__folioShow;if(sh.i===1){clearInterval(window.__adv);return}sh.prep.finish();sh.next();window.__clicks++},300)", 4000), log('[window.__folioShow.i, window.__folioShow.step, window.__clicks]'),
  step("window.__folioShow.prev()", 600), log('[window.__folioShow.i, window.__folioShow.step]'),
  step("window.__folioShow.close()", 600),
  errors,
]);
console.log('\nmotion');
assert.deepEqual(r.js.at(-1), [], r.log.slice(-2500));
const [badges, items, start, s1, s2, end, back] = r.js;
assert.equal(badges, 'a:1,b:1'); console.log('  ✓ animated objects show their click number on the canvas');
assert.equal(items, 3); console.log('  ✓ the pane lists the slide’s animations in order');
const text = w.read('Motion.slides.md');
assert.match(text, /<!-- transition: push-left -->\n/); assert.match(text, /animate: #a fade-in after\nanimate: #b fly-in-up with 0\.4s delay=200ms\nanimate: #a zoom-in\nanimate: #b pulse after repeat=2 by=paragraph\n-->/); console.log('  ✓ adding, changing and reordering write the animation lines; the transition is a directive');
assert.deepEqual(start, ['hidden', 'hidden']); assert.deepEqual(s1.slice(0, 2), ['visible', 'visible']); assert.equal(s1[2], 1); console.log('  ✓ the show starts with entering objects hidden and builds them on click');
assert.equal(s2[1], 2); assert.deepEqual(end, [1, 0, 3]); assert.deepEqual(back, [0, 4]); console.log('  ✓ steps then slides advance in order, and back steps through builds');
