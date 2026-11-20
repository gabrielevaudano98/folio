// Folio slides performance: a 200-slide deck opens quickly and an edit re-renders without redrawing every thumbnail.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, pick, errors, log, step } from './harness.mjs';

const w = workspace('perf', 47580);
const slides = Array.from({ length: 200 }, (_, i) => `# Slide ${i + 1}\n\n- Point one about ${i}\n- Point two\n\n::: box #b${i} x=700 y=200 w=400 h=200 fill=#eeeeee\n**Box ${i}**\n:::\n\n::: shape #s${i} type=ellipse x=100 y=420 w=160 h=160 fill=#0a5c36 :::`);
fs.writeFileSync(path.join(w.ws, 'Big.slides.md'), `---\nmarp: true\npaginate: true\n---\n\n${slides.join('\n\n---\n\n')}\n`);
const r = await runApp(w, [
  { size: [1500, 950], wait: 1200 },
  step("window.__t0=performance.now();document.querySelector('[data-file=\"Big.slides.md\"]').click()", 50),
  { js: "new Promise(r=>{const f=()=>document.querySelector('.sl-frame .slide')?r(Math.round(performance.now()-window.__t0)):setTimeout(f,20);f()})", log: true, wait: 1500 },
  log("[document.querySelectorAll('.sl-thumb').length, [...document.querySelectorAll('.sl-thumb .sl-scale')].filter(b=>b.firstElementChild).length]"),
  pick('b0'),
  log("(()=>{const t=performance.now();document.querySelector('.sl-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));return Math.round(performance.now()-t)})()"),
  log("(()=>{const t=performance.now();for(let k=0;k<5;k++)document.querySelector('.sl-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));return Math.round((performance.now()-t)/5)})()"),
  step("const l=document.querySelector('.sl-thumbs');l.scrollTop=l.scrollHeight", 800),
  log("!!document.querySelector('.sl-thumb[data-i=\"199\"] .sl-scale .slide')"),
  errors,
]);
console.log('\nperformance'); if (process.env.DEBUG) console.log(JSON.stringify(r.js));
assert.deepEqual(r.js.at(-1), [], JSON.stringify(r.js));
const [openMs, [thumbs, drawn], firstEdit, editMs, last] = r.js;
const slow = process.env.CI ? 3 : 1;
assert(openMs < 3000 * slow, `open took ${openMs} ms`); console.log(`  ✓ a 200-slide deck opens in ${openMs} ms`);
assert.equal(thumbs, 200); assert(drawn < 40, `${drawn} thumbnails drawn up front`); console.log(`  ✓ only ${drawn} of 200 thumbnails are drawn until they scroll into view`);
assert(editMs < 250 * slow, `an edit took ${editMs} ms`); console.log(`  ✓ an edit re-renders in ${editMs} ms (first ${firstEdit} ms)`);
assert.equal(last, true); console.log('  ✓ thumbnails fill in as the list scrolls');
assert.match(w.read('Big.slides.md'), /::: box #b0 x=706 y=200/); console.log('  ✓ the edits are in the file');
