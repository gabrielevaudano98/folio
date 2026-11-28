// Calculation benchmark for the headless Univer engine: node scripts/sheets-bench.mjs [rows ...]
// Measures open (first full calculation) and one-cell edits that recalculate everything that depends on it.
import { createHeadless } from '../src/sheets/engine/headless.js';
import { AstTreeBuilder } from '@univerjs/engine-formula';
const sizes = process.argv.slice(2).map(Number).filter(Boolean);
if (!sizes.length) sizes.push(2000, 10000, 25000);
export function makeBook(rows, { shared = true } = {}) {
  const cellData = { 0: { 0: { v: 'qty' }, 1: { v: 'price' }, 2: { v: 'total' }, 3: { v: 'run' } } };
  const f = {};
  for (let r = 1; r <= rows; r++) {
    cellData[r] = { 0: { v: r % 97 }, 1: { v: (r % 13) + 0.5 } };
    const si = shared ? { si: 'a' } : {};
    cellData[r][2] = shared ? (r === 1 ? { f: `=A${r + 1}*B${r + 1}`, si: 'a' } : { si: 'a' }) : { f: `=A${r + 1}*B${r + 1}` };
    cellData[r][3] = { f: `=IF(C${r + 1}>100,C${r + 1},0)+${r}` };
  }
  cellData[1][4] = { f: `=SUM(C2:C${rows + 1})` };
  cellData[2][4] = { f: `=SUM(D2:D${rows + 1})` };
  return { id: 'bench', name: 'bench', appVersion: '1', locale: 'enUS', styles: {}, sheetOrder: ['s1'],
    sheets: { s1: { id: 's1', name: 'Sheet1', rowCount: rows + 10, columnCount: 8, cellData } } };
}
const h = await createHeadless();
const cap = Number(process.env.AST_CAP || 0);
if (cap) { const c = h.univer.__getInjector().get(AstTreeBuilder).cacheService; c._asts.limit = cap; c._lexerTrees.limit = cap; }
for (const rows of sizes) {
  const t0 = performance.now();
  const wb = await h.open(makeBook(rows, { shared: !!process.env.SHARED }));
  const open = performance.now() - t0;
  const edits = [];
  for (let i = 0; i < 4; i++) {
    const t = performance.now();
    await wb.setAndSettle('Sheet1', 'A3', 5 + i);
    edits.push(Math.round(performance.now() - t));
  }
  console.log(`${rows} rows (${rows * 2} formulas): open ${Math.round(open)} ms, edits ${edits.join('/')} ms, sum=${wb.values('Sheet1', 'E2:E3').flat()}, rss ${Math.round(process.memoryUsage().rss / 1e6)} MB, heap ${(globalThis.gc?.(), Math.round(process.memoryUsage().heapUsed / 1e6))} MB`);
  h.close(wb);
}
h.dispose();
