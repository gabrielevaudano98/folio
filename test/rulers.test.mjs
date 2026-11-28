// Folio rulers test: rulers on the stage, guides dragged out of them (view state only, never in the file), objects
// snapping to a guide, a guide dragged away, and a block of the slide text placed as a free box in one edit.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, open, fire, errors, log, step } from './harness.mjs';

const w = workspace('rulers', 47642);
const deck = `---
marp: true
---

## Heading to place

- One
- Two

::: box #a x=100 y=420 w=200 h=100 fill=#eeeeee
Box
:::

---

<!-- layout: title -->
# Big title

Subtitle line

<!--
Say hello.
-->
`;
fs.writeFileSync(path.join(w.ws, 'Guides.slides.md'), deck);
const k = "parseFloat(document.querySelector('.sl-frame').style.getPropertyValue('--k'))";
const ptr = "window.__ptr=(el,t,x,y)=>el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:t==='pointerup'?0:1,pointerId:1}));";
// drag from the left ruler to slide x=400 (a vertical guide)
const fromRuler = `${ptr}{const f=document.querySelector('.sl-frame').getBoundingClientRect();const r=document.querySelector('.sl-ruler.is-left');const kk=${k};const y=f.top+200*kk;__ptr(r,'pointerdown',r.getBoundingClientRect().left+8,y);for(let i=1;i<=5;i++)__ptr(window,'pointermove',f.left+400*kk*i/5,y);__ptr(window,'pointerup',f.left+400*kk,y);}`;
const guideX = `[...document.querySelectorAll('.sl-guide.is-v')].map(g=>Math.round(parseFloat(g.style.left)/${k}))`;
// drag box #a by mouse so its left edge ends 3 slide px right of the guide at 400 (inside the snap distance)
const dragBox = `${fire}{const kk=${k};const r=document.querySelector('.sl-frame .sl-obj[data-id=a]').getBoundingClientRect();const c=[r.x+r.width/2,r.y+r.height/2];__fire('mousedown',...c);__fire('mouseup',...c);window.__c=c;window.__dx=(403-100)*kk;}`;
const dragBox2 = "{const [x,y]=window.__c;__fire('mousedown',x,y);for(let i=1;i<=8;i++)__fire('mousemove',x+window.__dx*i/8,y);__fire('mouseup',x+window.__dx,y);}";
// the guide back onto the ruler
const offGuide = `${ptr}{const g=document.querySelector('.sl-guide.is-v');const b=g.getBoundingClientRect();const r=document.querySelector('.sl-ruler.is-left').getBoundingClientRect();__ptr(g,'pointerdown',b.left+3,b.top+50);__ptr(window,'pointermove',b.left-100,b.top+50);__ptr(window,'pointerup',r.left+5,b.top+50);}`;
const rect = (sel) => `(()=>{const e=document.querySelector('${sel}');if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top)]})()`;
const r = await runApp(w, [
  { size: [1500, 950], wait: 1200 }, open('Guides.slides.md'),
  step("document.querySelector('[data-sl-rulers]').click()", 600),
  log("[!document.querySelector('.sl-ruler.is-top').hidden, [...document.querySelectorAll('.sl-ruler.is-top span')].map(s=>s.textContent).slice(0,3), document.querySelectorAll('.sl-ruler.is-left span').length > 2]"),
  step(fromRuler, 600), log(guideX),
  step(dragBox, 500), step(dragBox2, 1300),
  log("Math.round(parseFloat(document.querySelector('.sl-frame .sl-obj[data-id=a]').style.left))"),
  log(guideX),
  step(offGuide, 600), log(guideX),
  step("document.querySelector('[data-sl-rulers]').click()", 400), log("document.querySelector('.sl-ruler.is-top').hidden"),
  // place the heading of slide 1 with the Arrange menu
  log(rect('.sl-frame .sl-body > [data-flow="0"]')),
  step("document.querySelector('.sl-frame .sl-body > [data-flow=\"0\"]').click()", 300),
  log("document.querySelector('.sl-frame .is-flow-picked')?.textContent"),
  step("document.querySelector('[data-sl=arrange]').click()", 400),
  step("[...document.querySelectorAll('.menu button')].find(b=>/Place as free box/.test(b.textContent)).click()", 1300),
  log(rect('.sl-frame .sl-obj[data-id="box-1"] h2')),
  log("document.querySelector('.sl-frame .sl-obj[data-id=\"box-1\"]')?.classList.contains('is-selected')"),
  // the title of slide 2 with the context menu
  step("document.querySelectorAll('.sl-thumb')[1].click()", 900),
  step("const e=document.querySelector('.sl-frame .sl-body > [data-flow=\"0\"]');const b=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.x+5,clientY:b.y+5}))", 400),
  step("[...document.querySelectorAll('.menu button')].find(b=>/Place as free box/.test(b.textContent)).click()", 1300),
  errors,
]);
console.log('\nrulers'); if (process.env.DEBUG) console.log(JSON.stringify(r.js));
assert.deepEqual(r.js.at(-1), [], r.log.slice(-2500));
const [shown, guide, moved, kept, removed, hidden, before, picked, after, sel] = r.js;
assert.equal(shown[0], true); assert.deepEqual(shown[1], ['0', '100', '200']); assert.equal(shown[2], true); console.log('  ✓ Rulers shows a ruler along the top and the left of the slide, in slide pixels');
assert.equal(guide.length, 1); assert(Math.abs(guide[0] - 400) <= 1, String(guide)); console.log('  ✓ dragging from a ruler adds a guide where it is dropped');
assert.equal(moved, guide[0]); console.log('  ✓ a dragged object snaps to the guide');
assert.deepEqual(kept, guide); assert.deepEqual(removed, []); console.log('  ✓ a guide dragged back onto the ruler goes away');
assert.equal(hidden, true); console.log('  ✓ the rulers hide again');
assert.equal(picked, 'Heading to place'); console.log('  ✓ a click picks a block of the slide text');
assert(Math.abs(after[0] - before[0]) <= 2 && Math.abs(after[1] - before[1]) <= 2, `${before} → ${after}`); assert.equal(sel, true); console.log('  ✓ Place puts the block in a free box at the same spot, selected');
const text = w.read('Guides.slides.md');
assert(!/guide/i.test(text.replace('Guides', ''))); console.log('  ✓ guides are view state: nothing about them is written to the file');
const parts = text.split('\n---\n'); const s1 = parts[1];
assert.match(s1, new RegExp(`\\n- One\\n- Two\\n\\n::: box #a x=${guide[0]} y=420 w=200 h=100 fill=#eeeeee\\nBox\\n:::\\n\\n::: box #box-1 x=\\d+ y=\\d+ w=\\d+ h=\\d+\\n## Heading to place\\n:::\\n$`)); assert(!/^## Heading to place\n\n- One/m.test(s1));
console.log('  ✓ the block\'s lines move unchanged into the box; nothing else in the slide changes');
const s2 = parts[2];
assert.equal(s2.replace(/\n\n::: box #box-1 x=\d+ y=\d+ w=\d+ h=\d+ align=center\n# Big title\n:::\n$/, '\n'), '\n<!-- layout: title -->\n\nSubtitle line\n\n<!--\nSay hello.\n-->\n');
console.log('  ✓ from the context menu too; a centred title keeps align=center, the notes stay');
