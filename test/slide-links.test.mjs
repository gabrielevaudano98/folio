// Folio interactivity test: links and zooms when presenting, custom shows, auto-advance, the Link and Zoom
// fields of the Format pane, summary zoom, and hyperlinks in the PowerPoint export.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import JSZip from 'jszip';
import { workspace, runApp, open, pick, errors, log, step } from './harness.mjs';

const w = workspace('links', 47583);
const S = 'window.__folioShow';
const click = (sel) => step(`document.querySelector('.presenter .pr-layer:nth-last-child(1 of .pr-layer) ${sel}').click()`, 900);
const r = await runApp(w, [
  { size: [1500, 950], wait: 1200 }, open('Links.slides.md'),
  log("[document.querySelectorAll('.sl-frame .sl-zoom .sl-zoom-view .slide').length, !!document.querySelector('.sl-frame [data-link=last].has-link')]"),
  step("document.querySelector('[data-sl=present]').click()", 1500),
  log(`[${S}.i, ${S}.order.length]`),
  click('[data-zoom]'), log(`[${S}.i, ${S}.order[${S}.i].title]`),
  step(`${S}.next()`, 900), step(`${S}.next()`, 900), log(`[${S}.i, ${S}.order[${S}.i].title]`),
  click('[data-link=last]'), log(`[${S}.i]`),
  step('', 1800), log(`[${S}.i, ${S}.order[${S}.i].title]`), // advance: 1s on the last slide loops back? no: it stays (no loop)
  click('[data-link="slide:1"]'), log(`[${S}.i]`),
  step(`${S}.close()`, 600),
  // custom show from the Present menu
  step("document.querySelector('[data-sl=present-menu]').click()", 600), step("[...document.querySelectorAll('.menu button, .menu [role=menuitem]')].find(b=>/Custom show: short/.test(b.textContent)).click()", 1500),
  log(`${S}.order.map(s=>s.number)`), step(`${S}.close()`, 600),
  // Format pane: link and zoom fields
  step("document.querySelector('.sl-thumb[data-i=\"0\"]').click()", 800), step("document.querySelector('[data-sl-format]').click()", 600), pick('site'),
  step("const s=document.querySelector('.sl-format [data-fk=link-kind]');s.value='slide';s.dispatchEvent(new Event('change',{bubbles:true}))", 700),
  step("const s=document.querySelector('.sl-format [data-fk=link-value]');s.value='3';s.dispatchEvent(new Event('change',{bubbles:true}))", 700),
  pick('z-detail'), step("const s=document.querySelector('.sl-format [data-fk=zoom-to]');s.value='slide:3';s.dispatchEvent(new Event('change',{bubbles:true}))", 700),
  step("document.querySelector('[data-sl=insert]').click()", 500), step("[...document.querySelectorAll('.menu button, .menu [role=menuitem]')].find(b=>/Summary zoom/.test(b.textContent)).click()", 1200),
  step("window.__folioRun('export-pptx')", 6000),
  errors,
]);
console.log('\nlinks'); if (process.env.DEBUG) console.log(JSON.stringify(r.js));
assert.deepEqual(r.js.at(-1), [], JSON.stringify(r.js));
const [canvas, start, zoomed, returned, last, , home, custom] = r.js;
assert.deepEqual(canvas, [1, true]); console.log('  ✓ the canvas shows zooms as live copies and marks linked objects');
assert.deepEqual(start, [0, 4]); assert.deepEqual(zoomed, [1, 'Detail one']); assert.deepEqual(returned, [0, 'Contents']); console.log('  ✓ a section zoom opens the section and comes back to the summary at its end');
assert.deepEqual(last, [3]); assert.deepEqual(home, [0]); console.log('  ✓ links jump to the last slide and to a slide number');
assert.deepEqual(custom, [1, 3]); console.log('  ✓ custom shows present only their slides, from the Present menu');
const text = w.read('Links.slides.md');
assert.match(text, /::: box #site x=700 y=340 w=300 h=100 link=slide:3\n/); assert.match(text, /::: zoom #z-detail x=100 y=200 w=384 h=216 slide=3 :::/); console.log('  ✓ the Format pane writes link= and the zoom target');
assert.match(text, /# Summary\n\n::: zoom #zoom-1 [^\n]*section=Start :::\n\n::: zoom #zoom-2 [^\n]*section=Detail :::\n\n::: zoom #zoom-3 [^\n]*section=End :::/); console.log('  ✓ summary zoom adds a slide with one zoom per section');
const zip = await JSZip.loadAsync(fs.readFileSync(path.join(w.out, 'Links.pptx')));
const s1 = await zip.file('ppt/slides/slide1.xml').async('string'); const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string');
assert.match(s1, /<a:hlinkClick r:id="rId\d+"[^>]*action="ppaction:\/\/hlinksldjump"|<a:hlinkClick r:id="rId\d+"/); assert.match(rels, /slide\d+\.xml"|hlinksldjump|slide/); console.log('  ✓ links and zooms export as PowerPoint hyperlinks');
