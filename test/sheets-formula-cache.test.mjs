// Folio Sheets — the compiled-formula cache (src/sheets/core/formula-cache.js) and the incremental recalculation
// (src/sheets/core/formula-incremental.js) must change speed, never values.
// Two headless engines get the same workbook (more formulas than Univer's stock 5,000-entry cache) and the same seeded
// random edits: values, formulas, text, cleared cells, rows and columns inserted and removed, a renamed sheet, a sheet
// added, a defined name moved, volatile functions. One is stock Univer, one is Folio's. After every step both must hold
// identical values (volatile cells excepted: those must change at every recalculation in both).
// FOLIO_FUZZ_STEPS=200 FOLIO_FUZZ_SEED=n for a long run.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHeadless } from '../src/sheets/engine/headless.js';

const STEPS = Number(process.env.FOLIO_FUZZ_STEPS || 16), SEED = Number(process.env.FOLIO_FUZZ_SEED || 7);
let s = SEED >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (n) => Math.floor(rnd() * n);

const ROWS = 3000;
function book() {
  const data = { 0: { 0: { v: 'x' }, 1: { v: 'y' }, 2: { v: 'z' }, 3: { v: 'w' } } }, calc = { 0: { 0: { v: 'sum' } } };
  for (let r = 1; r <= ROWS; r++) {
    data[r] = { 0: { v: (r * 7) % 101 }, 1: { f: `=A${r + 1}*rate+Calc!$E$1` }, 2: { f: `=IF(B${r + 1}>50,"hi","lo")&A${r + 1}` } };
    if (r < 400) data[r][3] = r === 1 ? { f: '=A2+B2', si: 'w' } : { si: 'w' }; // a shared run (virtual dependency trees)
  }
  for (let r = 1; r <= ROWS / 2; r++) calc[r] = { 0: { f: `=SUM(Data!B${r + 1}:B${r + 6})` } };
  calc[0][4] = { v: 3 };
  calc[1] = { ...calc[1], 4: { f: '=SUM(A2:A20)' }, 5: { f: `=COUNTIF(Data!C2:C${ROWS + 1},"hi*")` }, 6: { f: '=SUMPRODUCT(Data!A2:A200,Data!D2:D200)' } };
  calc[2] = { ...calc[2], 4: { f: '=RAND()' }, 5: { f: '=E3*0+1' } };
  return { id: 'fz', name: 'fz', appVersion: '1', locale: 'enUS', styles: {}, sheetOrder: ['d', 'c'],
    resources: [{ name: 'SHEET_DEFINED_NAME_PLUGIN', data: JSON.stringify({ 'name-1': { id: 'name-1', name: 'rate', formulaOrRefString: 'Calc!$E$1', localSheetId: 'AllDefaultWorkbook' } }) }],
    sheets: { d: { id: 'd', name: 'Data', rowCount: ROWS + 40, columnCount: 10, cellData: data }, c: { id: 'c', name: 'Calc', rowCount: ROWS, columnCount: 10, cellData: calc } } };
}
// value edits dominate, as they do when people work; every other kind of change is there too
function plan() {
  const ops = [];
  const kinds = [
    () => ({ t: 'set', sheet: 0, a1: `A${2 + pick(ROWS - 20)}`, v: pick(500) }),
    () => ({ t: 'set', sheet: 0, a1: `A${2 + pick(ROWS - 20)}`, v: pick(9) }),
    () => ({ t: 'set', sheet: 1, a1: `E1`, v: 1 + pick(4) }),
    () => ({ t: 'set', sheet: 0, a1: `A${2 + pick(ROWS - 20)}`, v: pick(500) }),
    () => ({ t: 'set', sheet: 0, a1: `B${2 + pick(ROWS - 20)}`, v: `=A${2 + pick(50)}+${pick(9)}` }),
    () => ({ t: 'set', sheet: 0, a1: `A${2 + pick(ROWS - 20)}`, v: `=Calc!A${2 + pick(50)}` }),
    () => ({ t: 'set', sheet: 0, a1: `C${2 + pick(ROWS - 20)}`, v: 'txt' }),
    () => ({ t: 'set', sheet: 0, a1: `D${2 + pick(390)}`, v: pick(7) }),
    () => ({ t: 'clear', sheet: 0, a1: `A${2 + pick(ROWS - 20)}` }),
    () => ({ t: 'ins', at: 1 + pick(ROWS - 20), n: 1 + pick(3) }),
    () => ({ t: 'del', at: 1 + pick(ROWS - 20), n: 1 + pick(3) }),
    () => ({ t: 'inscol', at: 4 + pick(3) }),
    () => ({ t: 'name', ref: pick(2) ? 'Calc!$E$1' : 'Calc!$F$3' }),
  ];
  for (let i = 0; i < STEPS; i++) ops.push(kinds[rnd() < 0.5 ? pick(4) : pick(kinds.length)]());
  ops.splice(Math.floor(STEPS / 3), 0, { t: 'rename', to: 'Calc2' });
  ops.splice(Math.floor((2 * STEPS) / 3), 0, { t: 'sheet', name: 'Extra' });
  return ops;
}
async function apply(wb, op) {
  const name = (i) => wb.sheetNames()[i];
  if (op.t === 'set') wb.set(name(op.sheet), op.a1, op.v);
  else if (op.t === 'clear') wb.sheet(name(op.sheet)).getRange(op.a1).clearContent();
  else if (op.t === 'ins') wb.sheet('Data').insertRows(op.at, op.n);
  else if (op.t === 'del') wb.sheet('Data').deleteRows(op.at, op.n);
  else if (op.t === 'inscol') wb.sheet('Data').insertColumns(op.at, 1);
  else if (op.t === 'rename') wb.sheet(name(1)).setName(op.to);
  else if (op.t === 'sheet') { wb.addSheet(op.name); }
  else if (op.t === 'name') wb.fwb.getDefinedName('rate')?.setRef(op.ref.replace('Calc', name(1)));
  await wb.settle();
}
/** values with the volatile cell (Calc!E3, =RAND()) taken out; it is checked on its own */
function values(wb) {
  const v = wb.usedValues();
  const calc = v[wb.sheetNames()[1]];
  const rand = calc?.[2]?.[4];
  if (calc?.[2]) calc[2][4] = typeof rand === 'number' ? 'rand' : rand;
  return { v, rand };
}

