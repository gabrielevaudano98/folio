// Folio Sheets — the command line (area 18: headless and batch work). The same modules as the app: the Univer formula
// engine (headless.js), FQL, file conversion and what-if analysis, without a window. Built to dist/folio-sheets.mjs.
//
//   node dist/folio-sheets.mjs values  Book.sheet.md [Sheet]          computed values as JSON
//   node dist/folio-sheets.mjs export  Book.sheet.md out.xlsx|out.csv  (writes into Book's original .xlsm if it has one)
//   node dist/folio-sheets.mjs import  data.xlsx [out.sheet.md]
//   node dist/folio-sheets.mjs refresh Book.sheet.md                   run every FQL query and pivot, write the file
//   node dist/folio-sheets.mjs goal    Book.sheet.md "Sheet!F9" 1000 "Sheet!B2"
//   node dist/folio-sheets.mjs pdf     Book.sheet.md out.pdf [Sheet]    Puppeteer + a local Chrome (CHROME_PATH)
//   node dist/folio-sheets.mjs check   Book.sheet.md                   errors and circular references, exit 1 if any
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHeadless } from './engine/headless.js';
import { importFile, exportXlsx, exportCsv } from './engine/io.js';
import { goalSeek } from './engine/whatif.js';
import { toUniver, fromUniver } from './core/convert.js';
import { readDoc } from './core/sheetmd.js';
import { run as runFql } from './core/fql/run.js';
import { parse as parseFql, inputsOf } from './core/fql/parse.js';
import { findCycles } from './core/refs.js';
import { addr, splitRef, toRange, quoteSheet } from './core/a1.js';
import { buildPrintHtml } from './ui/print-ui.js';

const [cmd, file, ...rest] = process.argv.slice(2);
const die = (m) => { console.error(m); process.exit(2); };
const usage = 'folio-sheets values|export|import|refresh|goal|pdf|check <file> …';
if (!cmd || !file) die(usage);

async function open(text) { const H = await createHeadless(); const loaded = toUniver(text); const wb = await H.open(loaded.data); return { H, wb, loaded }; }
const grids = (wb) => Object.fromEntries(wb.fwb.getSheets().map((s) => [s.getSheetName(), s.getDataRange().getRawValues()]));

