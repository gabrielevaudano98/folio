// Folio Sheets — the first screen of a big workbook, computed first.
//
// A workbook of 100k formulas takes Univer seconds to compute on first open (no values kept from an earlier one), and
// the cells on screen wait for all of it. Most of what is on screen needs very little: =D2*E2 needs D2 and E2. This
// module picks the formula cells of the first rows of a sheet and everything they read, transitively, and builds a
// small workbook with only those cells, at the same addresses, on sheets of the same names and sizes. The data engine
// computes that one in a moment; the window shows its values while the formula worker computes the whole workbook,
// whose values then replace them.
//
// Exact, not approximate: the same engine computes the same formulas on the same inputs at the same addresses. A
// formula is taken only when that holds for certain: every function in it is on a list of functions whose result
// depends only on their arguments (no volatile, reference-returning, spilling, sheet-aware, filter-aware or custom
// functions), it has no defined names, and every range it reads is bounded and small enough. Anything else, and the
// cell (and every cell that reads it) simply waits for the worker as before. Pure.
import { toRange } from './a1.js';
import { refsOf } from './refs.js';
import { expandShared } from './convert.js';

const PURE = new Set(('SUM SUMIF SUMIFS SUMPRODUCT SUMSQ AVERAGE AVERAGEA AVERAGEIF AVERAGEIFS MIN MINA MINIFS MAX MAXA MAXIFS COUNT COUNTA COUNTBLANK '
  + 'COUNTIF COUNTIFS PRODUCT MEDIAN MODE STDEV STDEVP STDEV.S STDEV.P VAR VARP VAR.S VAR.P LARGE SMALL RANK RANK.EQ PERCENTILE QUARTILE '
  + 'IF IFS IFERROR IFNA AND OR NOT XOR SWITCH CHOOSE TRUE FALSE ISBLANK ISNUMBER ISTEXT ISERROR ISERR ISNA ISLOGICAL ISEVEN ISODD NA '
  + 'ABS ROUND ROUNDUP ROUNDDOWN INT TRUNC MOD POWER SQRT EXP LN LOG LOG10 SIGN CEILING FLOOR MROUND QUOTIENT PI '
  + 'LEN LEFT RIGHT MID UPPER LOWER PROPER TRIM CLEAN CONCAT CONCATENATE TEXTJOIN REPT SUBSTITUTE REPLACE FIND SEARCH EXACT TEXT VALUE N T CHAR CODE '
  + 'DATE YEAR MONTH DAY HOUR MINUTE SECOND TIME WEEKDAY EDATE EOMONTH DATEDIF DAYS NETWORKDAYS WORKDAY '
  + 'VLOOKUP HLOOKUP MATCH LOOKUP').split(' '));
