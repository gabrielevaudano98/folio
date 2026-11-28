// Folio — an edit made just before switching tabs is written to its own file and to no other. Issue #82.
// The page editor reports its change 220 ms after the last key, and the surfaces wait too: slide notes 350 ms, slide text
// 180 ms, a board's label field 300 ms, a sheet cell until its editor is left. Before the fix that late change went into
// the tab shown by then (a page or another deck overwritten), or was lost. Each case below edits, switches at once, and
// compares both files on disk byte for byte.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, errors } from './harness.mjs';
import { parseWorkbook, serializeWorkbook } from '../src/renderer/sheet-core.js';
import { splitSlides, joinDeck, setNotes, parseFrontmatter } from '../src/renderer/slides-core.js';
import { setObjectBody } from '../src/renderer/slides-objects.js';

const w = workspace('tab-switch-save', 47623);
const put = (f, t) => fs.writeFileSync(path.join(w.ws, f), t);
const orig = { pitch: w.read('Pitch.slides.md'), motion: w.read('Motion.slides.md'), board: w.read('System.board.md'), sheet: w.read('Budget.sheet.md') };
const target = '# Target\n\nNothing here may change.\n';
put('Target.md', target);
put('Rename.md', '# Note\n\nhello\n');
for (const n of [2, 3, 4, 5, 6]) put(`Deck${n}.slides.md`, orig.pitch);
for (const n of [2, 3]) { put(`Board${n}.board.md`, orig.board); put(`Sheet${n}.sheet.md`, orig.sheet); }

// what each file must hold afterwards, from the pure cores (the surfaces write through the same functions)
const withNotes = (t, notes) => { const fm = parseFrontmatter(t); const list = splitSlides(fm.body); list[0] = setNotes(list[0], notes); return joinDeck(fm.raw, list); };
const withBox = (t, body) => { const fm = parseFrontmatter(t); const list = splitSlides(fm.body); list[0] = setObjectBody(list[0], 0, body); return joinDeck(fm.raw, list); };
const withCell = (t, v) => { const b = parseWorkbook(t); b.filter((x) => x.type === 'sheet')[0].rows[1][1] = v; return serializeWorkbook(b); };
const withLabel = (t, v) => t.replace('api: component "Orders API"', `api: component "${v}"`);

