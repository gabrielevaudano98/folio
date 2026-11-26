// Folio Sheets in the app (Electron, xvfb on Linux): the surface, the data engine process and the panels together.
// Each step works through the same `surface` API the ribbon and panels use; results are checked in the file on disk.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { workspace, runApp, open, errors } from './harness.mjs';

const w = workspace('sheets-ui', 47390);
const S = "document.querySelector('.surface-sheet').__surface";
const ev = (expr, wait = 1200) => ({ js: `(async()=>{try{const v=await (async()=>{${expr}})();return v===undefined?null:JSON.parse(JSON.stringify(v))}catch(e){return 'ERR '+e.message}})()`, log: true, wait });
// a spreadsheet to import, made with SheetJS
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Item', 'Qty', 'Price'], ['Pen', 3, 1.5], ['Book', 2, 12]]), 'Stock');
const xlsxPath = path.join(w.tmp, 'Stock.xlsx'); fs.writeFileSync(xlsxPath, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));

const steps = [
  { wait: 2500 }, open('sheets/Rich.sheet.md'), { wait: 5000 },
  // 1 engine up
  ev(`return (await ${S}.call('ping')).engine`),
  // 2 a macro from a script block runs in the sandbox and its changes reach the file
  ev(`${S}.setFence('script', 'Macros', 'function stamp(){ Workbook.active().range("H1").setValue("checked").setBold(); }\\nfunction TRIPLE(x){ return x*3 }'); await ${S}.runMacro('stamp'); ${S}.saveNow(); return ${S}.read('Orders!H1')[0][0]`, 2500),
  // 3 a pivot block placed in a new sheet
  ev(`${S}.setFence('pivot', 'By region', 'source: Orders!A1:F4\\nrows: Region\\nvalues: sum(Total)\\nplace: Pivot!A1'); await ${S}.panels.run('pivot', 'refreshAll'); return ${S}.read('Pivot!A1:B4')`, 2500),
  // 4 FQL refresh writes the Summary sheet
  ev(`await ${S}.refreshAll(); return ${S}.read('Summary!A1:B3')`, 3000),
  // 5 protection blocks an edit outside the allowed range and lets one inside through
  ev(`${S}.setMeta({ protect: { allow: ['C2:C4'] } }); let blocked = false; try { ${S}.ws().getRange('D2').setValue(99); } catch { blocked = true; } const d2 = ${S}.read('D2')[0][0]; ${S}.ws().getRange('C2').setValue('Pencil'); const c2 = ${S}.read('C2')[0][0]; ${S}.protection.unguarded(() => ${S}.setMeta({ protect: null })); return { blocked, d2, c2 }`),
  // 6 encrypt a range, then decrypt it
  ev(`const box = await ${S}.call('crypto.encrypt', { value: [[1, 2]], password: 'correct horse' }); return await ${S}.call('crypto.decrypt', { box, password: 'correct horse' })`),
  // 7 sign the workbook and verify
  ev(`const r = await ${S}.call('crypto.sign', { text: ${S}.saveNow(), signer: 'Test' }); const v1 = await ${S}.call('crypto.verify', { text: r.text }); const v2 = await ${S}.call('crypto.verify', { text: r.text.replace('Folder', 'Binder') }); return [v1.valid, v1.mine, v2.valid]`, 4000),
  // 8 export to Excel through the engine (FOLIO_EXPORT_DIR replaces the save dialog)
  ev(`document.querySelector('[data-tab="data"]').click(); document.querySelector('[data-cmd="x:exportXlsx"]').click(); return 1`, 4000),
  // 9 a slicer filters the table
  ev(`${S}.wb().getSheetByName('Orders').activate(); ${S}.floats.addSlicer({ source: 'A1:F4', column: 'Region' }); await new Promise(r=>setTimeout(r,400)); const b=[...document.querySelectorAll('.xs-slicer-items button')].find(x=>x.textContent==='US'); b.click(); await new Promise(r=>setTimeout(r,400)); return { hidden: ${S}.ws().getFilter().getFilteredOutRows(), saved: ${S}.meta().slicers[0].selected }`, 1500),
  // 10 PDF of the sheet
  ev(`await ${S}.exportPdf(); return 1`, 4000),
  // 11 every panel opens without an error
  ev(`const ids = ['queries','model','pivot','chart','slicer','whatif','python','scripts','protect','history','audit','form','entity','cf','series','textToCols','print']; const bad = []; for (const id of ids) { try { await ${S}.panels.open(id); await new Promise(r=>setTimeout(r,250)); if (document.querySelector('.xs-dock[hidden]')) bad.push(id); } catch (e) { bad.push(id + ': ' + e.message); } } ${S}.panels.close(); return bad`, 6000),
  // 12 import an .xlsx as a new workbook
  ev(`document.querySelector('[data-tab="data"]').click(); document.querySelector('[data-cmd="x:importFile"]').click(); return 1`, 5000),
  ev(`return [...document.querySelectorAll('[data-file]')].map(e=>e.dataset.file).filter(f=>/Stock/.test(f))`),
  // 13 the ribbon: every tab the same height; a size typed in the box applies; Escape gives back what was there; the
  //    Number format list previews the active cell
  open('sheets/Rich.sheet.md'),
  ev(`const R = document.querySelector('.surface-sheet .ribbon'); const h = new Set();
    for (const t of R.querySelectorAll('.rb-tab:not([hidden])')) { t.click(); await new Promise(r=>setTimeout(r,120)); h.add(Math.round(R.querySelector('.rb-panels').getBoundingClientRect().height)); }
    R.querySelector('[data-tab="home"]').click(); await new Promise(r=>setTimeout(r,200));
    ${S}.wb().getSheetByName('Orders').activate(); ${S}.ws().getRange('E3').activate(); await new Promise(r=>setTimeout(r,200));
    const q = (c) => R.querySelector('#rb-panel-home .rb-combo-input[data-cmd="' + c + '"]');
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const size = q('x:size'); size.focus(); size.value = '13'; size.dispatchEvent(new Event('input', { bubbles: true })); key(size, 'Enter'); await new Promise(r=>setTimeout(r,200));
    const fs = ${S}.range().getCellStyleData().fs;
    size.focus(); size.value = '999'; size.dispatchEvent(new Event('input', { bubbles: true })); key(size, 'Enter'); await new Promise(r=>setTimeout(r,200));
    const fs2 = ${S}.range().getCellStyleData().fs;
    const font = q('x:font'); font.focus(); font.value = 'Verd'; font.dispatchEvent(new Event('input', { bubbles: true })); const matches = document.querySelectorAll('.rb-listbox .rb-option').length; key(font, 'Escape');
    const nf = q('x:numfmt'); nf.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await new Promise(r=>setTimeout(r,100));
    const cur = [...document.querySelectorAll('.rb-listbox .rb-option')].find((o) => o.textContent.startsWith('Currency'))?.textContent; key(nf, 'Escape');
    return { heights: [...h], fs, fs2, sizeBox: size.value, matches, font: font.value, cur }`, 2500),
  // 14 formulas are computed in a Web Worker: values arrive, a script's custom function answers through the window,
  //    and the formula audit gets its dependency tree
  ev(`const s = ${S}; s.wb().getSheetByName('Orders').activate(); s.ws().getRange('J2').setValue('=TRIPLE(5)'); s.ws().getRange('J3').setValue('=D2*2');
    const wait = async (f) => { for (let i = 0; i < 60; i++) { const v = f(); if (v !== null && v !== undefined && v !== '' && !String(v).startsWith('#')) return v; await new Promise((r) => setTimeout(r, 100)); } return f(); };
    const udf = await wait(() => s.ws().getRange('J2').getRawValue()); const plainF = await wait(() => s.ws().getRange('J3').getRawValue());
    let tree = null; try { tree = await s.formulaApi().getCellDependencyTree({ unitId: s.unitId(), sheetId: s.sheetId(), row: 1, column: 5 }, 5000); } catch (e) { tree = 'ERR ' + e.message; }
    // formulas inside rules (a custom validation) and SUBTOTAL, which skips rows a filter hides, are computed there too
    const ws = s.ws(); ws.getRange('D2:D4').setDataValidation(s.univerApi().newDataValidation().requireFormulaSatisfied('=D2>5').build());
    ws.getRange('J4').setValue('=SUBTOTAL(9,D2:D4)'); await new Promise((r) => setTimeout(r, 1500));
    const hidden = new Set(ws.getFilter?.()?.getFilteredOutRows?.() || []); const d = ws.getRange('D2:D4').getRawValues().map((x) => x[0]);
    const visible = d.reduce((a, v, i) => a + (hidden.has(i + 1) ? 0 : v), 0);
    const dv = [String(await ws.getRange('D2').getValidatorStatus()), String(await ws.getRange('D3').getValidatorStatus())];
    return { worker: s.univerWorker(), udf, plainF, tree: tree && typeof tree === 'object' ? 'ok' : String(tree), subtotal: ws.getRange('J4').getRawValue() === visible, dv }`, 6000),
  errors,
];
const r = await runApp(w, steps, { FOLIO_IMPORT_SHEET: xlsxPath }, 240000);
const [ping, macro, pivot, summary, prot, dec, sig, , slicer, , panels, , imported, ribbon, worker, errs] = r.js;
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('sheets in the app');
assert.equal(ping, 1); ok('the data engine starts as a separate process');
assert.equal(macro, 'checked'); ok('a macro runs in the sandbox and changes the grid');
assert.deepEqual(pivot, [['Region', 'Sum of Total'], ['EU', 26.6], ['US', 14.4], ['Grand total', 41]]); ok('a PivotTable block is computed and placed in its sheet');
assert.deepEqual(summary, [['Region', 'qty'], ['EU', 10], ['US', 12]]); ok('Refresh all runs the FQL queries and loads their results');
assert.deepEqual(prot, { blocked: true, d2: 4, c2: 'Pencil' }); ok('a protected sheet refuses edits outside its editable ranges');
assert.deepEqual(dec, [[1, 2]]); ok('encryption round trip through the engine');
assert.deepEqual(sig, [true, true, false]); ok('a signature verifies, and breaks when the workbook changes');
assert.deepEqual(slicer, { hidden: [1, 3], saved: ['US'] }); ok('a slicer filters the table and is saved with the sheet');
assert.deepEqual(panels, []); ok('every panel opens');
const md = w.read('sheets/Rich.sheet.md');
assert(md.includes('```script Macros') && md.includes('```pivot By region') && /\| checked/.test(md) && md.includes('## Pivot') && md.includes('"slicers":[{"kind":"slicer","source":"A1:F4","column":"Region"')); ok('scripts, pivots, results and slicers are written to the Markdown file');
const xl = XLSX.read(fs.readFileSync(path.join(w.out, 'Rich.xlsx')), { type: 'buffer', cellFormula: true });
assert.deepEqual(xl.SheetNames.slice(0, 2), ['Orders', 'Regions']); assert.equal(xl.Sheets.Orders.F5.f, 'SUM(F2:F4)'); assert.equal(xl.Sheets.Orders.F5.v, 41); ok('export to Excel writes formulas with their computed values');
assert(fs.readdirSync(w.out).some((f) => f.endsWith('.pdf') && fs.statSync(path.join(w.out, f)).size > 1000)); ok('the sheet exports to PDF');
assert.deepEqual(imported, ['sheets/Stock.sheet.md']); const st = w.read('sheets/Stock.sheet.md');
assert(st.includes('## Stock') && st.includes('| Book | 2   | 12    |') && /"source":"\.asset\/[0-9a-f]{8}-Stock\.xlsx"/.test(st)); ok('an .xlsx imports as a new workbook that keeps the original package for export');
assert.equal(ribbon.heights.length, 1, `ribbon heights ${ribbon.heights}`); ok('every ribbon tab has the same height');
assert.deepEqual([ribbon.fs, ribbon.fs2, ribbon.sizeBox], [13, 13, '13']); ok('a font size typed in the box applies; one out of range (999) is refused');
assert.deepEqual([ribbon.matches, ribbon.font], [1, 'System']); ok('the font box filters as you type and Escape gives back the font in use');
assert.equal(ribbon.cur, 'Currency€1.20'); ok('the Number format list previews the active cell in each format');
assert.deepEqual(worker, { worker: true, udf: 15, plainF: 8, tree: 'ok', subtotal: true, dv: ['invalid', 'valid'] }, JSON.stringify(worker)); ok('formulas are computed in a Web Worker: custom functions, the formula audit, validation formulas and SUBTOTAL under a filter work through it');
assert.deepEqual(errs, []); ok('no errors in the window');
console.log(`\n${n} sheets app checks passed`);
