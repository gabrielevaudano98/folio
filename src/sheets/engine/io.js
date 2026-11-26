// Folio Sheets — files in and out (areas 9 and 25). Runs in the data engine, never in the window.
//
//   import: .xlsx/.xlsm (xlsx-kit: values, formulas, styles, merges, widths, freeze, validation, notes, names)
//           .xls/.xlsb/.ods/.csv/.tsv (SheetJS: values, formulas, number formats, merges, widths)
//           → a Univer snapshot → sheet-md v2 text through convert.js, the same path the grid uses to save.
//   export: sheet-md text → Univer model → .xlsx (xlsx-kit) or .csv (SheetJS).
//           When the workbook came from an .xlsx/.xlsm, Folio keeps the original package next to the note
//           (`source` in the workbook settings) and writes into a copy of it: the VBA project, pivot caches, OLE
//           objects, Power Query parts and everything else Folio does not model pass through byte for byte.
import * as XLSX from 'xlsx';
import { loadWorkbook, workbookToBytes } from 'xlsx-kit/io';
import { fromBuffer } from 'xlsx-kit/node';
import { createWorkbook, addWorksheet, getSheet, addDefinedName, makeDefinedName, listDefinedNames, removeDefinedName } from 'xlsx-kit/workbook';
import * as W from 'xlsx-kit/worksheet';
import * as S from 'xlsx-kit/styles';
import { toUniver, fromUniver } from '../core/convert.js';
import { addr, colName, toRange, fromRange, parseAddr } from '../core/a1.js';
import { BORDER } from '../core/style.js';

const PX_PER_CHAR = 7, PT_TO_PX = 4 / 3;
const isZip = (b) => b[0] === 0x50 && b[1] === 0x4b;
const hasVba = (b) => Buffer.from(b).includes(Buffer.from('xl/vbaProject.bin'));
const rgbOf = (c) => (c?.rgb && /^[0-9a-f]{6,8}$/i.test(c.rgb) ? '#' + c.rgb.slice(-6).toLowerCase() : null);
const argb = (hex) => ({ rgb: 'FF' + String(hex).replace('#', '').toUpperCase().padStart(6, '0').slice(-6) });
const H = { left: 1, center: 2, right: 3, justify: 4, general: 0 }, V = { top: 1, center: 2, middle: 2, bottom: 3 };
const HI = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify' }, VI = { 1: 'top', 2: 'center', 3: 'bottom' };
const BI = Object.fromEntries(Object.entries(BORDER).map(([k, v]) => [v, k]));
const XL_BORDER = { thin: 'thin', hair: 'hair', dotted: 'dotted', dashed: 'dashed', 'dash-dot': 'dashDot', 'dash-dot-dot': 'dashDotDot', double: 'double', medium: 'medium', 'medium-dashed': 'mediumDashed', 'medium-dash-dot': 'mediumDashDot', 'medium-dash-dot-dot': 'mediumDashDotDot', 'slant-dash-dot': 'slantDashDot', thick: 'thick' };
const XL_BORDER_IN = Object.fromEntries(Object.entries(XL_BORDER).map(([k, v]) => [v, k]));

