// Calculation benchmark on the headless Univer engine, with the workbook of test/sheets-stress.test.mjs converted the
// way the app converts it (shared formulas). node scripts/sheets-bench.mjs [rows ...]   (AST_CAP=5000: Univer's stock cache)
import { createHeadless } from '../src/sheets/engine/headless.js';
import { toUniver } from '../src/sheets/core/convert.js';
import { AstTreeBuilder } from '@univerjs/engine-formula';

export function stressText(rows) {
  const big = ['## Data', '', '| Date | Region | Product | Qty | Price | Total | Flag |', '| --- | --- | --- | --: | --: | --: | --- |'];
  for (let i = 2; i <= rows + 1; i++) big.push(`| ${46000 + (i % 365)} | ${['EU', 'US', 'APAC'][i % 3]} | P${i % 97} | ${i % 13} | ${(i % 50) / 2} | =D${i}*E${i} | =IF(F${i}>100,"big","") |`);
  big.push('', '## Summary', '', '| What | Value |', '| --- | --: |', `| Total | =SUM(Data!F2:F${rows + 1}) |`, `| Big rows | =COUNTIF(Data!G2:G${rows + 1},"big") |`, `| EU qty | =SUMIFS(Data!D2:D${rows + 1},Data!B2:B${rows + 1},"EU") |`);
  return big.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = process.argv.slice(2).map(Number).filter(Boolean);
  if (!sizes.length) sizes.push(10000, 50000);
  const h = await createHeadless();
  const cap = Number(process.env.AST_CAP || 0);
  if (cap) { const c = h.univer.__getInjector().get(AstTreeBuilder).cacheService; c._asts.limit = cap; c._lexerTrees.limit = cap; }
  for (const rows of sizes) {
    const data = toUniver(stressText(rows), { share: true }).data;
    const t0 = performance.now();
    const wb = await h.open(data);
    const open = performance.now() - t0;
    const edits = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await wb.setAndSettle('Data', `D${3 + i * 997}`, 5 + i);
      edits.push(Math.round(performance.now() - t));
    }
    globalThis.gc?.();
    console.log(JSON.stringify(h.recalc?.stats));
    console.log(`${rows} rows (${rows * 2} formulas): open ${Math.round(open)} ms, edits ${edits.join('/')} ms, total=${wb.values('Summary', 'B2')}, rss ${Math.round(process.memoryUsage().rss / 1e6)} MB, heap ${Math.round(process.memoryUsage().heapUsed / 1e6)} MB`);
    h.close(wb);
  }
  h.dispose();
}
