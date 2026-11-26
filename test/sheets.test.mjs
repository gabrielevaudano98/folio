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
{
  // fuzz: any value a cell can hold (text that looks like a number, TRUE or a formula, pipes, backslashes, blanks at the
  // edges, a literal <br>, entities, unicode) survives save → reload with its type, through a real Univer instance
  let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const alphabet = ['a', 'Z', '0', '7', '.', '-', '+', 'e', '=', "'", '|', '\\', ' ', '\t', '\n', '<br>', '&', '#32;', 'lt;', 'amp;', '&#169;', ':', '-', '`', '*', '#', '<!--', '漢', '🎉', 'TRUE', 'FALSE', '\u00a0'];
  const fixed = ['42', '007', 'TRUE', 'FALSE', '=abc', '=', "'", "'42", "''x", "'hello", 'a|b', 'C:\\', ' lead', 'trail ', ' ', '  ', 'x<br>y', 'R&amp;D', '&#32;', '1e5', '-0', '3.0', '---', '| x |', 'two\nlines'];
  const norm = (x) => (x ? (x.f ? 'f:' + x.f : `${x.t}:${x.t === 3 ? !!x.v : x.v}`) : 'empty');
  const fails = [];
  for (let iter = 0; iter < 60; iter++) {
    const loaded = toUniver('## S\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    const cd = loaded.data.sheets['sheet-1'].cellData; const want = {};
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      const k = rnd(); let cell;
      if (k < 0.35) cell = { v: pick(fixed), t: 1 };
      else if (k < 0.65) cell = { v: Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => pick(alphabet)).join(''), t: 1 };
      else if (k < 0.85) cell = { v: pick([0, 1, -1, 0.1, 1.5, 1e21, 1e-7, 123456789.123, 0.30000000000000004]), t: 2 };
      else cell = { v: rnd() < 0.5 ? 1 : 0, t: 3 };
      (cd[r] ||= {})[c] = cell; want[`${r},${c}`] = cell;
    }
    const wb = await H.open(loaded.data);
    const text = fromUniver(wb.save(), loaded); H.close(wb);
    const back = toUniver(text).data.sheets['sheet-1'].cellData;
    for (const [k, cell] of Object.entries(want)) {
      const [r, c] = k.split(',').map(Number);
      const exp = cell.t === 1 && cell.v === '' ? 'empty' : norm({ ...cell, v: cell.t === 1 ? String(cell.v).replace(/\r\n?/g, '\n') : cell.v });
      const got = norm(back[r]?.[c]);
      if (exp !== got) fails.push(`${JSON.stringify(exp)} → ${JSON.stringify(got)}`);
    }
    assert.equal(roundTrip(text), text, 'a saved file is stable on the next read');
  }
  assert.deepEqual([...new Set(fails)], []); ok('fuzz: 1,200 cells of hostile text, numbers and booleans keep value and type through save and reload');
}
H.dispose();
console.log(`\n${n} sheet checks passed`);