/* ---------- xlsx-kit styles ⇄ Univer IStyleData ---------- */
export function styleFromXlsx(font, fill, border, align, numfmt) {
  const s = {};
  if (font) {
    if (font.bold) s.bl = 1; if (font.italic) s.it = 1; if (font.strike) s.st = { s: 1 };
    if (font.underline && font.underline !== 'none') s.ul = { s: 1 };
    if (font.name && font.name !== 'Calibri') s.ff = font.name;
    if (font.size && font.size !== 11) s.fs = font.size;
    const c = rgbOf(font.color); if (c && c !== '#000000') s.cl = { rgb: c };
  }
  if (fill?.kind === 'pattern' && fill.patternType === 'solid') { const c = rgbOf(fill.fgColor); if (c) s.bg = { rgb: c }; }
  if (border) {
    const bd = {};
    for (const [side, k] of [['top', 't'], ['bottom', 'b'], ['left', 'l'], ['right', 'r']]) {
      const x = border[side]; if (!x?.style) continue;
      bd[k] = { s: BORDER[XL_BORDER_IN[x.style] || 'thin'], cl: { rgb: rgbOf(x.color) || '#000000' } };
    }
    if (Object.keys(bd).length) s.bd = bd;
  }
  if (align) {
    if (H[align.horizontal]) s.ht = H[align.horizontal];
    if (V[align.vertical] && align.vertical !== 'bottom') s.vt = V[align.vertical];
    if (align.wrapText) s.tb = 3;
    if (align.textRotation) s.tr = { a: align.textRotation > 90 ? 90 - align.textRotation : align.textRotation };
  }
  if (numfmt && numfmt !== 'General') s.n = { pattern: numfmt };
  return Object.keys(s).length ? s : null;
}
export function styleToXlsx(u = {}) {
  const out = {};
  const font = {};
  if (u.bl) font.bold = true; if (u.it) font.italic = true; if (u.st?.s) font.strike = true; if (u.ul?.s) font.underline = 'single';
  if (u.ff) font.name = u.ff; if (u.fs) font.size = u.fs; if (u.cl?.rgb) font.color = argb(u.cl.rgb);
  if (Object.keys(font).length) out.font = S.makeFont({ name: 'Calibri', size: 11, ...font });
  if (u.bg?.rgb) out.fill = S.makePatternFill({ patternType: 'solid', fgColor: argb(u.bg.rgb) });
  if (u.bd) {
    const b = {};
    for (const [side, k] of [['top', 't'], ['bottom', 'b'], ['left', 'l'], ['right', 'r']]) { const x = u.bd[k]; if (x?.s) b[side] = S.makeSide({ style: XL_BORDER[BI[x.s]] || 'thin', color: argb(x.cl?.rgb || '#000000') }); }
    if (Object.keys(b).length) out.border = S.makeBorder(b);
  }
  const al = {};
  if (HI[u.ht]) al.horizontal = HI[u.ht]; if (VI[u.vt]) al.vertical = VI[u.vt]; if (u.tb === 3) al.wrapText = true;
  if (u.tr?.a) al.textRotation = u.tr.a < 0 ? 90 - u.tr.a : u.tr.a;
  if (Object.keys(al).length) out.align = S.makeAlignment(al);
  if (u.n?.pattern && u.n.pattern !== 'General') out.numfmt = u.n.pattern;
  return out;
}

/* ---------- import ---------- */
function emptySnapshot(name) { return { id: 'import', name, appVersion: '', locale: 'enUS', styles: {}, sheetOrder: [], sheets: {}, resources: [] }; }
function addSheet(snap, name) {
  const id = `sheet-${snap.sheetOrder.length + 1}`;
  snap.sheetOrder.push(id);
  return (snap.sheets[id] = { id, name, cellData: {}, columnData: {}, rowData: {}, mergeData: [], freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 }, defaultColumnWidth: 104, defaultRowHeight: 24, rowCount: 1000, columnCount: 26 });
}
const styleIds = new Map();
function styleRef(snap, st) { if (!st) return undefined; const k = JSON.stringify(st); let id = styleIds.get(k); if (!id || !snap.styles[id]) { id = `s${Object.keys(snap.styles).length + 1}`; snap.styles[id] = st; styleIds.set(k, id); } return id; }
const valueCell = (v) => (v == null ? null : typeof v === 'number' ? { v, t: 2 } : typeof v === 'boolean' ? { v: v ? 1 : 0, t: 3 } : v instanceof Date ? { v: excelDate(v), t: 2 } : { v: String(v), t: 1 });
const excelDate = (d) => d.getTime() / 864e5 + 25569;

