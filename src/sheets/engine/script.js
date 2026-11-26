// Folio Sheets — scripts (areas 13, 14 and 20). Folio Script is plain JavaScript in ```script Name``` blocks, with an
// API shaped like Apps Script and Excel's object model:
//
//   function addTotals() {                       // a macro: Automate → Run macro, or a button on the sheet
//     const sh = Workbook.active();
//     const last = sh.lastRow();
//     sh.range(`F${last + 1}`).setFormula(`=SUM(F2:F${last})`).setBold(true);
//     ui.toast('Totals added');
//   }
//   function DOUBLE(x) { return x * 2; }        // UPPER-CASE name: a custom function, =DOUBLE(A1) in a cell
//   function onEdit(e) { ... }                   // hooks: onOpen(), onEdit({ sheet, range, value, oldValue })
//
// It runs in QuickJS (WebAssembly) inside the data engine: no file system, no network, no Node, no DOM, a memory cap
// and a time limit. The script sees a copy of the workbook (values and formulas) and returns a list of operations;
// the window replays them through Univer's commands, so a macro is undoable, recorded in the operation log and
// written to the file like any edit. Pure apart from QuickJS.
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { describe } from './script-describe.js';
import { expandSharedFormulas } from '../core/convert.js';
export { describe };

const LIMITS = { memory: 64 * 1024 * 1024, stack: 512 * 1024, ms: 5000 };
let modP = null;
/** the QuickJS module; `wasmPath` is set when bundled (the .wasm file is copied next to the engine) */
export function quickjs(wasmPath = globalThis.__folioQuickJsWasm) {
  if (!modP) {
    const variant = wasmPath ? newVariant(releaseSync, { wasmLocation: wasmPath }) : releaseSync;
    modP = newQuickJSWASMModuleFromVariant(variant);
  }
  return modP;
}

