// Folio Sheets — workbooks of hidden tabs stay loaded: switching back shows the same Univer unit (undo history,
// selection, computed values) without reloading or running onOpen again; drawings come back; a file changed on disk
// meanwhile is loaded again; past the limit the least recently shown goes; a closed tab's workbook is let go.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, errors } from './harness.mjs';

const w = workspace('sheets-tabs', 47624);
const book = (n, extra = '') => `## S\n\n| X | Y |\n| --: | --: |\n| ${n} | =A2*2 |\n${extra}`;
fs.writeFileSync(path.join(w.ws, 'sheets', 'A.sheet.md'), book(1, '\n<!-- sheet: {"charts":[{"type":"column","range":"A1:B2"}]} -->\n\n```script\nfunction onOpen() { const s = SpreadsheetApp.getActiveSheet(); s.getRange("D1").setValue((s.getRange("D1").getValue() || 0) + 1); }\n```\n\n<!-- workbook: {"scripts":{"hooks":true}} -->\n'));
for (const n of ['B', 'C', 'D']) fs.writeFileSync(path.join(w.ws, 'sheets', `${n}.sheet.md`), book(n.charCodeAt(0)));
// a value as a JavaScript literal inside injected step code (JSON plus the characters that could end a script)
const lit = (v) => JSON.stringify(v).replace(/[<>/\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const S = "document.querySelector('.surface-sheet:not([hidden])')?.__surface";
const click = (f) => `document.querySelector(${lit(`[data-file="${f}"]`)}).click()`;
const show = (f, wait = 1500) => ({ js: `(async()=>{const t=performance.now(); ${click(f)}; await new Promise(r=>setTimeout(r,${wait})); return JSON.stringify({ms:Math.round(performance.now()-t)})})()`, wait: 100 });
const state = (label) => ({ js: `(()=>{const s=${S}; return JSON.stringify({label:${lit(label)}, unit:s.unitId(), a2:s.read('S!A2')[0][0], b2:s.read('S!B2')[0][0], d1:s.read('S!D1')[0][0], sel:s.selectionRef(), charts:document.querySelectorAll('.surface-sheet:not([hidden]) .xs-chart, .surface-sheet:not([hidden]) [data-chart]').length, ops:s.oplog.ops().length})})()`, log: true, wait: 100 });
const r = await runApp(w, [{ size: [1300, 900], wait: 1200 },
  show('sheets/A.sheet.md', 2500), state('A first'),
  { js: `${S}.ws().getRange('A2').setValue(5); ${S}.ws().getRange('C3').activate(); 1`, wait: 1200 },
  state('A edited'),
  show('sheets/B.sheet.md'), state('B'),
  show('sheets/A.sheet.md', 900), state('A back'),
  { js: `${S}.exec('univer.command.undo'); 1`, wait: 1500 }, state('A undo'),
  // C and D are shown: past two hidden workbooks, the least recently shown (B) is let go
  show('sheets/C.sheet.md'), state('C'), show('sheets/D.sheet.md'), state('D'), { js: `window.__dUnit=${S}.unitId();1`, wait: 50 },
  show('sheets/B.sheet.md'), state('B again'),
  // A's file changes on disk while A is hidden (another editor, a sync client): A is loaded again when shown
  { diskWrite: { path: path.join(w.ws, 'sheets', 'A.sheet.md'), text: book(42) }, wait: 2500 },
  show('sheets/A.sheet.md', 2500), state('A after disk change'),
  // closing a hidden workbook's tab lets it go (D and B are the two kept now)
  { js: `(async()=>{ const api=${S}.univerApi(); const before=!!api.getWorkbook(window.__dUnit); const t=[...document.querySelectorAll('[data-close]')].find(b=>b.dataset.close==='sheets/D.sheet.md'); t?.click(); await new Promise(r=>setTimeout(r,1200)); return JSON.stringify({label:'closed', before, after:!!api.getWorkbook(window.__dUnit), button:!!t}) })()`, log: true, wait: 200 },
  errors,
]);
const all = r.js.slice(0, -1).map((x) => JSON.parse(x)); const errs = r.js.at(-1);

let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('workbooks of hidden tabs');
const [a1, aEd, b, aBack, aUndo, , , bAgain, aDisk, closedD] = all;
assert.equal(aEd.a2, 5); assert.equal(aEd.b2, 10); assert.equal(a1.d1, 1, 'onOpen ran once');
assert.equal(aBack.unit, aEd.unit, 'the same unit is shown again'); assert.notEqual(b.unit, aEd.unit);
assert.equal(aBack.a2, 5); assert.equal(aBack.b2, 10); assert.equal(aBack.sel, aEd.sel); assert.equal(aBack.d1, 1, 'onOpen did not run again');
ok('switching back shows the same workbook: values, formulas, selection; onOpen does not run again');
assert.equal(aUndo.a2, 1); assert.equal(aUndo.b2, 2); ok("undo still knows the workbook's history after switching");
assert.ok(aBack.charts >= 1 && a1.charts >= 1, JSON.stringify([a1.charts, aBack.charts])); ok('its chart is drawn again');
assert.equal(aBack.ops, aEd.ops, 'its operation log came back with it'); ok('its operation log is its own');
assert.notEqual(bAgain.unit, b.unit, 'B was let go'); assert.equal(bAgain.a2, 66);
ok('past two hidden workbooks the least recently shown is let go, and loads again when shown');
assert.equal(aDisk.a2, 42); assert.equal(aDisk.b2, 84); assert.notEqual(aDisk.unit, aBack.unit);
ok('a workbook whose file changed while hidden is loaded again, with the new content');
assert.deepEqual([closedD.button, closedD.before, closedD.after], [true, true, false], JSON.stringify(closedD)); ok("closing a hidden workbook's tab lets its workbook go");
assert.deepEqual(errs, []);
console.log(`\n${n} checks passed`);
