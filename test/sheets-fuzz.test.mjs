// Folio Sheets — random edit sequences (values, styles, merges, rows and columns, notes, renames, new sheets) on a
// headless Univer: after each, save → reopen → save must give the same text, opening must not rewrite it, and the values
// must survive. Seeded, opt-in:  FOLIO_FUZZ=1 node test/sheets-fuzz.test.mjs [seed] [runs]
if (process.env.FOLIO_FUZZ !== '1') { console.log('\nsheets fuzz skipped (set FOLIO_FUZZ=1)'); process.exit(0); }
import { createHeadless } from '../src/sheets/engine/headless.js';
import { toUniver, fromUniver } from '../src/sheets/core/convert.js';
import { replayOps } from '../src/sheets/core/replay.js';
let seed = Number(process.argv[2] || 1); const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rnd() * a.length)]; const ri = (n) => Math.floor(rnd() * n);
const col = (c) => String.fromCharCode(65 + c); const cell = () => col(ri(6)) + (1 + ri(12));
const range = () => { const a = ri(5), b = a + ri(2), r = 1 + ri(10), r2 = r + ri(3); return `${col(a)}${r}:${col(b)}${r2}`; };
const VALS = [1, -2.5, 0, 1e6, 'text', '  spaced ', '42', 'TRUE', '=1+1', "'=A1", 'a|b', 'é ✓ 日本', '<br>', true, false, null, '=SUM(A1:A3)', '=A1&"x"', '#N/A'];
const base = '## One\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | =A2+B2 |\n| x | y | =A3&B3 |\n\n## Two\n\n| K | V |\n| --- | --: |\n| a | 10 |\n';
const H = await createHeadless(); const fails = []; let runs = 0;
for (let run = 0; run < Number(process.argv[3] || 150); run++) {
  runs++;
  const loaded = toUniver(base); const w = await H.open(loaded.data); const sheets = () => w.sheetNames();
  const ops = [];
  for (let k = 0; k < 4 + ri(12); k++) {
    const sheet = pick(sheets()); const kind = pick(['values', 'values', 'values', 'style', 'style', 'merge', 'unmerge', 'insertRows', 'deleteRows', 'insertCols', 'deleteCols', 'colWidth', 'rowHeight', 'freeze', 'note', 'clear', 'renameSheet', 'insertSheet']);
    let o;
    if (kind === 'values') { const v = pick(VALS); o = { op: 'values', sheet, range: cell(), values: [[v]] }; }
    else if (kind === 'style') { const key = pick(['bold', 'italic', 'underline', 'strike', 'color', 'fill', 'numfmt', 'align', 'valign', 'wrap', 'size', 'font']); o = { op: 'style', sheet, range: range(), key, value: { color: '#aa0000', fill: '#eeeeee', numfmt: pick(['0.00', '#,##0', 'd mmm yyyy', '0%']), align: pick(['left', 'center', 'right']), valign: pick(['top', 'middle', 'bottom']), size: 9 + ri(10), font: pick(['Georgia', 'Arial']) }[key] ?? true }; }
    else if (kind === 'merge' || kind === 'unmerge' || kind === 'clear') o = { op: kind, sheet, range: range() };
    else if (/Rows|Cols/.test(kind)) o = { op: kind, sheet, at: 1 + ri(6), count: 1 + ri(2) };
    else if (kind === 'colWidth' || kind === 'rowHeight') o = { op: kind, sheet, at: 1 + ri(6), size: 30 + ri(200) };
    else if (kind === 'freeze') o = { op: 'freeze', sheet, rows: ri(3), cols: ri(2) };
    else if (kind === 'note') o = { op: 'note', sheet, range: cell(), value: pick(['note', 'two\nlines', 'a | b']) };
    else if (kind === 'renameSheet') o = { op: 'renameSheet', sheet, name: pick(['Three', 'My sheet', 'Q1 2026', 'Dati']) + ri(9) };
    else o = { op: 'insertSheet', sheet: 'New' + ri(99) };
    ops.push(o);
  }
  const errs = []; replayOps(w.fwb, ops, { onError: (o, e) => errs.push(`${o.op}: ${e.message}`) }); await w.settle();
  let t1, t2, t3, v1, v2;
  try {
    t1 = fromUniver(w.save(), loaded);
    v1 = Object.fromEntries(w.sheetNames().map((n) => [n, JSON.stringify(w.values(n, 'A1:H16'))]));
    const l2 = toUniver(t1); const w2 = await H.open(l2.data); await w2.settle();
    t2 = fromUniver(w2.save(), l2);
    v2 = Object.fromEntries(w2.sheetNames().map((n) => [n, JSON.stringify(w2.values(n, 'A1:H16'))]));
    const l3 = toUniver(t2); t3 = fromUniver(l3.data, l3); // reopened and saved without edits
    H.close(w2);
  } catch (e) { fails.push({ run, ops, error: e.stack.split('\n').slice(0, 3).join(' ') }); H.close(w); continue; }
  H.close(w);
  if (t1 !== t2) fails.push({ run, ops, kind: 'save after reopen differs', diff: firstDiff(t1, t2) });
  else if (t2 !== t3) fails.push({ run, ops, kind: 'opening rewrites the file', diff: firstDiff(t2, t3) });
  else if (JSON.stringify(v1) !== JSON.stringify(v2)) fails.push({ run, ops, kind: 'values changed', diff: Object.keys(v1).filter((n) => v1[n] !== v2[n]).map((n) => [n, v1[n]?.slice(0, 300), v2[n]?.slice(0, 300)]) });
}
function firstDiff(a, b) { let i = 0; while (i < a.length && a[i] === b[i]) i++; return [a.slice(Math.max(0, i - 120), i + 120), b.slice(Math.max(0, i - 120), i + 120)]; }
H.dispose();
console.log(JSON.stringify({ runs, fails: fails.length, kinds: [...new Set(fails.map((f) => f.kind || 'error'))], first: fails.slice(0, 3) }, null, 1));
if (fails.length) process.exit(1);