/** .xlsx / .xlsm through xlsx-kit */
async function snapshotFromXlsx(bytes, name) {
  const wb = await loadWorkbook(fromBuffer(Buffer.from(bytes)));
  const snap = emptySnapshot(name); styleIds.clear();
  const dv = {}, notes = {};
  for (const ref of wb.sheets) {
    if (ref.kind !== 'worksheet') continue;
    const ws = ref.sheet, u = addSheet(snap, ws.title);
    let maxR = 0, maxC = 0;
    for (const cell of W.iterCells(ws)) {
      const r = cell.row - 1, c = cell.col - 1; maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
      const v = cell.value;
      let out = v && typeof v === 'object' && v.kind === 'formula' ? (v.t === 'shared' && !v.formula ? null : { f: '=' + v.formula })
        : v && typeof v === 'object' && v.kind === 'rich-text' ? { v: v.runs.map((x) => x.text).join(''), t: 1 }
        : v && typeof v === 'object' && v.kind === 'error' ? { v: v.code, t: 1 } : valueCell(v);
      const st = cell.styleId ? styleFromXlsx(S.getCellFont(wb, cell), S.getCellFill(wb, cell), S.getCellBorder(wb, cell), S.getCellAlignment(wb, cell), S.getCellNumberFormat(wb, cell)) : null;
      if (!out && !st) continue;
      out = { ...(out || {}) }; const s = styleRef(snap, st); if (s) out.s = s;
      (u.cellData[r] ||= {})[c] = out;
    }
    for (const m of W.getMergedCells(ws)) u.mergeData.push({ startRow: m.minRow - 1, endRow: m.maxRow - 1, startColumn: m.minCol - 1, endColumn: m.maxCol - 1, rangeType: 0 });
    const dims = ws.columnDimensions instanceof Map ? [...ws.columnDimensions.values()] : Object.values(ws.columnDimensions || {});
    for (const d of dims) { if (!d?.min) continue; for (let c = d.min; c <= Math.min(d.max, d.min + 200); c++) { const o = {}; if (d.width && d.customWidth !== false) o.w = Math.round(d.width * PX_PER_CHAR + 5); if (d.hidden) o.hd = 1; if (Object.keys(o).length) u.columnData[c - 1] = o; } }
    const rows = ws.rowDimensions instanceof Map ? [...ws.rowDimensions.entries()] : Object.entries(ws.rowDimensions || {});
    for (const [r, d] of rows) { const o = {}; if (d?.ht && d.customHeight) o.h = Math.round(d.ht * PT_TO_PX); if (d?.hidden) o.hd = 1; if (Object.keys(o).length) u.rowData[Number(r) - 1] = o; }
    const fz = W.getFreezePanes(ws); const p = fz && parseAddr(fz);
    if (p && (p[0] || p[1])) u.freeze = { xSplit: p[1], ySplit: p[0], startRow: p[0] || -1, startColumn: p[1] || -1 };
    const rules = W.listDataValidations(ws).map((x, k) => ({
      uid: `dv-${u.id}-${k}`, type: x.type === 'list' ? 'list' : x.type || 'custom', ...(x.operator ? { operator: x.operator } : {}),
      formula1: x.type === 'list' ? String(x.formula1 || '').replace(/^"|"$/g, '') : x.formula1, ...(x.formula2 ? { formula2: x.formula2 } : {}),
      ranges: (x.sqref?.ranges || []).map((g) => ({ startRow: g.minRow - 1, endRow: g.maxRow - 1, startColumn: g.minCol - 1, endColumn: g.maxCol - 1, rangeType: 0 })),
    })).filter((x) => x.ranges.length);
    if (rules.length) dv[u.id] = rules;
    for (const n of W.listComments(ws)) { const q = parseAddr(n.ref); if (q) ((notes[u.id] ||= {})[q[0]] ||= {})[q[1]] = { id: `note-${n.ref}`, row: q[0], col: q[1], width: 160, height: 72, note: n.text }; }
    u.rowCount = Math.max(1000, maxR + 100); u.columnCount = Math.max(26, maxC + 10);
  }
  const names = Object.fromEntries(listDefinedNames(wb).filter((n) => !n.name.startsWith('_xlnm')).map((n, k) => [`name-${k + 1}`, { id: `name-${k + 1}`, name: n.name, formulaOrRefString: '=' + String(n.value).replace(/^=/, ''), localSheetId: 'AllDefaultWorkbook' }]));
  snap.resources = [['SHEET_DATA_VALIDATION_PLUGIN', dv], ['SHEET_NOTE_PLUGIN', notes], ['SHEET_DEFINED_NAME_PLUGIN', names]].filter(([, v]) => Object.keys(v).length).map(([n, v]) => ({ name: n, data: JSON.stringify(v) }));
  return snap;
}