/* The API inside the sandbox. Written in plain JavaScript and evaluated in QuickJS before the person's code. */
export const PRELUDE = String.raw`
"use strict";
const __ops = [], __logs = [], __toasts = [];
const __col = (s) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const __colName = (c) => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
const __addr = (r, c) => __colName(c) + (r + 1);
function __parse(a1) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(String(a1).trim());
  if (!m) throw new Error('Not a cell or range: ' + a1);
  const r1 = +m[2] - 1, c1 = __col(m[1]), r2 = m[3] ? +m[4] - 1 : r1, c2 = m[3] ? __col(m[3]) : c1;
  return { row: Math.min(r1, r2), col: Math.min(c1, c2), rows: Math.abs(r2 - r1) + 1, cols: Math.abs(c2 - c1) + 1 };
}
class Range {
  constructor(sheet, row, col, rows = 1, cols = 1) { if (rows * cols > 1e6) throw new Error('Range too large'); Object.assign(this, { sheet, row, col, rows, cols }); }
  getA1Notation() { const a = __addr(this.row, this.col), b = __addr(this.row + this.rows - 1, this.col + this.cols - 1); return a === b ? a : a + ':' + b; }
  get address() { return this.getA1Notation(); }
  getRow() { return this.row + 1; } getColumn() { return this.col + 1; } getNumRows() { return this.rows; } getNumColumns() { return this.cols; }
  __each(f) { const out = []; for (let i = 0; i < this.rows; i++) { const row = []; for (let j = 0; j < this.cols; j++) row.push(f(this.row + i, this.col + j)); out.push(row); } return out; }
  getValues() { return this.__each((r, c) => this.sheet.__cell(r, c).v ?? null); }
  getValue() { return this.getValues()[0][0]; }
  getFormulas() { return this.__each((r, c) => this.sheet.__cell(r, c).f || ''); }
  getFormula() { return this.getFormulas()[0][0]; }
  getDisplayValues() { return this.getValues().map((r) => r.map((v) => (v == null ? '' : String(v)))); }
  setValues(rows) {
    if (!Array.isArray(rows) || !rows.every(Array.isArray)) throw new Error('setValues needs rows: [[...], [...]]');
    const h = rows.length, w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    rows.forEach((row, i) => row.forEach((v, j) => { const s = typeof v === 'string' && v.startsWith('=') ? { f: v } : { v: v === undefined ? null : v }; this.sheet.__set(this.row + i, this.col + j, s); }));
    __ops.push({ op: 'values', sheet: this.sheet.name, range: __addr(this.row, this.col) + ':' + __addr(this.row + h - 1, this.col + w - 1), values: rows });
    return this;
  }
  setValue(v) { return this.setValues(this.__each(() => v)); }
  setFormulas(rows) { return this.setValues(rows.map((r) => r.map((f) => (String(f).startsWith('=') ? f : '=' + f)))); }
  setFormula(f) { return this.setFormulas(this.__each(() => f)); }
  clear() { __ops.push({ op: 'clear', sheet: this.sheet.name, range: this.getA1Notation() }); this.__each((r, c) => this.sheet.__set(r, c, { v: null })); return this; }
  __style(k, v) { __ops.push({ op: 'style', sheet: this.sheet.name, range: this.getA1Notation(), key: k, value: v }); return this; }
  setBold(on = true) { return this.__style('bold', !!on); }
  setItalic(on = true) { return this.__style('italic', !!on); }
  setFontColor(c) { return this.__style('color', String(c)); }
  setBackground(c) { return this.__style('fill', c == null ? null : String(c)); }
  setNumberFormat(p) { return this.__style('numfmt', String(p)); }
  setHorizontalAlignment(a) { return this.__style('align', String(a)); }
  setFontSize(n) { return this.__style('size', Number(n)); }
  setFontFamily(f) { return this.__style('font', String(f)); }
  setFontWeight(w) { return this.__style('bold', String(w).toLowerCase() === 'bold'); }
  setFontStyle(s) { return this.__style('italic', String(s).toLowerCase() === 'italic'); }
  setUnderline(on = true) { return this.__style('underline', !!on); }
  setStrikethrough(on = true) { return this.__style('strike', !!on); }
  setVerticalAlignment(a) { return this.__style('valign', String(a)); }
  setWrap(on = true) { return this.__style('wrap', !!on); }
  /** setBorder(true, null, true, null) as in Apps Script (top, left, bottom, right, vertical, horizontal, colour, style), or setBorder('all' | 'outside' | 'none', colour, style) */
  setBorder(...a) {
    if (typeof a[0] === 'string') return this.__style('border', { sides: [a[0]], color: a[1] || '#000000', style: a[2] || 'thin' });
    const names = ['top', 'left', 'bottom', 'right', 'vertical', 'horizontal'];
    const on = names.filter((_, i) => a[i] === true), off = names.filter((_, i) => a[i] === false);
    if (off.length === 6) return this.__style('border', { sides: ['none'] });
    return this.__style('border', { sides: on.length ? on : ['all'], color: a[6] || '#000000', style: a[7] || 'thin' });
  }
  merge() { __ops.push({ op: 'merge', sheet: this.sheet.name, range: this.getA1Notation() }); return this; }
  mergeAcross() { __ops.push({ op: 'merge', sheet: this.sheet.name, range: this.getA1Notation(), across: true }); return this; }
  breakApart() { __ops.push({ op: 'unmerge', sheet: this.sheet.name, range: this.getA1Notation() }); return this; }
  /** sort the rows of this range by a column (1-based, of the sheet) or several: sort(2), sort({ column: 2, ascending: false }), sort([{ column: 3 }, 1]) */
  sort(spec) {
    const keys = (Array.isArray(spec) ? spec : [spec]).map((k) => (typeof k === 'number' ? { column: k, ascending: true } : { column: k.column, ascending: k.ascending !== false }));
    for (const k of keys) if (!(k.column >= this.col + 1 && k.column <= this.col + this.cols)) throw new Error('sort: column ' + k.column + ' is outside ' + this.getA1Notation());
    const rows = this.__each((r, c) => { const x = this.sheet.__cell(r, c); return x.f ? x.f : x.v ?? null; });
    const vals = this.getValues();
    const idx = rows.map((_, i) => i);
    const cmp = (a, b) => { if (a === b) return 0; if (a == null || a === '') return 1; if (b == null || b === '') return -1; if (typeof a === 'number' && typeof b === 'number') return a - b; return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); };
    idx.sort((i, j) => { for (const k of keys) { const c = k.column - 1 - this.col; const d = cmp(vals[i][c], vals[j][c]); if (d) return k.ascending ? d : -d; } return i - j; });
    return this.setValues(idx.map((i) => rows[i]));
  }
  /** cells of this range whose shown text matches: find('Pen'), find('pen', { matchCase: false, entireCell: true }) */
  find(text, { matchCase = false, entireCell = false } = {}) {
    const want = matchCase ? String(text) : String(text).toLowerCase(); const out = [];
    this.__each((r, c) => { const v = this.sheet.__cell(r, c).v; if (v == null) return; const s = matchCase ? String(v) : String(v).toLowerCase(); if (entireCell ? s === want : s.includes(want)) out.push(new Range(this.sheet, r, c)); });
    return out;
  }
  setNote(t) { __ops.push({ op: 'note', sheet: this.sheet.name, range: __addr(this.row, this.col), value: t == null ? null : String(t) }); return this; }
  offset(r, c, rows = this.rows, cols = this.cols) { return new Range(this.sheet, this.row + r, this.col + c, rows, cols); }
  activate() { __ops.push({ op: 'select', sheet: this.sheet.name, range: this.getA1Notation() }); return this; }
}
class Sheet {
  constructor(name, data) { this.name = name; this.__d = data || { cells: {} }; }
  getName() { return this.name; }
  __cell(r, c) { return (this.__d.cells[r] && this.__d.cells[r][c]) || {}; }
  __set(r, c, v) { (this.__d.cells[r] ||= {})[c] = v; }
  range(a1, c, rows, cols) { if (typeof a1 === 'number') return new Range(this, a1 - 1, c - 1, rows || 1, cols || 1); const p = __parse(a1); return new Range(this, p.row, p.col, p.rows, p.cols); }
  getRange(a, b, c, d) { return this.range(a, b, c, d); }
  cell(row, col) { return new Range(this, row - 1, col - 1); }
  lastRow() { let m = 0; for (const r of Object.keys(this.__d.cells)) { const row = this.__d.cells[r]; if (Object.values(row).some((x) => x && (x.v != null && x.v !== '' || x.f))) m = Math.max(m, +r + 1); } return m; }
  lastColumn() { let m = 0; for (const row of Object.values(this.__d.cells)) for (const [c, x] of Object.entries(row)) if (x && (x.v != null && x.v !== '' || x.f)) m = Math.max(m, +c + 1); return m; }
  getLastRow() { return this.lastRow(); } getLastColumn() { return this.lastColumn(); }
  dataRange() { return new Range(this, 0, 0, Math.max(1, this.lastRow()), Math.max(1, this.lastColumn())); }
  getDataRange() { return this.dataRange(); }
  appendRow(values) { return this.range(this.lastRow() + 1, 1, 1, values.length).setValues([values]); }
  find(text, o) { return this.dataRange().find(text, o); }
  createTextFinder(text) { let o = {}; const f = { matchCase: (b = true) => ((o.matchCase = b), f), matchEntireCell: (b = true) => ((o.entireCell = b), f), findAll: () => this.find(text, o), findNext: () => this.find(text, o)[0] || null }; return f; }
  /* rows and columns are 1-based, as in Apps Script; the copy the script reads moves with them */
  __shift(axis, at, n) {
    const cells = this.__d.cells, out = {};
    for (const [r, row] of Object.entries(cells)) for (const [c, x] of Object.entries(row)) {
      let R = +r, C = +c;
      if (axis === 'r') { if (n < 0 && R >= at && R < at - n) continue; if (R >= at) R += n; } else { if (n < 0 && C >= at && C < at - n) continue; if (C >= at) C += n; }
      (out[R] ||= {})[C] = x;
    }
    this.__d.cells = out;
  }
  insertRowsBefore(row, n = 1) { this.__shift('r', row - 1, n); __ops.push({ op: 'insertRows', sheet: this.name, at: row - 1, count: n }); return this; }
  insertRowsAfter(row, n = 1) { return this.insertRowsBefore(row + 1, n); }
  insertRowBefore(row) { return this.insertRowsBefore(row, 1); } insertRowAfter(row) { return this.insertRowsAfter(row, 1); }
  deleteRows(row, n = 1) { this.__shift('r', row - 1, -n); __ops.push({ op: 'deleteRows', sheet: this.name, at: row - 1, count: n }); return this; }
  deleteRow(row) { return this.deleteRows(row, 1); }
  insertColumnsBefore(col, n = 1) { this.__shift('c', col - 1, n); __ops.push({ op: 'insertCols', sheet: this.name, at: col - 1, count: n }); return this; }
  insertColumnsAfter(col, n = 1) { return this.insertColumnsBefore(col + 1, n); }
  deleteColumns(col, n = 1) { this.__shift('c', col - 1, -n); __ops.push({ op: 'deleteCols', sheet: this.name, at: col - 1, count: n }); return this; }
  deleteColumn(col) { return this.deleteColumns(col, 1); }
  setColumnWidth(col, px) { __ops.push({ op: 'colWidth', sheet: this.name, at: col - 1, size: Number(px) }); return this; }
  setRowHeight(row, px) { __ops.push({ op: 'rowHeight', sheet: this.name, at: row - 1, size: Number(px) }); return this; }
  setFrozenRows(n) { __ops.push({ op: 'freeze', sheet: this.name, rows: Number(n) || 0 }); return this; }
  setFrozenColumns(n) { __ops.push({ op: 'freeze', sheet: this.name, cols: Number(n) || 0 }); return this; }
  setName(name) {
    name = String(name); if (!name || name in __wb.sheets) throw new Error('A sheet named ' + name + ' already exists');
    __ops.push({ op: 'renameSheet', sheet: this.name, name }); __wb.sheets[name] = __wb.sheets[this.name]; delete __wb.sheets[this.name];
    const old = this.name; __sheets.delete(old); this.name = name; __sheets.set(name, this); if (__wb.active === old) __wb.active = name; return this;
  }
  clear() { return this.dataRange().clear(); }
  activate() { __ops.push({ op: 'activate', sheet: this.name }); return this; }
}
const __sheets = new Map();
const Workbook = Object.freeze({
  sheets: () => Object.keys(__wb.sheets).map((n) => Workbook.sheet(n)),
  sheet(name) { if (!(name in __wb.sheets)) throw new Error('No sheet named ' + name); if (!__sheets.has(name)) __sheets.set(name, new Sheet(name, __wb.sheets[name])); return __sheets.get(name); },
  getSheetByName(name) { return name in __wb.sheets ? Workbook.sheet(name) : null; },
  active: () => Workbook.sheet(__wb.active),
  getActiveSheet: () => Workbook.active(),
  selection: () => (__wb.selection ? Workbook.active().range(__wb.selection) : null),
  getActiveRange: () => Workbook.selection(),
  getSheets: () => Workbook.sheets(),
  deleteSheet(sheet) { const name = typeof sheet === 'string' ? sheet : sheet.name; if (!(name in __wb.sheets)) throw new Error('No sheet named ' + name); if (Object.keys(__wb.sheets).length < 2) throw new Error('A workbook keeps at least one sheet'); delete __wb.sheets[name]; __sheets.delete(name); __ops.push({ op: 'deleteSheet', sheet: name }); },
  insertSheet(name) { if (name in __wb.sheets) throw new Error('A sheet named ' + name + ' already exists'); __wb.sheets[name] = { cells: {} }; __ops.push({ op: 'insertSheet', sheet: name }); return Workbook.sheet(name); },
  name: (n) => { const v = __wb.names && __wb.names[n]; if (!v) throw new Error('No name ' + n); const m = /^=?'?([^'!]+)'?!(.+)$/.exec(v); return m ? Workbook.sheet(m[1]).range(m[2].replace(/\$/g, '')) : null; },
});
const SpreadsheetApp = Object.freeze({ getActive: () => Workbook, getActiveSpreadsheet: () => Workbook, getActiveSheet: () => Workbook.active(), getUi: () => ui });
const ui = Object.freeze({ toast: (m) => { __toasts.push(String(m)); }, alert: (m) => { __toasts.push(String(m)); } });
const console = Object.freeze({ log: (...a) => { __logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }, warn: (...a) => console.log(...a), error: (...a) => console.log(...a) });
const log = console.log;
`;

