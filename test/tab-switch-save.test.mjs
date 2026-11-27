// Folio — an edit made just before switching tabs is written to its own file, and to no other. A sheet saves after a
// pause (or in slices); before this fix that late save landed in whichever tab was then active, and the left tab
// waited in memory until it was shown again (found by the tab-switch work, Nov 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, errors } from './harness.mjs';

const w = workspace('tab-switch-save', 47623);
fs.writeFileSync(path.join(w.ws, 'sheets', 'A.sheet.md'), '## S\n\n| X |\n| --- |\n| 1 |\n');
fs.writeFileSync(path.join(w.ws, 'sheets', 'B.sheet.md'), '## S\n\n| X |\n| --- |\n| 2 |\n');
fs.writeFileSync(path.join(w.ws, 'Note.md'), '# Note\n\nhello\n');
const S = "document.querySelector('.surface-sheet:not([hidden])')?.__surface";
const click = (f) => `document.querySelector('[data-file="${f}"]').click()`;
const roadmap = w.read('Roadmap.md');
const r = await runApp(w, [{ size: [1300, 900], wait: 1200 },
  { js: `${click('sheets/A.sheet.md')};1`, wait: 2500 },
  { js: `${S}.ws().getRange('A2').setValue(111); ${click('Note.md')}; 1`, wait: 2500 },        // sheet → note
  { js: `${click('sheets/A.sheet.md')};1`, wait: 2500 },
  { js: `${S}.ws().getRange('A2').setValue(222); ${click('sheets/B.sheet.md')}; 1`, wait: 2500 }, // sheet → sheet
  { js: `${click('Note.md')};1`, wait: 1500 },
  { js: `document.querySelector('.ProseMirror').editor.commands.insertContentAt(1, 'Typed '); ${click('sheets/A.sheet.md')}; 1`, wait: 2500 }, // note → sheet
  { js: `${click('Note.md')};1`, wait: 1500 },
  { js: `document.querySelector('.ProseMirror').editor.commands.insertContentAt(1, 'Again '); ${click('Roadmap.md')}; 1`, wait: 2500 }, // note → note
  errors,
]);
const errs = r.js.at(-1);
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('edits just before a tab switch');
assert.equal(w.read('Note.md'), '# Again Typed Note\n\nhello\n', 'the note holds only its own text'); assert.equal(w.read('Roadmap.md'), roadmap);
ok('a sheet saving after the switch never writes into the note now shown');
assert.match(w.read('sheets/A.sheet.md'), /\| 222 \|/); assert.equal(w.read('sheets/B.sheet.md'), '## S\n\n| X |\n| --- |\n| 2 |\n');
ok('the sheet edited just before switching is written to its own file; the other sheet is untouched');
ok('a page typed in just before switching (to a sheet or another page) is written at once, and only into itself');
assert.deepEqual(errs, []);
console.log(`\n${n} checks passed`);