/** every other format through SheetJS */
function snapshotFromSheetJS(bytes, name, ext) {
  const opts = { type: 'buffer', cellFormula: true, cellNF: true, cellDates: false, dense: false };
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') Object.assign(opts, { type: 'string', raw: true, FS: ext === 'tsv' ? '\t' : undefined }); // raw: "1,5" stays text, never 15
  const input = opts.type === 'string' ? Buffer.from(bytes).toString('utf8').replace(/^﻿/, '') : Buffer.from(bytes);
  const wb = XLSX.read(input, opts);
  const snap = emptySnapshot(name); styleIds.clear();
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn], u = addSheet(snap, ext === 'csv' || ext === 'tsv' ? name.replace(/\.[^.]+$/, '') : sn);
    if (!ws['!ref']) continue;
    const rg = XLSX.utils.decode_range(ws['!ref']);
    for (let r = rg.s.r; r <= rg.e.r; r++) for (let c = rg.s.c; c <= rg.e.c; c++) {
      const x = ws[XLSX.utils.encode_cell({ r, c })]; if (!x) continue;
      if (opts.raw && x.t === 's' && /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(String(x.v).trim())) { x.t = 'n'; x.v = Number(String(x.v).trim()); }
      let out = x.f ? { f: '=' + x.f } : x.t === 'n' ? { v: x.v, t: 2 } : x.t === 'b' ? { v: x.v ? 1 : 0, t: 3 } : x.t === 'e' ? { v: x.w || '#ERROR', t: 1 } : x.v != null ? { v: String(x.v), t: 1 } : null;
      const fmt = x.z && x.z !== 'General' ? styleRef(snap, { n: { pattern: x.z } }) : null;
      if (!out && !fmt) continue; out = { ...(out || {}) }; if (fmt) out.s = fmt;
      (u.cellData[r] ||= {})[c] = out;
    }
    for (const m of ws['!merges'] || []) u.mergeData.push({ startRow: m.s.r, endRow: m.e.r, startColumn: m.s.c, endColumn: m.e.c, rangeType: 0 });
    (ws['!cols'] || []).forEach((col, c) => { if (col?.wpx || col?.wch) u.columnData[c] = { w: Math.round(col.wpx || col.wch * PX_PER_CHAR + 5) }; });
    u.rowCount = Math.max(1000, rg.e.r + 100); u.columnCount = Math.max(26, rg.e.c + 10);
  }
  return snap;
}

/** a style every used row of a column shares becomes the column's style, so imported files read like hand-written ones */
function hoistColumnStyles(snap) {
  for (const id of snap.sheetOrder) {
    const u = snap.sheets[id]; const rows = Object.keys(u.cellData).map(Number); if (rows.length < 3) continue;
    const maxR = Math.max(...rows), cols = new Set(rows.flatMap((r) => Object.keys(u.cellData[r]).map(Number)));
    for (const c of cols) {
      let s = undefined, same = true;
      for (let r = 1; r <= maxR && same; r++) { const x = u.cellData[r]?.[c]?.s; if (s === undefined) s = x; same = x != null && x === s; }
      if (!same || !s) continue;
      const head = u.cellData[0]?.[c];
      u.columnData[c] = { ...(u.columnData[c] || {}), s };
      for (let r = 1; r <= maxR; r++) delete u.cellData[r][c].s;
      if (head?.s === s) delete head.s;
    }
  }
}