function withVm(QJS, fn, { ms = LIMITS.ms } = {}) {
  const rt = QJS.newRuntime();
  rt.setMemoryLimit(LIMITS.memory); rt.setMaxStackSize(LIMITS.stack);
  const deadline = Date.now() + ms;
  rt.setInterruptHandler(() => Date.now() > deadline);
  const vm = rt.newContext();
  try { return fn(vm, () => Date.now() > deadline); } finally { vm.dispose(); rt.dispose(); }
}
function evalOrThrow(vm, code, file, timedOut) {
  const r = vm.evalCode(code, file);
  if (r.error) {
    const e = vm.dump(r.error); r.error.dispose();
    const msg = timedOut() ? `The script ran for more than ${LIMITS.ms / 1000} seconds and was stopped.` : (e?.message || String(e?.name || e));
    const line = /:(\d+)/.exec(e?.stack || '')?.[1];
    throw Object.assign(new Error(msg), { line: line ? Number(line) : undefined });
  }
  const v = vm.dump(r.value); r.value.dispose(); return v;
}

/**
 * run a macro or hook. wb = { active, selection, names, sheets: { Name: { cells: { r: { c: { v, f } } } } } }
 * → { ops, logs, toasts, result }
 */
export async function runScript(code, entry, wb, args = []) {
  const QJS = await quickjs();
  return withVm(QJS, (vm, timedOut) => {
    evalOrThrow(vm, `const __wb = ${JSON.stringify(wb)};\n${PRELUDE}\nglobalThis.__out = () => JSON.stringify({ ops: __ops, logs: __logs, toasts: __toasts });`, 'folio-prelude.js', timedOut);
    // the person's code is evaluated as a script so its functions become globals; line numbers stay theirs
    evalOrThrow(vm, String(code), 'script.js', timedOut);
    if (!/^[A-Za-z_$][\w$]*$/.test(entry)) throw new Error(`Not a function name: ${entry}`);
    const result = evalOrThrow(vm, `(() => { if (typeof ${entry} !== 'function') throw new Error('No function named ${entry} in the scripts'); const r = ${entry}(...${JSON.stringify(args)}); return r === undefined ? null : JSON.parse(JSON.stringify(r)); })()`, 'run.js', timedOut);
    const out = JSON.parse(evalOrThrow(vm, '__out()', 'out.js', timedOut));
    return { ...out, result };
  });
}

