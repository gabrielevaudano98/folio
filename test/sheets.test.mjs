// Folio Sheets — sheet-md v2 and the Univer model. Run through test/run.mjs (bundled) or `node test/sheets.test.mjs`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toUniver, fromUniver, roundTrip } from '../src/sheets/core/convert.js';
import { readDoc, setFence, serializeDoc } from '../src/sheets/core/sheetmd.js';
import { toRange, fromRange } from '../src/sheets/core/a1.js';
import { toUniverStyle, fromUniverStyle } from '../src/sheets/core/style.js';
import { createHeadless } from '../src/sheets/engine/headless.js';

const here = path.resolve('test');
const fx = (f) => fs.readFileSync(path.join(here, 'fixture', f), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('sheets');

assert.deepEqual(toRange('B2:C4'), { startRow: 1, endRow: 3, startColumn: 1, endColumn: 2, rangeType: 0 });
assert.equal(fromRange(toRange('A:C')), 'A:C'); assert.equal(fromRange(toRange('3:5')), '3:5'); assert.equal(fromRange(toRange('$D$7')), 'D7'); ok('A1 ranges convert both ways, whole rows and columns included');
const st = { bold: true, italic: true, underline: true, color: '#AA0000', fill: 'rgb(242,242,242)', align: 'center', valign: 'middle', wrap: true, font: 'Inter', size: 12, numfmt: '0.0%', border: { top: 'thin #1f1f1f', bottom: 'double #000000' } };
assert.deepEqual(fromUniverStyle(toUniverStyle(st)), { ...st, color: '#aa0000', fill: '#f2f2f2' }); ok('cell styles convert both ways');

const files = ['Budget.sheet.md', 'sheets/Rich.sheet.md'];
for (const f of files) assert.equal(roundTrip(fx(f)), fx(f), f);
ok('opening a sheet-md file through the Univer model rewrites nothing (v1 and v2)');

// a real Univer, headless: load, compute, save, write back
const H = await createHeadless();
for (const f of files) {
  const loaded = toUniver(fx(f));
  const wb = await H.open(loaded.data);
  const out = fromUniver(wb.save(), loaded);
  assert.equal(out, fx(f), f); H.close(wb);
}
ok('a real Univer instance hands every file back byte-identical');

{
  const text = fx('sheets/Rich.sheet.md'), loaded = toUniver(text);
  const wb = await H.open(loaded.data);
  const v = wb.values('Orders', 'F2:F5');
  assert.deepEqual(v.map((r) => r[0]), [14, 14.399999999999999, 12.600000000000001, 41]); ok('formulas compute in the headless engine');
  wb.set('Orders', 'D2', 5);
  const out = fromUniver(wb.save(), loaded);
  assert(out.includes('| 2026-01-05 | EU     | Notebook | 4   |') === false && /\| 5 +\|/.test(out)); 
  assert(out.includes(text.slice(text.indexOf('## Regions'), text.indexOf('<!-- workbook')).trim())); ok('editing one sheet rewrites only that sheet');
  assert(out.includes('"validation":[{"range":"B2:B4","type":"list","formula1":"EU,US"}]') && out.includes('"charts":[{"type":"column","range":"C1:D4"}]') && out.includes('```fql Summary')); ok('rules, notes, charts and FQL blocks survive an edit');
  assert.equal(roundTrip(out), out); ok('a rewritten sheet is stable on the next read');
  H.close(wb);
}
{
  const loaded = toUniver(fx('sheets/Rich.sheet.md'));
  const wb = await H.open(loaded.data);
  wb.api.getActiveWorkbook().create?.call; wb.addSheet('Notes');
  wb.set('Notes', 'A1', 'line one\nline two');
  const out = fromUniver(wb.save(), loaded);
  assert(/## Notes\n\n\| line one<br>line two \|/.test(out)); assert.equal(roundTrip(out), out); ok('new sheets are added after the last one; line breaks are written as <br>');
  H.close(wb);
}
{
  const doc = readDoc(fx('sheets/Rich.sheet.md'));
  setFence(doc, 'script', 'Macros', 'function DOUBLE(x) { return x * 2; }');
  const t = serializeDoc(doc); assert(t.endsWith('```script Macros\nfunction DOUBLE(x) { return x * 2; }\n```\n'));
  setFence(doc, 'fql', 'Summary', null); assert(!serializeDoc(doc).includes('```fql')); ok('workbook blocks (fql, script…) are added, replaced and removed by name');
}
H.dispose();
console.log(`\n${n} sheet checks passed`);
