// Folio Sheets — the data engine's modules in Node: files in and out, the script sandbox, encryption and signatures,
// what-if analysis, pivots, version comparison, formula references. Bundled by test/run.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { Window } from 'happy-dom';
import { importFile, exportXlsx, exportCsv } from '../src/sheets/engine/io.js';
import { readDoc as readDocCf, sheetsOf as sheetsOfCf } from '../src/sheets/core/sheetmd.js';
import { runScript, callFunction, describe, scriptWorkbook } from '../src/sheets/engine/script.js';
import * as crypto from '../src/sheets/engine/crypto.js';
import * as whatif from '../src/sheets/engine/whatif.js';
import { createHeadless } from '../src/sheets/engine/headless.js';
import { toUniver, fromUniver, roundTrip } from '../src/sheets/core/convert.js';
import { compareWorkbooks } from '../src/sheets/core/diff.js';
import { refsOf, findCycles, substitute } from '../src/sheets/core/refs.js';
import { createOpLog, createLocalTransport, bindSync, overlaps, compareOps, applyWith } from '../src/sheets/core/collab.js';
import { ICommandService } from '@univerjs/core';
import { series } from '../src/sheets/ui/panels/series.js';
import { splitText } from '../src/sheets/ui/panels/text-to-cols.js';

const w = new Window(); globalThis.window = w; globalThis.document = w.document;
globalThis.__folioQuickJsWasm = path.resolve('node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm');
const { parsePivot, serializePivot, computePivot } = await import('../src/sheets/core/pivot.js');