const FN = /([A-Za-z_][\w.]*)\s*\(/g;
const NAME = /(^|[^\w.$!:'"])([A-Za-z_][\w.]*)(?![\w.]*\s*[(!])/g; // a bare identifier: a defined name, TRUE/FALSE, or part of a cell reference

/** true when a formula's value depends only on the cells it names (see above) */
export function pureFormula(f) {
  const s = String(f || '').replace(/"(?:[^"]|"")*"/g, '""').replace(/'(?:[^']|'')+'!/g, 'S!');
  if (/[{}[\]#@]/.test(s)) return false; // arrays, structured references, errors and implicit intersection
  for (const m of s.matchAll(FN)) if (!PURE.has(m[1].toUpperCase())) return false;
  for (const m of s.matchAll(NAME)) { const w = m[2].toUpperCase(); if (w !== 'TRUE' && w !== 'FALSE' && !/^\$?[A-Z]{1,3}\$?\d+$/.test(w) && !/^[A-Z]{1,3}$/.test(w)) return false; }
  return true;
}

/**
 * The cells to compute first and the small workbook that computes them.
 * data: IWorkbookData (shared formulas allowed); sheetId: the sheet on screen; rows/cols: how much of it.
 * Returns { book, targets: { [sheetId]: ["r,c", …] }, cells } or null when nothing qualifies.
 */
export function previewBook(data, { sheetId, rows = 100, cols = 40, maxCells = 20000, maxRange = 5000 } = {}) {
  const sheets = data?.sheets || {};
  const sheet = sheets[sheetId]; if (!sheet) return null;
  if (hasNames(data)) return null;
  const byName = new Map(Object.values(sheets).map((s) => [String(s.name).toLowerCase(), s.id]));
  const resolvers = new Map();
  const cellAt = (sid, r, c) => {
    const cd = sheets[sid]?.cellData; const cell = cd?.[r]?.[c]; if (!cell) return null;
    let res = resolvers.get(sid); if (!res) resolvers.set(sid, (res = expandShared(cd)));
    return res(r, c, cell);
  };
  const key = (sid, r, c) => `${sid}\u0000${r}\u0000${c}`;
  const verdict = new Map(); // key -> true (computable, with everything it reads) | false
  const take = new Map(); // key -> [sid, r, c, cell]
  // precedents of one formula cell, or null when it cannot be taken
  const reads = (sid, cell) => {
    if (!pureFormula(cell.f)) return null;
    const out = [];
    for (const ref of refsOf(cell.f)) {
      const target = ref.sheet == null ? sid : byName.get(String(ref.sheet).toLowerCase());
      if (target == null) return null;
      let rg; try { rg = toRange(ref.range); } catch { return null; }
      if (rg.rangeType) return null;
      const n = (rg.endRow - rg.startRow + 1) * (rg.endColumn - rg.startColumn + 1);
      if (n > maxRange) return null;
      const cd = sheets[target].cellData || {};
      for (let r = rg.startRow; r <= rg.endRow; r++) { const row = cd[r]; if (!row) continue; for (let c = rg.startColumn; c <= rg.endColumn; c++) if (row[c]) out.push([target, r, c]); }
    }
    return out;
  };
  // iterative depth-first walk: chains of formulas can be long (running totals)
  const judge = (sid0, r0, c0) => {
    const k0 = key(sid0, r0, c0);
    if (verdict.has(k0)) return verdict.get(k0);
    const stack = [[sid0, r0, c0, null, 0]];
    const onStack = new Set([k0]);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [sid, r, c] = top; const k = key(sid, r, c);
      if (top[3] === null) {
        const cell = cellAt(sid, r, c);
        if (!cell || (!cell.f && !cell.si)) { verdict.set(k, true); take.set(k, [sid, r, c, cell]); stack.pop(); onStack.delete(k); continue; }
        const deps = cell.f ? reads(sid, cell) : null;
        if (!deps) { verdict.set(k, false); stack.pop(); onStack.delete(k); continue; }
        top[3] = deps; top[4] = 0; top[5] = cell;
      }
      const deps = top[3];
      let pushed = false, bad = false;
      while (top[4] < deps.length) {
        const [ds, dr, dc] = deps[top[4]]; const dk = key(ds, dr, dc);
        if (verdict.has(dk)) { if (!verdict.get(dk)) { bad = true; break; } top[4]++; continue; }
        if (onStack.has(dk)) { bad = true; break; } // a circular reference: Univer's answer depends on more than this
        if (take.size + stack.length > maxCells) { bad = true; break; }
        stack.push([ds, dr, dc, null, 0]); onStack.add(dk); pushed = true; break;
      }
      if (pushed) continue;
      verdict.set(k, !bad); if (!bad) take.set(k, [sid, r, c, top[5]]);
      stack.pop(); onStack.delete(k);
    }
    return verdict.get(k0);
  };

  const targets = {}; let found = 0;
  const cd = sheet.cellData || {};
  for (let r = 0; r < rows; r++) {
    const row = cd[r]; if (!row) continue;
    for (let c = 0; c < cols; c++) {
      const cell = row[c]; if (!cell || (!cell.f && !cell.si) || cell.v != null) continue;
      if (judge(sheetId, r, c)) { (targets[sheetId] ||= []).push(`${r},${c}`); found++; }
      if (take.size > maxCells) break;
    }
  }
  if (!found) return null;
  const book = { id: 'folio-preview', name: 'preview', appVersion: data.appVersion || '1', locale: data.locale, styles: {}, sheetOrder: [...(data.sheetOrder || Object.keys(sheets))], sheets: {} };
  for (const s of Object.values(sheets)) book.sheets[s.id] = { id: s.id, name: s.name, rowCount: s.rowCount, columnCount: s.columnCount, cellData: {} };
  for (const [sid, r, c, cell] of take.values()) {
    const out = cell.f ? { f: cell.f } : { v: cell.v, ...(cell.t != null ? { t: cell.t } : {}) };
    (book.sheets[sid].cellData[r] ||= {})[c] = out;
  }
  return { book, targets, cells: take.size };
}
function hasNames(data) {
  const res = (data.resources || []).find((x) => x.name === 'SHEET_DEFINED_NAME_PLUGIN');
  if (!res) return false;
  try { const o = typeof res.data === 'string' ? JSON.parse(res.data || '{}') : res.data; return o && Object.keys(o).length > 0; } catch { return true; }
}
