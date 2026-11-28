// Folio — a page typed in just before switching tabs is written to its own file and to no other. Before the fix the page
// editor reported its change 220 ms after the last key; if the tab had changed by then, that text went into the tab now
// shown (a slides, board or sheet file overwritten with the page's text). Issue #82.
import assert from 'node:assert/strict';
import { workspace, runApp, errors } from './harness.mjs';

const w = workspace('tab-switch-save', 47623);
const click = (f) => `document.querySelector('[data-file="${f}"]').click()`;
const type = (s) => `document.querySelector('.ProseMirror').editor.commands.insertContentAt(1, '${s}')`;
const before = { slides: w.read('Pitch.slides.md'), board: w.read('System.board.md'), sheet: w.read('Budget.sheet.md'), roadmap: w.read('Roadmap.md') };
const note = w.read('Onboarding.md');
const r = await runApp(w, [{ size: [1300, 900], wait: 1200 },
  { js: `${click('Onboarding.md')};1`, wait: 1800 },
  { js: `${type('One ')}; ${click('Pitch.slides.md')}; 1`, wait: 2500 },   // page → slides, inside the 220 ms window
  { js: `${click('Onboarding.md')};1`, wait: 1500 },
  { js: `${type('Two ')}; ${click('System.board.md')}; 1`, wait: 2500 },    // page → board
  { js: `${click('Onboarding.md')};1`, wait: 1500 },
  { js: `${type('Three ')}; ${click('Budget.sheet.md')}; 1`, wait: 2500 },  // page → sheet
  { js: `${click('Onboarding.md')};1`, wait: 1500 },
  { js: `${type('Four ')}; ${click('Roadmap.md')}; 1`, wait: 2500 },        // page → another page
  errors,
]);
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('edits just before a tab switch');
assert.equal(w.read('Pitch.slides.md'), before.slides); assert.equal(w.read('System.board.md'), before.board); assert.equal(w.read('Budget.sheet.md'), before.sheet);
ok('the slides, board and sheet files are not overwritten with the page text');
assert.equal(w.read('Roadmap.md'), before.roadmap); ok('the page shown next is not overwritten either');
const got = w.read('Onboarding.md');
for (const s of ['One ', 'Two ', 'Three ', 'Four ']) assert.ok(got.includes(s), `the page was saved with "${s}"`);
assert.ok(got.length > note.length); ok('the page typed in is written to its own file at once, with every edit');
assert.deepEqual(r.js.at(-1), []); ok('no errors in the window');
console.log(`\n${n} checks passed`);