const fx = (f) => fs.readFileSync(path.join('test', 'fixture', f), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('sheets engine');
const rich = fx('sheets/Rich.sheet.md');

/* ---------- files ---------- */
{
  const bytes = await exportXlsx(rich);
  const wb = XLSX.read(Buffer.from(bytes), { type: 'buffer', cellFormula: true, sheetStubs: true, cellNF: true });
  assert.deepEqual(wb.SheetNames, ['Orders', 'Regions']);
  assert.equal(wb.Sheets.Orders.F5.f, 'SUM(F2:F4)'); assert.equal(wb.Sheets.Orders.E2.z, '"€"#,##0.00'); assert.deepEqual(wb.Sheets.Orders['!merges'], [{ s: { c: 0, r: 4 }, e: { c: 2, r: 4 } }]);
  ok('export to .xlsx keeps formulas, number formats from column styles and merges');
  const back = await importFile(bytes, 'Rich.xlsx');
  assert(back.text.includes('| Total      |        |          |     |       | =SUM(F2:F4) |'));
  assert(back.text.includes('"cols":{"E":{"format":"currency"},"F":{"width":140,"format":"currency","bold":true}}'));
  assert(back.text.includes('"validation":[{"range":"B2:B4","type":"list","formula1":"EU,US"}]') && back.text.includes('"notes":{"F5":"Grand total"}') && back.text.includes('"names":{"Grand":"=Orders!$F$5"}'));
  assert.equal(roundTrip(back.text), back.text); assert.equal(back.keepSource, true); assert.equal(back.vba, false);
  ok('import of .xlsx: formulas, column styles, validation, notes, names; the result is stable sheet-md');
  const csv = await importFile(Buffer.from('﻿Name,Qty\nPen,"1,5"\nBook,3\n'), 'list.csv');
  assert(csv.text.includes('## list') && csv.text.includes('| Pen  | 1,5 |') && csv.text.includes('| Book | 3   |'));
  assert.equal(exportCsv([['a', 'b'], [1, 'x, y']]), 'a,b\n1,"x, y"'); ok('CSV in and out');
  // the original package: export writes into it, so parts Folio does not model survive byte for byte
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes); zip.file('xl/vbaProject.bin', Buffer.from('VBA-PROJECT-BYTES')); zip.file('customXml/item9.xml', '<x>keep me</x>');
  const ct = await zip.file('[Content_Types].xml').async('string'); zip.file('[Content_Types].xml', ct.replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'));
  const xlsm = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
  const imported = await importFile(xlsm, 'Macro.xlsm'); assert.equal(imported.vba, true);
  const edited = imported.text.replace('| 2026-01-09 | US     | Pen      | 12  |', '| 2026-01-09 | US     | Pen      | 99  |');
  const out = await JSZip.loadAsync(await exportXlsx(edited, { source: xlsm }));
  assert.equal(await out.file('xl/vbaProject.bin').async('string'), 'VBA-PROJECT-BYTES'); assert.equal(await out.file('customXml/item9.xml').async('string'), '<x>keep me</x>');
  assert.equal(XLSX.read(await out.generateAsync({ type: 'nodebuffer' }), { type: 'buffer' }).Sheets.Orders.D3.v, 99);
  ok('.xlsm: the VBA project and other parts pass through an edit byte for byte');
}

/* ---------- scripts ---------- */
{
  const { data } = toUniver(rich);
  const wb = scriptWorkbook(data, { active: 'Orders', values: { Orders: { 4: { 5: 41 } } } });
  const code = `function addTotals() { const s = Workbook.active(); const last = s.lastRow(); s.range('H1').setValue(s.range('F5').getValue() * 2).setBold(); s.appendRow(['x', 1]); log('rows', last); return last; }\nfunction DOUBLE(x) { return x * 2; }\nfunction onEdit(e) {}`;
  const r = await runScript(code, 'addTotals', wb);
  assert.equal(r.result, 5); assert.deepEqual(r.logs, ['rows 5']);
  assert.deepEqual(r.ops, [{ op: 'values', sheet: 'Orders', range: 'H1:H1', values: [[82]] }, { op: 'style', sheet: 'Orders', range: 'H1', key: 'bold', value: true }, { op: 'values', sheet: 'Orders', range: 'A6:B6', values: [['x', 1]] }]);
  ok('a macro reads computed values and returns operations, chained like Apps Script');
  assert.deepEqual(describe(code), { macros: [{ name: 'addTotals', params: [] }], functions: [{ name: 'DOUBLE', params: ['x'] }], hooks: ['onEdit'] });
  assert.equal(await callFunction(code, 'DOUBLE', [21]), 42); ok('custom functions (UPPER_CASE) and hooks are recognised; =DOUBLE(21) is 42');
  await assert.rejects(runScript('function f(){ while(true){} }', 'f', wb), /more than 5 seconds/);
  await assert.rejects(runScript('function f(){ return typeof require + typeof process + typeof fetch; }', 'f', wb).then((x) => { if (x.result !== 'undefinedundefinedundefined') throw new Error('escaped'); throw new Error('sandboxed'); }), /sandboxed/);
  await assert.rejects(runScript('function f(){ const a = []; for(;;) a.push([a.length, a.length + 1, a.length + 2, a.length + 3]); }', 'f', wb), /memory|out of/i);
  await assert.rejects(runScript('function f(){ return x.y; }', 'f', wb), /'?x'? is not defined/);
  ok('the sandbox has no require, process or fetch, stops runaway loops and memory, reports errors');
}

/* ---------- crypto ---------- */
{
  const rec = crypto.hashPassword('s3cret');
  assert(crypto.checkPassword('s3cret', rec)); assert(!crypto.checkPassword('nope', rec)); ok('passwords: PBKDF2 hash and check');
  const box = crypto.encrypt([['Salary', 5000]], 'longpassword');
  assert.deepEqual(crypto.decrypt(box, 'longpassword'), [['Salary', 5000]]);
  assert.throws(() => crypto.decrypt(box, 'wrong-password'), /Wrong password/);
  assert.throws(() => crypto.decrypt({ ...box, data: box.data.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }, 'longpassword'), /Wrong password|changed/); ok('AES-256-GCM: round trip, wrong password and tampering detected');
  const keys = crypto.newKeyPair();
  const s = crypto.sign(rich, keys, { signer: 'Gabriele', date: '2026-11-26T10:00:00Z' });
  const signed = crypto.withSignature(rich, s);
  const v = crypto.verify(signed, crypto.readSignature(signed), { myPublicPem: keys.publicPem });
  assert(v.valid && v.mine && v.signer === 'Gabriele');
  assert.equal(crypto.verify(signed.replace('Notebook', 'Netbook'), crypto.readSignature(signed)).valid, false);
  assert.equal(crypto.verify(crypto.withSignature(signed, s), s).valid, true); ok('signatures: valid, any edit breaks them, re-signing replaces the line');
}

{
  // the larger API: formats, borders, merge, sort, find, rows and columns, widths, freeze, rename; the operations
  // replay on a real (headless) Univer workbook and the file shows each effect
  const { replayOps } = await import('../src/sheets/core/replay.js');
  const H2 = await createHeadless(); const loaded = toUniver(rich); const w = await H2.open(loaded.data);
  const code = `function tidy() {
    const s = Workbook.sheet('Orders');
    s.range('A1:F1').setFontSize(13).setFontFamily('Georgia').setUnderline().setBorder(null, null, true, null, null, null, '#000000', 'thick').setVerticalAlignment('middle').setWrap(true);
    s.range('A2:F4').sort({ column: 4, ascending: false });
    const hits = s.find('pen').map((r) => r.getA1Notation());
    s.insertRowsBefore(2, 1); s.range('A2').setValue('inserted');
    s.setColumnWidth(3, 160); s.setFrozenRows(1); s.range('A7:B7').merge();
    Workbook.sheet('Regions').setName('Areas');
    return { hits, after: s.range('C3:C5').getValues().map((r) => r[0]), d: s.range('D3').getValue() };
  }`;
  const r = await runScript(code, 'tidy', scriptWorkbook(w.save(), { active: 'Orders' }));
  assert.deepEqual(r.result.hits, ['C2']); assert.deepEqual(r.result.after, ['Pen', 'Folder', 'Notebook']); assert.equal(r.result.d, 12);
  const errs = []; replayOps(w.fwb, r.ops, { onError: (o, e) => errs.push(`${o.op}: ${e.message}`) }); await w.settle();
  assert.deepEqual(errs, []);
  const out = fromUniver(w.save(), loaded);
  assert.deepEqual(w.values('Orders', 'C3:D5').map((x) => x[0]), ['Pen', 'Folder', 'Notebook']);
  assert.equal(w.values('Orders', 'A2')[0][0], 'inserted');
  assert.deepEqual(w.sheetNames(), ['Orders', 'Areas']);
  assert(/"A1":\{[^}]*"size":13/.test(out) && /"font":"Georgia"/.test(out) && /"underline":true/.test(out) && /"wrap":true/.test(out) && /"valign":"middle"/.test(out), 'header style in the file');
  assert(/"C":\{[^}]*"width":160/.test(out) && /"freeze":\{"rows":1\}/.test(out) && /"merges":\[[^\]]*"A7:B7"/.test(out) && /## Areas/.test(out));
  assert(/=SUM\(F3:F5\)/.test(out), 'the total moved with the inserted row');
  // a sheet name Excel would refuse, or one another sheet has (any case), is refused: two `## Name` headings would
  // not open as two sheets (found by a random-edit test)
  const bad = []; replayOps(w.fwb, [{ op: 'renameSheet', sheet: 'Areas', name: 'orders' }, { op: 'insertSheet', sheet: 'A/B' }, { op: 'renameSheet', sheet: 'Areas', name: 'x'.repeat(32) }, { op: 'renameSheet', sheet: 'Areas', name: 'Areas' }],
    { onError: (o, e) => bad.push(e.message) });
  assert.equal(bad.length, 3, bad.join(' | ')); assert.match(bad[0], /already exists/); assert.deepEqual(w.sheetNames(), ['Orders', 'Areas']);
  H2.close(w); H2.dispose();
  ok('scripts: fonts, borders, merge, sort, find, rows, widths, freeze and rename replay as Univer commands; duplicate or invalid sheet names are refused');
}
/* ---------- what-if ---------- */
{
  const H = await createHeadless();
  const { data } = toUniver(rich);
  const g = await whatif.goalSeek(H, data, { set: 'Orders!F5', to: 50, by: 'Orders!D2', active: 'Orders' });
  assert(g.found && Math.abs(g.value - 46 / 7) < 1e-6); ok('goal seek finds Qty so that the total is 50');
  const t = await whatif.dataTable(H, data, { active: 'Orders', colInput: 'Orders!E2', colValues: [1, 2], outputs: ['Orders!F5'] });
  assert.deepEqual(t.grid.map((r) => r.map((x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x))), [['Orders!E2', 'Orders!F5'], [1, 31], [2, 35]]); ok('one-variable data table');
  const sc = await whatif.scenarios(H, data, { active: 'Orders', list: [{ name: 'High price', cells: { 'Orders!E2': 5 } }], results: ['Orders!F5'] });
  assert.equal(Math.round(sc.grid.at(-1)[2] * 100) / 100, 47); ok('scenario summary');
  const sim = await whatif.simulate(H, data, { active: 'Orders', inputs: { 'Orders!D2': ['uniform', 0, 10] }, outputs: ['Orders!F5'], iterations: 60, seed: 7 });
  const r = sim.results['Orders!F5'];
  assert(r.n === 60 && r.min >= 27 && r.max <= 62 && r.p5 <= r.p50 && r.p50 <= r.p95);
  const again = await whatif.simulate(H, data, { active: 'Orders', inputs: { 'Orders!D2': ['uniform', 0, 10] }, outputs: ['Orders!F5'], iterations: 60, seed: 7 });
  assert.equal(again.results['Orders!F5'].mean, r.mean); ok('Monte Carlo: bounded, ordered percentiles, repeatable with a seed');
  H.dispose();
}

/* ---------- pivot, diff, references, fill and split ---------- */
{
  const spec = parsePivot('source: Orders!A1:F4\nrows: Region\nvalues: sum(Total) as Revenue, count(Qty)\nfilter: Product not in Pen\nplace: Pivot!B2');
  assert.equal(parsePivot(serializePivot(spec)).place, 'Pivot!B2');
  const grid = [['Region', 'Product', 'Qty', 'Total'], ['EU', 'Notebook', 4, 14], ['US', 'Pen', 12, 14.4], ['EU', 'Folder', 6, 12.6]];
  assert.deepEqual(computePivot(grid, spec), [['Region', 'Revenue', 'Count of Qty'], ['EU', 26.6, 2], ['Grand total', 26.6, 2]]);
  assert.throws(() => computePivot(grid, parsePivot('rows: Nope')), /No column named Nope/); ok('pivot: readable spec, filters, several values, totals, clear errors');
  const changed = rich.replace('| 2026-01-09 | US     | Pen      | 12  |', '| 2026-01-09 | US     | Pen      | 15  |');
  assert.deepEqual(compareWorkbooks(rich, changed).map((c) => [c.kind, c.sheet, c.cell, c.before, c.after]), [['cell', 'Orders', 'D3', '12', '15']]);
  assert.deepEqual(compareWorkbooks(rich, rich.replace(/\| ([-:]+) \|/g, '|$1|')), []); ok('compare: one changed cell is one change; re-spacing the Markdown is none');
  assert.deepEqual(refsOf('=SUM(A1:B2)+Rates!C3+\'My sheet\'!$D$4+"A9"+LOG10(2)').map((r) => [r.sheet, r.range]), [[null, 'A1:B2'], ['Rates', 'C3'], ['My sheet', 'D4']]);
  assert.deepEqual(findCycles({ 'S!A1': '=B1+1', 'S!B1': '=C1', 'S!C1': '=A1', 'S!D1': '=A1' }), [['S!A1', 'S!B1', 'S!C1', 'S!A1']]);
  assert.equal(substitute('=A1*B1+S!C1', (s, a) => ({ A1: 2, B1: 'x', C1: null })[a]), '=2*"x"+0'); ok('formula references, circular references, evaluate step');
  assert.deepEqual(series(1, { step: 2, count: 4 }), [1, 3, 5, 7]); assert.deepEqual(series(2, { kind: 'growth', step: 3, stop: 60, count: 99 }), [2, 6, 18, 54]);
  assert.deepEqual(series(46022, { kind: 'month', count: 3 }), [46022, 46053, 46081]);
  assert.deepEqual(splitText(['a, 1', 'b,2,x', null], ','), [['a', 1], ['b', 2, 'x'], ['']]); ok('fill series (linear, growth, months) and text to columns');
}

{
  // shared formulas never leak into what Folio reads itself: export, scripts and version compare see every formula
  const { toUniver: tu, expandSharedFormulas: ex } = await import('../src/sheets/core/convert.js');
  const text = '## S\n\n| A | B |\n| --- | --- |\n| 1 | =A2*2 |\n| 2 | =A3*2 |\n| 3 | =A4*2 |\n';
  const xl = XLSX.read(Buffer.from(await exportXlsx(text)), { type: 'buffer', cellFormula: true, sheetStubs: true });
  assert.deepEqual(['B2', 'B3', 'B4'].map((a) => xl.Sheets.S[a]?.f), ['A2*2', 'A3*2', 'A4*2']);
  const snap = ex(tu(text, { share: true }).data);
  assert.deepEqual([1, 2, 3].map((r) => snap.sheets['sheet-1'].cellData[r][1].f), ['=A2*2', '=A3*2', '=A4*2']);
  ok('shared formulas are written out for export and scripts');
}
{
  // conditional formatting goes to .xlsx as Excel rules with their formats, and comes back as the same rules
  const S = (bg) => ({ bg: { rgb: bg } });
  const cf = [
    { range: 'B2:B9', rule: { type: 'highlightCell', subType: 'number', operator: 'greaterThan', value: 10, style: { bg: { rgb: '#e6e6e6' }, bl: 1 } } },
    { range: 'B2:B9', rule: { type: 'highlightCell', subType: 'number', operator: 'between', value: [2, 5], style: { cl: { rgb: '#aa0000' } } } },
    { range: 'A2:A9', rule: { type: 'highlightCell', subType: 'text', operator: 'containsText', value: 'pen', style: S('#ffeeee') } },
    { range: 'A2:A9', rule: { type: 'highlightCell', subType: 'text', operator: 'equal', value: 'Book', style: S('#eeffee') } },
    { range: 'A2:A9', rule: { type: 'highlightCell', subType: 'text', operator: 'beginsWith', value: 'P', style: S('#eeeeff') } },
    { range: 'A2:A9', rule: { type: 'highlightCell', subType: 'text', operator: 'containsBlanks', style: S('#dddddd') } },
    { range: 'C2:C9', rule: { type: 'highlightCell', subType: 'timePeriod', operator: 'last7Days', style: S('#ffffcc') } },
    { range: 'B2:B9', rule: { type: 'highlightCell', subType: 'average', operator: 'greaterThanOrEqual', style: S('#ccffcc') } },
    { range: 'B2:B9', rule: { type: 'highlightCell', subType: 'rank', isBottom: true, isPercent: false, value: 3, style: S('#ffcccc') } },
    { range: 'A2:A9', rule: { type: 'highlightCell', subType: 'duplicateValues', style: S('#f0f0f0') } },
    { range: 'B2:B9', rule: { type: 'highlightCell', subType: 'formula', value: '=MOD(B2,2)=0', style: { it: 1, st: { s: 1 } } } },
    { range: 'D2:D9', rule: { type: 'colorScale', config: [{ index: 0, color: '#f8696b', value: { type: 'min' } }, { index: 1, color: '#ffeb84', value: { type: 'percentile', value: 50 } }, { index: 2, color: '#63be7b', value: { type: 'max' } }] } },
    { range: 'D2:D9', rule: { type: 'dataBar', isShowValue: true, config: { min: { type: 'min' }, max: { type: 'max' }, isGradient: false, positiveColor: '#638ec6', nativeColor: '#ff0000' } } },
    { range: 'B2:B9', rule: { type: 'iconSet', isShowValue: true, config: [{ operator: 'greaterThanOrEqual', value: { type: 'percent', value: 67 }, iconType: '3Arrows', iconId: '0' }, { operator: 'greaterThanOrEqual', value: { type: 'percent', value: 33 }, iconType: '3Arrows', iconId: '1' }, { operator: 'lessThan', value: { type: 'percent', value: 33 }, iconType: '3Arrows', iconId: '2' }] } },
    { range: 'B2:B9', rule: { type: 'highlightCell', subType: 'average', operator: 'equal', style: S('#000000') } },
  ];
  const rows = ['| Item | Qty | Date | Score |', '| --- | --- | --- | --- |'];
  for (let i = 2; i <= 9; i++) rows.push(`| ${['Pen', 'Book', 'Pencil', 'Paper'][i % 4]} | ${i} | ${46000 + i} | ${i * 3} |`);
  const text = `## S\n\n${rows.join('\n')}\n\n<!-- sheet: ${JSON.stringify({ cf })} -->\n`;
  const bytes = await exportXlsx(text);
  const back = sheetsOfCf(readDocCf((await importFile(bytes, 'S.xlsx')).text))[0].meta.cf || [];
  const want = cf.filter((x) => !(x.rule.subType === 'average' && x.rule.operator === 'equal'));
  assert.deepEqual(back.map(({ range, rule }) => ({ range, rule })), want);
  ok(`conditional formatting: ${want.length} kinds of rule (values, text, dates, average, top/bottom, duplicates, formula, colour scale, data bar, icons) go to .xlsx and back`);
}
{
  // past ~120k rows an argument spread (Math.max(...rows)) overflows the stack: export and import go through loops
  const rows = ['| N | Twice |', '| --: | --: |']; for (let i = 2; i <= 130001; i++) rows.push(`| ${i} | =A${i}*2 |`);
  const bytes = await exportXlsx(`## Big\n\n${rows.join('\n')}\n\n<!-- sheet: {"cols":{"B":{"bold":true}}} -->\n`);
  const back = await importFile(bytes, 'Big.xlsx');
  assert(back.text.includes('| 130001 | =A130001*2 |'));
  ok('130,000 rows export to .xlsx and import back');
}
{
  // whole-workbook jobs for AI assistants (book.js): computed values, Refresh all (queries and pivots, written where
  // the window writes them, replacing the previous results), a macro replayed as commands, protection respected
  const book = await import('../src/sheets/engine/book.js');
  const H3 = await createHeadless();
  const v = await book.values(H3, rich, { sheet: 'Orders' });
  assert.equal(v[0].values[4][5], 41); assert.equal(v[0].display[1][4], '€3.50');
  let text = rich + '\n```pivot By region\nsource: Orders!A1:F4\nrows: Region\nvalues: sum(Total)\nplace: Pivot!A1\n```\n';
  const r1 = await book.refresh(H3, text);
  assert.deepEqual(r1.errors, []); assert(r1.loaded >= 2, `loaded ${r1.loaded}`);
  assert(/## Summary/.test(r1.text) && /## Pivot/.test(r1.text) && /"loads":\{[^}]*"pivot\/By region":"Pivot!A1:B4"/.test(r1.text), 'results and where they went');
  const r2 = await book.refresh(H3, r1.text); assert.equal(r2.text, r1.text, 'a second refresh of unchanged data writes the same file');
  text = r1.text + '\n```script Macros\nfunction stamp(){ const s = Workbook.sheet("Orders"); s.range("H1").setValue("checked").setBold(); s.range("A2").setValue("hack"); return s.lastRow(); }\n```\n';
  const m1 = await book.macro(H3, text, { entry: 'stamp' });
  assert.equal(m1.result, 5); assert(/\| checked/.test(m1.text) && /\| hack/.test(m1.text) && m1.refused.length === 0);
  const prot = text.replace('<!-- sheet: {"cols"', '<!-- sheet: {"protect":{"allow":["H1:H9"]},"cols"');
  assert(prot !== text);
  const m2 = await book.macro(H3, prot, { entry: 'stamp' });
  assert(/\| checked/.test(m2.text) && !/\| hack/.test(m2.text)); assert.deepEqual(m2.refused, ['values Orders!A2:A2']);
  H3.dispose();
  ok('workbook jobs: values as shown, Refresh all of queries and pivots (stable), macros that respect protection');
}
/* ---------- collaboration-ready: operations, order, conflicts, replay ---------- */
{
  const a = createOpLog({ actor: 'ann', now: () => 1 }), b = createOpLog({ actor: 'bob', now: () => 1 });
  const m = (r, c, v) => ({ id: 'sheet.mutation.set-range-values', params: { unitId: 'u', subUnitId: 's1', cellValue: { [r]: { [c]: { v } } } } });
  const x = a.record(m(0, 0, 1)), y = b.record(m(0, 0, 2)), z = b.record(m(3, 3, 3));
  assert.equal(a.record(m(1, 1, 1), { fromCollab: true }), null); ok('remote replays are not recorded again');
  assert(overlaps(x, y) && !overlaps(x, z)); assert(overlaps(x, { mutation: { id: 'sheet.mutation.insert-row', params: {} } })); ok('conflicts: same cell or structure');
  const order1 = a.receive([z, y]).map((o) => o.id), order2 = [x, y, z].sort(compareOps).filter((o) => o.actor === 'bob').map((o) => o.id);
  assert.deepEqual(order1, order2); assert.deepEqual(a.receive([y]), []); assert(a.clock >= 2); ok('replicas order operations the same way, skip duplicates, advance the Lamport clock');
  // two headless Univer replicas converge through the local transport
  const H = await createHeadless();
  const { data } = toUniver(rich);
  const w1 = await H.open({ ...data, id: 'r1' }), w2 = await H.open({ ...data, id: 'r2' });
  const cmd = H.univer.__getInjector().get(ICommandService);
  const l1 = createOpLog({ actor: 'one' }), l2 = createOpLog({ actor: 'two' });
  const t1 = createLocalTransport(), t2 = createLocalTransport();
  t1.send = async (ops) => t2.inject(ops.map((o) => ({ ...o, mutation: { ...o.mutation, params: { ...o.mutation.params, unitId: 'r2' } } })));
  bindSync(l2, t2, applyWith(cmd));
  bindSync(l1, t1, () => {});
  const off = cmd.onCommandExecuted((c, o) => { if (c.type === 2 && c.params?.unitId === 'r1' && c.id === 'sheet.mutation.set-range-values') l1.record(c, o); });
  w1.set('Orders', 'D2', 10); await w1.settle(); await w2.settle();
  assert.equal(w2.values('Orders', 'D2')[0][0], 10); assert.equal(w2.values('Orders', 'F5')[0][0], w1.values('Orders', 'F5')[0][0]);
  assert.equal(l2.ops().length, 1); assert.equal(l2.ops()[0].actor, 'one'); off.dispose(); H.dispose();
  ok('an edit on one replica reaches the other as a serialisable operation and both compute the same totals');
}
{
  // what Excel needs besides cells: function prefixes (_xlfn.), the sheet's view (tab colour, hidden, zoom, gridlines,
  // filter range), and a full recalculation on open; each comes back on import
  const { toExcelFormula, fromExcelFormula } = await import('../src/sheets/engine/xlsx-formula.js');
  assert.equal(toExcelFormula('=XLOOKUP(A1,B:B,C:C)+SUM(IFS(A1>1,1,TRUE,2))'), '_xlfn.XLOOKUP(A1,B:B,C:C)+SUM(_xlfn.IFS(A1>1,1,TRUE,2))');
  assert.equal(toExcelFormula('=FILTER(A2:A9,B2:B9>1)&"XLOOKUP(x)"&\'TEXTJOIN(\'!A1'), '_xlfn._xlws.FILTER(A2:A9,B2:B9>1)&"XLOOKUP(x)"&\'TEXTJOIN(\'!A1');
  assert.equal(toExcelFormula('=STDEV.S(A1:A3)+stdev(A1:A3)'), '_xlfn.STDEV.S(A1:A3)+stdev(A1:A3)');
  assert.equal(fromExcelFormula('_xlfn._xlws.SORT(_xlfn.UNIQUE(A1:A9))&"_xlfn.x"'), 'SORT(UNIQUE(A1:A9))&"_xlfn.x"');
  assert.equal(fromExcelFormula('_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1)(2)'), 'LAMBDA(x,x+1)(2)');
  const text = ['## A', '', '| N | L |', '| --- | --- |', '| 1 | =XLOOKUP(1,A2:A3,A2:A3) |', '| 2 | =TEXTJOIN(",",TRUE,A2:A3) |', '',
    '<!-- sheet: {"tab":"#3b82f6","zoom":1.5,"gridlines":false,"filter":{"range":"A1:B3"},"cf":[{"range":"A2:A3","rule":{"type":"highlightCell","subType":"formula","value":"=IFS(A2>1,TRUE)","style":{"bl":1}}}]} -->', '',
    '## B', '', '| X |', '| --- |', '| 1 |', '', '<!-- sheet: {"hidden":true} -->', ''].join('\n');
  const bytes = await exportXlsx(text);
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes); const wbx = await zip.file('xl/workbook.xml').async('string'), s1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(wbx, /<sheet name="B"[^>]*state="hidden"/); assert.match(wbx, /fullCalcOnLoad="1"/);
  assert.match(s1, /<tabColor rgb="FF3B82F6"\/>/); assert.match(s1, /<autoFilter ref="A1:B3"\/>/); assert.match(s1, /zoomScale="150"/); assert.match(s1, /showGridLines="0"/);
  assert.match(s1, /<f>_xlfn\.XLOOKUP\(/); assert.match(s1, /<f>_xlfn\.TEXTJOIN\(/); assert.match(s1, /_xlfn\.IFS\(A2&gt;1,TRUE\)/);
  const back = (await importFile(bytes, 'A.xlsx')).text;
  assert.match(back, /=XLOOKUP\(1,A2:A3,A2:A3\)/); assert.doesNotMatch(back, /_xlfn/);
  for (const k of ['"tab":"#3b82f6"', '"zoom":1.5', '"gridlines":false', '"filter":{"range":"A1:B3"}', '"hidden":true', '"value":"=IFS(A2>1,TRUE)"']) assert.ok(back.includes(k), k);
  ok('.xlsx: _xlfn prefixes both ways, tab colour, hidden sheet, zoom, gridlines and filter range go to Excel and back; Excel recalculates on open');
}
console.log(`\n${n} sheets engine checks passed`);
