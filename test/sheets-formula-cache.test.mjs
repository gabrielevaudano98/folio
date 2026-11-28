// Folio Sheets — the compiled-formula cache (src/sheets/core/formula-cache.js) must change speed, never values.
// Two headless engines get the same workbook (more formulas than Univer's stock 5,000-entry cache) and the same
// seeded random edits: value and formula edits, row and column insertion and removal, a renamed sheet, a changed
// defined name. After every step both must hold identical values. FOLIO_FUZZ_STEPS=200 for a long run.
import assert from 'node:assert/strict';
import { createHeadless } from '../src/sheets/engine/headless.js';

const STEPS = Number(process.env.FOLIO_FUZZ_STEPS || 14), SEED = Number(process.env.FOLIO_FUZZ_SEED || 7);
let s = SEED >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (n) => Math.floor(rnd() * n);

const ROWS = 3000;
function book() {
  const data = { 0: { 0: { v: 'x' }, 1: { v: 'y' }, 2: { v: 'z' } } }, calc = { 0: { 0: { v: 'sum' } } };
  for (let r = 1; r <= ROWS; r++) data[r] = { 0: { v: (r * 7) % 101 }, 1: { f: `=A${r + 1}*rate+Calc!$E$1` }, 2: { f: `=IF(B${r + 1}>50,"hi","lo")&A${r + 1}` } };
  for (let r = 1; r <= ROWS / 2; r++) calc[r] = { 0: { f: `=SUM(Data!B${r + 1}:B${r + 6})` } };
  calc[0][4] = { v: 3 }; calc[1] = { ...calc[1], 4: { f: '=SUM(A2:A20)' } };
  return { id: 'fz', name: 'fz', appVersion: '1', locale: 'enUS', styles: {}, sheetOrder: ['d', 'c'],
    resources: [{ name: 'SHEET_DEFINED_NAME_PLUGIN', data: JSON.stringify({ 'name-1': { id: 'name-1', name: 'rate', formulaOrRefString: 'Calc!$E$1', localSheetId: 'AllDefaultWorkbook' } }) }],
    sheets: { d: { id: 'd', name: 'Data', rowCount: ROWS + 40, columnCount: 8, cellData: data }, c: { id: 'c', name: 'Calc', rowCount: ROWS, columnCount: 8, cellData: calc } } };
}
function plan() {
  const ops = [];
  for (let i = 0; i < STEPS; i++) {
    const k = pick(8), r = 2 + pick(ROWS - 20);
    ops.push([() => ({ t: 'val', a1: `A${r}`, v: pick(500) }), () => ({ t: 'f', a1: `B${r}`, v: `=A${r}+${pick(9)}` }), () => ({ t: 'ins', at: r, n: 1 + pick(3) }),
      () => ({ t: 'del', at: r, n: 1 + pick(3) }), () => ({ t: 'text', a1: `C${r}`, v: 'txt' }), () => ({ t: 'rate', v: 1 + pick(4) }),
      () => ({ t: 'val', a1: `A${r}`, v: pick(9) }), () => ({ t: 'f', a1: `A${r}`, v: `=Calc!A${1 + pick(50)}` })][k]());
  }
  ops.splice(Math.floor(STEPS / 2), 0, { t: 'rename', to: 'Calc2' });
  return ops;
}
async function apply(wb, op) {
  const sh = () => wb.sheet('Data');
  if (op.t === 'val' || op.t === 'text') wb.set('Data', op.a1, op.v);
  else if (op.t === 'f') wb.set('Data', op.a1, op.v);
  else if (op.t === 'ins') sh().insertRows(op.at, op.n);
  else if (op.t === 'del') sh().deleteRows(op.at, op.n);
  else if (op.t === 'rate') wb.set(wb.sheetNames()[1], 'E1', op.v);
  else if (op.t === 'rename') wb.sheet(wb.sheetNames()[1]).setName(op.to);
  await wb.settle();
}
const stock = await createHeadless({ tune: false }), tuned = await createHeadless();
const a = await stock.open(book()), b = await tuned.open(book());
assert.deepEqual(a.usedValues(), b.usedValues(), 'same values after opening');
let tA = 0, tB = 0;
for (const [i, op] of plan().entries()) {
  let t = performance.now(); await apply(a, op); tA += performance.now() - t;
  t = performance.now(); await apply(b, op); tB += performance.now() - t;
  assert.deepEqual(b.usedValues(), a.usedValues(), `step ${i} ${JSON.stringify(op)}: tuned cache and stock cache disagree`);
}
console.log(`  ✓ formula cache: ${STEPS} random edits on ${ROWS * 2 + ROWS / 2} formulas give identical values (stock ${Math.round(tA)} ms, tuned ${Math.round(tB)} ms)`);
stock.dispose(); tuned.dispose();
