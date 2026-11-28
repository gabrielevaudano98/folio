// Folio Sheets — the first screen computed first (src/sheets/core/preview.js) must show exactly what the whole
// workbook computes. Random workbooks with pure and impure formulas, chains, cross-sheet references, shared formulas;
// every value the preview gives is compared with a full computation. FOLIO_PREVIEW_RUNS=50 for a long run.
import assert from 'node:assert/strict';
import { createHeadless } from '../src/sheets/engine/headless.js';
import { previewBook, pureFormula } from '../src/sheets/core/preview.js';
import { toUniver } from '../src/sheets/core/convert.js';

assert.ok(pureFormula('=D2*E2') && pureFormula('=IF(F2>100,"big","")') && pureFormula("=SUM('My data'!A1:A9)") && pureFormula('=A1=TRUE'));
for (const f of ['=RAND()', '=NOW()+A1', '=OFFSET(A1,1,1)', '=INDIRECT("A1")', '=rate*A1', '=FILTER(A1:A9,A1:A9>1)', '=MYFUNC(A1)', '=SUBTOTAL(9,A1:A9)', '={1,2}', '=Table1[Col]', '=ROW()'])
  assert.ok(!pureFormula(f), `${f} is not taken`);

const RUNS = Number(process.env.FOLIO_PREVIEW_RUNS || 6);
let s = 11; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); const pick = (n) => Math.floor(rnd() * n);
const H = await createHeadless();
let checked = 0, skipped = 0;
for (let run = 0; run < RUNS; run++) {
  const rows = 150 + pick(150);
  const lines = ['## Data', '', '| A | B | C | D | E | F |', '| --- | --- | --- | --- | --- | --- |'];
  const forms = [
    (i) => `=A${i}*B${i}`, (i) => `=IF(A${i}>50,"big","small")`, (i) => (i > 2 ? `=C${i - 1}+A${i}` : `=A${i}`), (i) => `=SUM(A${Math.max(2, i - 5)}:A${i})`,
    (i) => `=VLOOKUP(${i % 7},Lookup!A2:B8,2,FALSE)`, (i) => `=RAND()*0+A${i}`, (i) => `=OFFSET(A${i},0,1)`, (i) => `=SUM(A:A)`, (i) => `=ROUND(B${i}/3,2)&"x"`,
    (i) => `=COUNTIF(A2:A${rows},">"&A${i})`, (i) => `=E${i + 1}`, (i) => `=IFERROR(1/(A${i}-50),"div")`, (i) => `=TEXT(A${i},"0.0")`, (i) => `=MAX(Lookup!B2:B8)+D${i}`,
  ];
  const pickF = [pick(forms.length), pick(forms.length), pick(forms.length), pick(forms.length)];
  for (let i = 2; i <= rows + 1; i++) lines.push(`| ${pick(100)} | ${pick(20) / 2} | ${forms[pickF[0]](i)} | ${forms[pickF[1]](i)} | ${forms[pickF[2]](i)} | ${forms[pickF[3]](i)} |`);
  lines.push('', '## Lookup', '', '| K | V |', '| --- | --- |');
  for (let k = 0; k < 7; k++) lines.push(`| ${k} | ${pick(1000)} |`);
  const text = lines.join('\n') + '\n';
  const data = toUniver(text, { share: true }).data;
  const full = await H.open(toUniver(text, { share: true }).data); const fullSnap = full.save(); H.close(full);
  const p = previewBook(data, { sheetId: 'sheet-1', rows: 60 });
  if (!p) { skipped++; continue; }
  const w = await H.open(p.book); const snap = w.save(); H.close(w);
  for (const [sid, keys] of Object.entries(p.targets)) for (const k of keys) {
    const [r, c] = k.split(',').map(Number);
    const a = snap.sheets[sid].cellData[r][c], b = fullSnap.sheets[sid].cellData[r][c];
    assert.deepEqual([a?.v, a?.t], [b?.v, b?.t], `run ${run}, ${sid} ${k} (${b?.f || data.sheets[sid].cellData[r][c].si}): preview ${a?.v}, full ${b?.v}`);
    checked++;
  }
}
H.dispose();
console.log(`  ✓ first screen computed first: ${checked} values identical to the full computation over ${RUNS} random workbooks (${skipped} with nothing to preview)`);