/* custom functions run often (once per cell per recalculation): one warm context per script text */
const warm = new Map();
export async function callFunction(code, name, args) {
  if (!/^[A-Z][A-Z0-9_.]*$/.test(name)) throw new Error(`${name} is not a custom function name (use UPPER_CASE)`);
  const QJS = await quickjs();
  let w = warm.get(code);
  if (!w) {
    const rt = QJS.newRuntime(); rt.setMemoryLimit(LIMITS.memory); rt.setMaxStackSize(LIMITS.stack);
    const vm = rt.newContext(); w = { rt, vm, deadline: 0 };
    rt.setInterruptHandler(() => Date.now() > w.deadline);
    w.deadline = Date.now() + LIMITS.ms;
    try { evalOrThrow(vm, `const __wb = { sheets: {}, active: null };\n${PRELUDE}`, 'folio-prelude.js', () => Date.now() > w.deadline); evalOrThrow(vm, code, 'script.js', () => Date.now() > w.deadline); }
    catch (e) { vm.dispose(); rt.dispose(); throw e; }
    if (warm.size >= 4) { const [k, old] = warm.entries().next().value; old.vm.dispose(); old.rt.dispose(); warm.delete(k); }
    warm.set(code, w);
  }
  w.deadline = Date.now() + 1000; // one cell gets one second
  const v = evalOrThrow(w.vm, `(() => { const r = ${name}(...${JSON.stringify(args)}); return r === undefined ? null : JSON.parse(JSON.stringify(r)); })()`, 'call.js', () => Date.now() > w.deadline);
  return v;
}

/** a workbook copy for a script, from a Univer snapshot (values computed by the engine when given) */
export function scriptWorkbook(snap0, { active, selection, values = {} } = {}) {
  const snap = expandSharedFormulas(snap0); // a cell of a shared formula has its own formula text in a script
  const sheets = {};
  for (const id of snap.sheetOrder) {
    const ws = snap.sheets[id]; const cells = {};
    for (const [r, row] of Object.entries(ws.cellData || {})) for (const [c, x] of Object.entries(row || {})) {
      if (!x) continue;
      const v = values[ws.name]?.[r]?.[c] ?? (x.f ? null : x.v ?? null);
      if (v == null && !x.f) continue;
      (cells[r] ||= {})[c] = x.f ? { f: x.f, v } : { v: x.t === 3 ? !!Number(x.v) : v };
    }
    sheets[ws.name] = { cells };
  }
  return { active: active || snap.sheets[snap.sheetOrder[0]]?.name, selection: selection || null, sheets };
}