/**
 * bytes of a spreadsheet file → { text, sheets, vba, keepSource }
 * keepSource: the package should be stored next to the note so export can write into it (xlsx with parts Folio does not model)
 */
export async function importFile(bytes, fileName) {
  const ext = String(fileName).split('.').pop().toLowerCase();
  const title = String(fileName).replace(/\.[^.]+$/, '');
  const ooxml = isZip(bytes) && ['xlsx', 'xlsm', 'xltx', 'xltm'].includes(ext);
  const snap = ooxml ? await snapshotFromXlsx(bytes, title) : snapshotFromSheetJS(bytes, title, ext);
  if (!snap.sheetOrder.length) addSheet(snap, 'Sheet1');
  hoistColumnStyles(snap);
  const vba = ooxml && hasVba(bytes);
  const intro = `# ${title}\n\nImported from ${fileName}${vba ? '. The macros (VBA) are kept with the file and written back when you export as .xlsm' : ''}.\n`;
  const loaded = toUniver(intro);
  const text = fromUniver(snap, loaded);
  return { text, sheets: snap.sheetOrder.map((id) => snap.sheets[id].name), vba, keepSource: ooxml };
}

/* ---------- export ---------- */
/** sheet-md text (+ optional original package and computed values) → .xlsx / .xlsm bytes */
export async function exportXlsx(text, { source = null, values = null } = {}) {
  const { data } = toUniver(text);
  const wb = source ? await loadWorkbook(fromBuffer(Buffer.from(source))) : createWorkbook();
  const res = Object.fromEntries((data.resources || []).map((r) => { try { return [r.name, JSON.parse(r.data)]; } catch { return [r.name, null]; } }));
  for (const id of data.sheetOrder) {
    const u = data.sheets[id];
    let ws = source ? getSheet(wb, u.name) : null;
    if (ws && ws.kind !== undefined) ws = ws.sheet;
    if (ws) { W.clearAllCells(ws); W.removeAllMergedRanges(ws); W.removeAllDataValidations(ws); }
    else ws = addWorksheet(wb, u.name);
    const computed = values?.[u.name];
    const styleOf = (s) => (typeof s === 'string' ? data.styles?.[s] : s) || null;
    // column and row styles apply to every used cell under them, as Excel stores them per cell
    const usedRows = Object.keys(u.cellData || {}).map(Number); const maxR = usedRows.length ? Math.max(...usedRows) : -1;
    const colSt = Object.fromEntries(Object.entries(u.columnData || {}).filter(([, o]) => o?.s).map(([c, o]) => [c, styleOf(o.s)]));
    const rowSt = Object.fromEntries(Object.entries(u.rowData || {}).filter(([, o]) => o?.s).map(([r, o]) => [r, styleOf(o.s)]));
    const grid = structuredClone(u.cellData || {});
    for (const c of Object.keys(colSt)) for (let r = 0; r <= maxR; r++) (grid[r] ||= {})[c] ||= {};
    for (const r of Object.keys(rowSt)) for (const c of Object.keys(grid[r] || {})) grid[r][c] ||= {};
    for (const [r, row] of Object.entries(grid)) for (const [c, cell0] of Object.entries(row || {})) {
      if (!cell0) continue;
      const own = styleOf(cell0.s);
      const cell = (colSt[c] || rowSt[r]) ? { ...cell0, s: { ...(colSt[c] || {}), ...(rowSt[r] || {}), ...(own || {}) } } : cell0;
      const R = Number(r) + 1, C = Number(c) + 1;
      let v = null;
      if (cell.f) { const cv = computed?.[r]?.[c]; v = { kind: 'formula', formula: cell.f.replace(/^=/, ''), t: 'normal', ...(cv != null && typeof cv !== 'object' ? { cachedValue: cv } : {}) }; }
      else if (cell.v != null) v = cell.t === 3 ? !!Number(cell.v) : cell.t === 2 ? Number(cell.v) : String(cell.v);
      const x = W.setCell(ws, R, C, v);
      const st = styleOf(cell.s);
      if (st) {
        const m = styleToXlsx(st);
        if (m.font) S.setCellFont(wb, x, m.font); if (m.fill) S.setCellFill(wb, x, m.fill); if (m.border) S.setCellBorder(wb, x, m.border);
        if (m.align) S.setCellAlignment(wb, x, m.align); if (m.numfmt) S.setCellNumberFormat(wb, x, m.numfmt);
      }
    }
    for (const m of u.mergeData || []) W.mergeCells(ws, fromRange(m));
    for (const [c, o] of Object.entries(u.columnData || {})) { if (o?.w) W.setColumnWidth(ws, Number(c) + 1, Math.max(1, Math.round((o.w - 5) / PX_PER_CHAR * 100) / 100)); if (o?.hd) W.hideColumn?.(ws, Number(c) + 1); }
    for (const [r, o] of Object.entries(u.rowData || {})) { if (o?.h) W.setRowHeight(ws, Number(r) + 1, Math.round(o.h / PT_TO_PX * 100) / 100); if (o?.hd) W.hideRow?.(ws, Number(r) + 1); }
    if (u.freeze?.xSplit > 0 || u.freeze?.ySplit > 0) W.setFreezePanes(ws, addr(u.freeze.ySplit || 0, u.freeze.xSplit || 0));
    for (const rule of res.SHEET_DATA_VALIDATION_PLUGIN?.[id] || []) {
      if (!['list', 'whole', 'decimal', 'date', 'time', 'textLength', 'custom'].includes(rule.type)) continue;
      try {
        W.addDataValidation(ws, W.makeDataValidation({ type: rule.type, sqref: (rule.ranges || []).map(fromRange).join(' '), ...(rule.operator ? { operator: rule.operator } : {}), formula1: rule.type === 'list' && !/^=/.test(rule.formula1 || '') ? `"${rule.formula1}"` : String(rule.formula1 || '').replace(/^=/, ''), ...(rule.formula2 ? { formula2: String(rule.formula2).replace(/^=/, '') } : {}), allowBlank: rule.allowBlank !== false }));
      } catch { /* a rule Excel cannot express is left out of the export */ }
    }
    for (const row of Object.values(res.SHEET_NOTE_PLUGIN?.[id] || {})) for (const n of Object.values(row || {})) if (n?.note) W.setComment(ws, { ref: addr(n.row, n.col), author: 'Folio', text: n.note });
  }
  if (!source) {
    for (const n of Object.values(res.SHEET_DEFINED_NAME_PLUGIN || {})) { try { addDefinedName(wb, makeDefinedName({ name: n.name, value: String(n.formulaOrRefString).replace(/^=/, '') })); } catch { /* invalid name */ } }
  } else {
    for (const n of Object.values(res.SHEET_DEFINED_NAME_PLUGIN || {})) { try { removeDefinedName(wb, n.name); } catch { /* not there */ } try { addDefinedName(wb, makeDefinedName({ name: n.name, value: String(n.formulaOrRefString).replace(/^=/, '') })); } catch { /* invalid */ } }
  }
  return new Uint8Array(await workbookToBytes(wb));
}

/** one sheet as CSV (values: computed grid, formulas are not written to CSV) */
export function exportCsv(grid, { sep = ',' } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(grid.map((r) => r.map((v) => (v == null ? '' : v))));
  return XLSX.utils.sheet_to_csv(ws, { FS: sep, blankrows: false });
}
/** a range of an xlsx file as a grid (FQL `from xlsx "file" sheet "Name"`) */
export function readXlsxGrid(bytes, sheet) {
  const wb = XLSX.read(Buffer.from(bytes), { type: 'buffer', cellDates: true });
  const name = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
}
export { colName };
