// Folio — an edit made just before switching tabs is written to its own file, and to no other. A sheet saves after a
// pause (or in slices); before this fix that late save landed in whichever tab was then active, and the left tab
// waited in memory until it was shown again (found by the tab-switch work, Nov 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, errors } from './harness.mjs';

const w = workspace('tab-switch-save', 47623);
fs.writeFileSync(path.join(w.ws, 'sheets', 'A.sheet.md'), '## S\n\n| X |\n| --- |\n| 1 |\n');
fs.writeFileSync(path.join(w.ws, 'sheets', 'B.sheet.md'), '## S\n\n| X |\n| --- |\n| 2 |\n');
fs.writeFileSync(path.join(w.ws, 'sheets', 'C.sheet.md'), '## S\n\n| X |\n| --- |\n| 3 |\n');
fs.writeFileSync(path.join(w.ws, 'sheets', 'D.sheet.md'), '## S\n\n| X |\n| --- |\n| 4 |\n');
fs.writeFileSync(path.join(w.ws, 'Note.md'), '# Note\n\nhello\n');
const S = "document.querySelector('.surface-sheet:not([hidden])')?.__surface";
// a cell still being typed in: Univer's cell editor open on A2, text typed after its value
const typing = (t) => `${S}.ws().getRange('A2').activate(); ${S}.wb().startEditing(); document.execCommand('insertText', false, '${t}')`;
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
  // a cell still being typed in (Univer writes it only when its editor closes)
  { js: `${click('sheets/C.sheet.md')};1`, wait: 2500 },
  { js: `${typing('Zed')}; ${click('Note.md')}; 1`, wait: 2500 },                              // sheet → note
  { js: `${click('sheets/C.sheet.md')};1`, wait: 2500 },
  { js: `${click('sheets/D.sheet.md')};1`, wait: 2500 },
  { js: `${typing('Two')}; ${click('sheets/A.sheet.md')}; 1`, wait: 2500 },                    // sheet → sheet
  { js: `${click('sheets/D.sheet.md')};1`, wait: 2500 },
  { js: `${typing('Kept')}; window.__folioRun?.('save'); 1`, wait: 800 },                       // an explicit save
  { js: `[${S}.wb().isCellEditing(), ${S}.unitId() === ${S}.wb().getId()]`, log: true, wait: 1500 },
  // a workbook renamed while open keeps saving into itself (documents are known by their tab, which a rename keeps)
  { js: `${click('sheets/B.sheet.md')};1`, wait: 2500 },
  { js: "window.__folioRun('rename');1", wait: 600 },
  { js: "const i=document.querySelector('#prompt-input');i.value='B2';i.closest('form').requestSubmit();1", wait: 1500 },
  { js: `${S}.ws().getRange('A2').setValue(333);1`, wait: 2500 },
  errors,
]);
const errs = r.js.at(-1);
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('edits just before a tab switch');
assert.equal(w.read('Note.md'), '# Again Typed Note\n\nhello\n', 'the note holds only its own text'); assert.equal(w.read('Roadmap.md'), roadmap);
ok('a sheet saving after the switch never writes into the note now shown');
assert.match(w.read('sheets/A.sheet.md'), /\| 222 \|/);
ok('the sheet edited just before switching is written to its own file; the other sheet is untouched');
ok('a page typed in just before switching (to a sheet or another page) is written at once, and only into itself');
assert.match(w.read('sheets/C.sheet.md'), /\| 3Zed \|/); assert.equal(w.read('Note.md'), '# Again Typed Note\n\nhello\n');
ok('a cell still being typed in when the tab changes is written to its own workbook, never to the page shown next');
assert.match(w.read('sheets/D.sheet.md'), /\| 4Two/); assert.match(w.read('sheets/A.sheet.md'), /\| 222 \|/);
ok('a cell typed in just before switching to another workbook goes to its own; the other is untouched');
assert.match(w.read('sheets/D.sheet.md'), /\| 4TwoKept \|/); assert.deepEqual(r.js[0], [true, true]);
ok('an explicit save writes the cell being typed in and leaves its editor open');
assert.ok(!fs.existsSync(path.join(w.ws, 'sheets', 'B.sheet.md'))); assert.match(w.read('sheets/B2.sheet.md'), /\| 333 \|/);
ok('a workbook renamed while open keeps saving into itself');
assert.deepEqual(errs, []);
console.log(`\n${n} checks passed`);