const stock = await createHeadless({ tune: false, incremental: false }), folio = await createHeadless({ tune: process.env.FOLIO_FUZZ_TUNE !== '0', incremental: process.env.FOLIO_FUZZ_INCR !== '0' });
const a = await stock.open(book()), b = await folio.open(book());
assert.deepEqual(values(b).v, values(a).v, 'same values after opening');
let tA = 0, tB = 0, randKept = 0, valueSteps = 0, stockWrong = 0;
for (const [i, op] of plan().entries()) {
  const before = values(b).rand;
  let t = performance.now(); await apply(a, op); tA += performance.now() - t;
  t = performance.now(); await apply(b, op); tB += performance.now() - t;
  const va = values(a), vb = values(b);
  if (!isDeepStrictEqual(vb.v, va.v)) {
    // which cells, and what a fresh engine opening the same workbook computes for them (the truth)
    const fresh = await createHeadless({ tune: false, incremental: false }); const c = await fresh.open(a.save()); const vc = values(c).v;
    const cells = [];
    for (const sh of Object.keys(va.v)) (va.v[sh] || []).forEach((row, r) => (row || []).forEach((x, k) => { const y = vb.v[sh]?.[r]?.[k]; if (x !== y && cells.length < 6) cells.push({ sheet: sh, cell: `${String.fromCharCode(65 + k)}${r + 1}`, formula: a.formulas(sh, `${String.fromCharCode(65 + k)}${r + 1}`)[0][0], stock: x, folio: y, fresh: vc[sh]?.[r]?.[k] }); }));
    fresh.dispose();
    if (isDeepStrictEqual(vb.v, vc)) { stockWrong++; } else
    assert.fail(`step ${i} ${JSON.stringify(op)}: Folio's engine and stock Univer disagree:\n${cells.map((x) => JSON.stringify(x)).join('\n')}`);
  }
  if (op.t === 'set' || op.t === 'clear') { valueSteps++; if (vb.rand === before) randKept++; }
}
if (process.env.FOLIO_FUZZ_INCR !== '0') assert.ok(folio.recalc, 'incremental recalculation is on');
if (folio.recalc) assert.ok(folio.recalc.stats.fast >= Math.floor(STEPS / 4), `fast passes were used (${JSON.stringify(folio.recalc.stats)})`);
assert.equal(randKept, 0, `RAND() recomputes at every edit (${randKept} of ${valueSteps} edits left it unchanged)`);
if (stockWrong) console.log(`  · stock Univer was wrong at ${stockWrong} steps (stale parsed formulas); Folio agreed with a fresh open each time`);
console.log(`  ✓ formula cache + incremental recalculation: ${STEPS} random edits on ${ROWS * 2 + ROWS / 2 + 400} formulas give the values of stock Univer (stock ${Math.round(tA)} ms, Folio ${Math.round(tB)} ms; ${JSON.stringify(folio.recalc?.stats)})`);
stock.dispose(); folio.dispose();