const COMMANDS = {
  async values() {
    const { H, wb } = await open(await fs.readFile(file, 'utf8'));
    const g = grids(wb); const out = rest[0] ? { [rest[0]]: g[rest[0]] } : g;
    console.log(JSON.stringify(out, null, 1)); H.dispose();
  },
  async export() {
    const out = rest[0] || die(usage); const text = await fs.readFile(file, 'utf8');
    if (out.endsWith('.csv')) { const { H, wb } = await open(text); const g = grids(wb); await fs.writeFile(out, '﻿' + exportCsv(g[rest[1]] || Object.values(g)[0])); H.dispose(); return; }
    const src = readDoc(text).workbook?.source; const source = src ? await fs.readFile(path.join(path.dirname(file), src)).catch(() => null) : null;
    const { H, wb, loaded } = await open(text);
    const values = {};
    for (const id of loaded.data.sheetOrder) { const ws = loaded.data.sheets[id]; const vals = wb.fwb.getSheetBySheetId(id).getDataRange().getRawValues(); values[ws.name] = {}; for (const [r, row] of Object.entries(ws.cellData || {})) for (const c of Object.keys(row || {})) if (row[c]?.f) (values[ws.name][r] ||= {})[c] = vals[r]?.[c]; }
    await fs.writeFile(out, await exportXlsx(text, { source, values })); H.dispose();
  },
  async import() {
    const r = await importFile(await fs.readFile(file), path.basename(file));
    const out = rest[0] || file.replace(/\.[^.]+$/, '.sheet.md');
    await fs.writeFile(out, r.text); console.error(`${out}: ${r.sheets.length} sheets${r.vba ? ' (macros kept in the original file)' : ''}`);
  },
  async refresh() {
    let text = await fs.readFile(file, 'utf8');
    const { H, wb, loaded } = await open(text);
    const all = grids(wb);
    for (const f of readDoc(text).fences.filter((x) => x.lang === 'fql')) {
      const program = parseFql(f.body, { name: f.name || 'Query' }); const ins = inputsOf(program);
      const files = {}; for (const x of ins.files) { const p = path.join(path.dirname(file), x.path); files[x.path] = x.kind === 'xlsx' ? { bytes: await fs.readFile(p) } : { text: await fs.readFile(p, 'utf8') }; }
      const sheets = {}; for (const s of ins.sheets) sheets[s.range ? `${s.sheet}!${s.range}` : s.sheet] = s.range ? wb.values(s.sheet, s.range) : all[s.sheet];
      const res = await runFql(program, { sheets, files }, { name: f.name });
      for (const ld of res.loads) if (ld.to === 'sheet') { const s = wb.fwb.getSheetByName(ld.sheet) || wb.fwb.insertSheet(ld.sheet); const g = res.results[ld.query]; const p = toRange(ld.cell || 'A1'); s.getRange(p.startRow, p.startColumn, g.length, g.reduce((m, r) => Math.max(m, r.length), 0)).setValues(g.map((r) => r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null)))); console.error(`${f.name}/${ld.query} → ${ld.sheet}!${ld.cell || 'A1'} (${g.length - 1} rows)`); }
    }
    await wb.settle();
    text = fromUniver(wb.save(), loaded); await fs.writeFile(file, text); H.dispose();
  },
  async goal() {
    const [set, to, by] = rest; if (!by) die('folio-sheets goal <file> "Sheet!F9" 1000 "Sheet!B2"');
    const H = await createHeadless(); const r = await goalSeek(H, toUniver(await fs.readFile(file, 'utf8'), { share: true }).data, { set, to: Number(to), by });
    console.log(JSON.stringify(r)); H.dispose(); process.exitCode = r.found ? 0 : 1;
  },
  async check() {
    const { H, wb } = await open(await fs.readFile(file, 'utf8'));
    const formulas = {}, errors = [];
    for (const s of wb.fwb.getSheets()) { const r = s.getDataRange(); const fs_ = r.getFormulas(); const v = r.getRawValues(); fs_.forEach((row, i) => row.forEach((f, j) => { const k = `${s.getSheetName()}!${addr(i, j)}`; if (f) formulas[k] = f; if (typeof v[i][j] === 'string' && /^#[A-Z/0!?]+/.test(v[i][j])) errors.push(`${k} ${v[i][j]}`); })); }
    const cycles = findCycles(formulas);
    for (const e of errors) console.log(`error     ${e}`); for (const c of cycles) console.log(`circular  ${c.join(' → ')}`);
    console.log(`${Object.keys(formulas).length} formulas, ${errors.length} errors, ${cycles.length} circular references`);
    H.dispose(); process.exitCode = errors.length || cycles.length ? 1 : 0;
  },
  async pdf() {
    const out = rest[0] || die(usage); const text = await fs.readFile(file, 'utf8');
    const { H, wb, loaded } = await open(text);
    const ws = rest[1] ? wb.fwb.getSheetByName(rest[1]) : wb.fwb.getSheets()[0]; const snap = wb.save(); const sh = snap.sheets[ws.getSheetId()];
    const print = readDoc(text).workbook?.print || {}; const a1 = print.area ? splitRef(print.area).range : ws.getDataRange().getA1Notation(); const range = toRange(a1);
    const disp = ws.getRange(a1).getDisplayValues();
    const html = buildPrintHtml({ title: `${path.basename(file).replace(/\.sheet\.md$/, '')} — ${ws.getSheetName()}`, cells: sh.cellData || {}, styles: snap.styles || {}, merges: sh.mergeData || [], colWidths: Object.fromEntries(Object.entries(sh.columnData || {}).filter(([, o]) => o?.w).map(([c, o]) => [c, o.w])), range, print, display: (i, j) => disp[i - range.startRow]?.[j - range.startColumn] ?? '' });
    H.dispose(); void loaded; void quoteSheet;
    const executablePath = process.env.CHROME_PATH; if (!executablePath) die('Set CHROME_PATH to a Chrome or Chromium executable for PDF output.');
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    try { const page = await browser.newPage(); await page.setJavaScriptEnabled(false); await page.setContent(html, { waitUntil: 'load' }); await fs.writeFile(out, await page.pdf({ preferCSSPageSize: true, printBackground: true })); } finally { await browser.close(); }
  },
};
if (!COMMANDS[cmd]) die(usage);
await COMMANDS[cmd]();
