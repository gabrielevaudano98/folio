// Folio incremental lists test (Marp fragmented lists): `*` and `1)` items appear one click at a time in the show and in the
// presenter view, before the slide's own animation lines; `-` lists stay; the Animations pane says so.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, open, errors, log, step } from './harness.mjs';

const w = workspace('builds', 47641);
const deck = `---
marp: true
---

# Steps

* First
* Second
* Third

- Always there

::: box #note x=760 y=420 w=400 h=200
1) One
2) Two
:::

::: box #late x=80 y=560 w=300 h=80
Late
:::

<!--
animate: #late fade-in
-->

---

# The end
`;
fs.writeFileSync(path.join(w.ws, 'Steps.slides.md'), deck);
const layer = "document.querySelector('.presenter .pr-layer:nth-last-child(1 of .pr-layer)')";
const vis = (sel) => `(l.querySelector('${sel}') ? getComputedStyle(l.querySelector('${sel}')).visibility : null)`;
const state = `(()=>{const l=${layer};const f=[...l.querySelectorAll('[data-fragment]')];return [f.length, f.filter(e=>getComputedStyle(e).visibility==='visible').length, ${vis('.sl-body > ul:not(:has([data-fragment])) li')}, ${vis('[data-id=late]')}, window.__folioShow.step, window.__folioShow.prep.steps.length, window.__folioShow.i]})()`;
const next = step('window.__folioShow.prep.finish();window.__folioShow.next()', 700);
const r = await runApp(w, [
  { size: [1500, 950], wait: 1200 }, open('Steps.slides.md'),
  step("document.querySelector('[data-sl-anim]').click()", 800),
  log("document.querySelector('.sl-anim .an-fragments')?.textContent || ''"),
  log("[...document.querySelectorAll('.sl-frame [data-fragment]')].filter(e=>getComputedStyle(e).visibility==='visible').length"),
  // the on-canvas editor writes - and 1.; a box that builds keeps its * and 1)
  step("document.querySelector('.sl-frame .sl-obj[data-id=note]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))", 700),
  step("const pm=document.querySelector('.is-editing .ProseMirror');pm.focus();document.execCommand('insertText',false,' more')", 600),
  step("document.querySelector('.is-editing .ProseMirror').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))", 1200),
  step("document.querySelector('[data-sl=present]').click()", 1500),
  log(state), next, log(state), next, next, next, next, log(state), next, log(state), next, log(state),
  step('window.__folioShow.prev()', 700), log(state),
  step('window.__folioShow.close()', 700),
  step("document.querySelector('[data-sl=present-menu]').click()", 500), step("[...document.querySelectorAll('.menu button')].find(b=>/Presenter view/.test(b.textContent)).click()", 1800),
  log("[document.querySelector('.pv-next').textContent.trim(), document.querySelector('.pv-step').textContent]"),
  step("document.querySelector('[data-pv=end]').click()", 900),
  errors,
]);
console.log('\nbuilds'); if (process.env.DEBUG) console.log(JSON.stringify(r.js));
assert.deepEqual(r.js.at(-1), [], r.log.slice(-2500));
const [note, editing, start, one, five, six, slide2, back, pv] = r.js;
assert.match(note, /5 items marked with \* or 1\) appear one per click/); console.log('  ✓ the Animations pane says how many list items build one per click');
assert.equal(editing, 5); console.log('  ✓ on the editing canvas every item stays visible');
const saved = w.read('Steps.slides.md');
assert.match(saved, /::: box #note x=760 y=420 w=400 h=200\n1\) One\n2\) Two more\n:::/); assert.equal(saved.replace(' more', ''), deck); console.log('  ✓ editing a box on the slide keeps its 1) markers, and nothing else changes');
assert.deepEqual(start, [5, 0, 'visible', 'hidden', 0, 6, 0]); console.log('  ✓ the show starts with * and 1) items hidden, - items shown, six clicks to go');
assert.deepEqual(one.slice(0, 2), [5, 1]); assert.equal(one[4], 1); console.log('  ✓ each click shows the next item, in reading order (flow text, then boxes)');
assert.deepEqual(five.slice(1, 5), [5, 'visible', 'hidden', 5]); assert.deepEqual(six.slice(3, 5), ['visible', 6]); console.log('  ✓ the slide\'s own animation lines come after its incremental items');
assert.equal(slide2[6], 1); assert.deepEqual(back.slice(4, 7), [6, 6, 0]); console.log('  ✓ then the show moves on, and back returns to the fully built slide');
assert.deepEqual(pv, ['Next click: build 1 of 6 on this slide', 'Build 0 of 6']); console.log('  ✓ the presenter view counts the incremental items as builds');