const before = { roadmap: w.read('Roadmap.md') };
const note = w.read('Onboarding.md');
const click = (f) => `document.querySelector('[data-file="${f}"]').click()`;
const type = (s) => `document.querySelector('.ProseMirror').editor.commands.insertContentAt(1, '${s}')`;
const shown = (sel) => `document.querySelector('#pane-surface > .surface:not([hidden]) ${sel}')`;
const notes = (s) => `{const n=${shown('.sl-notes')};n.focus();n.value='${s}';n.dispatchEvent(new Event('input',{bubbles:true}))}`;
const label = (s) => `{const l=${shown('[data-n-label]')};l.focus();l.value='${s}';l.dispatchEvent(new Event('input',{bubbles:true}))}`;
const cell = (s) => `{const g=${shown('.sh-wrap')};g.dispatchEvent(new KeyboardEvent('keydown',{key:'${s[0]}',bubbles:true,cancelable:true}));const e=${shown('.sh-editor')};e.value='${s}';e.dispatchEvent(new Event('input',{bubbles:true}))}`;
const r = await runApp(w, [{ size: [1300, 900], wait: 1200 },
  // the page editor (220 ms)
  { js: `${click('Onboarding.md')};1`, wait: 1800 },
  { js: `${type('One ')}; ${click('Pitch.slides.md')}; 1`, wait: 2500 },   // page → slides, inside the 220 ms window
  { js: `${click('Onboarding.md')};1`, wait: 1500 },
  { js: `${type('Two ')}; ${click('System.board.md')}; 1`, wait: 2500 },    // page → board
  { js: `${click('Onboarding.md')};1`, wait: 1500 },
  { js: `${type('Three ')}; ${click('Budget.sheet.md')}; 1`, wait: 2500 },  // page → sheet
  { js: `${click('Onboarding.md')};1`, wait: 1500 },
  { js: `${type('Four ')}; ${click('Roadmap.md')}; 1`, wait: 2500 },        // page → another page
  // slides: speaker notes (350 ms) and text typed on the slide (180 ms)
  { js: `${click('Pitch.slides.md')};1`, wait: 2000 },
  { js: `${notes('Say hello')}; ${click('Target.md')}; 1`, wait: 1500 },             // deck → page
  { js: `${click('Deck2.slides.md')};1`, wait: 2000 },
  { js: `${notes('Deck two')}; ${click('Deck3.slides.md')}; 1`, wait: 1500 },        // deck → another deck
  { js: `${click('Motion.slides.md')};1`, wait: 2000 },
  { js: `${shown('.sl-frame .sl-obj[data-id=a]')}.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));1`, wait: 600 },
  { js: `{const ed=document.querySelector('.is-editing .ProseMirror').editor;ed.commands.selectAll();ed.commands.insertContent('Edited')} ${click('Target.md')}; 1`, wait: 1500 }, // text on a slide → page
  // board: the label field of the format panel (300 ms)
  { js: `${click('System.board.md')};1`, wait: 2000 },
  { js: "window.__folioSurface.gotoNode('api');1", wait: 400 },
  { js: `${label('Orders API v2')}; ${click('Target.md')}; 1`, wait: 1500 },         // board → page
  { js: `${click('Board2.board.md')};1`, wait: 2000 },
  { js: "window.__folioSurface.gotoNode('api');1", wait: 400 },
  { js: `${label('Orders API two')}; ${click('Board3.board.md')}; 1`, wait: 1500 },  // board → another board
  // sheet: a cell still being typed in (written when its editor is left)
  { js: `${click('Budget.sheet.md')};1`, wait: 2000 },
  { js: "window.__folioSurface.gotoCell('B2');1", wait: 400 },
  { js: `${cell('Zed')}; ${click('Target.md')}; 1`, wait: 800 },                     // sheet → page
  { js: 'document.activeElement?.blur();1', wait: 1000 },                             // the cell editor loses focus only now
  { js: `${click('Sheet2.sheet.md')};1`, wait: 2000 },
  { js: "window.__folioSurface.gotoCell('B2');1", wait: 400 },
  { js: `${cell('Zed two')}; ${click('Sheet3.sheet.md')}; 1`, wait: 800 },          // sheet → another sheet
  { js: 'document.activeElement?.blur();1', wait: 1000 },
  // code and visual side by side: text typed in the code pane reaches the surface after 250 ms, and must not reach the
  // next deck instead (which would then be saved with the first deck's text on its next edit)
  { js: `${click('Deck5.slides.md')};1`, wait: 2000 },
  { js: "document.querySelector('#view-switch [data-view=\"split\"]').click();1", wait: 1200 },
  { js: "document.querySelector('#editor .cm-content').focus();document.execCommand('insertText',false,'ZZ');1", wait: 0 },
  { js: `${click('Deck6.slides.md')};1`, wait: 1200 },
  { js: `${notes('Six')};1`, wait: 1200 },
  { js: "document.querySelector('#view-switch [data-view=\"visual\"]').click();1", wait: 800 },
  // a page renamed while open keeps saving into itself (changes name their tab, which a rename keeps, not its old path)
  { js: `${click('Rename.md')};1`, wait: 1800 },
  { js: "window.__folioRun('rename');1", wait: 600 },
  { js: "const i=document.querySelector('#prompt-input');i.value='Renamed';i.closest('form').requestSubmit();1", wait: 1500 },
  { js: `${type('Typed ')};1`, wait: 1500 },
  errors,
  // quitting at once: the notes still waiting for their pause are saved before Folio closes
  { js: `${click('Deck4.slides.md')};1`, wait: 2000 },
  { js: `${notes('Before quitting')};1`, wait: 0 },
  { quit: true, wait: 4000 },
]);
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
const errs = r.js.find((x) => Array.isArray(x));
console.log('edits just before a tab switch');
assert.equal(w.read('Roadmap.md'), before.roadmap); ok('a page typed in just before switching never writes into the page shown next');
const got = w.read('Onboarding.md');
for (const s of ['One ', 'Two ', 'Three ', 'Four ']) assert.ok(got.includes(s), `the page was saved with "${s}"`);
assert.ok(got.length > note.length); ok('the page typed in is written to its own file at once, with every edit');
assert.equal(w.read('Target.md'), target); ok('no slides, board or sheet change lands in the page shown next');
assert.equal(w.read('Pitch.slides.md'), withNotes(orig.pitch, 'Say hello')); ok('speaker notes typed just before switching to a page are written to their deck');
assert.equal(w.read('Deck2.slides.md'), withNotes(orig.pitch, 'Deck two')); assert.equal(w.read('Deck3.slides.md'), orig.pitch);
ok('speaker notes typed just before switching to another deck go to their own deck; the other deck is untouched');
assert.equal(w.read('Motion.slides.md'), withBox(orig.motion, 'Edited')); ok('text typed on a slide just before switching is written to its deck');
assert.equal(w.read('System.board.md'), withLabel(orig.board, 'Orders API v2')); ok('a board label typed just before switching to a page is written to its board');
assert.equal(w.read('Board2.board.md'), withLabel(orig.board, 'Orders API two')); assert.equal(w.read('Board3.board.md'), orig.board);
ok('a board label typed just before switching to another board goes to its own board; the other board is untouched');
assert.equal(w.read('Budget.sheet.md'), withCell(orig.sheet, 'Zed')); ok('a cell typed in just before switching to a page is written to its sheet');
assert.equal(w.read('Sheet2.sheet.md'), withCell(orig.sheet, 'Zed two')); assert.equal(w.read('Sheet3.sheet.md'), orig.sheet);
ok('a cell typed in just before switching to another sheet goes to its own sheet; the other sheet is untouched');
const five = w.read('Deck5.slides.md'); assert.ok(five.includes('ZZ')); assert.equal(five.replace('ZZ', ''), orig.pitch);
assert.equal(w.read('Deck6.slides.md'), withNotes(orig.pitch, 'Six'));
ok('text typed in the code pane just before switching stays in its deck; the next deck keeps its own text');
assert.ok(!fs.existsSync(path.join(w.ws, 'Rename.md'))); assert.equal(w.read('Renamed.md'), '# Typed Note\n\nhello\n');
ok('a page renamed while open goes on saving what is typed into it');
assert.equal(w.read('Deck4.slides.md'), withNotes(orig.pitch, 'Before quitting')); ok('quitting right after typing saves what was still waiting');
assert.deepEqual(errs, []); ok('no errors in the window');
console.log(`\n${n} checks passed`);