// Cases a random walk rarely meets. Each compares Folio's engine with a fresh open of the same workbook.
{
  const H = await createHeadless();
  const small = (v) => ({ id: 'same-id', name: 's', appVersion: '1', locale: 'enUS', styles: {}, sheetOrder: ['s'],
    sheets: { s: { id: 's', name: 'S', rowCount: 40, columnCount: 6, cellData: { 1: { 0: { v }, 1: { f: '=A2*2' } }, 2: { 0: { v: 2 }, 1: { f: '=A3*2' } }, 3: { 1: { f: '=SUM(B2:B3)' } } } } } });
  const w = await H.open(small(1));
  await w.setAndSettle('S', 'A3', 5); await w.setAndSettle('S', 'A3', 6);              // fast passes
  assert.ok(H.recalc.stats.fast >= 1, 'value edits use the fast pass');
  // the same formula typed again in its cell: Univer drops the cell from its dependency index, then adds it back
  await w.setAndSettle('S', 'B2', '=A2*2'); await w.setAndSettle('S', 'A2', 50);
  assert.deepEqual(w.values('S', 'B2:B4').flat(), [100, 12, 112], 'a formula typed again still follows its inputs');
  // a workbook closed and opened again under the same id (a file reloaded from disk), same formulas, other values
  H.close(w);
  const { UniverInstanceType } = await import('@univerjs/core');
  H.univer.createUnit(UniverInstanceType.UNIVER_SHEET, small(100)); await H.settle();
  const again = H.api.getWorkbook('same-id').getSheetByName('S');
  assert.deepEqual(again.getRange('B2:B4').getRawValues().flat(), [200, 4, 204], 'a reopened workbook is computed from its own values');
  again.getRange('A3').setValue(7); await H.settle();
  assert.deepEqual(again.getRange('B2:B4').getRawValues().flat(), [200, 14, 214], 'and follows edits afterwards');
  H.dispose();
  console.log('  ✓ incremental recalculation: formula typed again, workbook reopened under the same id');
}
{
  // formula edits rebuild only the cells that changed (partial passes); a second workbook stays as it is
  const H = await createHeadless();
  const truth = async (wb) => { const F = await createHeadless({ tune: false, incremental: false }); const c = await F.open(wb.save()); const v = c.usedValues(); F.dispose(); return v; };
  const big = book(); big.id = 'big';
  const B = await H.open(big);
  const S = await H.open({ id: 'small', name: 's', appVersion: '1', locale: 'enUS', styles: {}, sheetOrder: ['s'], sheets: { s: { id: 's', name: 'S', rowCount: 20, columnCount: 4, cellData: { 1: { 0: { v: 1 }, 1: { f: '=A2*2' } } } } } });
  const steps = [
    ['big: a formula typed', () => B.set('Data', 'C10', '=A10*1000')],
    ['big: a cell in the middle of a shared run', () => B.set('Data', 'D50', '=A50-B50')],
    ['big: the head of a shared run', () => B.set('Data', 'D2', '=A2*3')],
    ['big: a formula removed', () => B.set('Data', 'B30', 7)],
    ['big: formulas filled down', () => B.set('Data', 'E2:E40', Array.from({ length: 39 }, (_, k) => [`=B${k + 2}+1`]))],
    ['small: a formula typed', () => S.set('S', 'C2', '=B2+Big')],
    ['small: a value', () => S.set('S', 'A2', 21)],
    ['big: a value after all that', () => B.set('Data', 'A10', 99)],
  ];
  for (const [what, act] of steps) {
    act(); await H.settle();
    const v = B.usedValues(), t = await truth(B);
    const mask = (x) => { const c = x.Calc?.[2]; if (c) c[4] = typeof c[4]; return x; };
    assert.deepEqual(mask(v), mask(t), `${what}: values differ from a fresh open`);
    assert.deepEqual(S.usedValues(), await truth(S), `${what}: the small workbook differs from a fresh open`);
  }
  assert.ok(H.recalc.stats.partial >= 4, `formula edits used partial passes (${JSON.stringify(H.recalc.stats)})`);
  H.dispose();
  console.log(`  ✓ incremental recalculation: formula edits, shared runs split, formulas removed and filled, two workbooks (${JSON.stringify(H.recalc.stats)})`);
}
