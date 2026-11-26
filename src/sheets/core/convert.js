// Folio Sheets — sheet-md v2 ⇄ Univer IWorkbookData. Pure: the window, the data engine, the CLI and tests share it.
//
// Lossless rule: a sheet that the person did not change is written back exactly as it was read. We compare the
// sheet as Univer holds it now with the same sheet converted at load time (the baseline), not with the file text,
// so differences in how a value can be written (":---:" or {"align":"center"}) never rewrite an untouched sheet.
import { addr, colName, colIndex, parseAddr, toRange, fromRange, toRanges, fromRanges } from './a1.js';
import { toUniverStyle, fromUniverStyle, styleDiff, isEmpty } from './style.js';
import { readDoc, sheetsOf, setWorkbook, serializeDoc } from './sheetmd.js';
import { shiftFormula } from '../../renderer/sheet-core.js';
import { readCell, writeText } from './cell-text.js';

export const RES = { dv: 'SHEET_DATA_VALIDATION_PLUGIN', cf: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', notes: 'SHEET_NOTE_PLUGIN', filter: 'SHEET_FILTER_PLUGIN', names: 'SHEET_DEFINED_NAME_PLUGIN' };
/** meta keys that live in Univer's model; every other key (charts, slicers, print, protect, view…) is Folio's own */
export const UNIVER_KEYS = new Set(['cols', 'cells', 'rows', 'merges', 'freeze', 'tab', 'hidden', 'gridlines', 'zoom', 'validation', 'cf', 'notes', 'filter']);
const ALIGN = { left: 1, center: 2, right: 3 };

/* ---------- values ---------- */
// how a value is written in a table cell lives in cell-text.js (apostrophe rule, entities for edge blanks and <br>)
/** markdown cell text → Univer cell (value part only) */
export const cellFromRaw = (raw) => readCell(raw);
/** Univer cell → markdown cell text (formulas stay formulas; values of formulas are never stored) */
export function rawFromCell(cell) {
  if (!cell) return '';
  if (cell.f) return cell.f;
  let v = cell.v;
  if ((v == null || v === '') && cell.p?.body?.dataStream) v = cell.p.body.dataStream.replace(/\r?\n$/, '').replace(/\r\n?/g, '\n');
  if (v == null) return '';
  if (cell.t === 3 || typeof v === 'boolean') return v === true || v === 1 || v === '1' || v === 'TRUE' ? 'TRUE' : 'FALSE';
  if (cell.t === 2 || typeof v === 'number') { const n = Number(v); if (Number.isFinite(n)) return String(n); }
  return writeText(String(v));
}

/* ---------- shared formulas ---------- */
// Down a column, =D2*E2, =D3*E3, =D4*E4… are one formula moved row by row. Univer (like Excel) can hold them as one
// shared formula (`si`): it parses it once, which is what keeps a sheet of 50k such rows quick to recalculate. A run is
// shared only when the formula is simple enough that Folio and Univer move it the same way (checked here), and only
// when moving the first one gives each next one exactly as written, so the file is written back unchanged.
const REF_AT = /(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g;
export function shareable(f) {
  if (typeof f !== 'string' || f.length < 3 || !f.startsWith('=')) return false;
  if (!/^=[A-Z0-9$:+\-*/^&(),.<>= %]+$/.test(f)) return false;               // no text, sheet names, names in lowercase, arrays
  if (/\d[E]\d/.test(f) || /(^|[^A-Z$])\$?\d+\s*:\s*\$?\d+/.test(f)) return false; // 1E5, whole rows (2:2)
  for (const m of f.matchAll(REF_AT)) if (/[A-Z0-9_.$]/.test(f[m.index - 1] || '') && f[m.index - 1] !== '$') return false; // a reference inside a longer word
  return true;
}
function shareFormulas(cellData, prefix) {
  const byCol = new Map();
  for (const [r, row] of Object.entries(cellData)) for (const [c, cell] of Object.entries(row)) if (cell.f) (byCol.get(+c) || byCol.set(+c, []).get(+c)).push(+r);
  let n = 0;
  for (const [c, rows] of byCol) {
    rows.sort((a, b) => a - b);
    let root = null, len = 0;
    const end = () => { if (root && len < 2) delete cellData[root.r][c].si; root = null; len = 0; };
    for (const r of rows) {
      const cell = cellData[r][c];
      if (root && r === root.last + 1 && shiftFormula(root.f, r - root.r, 0) === cell.f) { cell.si = root.si; delete cell.f; root.last = r; len++; continue; }
      end();
      if (shareable(cell.f)) { root = { r, f: cell.f, last: r, si: `${prefix}-${++n}` }; cell.si = root.si; len = 1; }
    }
    end();
  }
}

/* ---------- md → Univer ---------- */
const sheetId = (i) => `sheet-${i + 1}`;

/** sheet-md text → { data: IWorkbookData, doc, baseline } */
/**
 * `share`: hand runs of the same formula to Univer as shared formulas (faster recalculation). Only for data that goes
 * into a Univer instance: cells of a shared run carry `si` and no `f`, so code that reads cellData itself leaves it off.
 */
export function toUniver(text, { id = 'folio-wb', name = 'Workbook', share = false } = {}) {
  const doc = readDoc(text);
  const sheets = sheetsOf(doc);
  const data = { id, name, appVersion: '1', locale: 'enUS', styles: {}, sheetOrder: [], sheets: {}, resources: [] };
  const res = { dv: {}, cf: {}, notes: {}, filter: {} };
  let sid = 0; const styleIds = new Map();
  const styleRef = (st) => { const u = toUniverStyle(st); if (!u) return undefined; const k = JSON.stringify(u); if (!styleIds.has(k)) { const i = `s${++sid}`; styleIds.set(k, i); data.styles[i] = u; } return styleIds.get(k); };

  sheets.forEach((b, i) => {
    const id = sheetId(i), m = b.meta || {};
    data.sheetOrder.push(id);
    const colStyle = (c) => { const base = { ...(b.align?.[c] && ALIGN[b.align[c]] ? { align: b.align[c] } : {}) }; const cm = m.cols?.[colName(c)]; if (cm) { const { width, hidden, ...st } = cm; Object.assign(base, st); } return base; };
    const rowStyle = (r) => { const rm = m.rows?.[r + 1]; if (!rm) return {}; const { height, hidden, ...st } = rm; return st; };
    const cellData = {};
    const ncol = b.rows.reduce((n, r) => Math.max(n, r.length), 0); // not Math.max(...rows): 100k+ arguments overflow the stack
    const put = (r, c, cell) => { (cellData[r] ||= {})[c] = cell; };
    b.rows.forEach((row, r) => row.forEach((raw, c) => { const v = cellFromRaw(raw); if (v) put(r, c, v); }));
    if (share) shareFormulas(cellData, `fs${i + 1}`);
    // styles: a cell gets column ⊕ row ⊕ its own style, so Univer shows exactly what sheet-md says. Ids are memoised
    // per column (cells with no style of their own and no row style, nearly all of them), so 100k cells cost little.
    const styledCols = new Set([...Object.keys(m.cols || {}).map(colIndex), ...(b.align || []).map((a, c) => (a ? c : -1)).filter((c) => c >= 0)]);
    const cellsMeta = new Map();
    for (const [a, v] of Object.entries(m.cells || {})) { const p = parseAddr(a); if (p) cellsMeta.set(p[0] * 20000 + p[1], v); }
    const styledRows = new Set(Object.keys(m.rows || {}).map((rk) => Number(rk) - 1).filter((r) => { const { height, hidden, ...st } = m.rows[r + 1] || {}; return Object.keys(st).length; }));
    const colRef = new Map();
    const refOf = (r, c) => {
      const own = cellsMeta.get(r * 20000 + c);
      if (!own && !styledRows.has(r)) { if (!colRef.has(c)) colRef.set(c, styleRef(colStyle(c))); return [colRef.get(c), undefined]; }
      const { data: custom, ...ownStyle } = own || {};
      return [styleRef({ ...colStyle(c), ...rowStyle(r), ...ownStyle }), custom];
    };
    const touch = new Set();
    for (const r of Object.keys(cellData)) for (const c of Object.keys(cellData[r])) touch.add(+r * 20000 + +c);
    for (const k of cellsMeta.keys()) touch.add(k);
    for (const rk of Object.keys(m.rows || {})) for (let c = 0; c < ncol; c++) touch.add((Number(rk) - 1) * 20000 + c);
    for (const c of styledCols) for (let r = 0; r < b.rows.length; r++) touch.add(r * 20000 + c);
    for (const key of touch) {
      const r = Math.floor(key / 20000), c = key % 20000;
      const [s, custom] = refOf(r, c);
      if (!s && !custom) continue;
      const cell = cellData[r]?.[c] || {};
      if (s) cell.s = s;
      if (custom) cell.custom = { folio: custom };
      put(r, c, cell);
    }
    const columnData = {};
    for (const [cn, cm] of Object.entries(m.cols || {})) { const c = colIndex(cn), o = {}; if (cm.width) o.w = cm.width; if (cm.hidden) o.hd = 1; const s = styleRef(colStyle(c)); if (s) o.s = s; if (Object.keys(o).length) columnData[c] = o; }
    for (const c of styledCols) if (!columnData[c]) { const s = styleRef(colStyle(c)); if (s) columnData[c] = { s }; }
    const rowData = {};
    for (const [rn, rm] of Object.entries(m.rows || {})) { const o = {}; if (rm.height) o.h = rm.height; if (rm.hidden) o.hd = 1; const s = styleRef(rowStyle(Number(rn) - 1)); if (s) o.s = s; if (Object.keys(o).length) rowData[Number(rn) - 1] = o; }
    const ws = {
      id, name: b.name, cellData, columnData, rowData, tabColor: m.tab || '', hidden: m.hidden ? 1 : 0,
      rowCount: Math.max(1000, b.rows.length + 100), columnCount: Math.max(26, ncol + 10),
      defaultColumnWidth: 104, defaultRowHeight: 24, showGridlines: m.gridlines === false ? 0 : 1, zoomRatio: m.zoom || 1,
      mergeData: (m.merges || []).map((a) => ({ ...toRange(a), sheetId: id, unitId: data.id })),
      freeze: m.freeze ? { xSplit: m.freeze.cols || 0, ySplit: m.freeze.rows || 0, startRow: m.freeze.rows ? m.freeze.rows : -1, startColumn: m.freeze.cols ? m.freeze.cols : -1 } : { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
    };
    data.sheets[id] = ws;
    const rng = (s) => toRanges(s).map((r) => ({ ...r, unitId: data.id, sheetId: id }));
    if (m.validation?.length) res.dv[id] = m.validation.map(({ range, ...rule }, k) => ({ uid: rule.uid || `dv-${i + 1}-${k + 1}`, ...rule, ranges: rng(range) }));
    if (m.cf?.length) res.cf[id] = m.cf.map(({ range, id: cfId, ...rest }, k) => ({ cfId: cfId || `cf-${i + 1}-${k + 1}`, stopIfTrue: false, ...rest, ranges: rng(range) }));
    if (m.notes) { const o = {}; for (const [a, n] of Object.entries(m.notes)) { const p = parseAddr(a); if (!p) continue; const note = typeof n === 'string' ? { note: n } : n; (o[p[0]] ||= {})[p[1]] = { id: `note-${a}`, row: p[0], col: p[1], width: 160, height: 72, ...note }; } res.notes[id] = o; }
    if (m.filter) res.filter[id] = { ref: toRange(m.filter.range), filterColumns: m.filter.columns || [], cachedFilteredOut: [] };
  });

  const wb = doc.workbook || {};
  const names = Object.entries(wb.names || {}).map(([n, v], k) => { const o = typeof v === 'string' ? { ref: v } : v; const local = o.sheet ? data.sheetOrder.find((id) => data.sheets[id].name === o.sheet) : null; return [`name-${k + 1}`, { id: `name-${k + 1}`, name: n, formulaOrRefString: o.ref, localSheetId: local || 'AllDefaultWorkbook', ...(o.comment ? { comment: o.comment } : {}) }]; });
  const resources = { [RES.dv]: res.dv, [RES.cf]: res.cf, [RES.notes]: res.notes, [RES.filter]: res.filter, [RES.names]: Object.fromEntries(names) };
  for (const [k, v] of Object.entries(wb.univer || {})) resources[k] = v;
  data.resources = Object.entries(resources).filter(([, v]) => v && Object.keys(v).length).map(([name, v]) => ({ name, data: JSON.stringify(v) }));
  // the baseline is needed at the first save, not to show the file: it is computed then, from the same text (the data
  // object itself belongs to Univer by then and may have changed)
  const out = { data, doc };
  let base = null;
  Object.defineProperty(out, 'baseline', { enumerable: true, get: () => (base ||= canonicalOf(toUniver(text, { id, name, share }).data)) });
  /** a baseline computed elsewhere (the formula worker, from the same text: baselineOf(text)), so no save waits for it */
  out.provideBaseline = (b) => { if (!base && b?.sheets && typeof b.workbook === 'string') { base = b; out.baselineFrom = 'elsewhere'; } };
  return out;
}

/* ---------- Univer → md ---------- */
function parseRes(snapshot) {
  const out = {};
  for (const r of snapshot.resources || []) { try { const v = typeof r.data === 'string' ? (r.data ? JSON.parse(r.data) : null) : r.data; if (v && Object.keys(v).length) out[r.name] = v; } catch { /* unreadable: dropped */ } }
  return out;
}
const styleOf = (snap, s) => (s == null ? null : typeof s === 'string' ? snap.styles?.[s] : s);

/** a snapshot whose shared formulas (si, from Univer or from toUniver's `share`) are written out on every cell */
export function expandSharedFormulas(snap) {
  const out = { ...snap, sheets: {} };
  for (const [id, ws] of Object.entries(snap.sheets || {})) {
    const shared = expandShared(ws.cellData);
    const cd = {};
    for (const [r, row] of Object.entries(ws.cellData || {})) { cd[r] = {}; for (const [c, cell] of Object.entries(row || {})) cd[r][c] = shared(+r, +c, cell); }
    out.sheets[id] = { ...ws, cellData: cd };
  }
  return out;
}
/** formulas shared by Univer (si) written out as ordinary formulas */
// moved formulas are remembered between saves: the window saves the same 50k shared cells again and again
const SHIFTED = new Map();
const shifted = (f, dr, dc) => {
  const k = `${dr},${dc},${f}`; let v = SHIFTED.get(k);
  if (v === undefined) { if (SHIFTED.size > 400000) SHIFTED.clear(); v = shiftFormula(f, dr, dc); SHIFTED.set(k, v); }
  return v;
};
function expandShared(cellData) {
  const roots = new Map();
  for (const r in cellData || {}) { const row = cellData[r]; for (const c in row || {}) { const cell = row[c]; if (cell?.si && cell.f) roots.set(cell.si, { f: cell.f, r: Number(r), c: Number(c) }); } }
  if (!roots.size) return (r, c, cell) => cell;
  return (r, c, cell) => { if (!cell || cell.f || !cell.si) return cell; const o = roots.get(cell.si); return o ? { ...cell, f: shifted(o.f, r - o.r, c - o.c) } : cell; };
}

/** one Univer worksheet → { name, rows, align, meta } */
export function sheetFromUniver(snap, ws, res) {
  const cd = ws.cellData || {};
  const shared = expandShared(cd);
  // one pass: each cell's text is computed once (a 50k-row sheet has 350k of them)
  let maxR = -1, maxC = -1; const raws = [];
  for (const r in cd) {
    const row = cd[r]; if (!row) continue; const R = +r;
    for (const c in row) {
      const cell = row[c]; const C = +c; const raw = rawFromCell(shared(R, C, cell));
      if (raw !== '' || cell?.s || cell?.custom) { if (R > maxR) maxR = R; if (C > maxC) maxC = C; }
      if (raw !== '') (raws[R] ||= [])[C] = raw;
    }
  }
  const rows = new Array(Math.max(maxR, 0) + 1);
  for (let r = 0; r < rows.length; r++) { const row = new Array(Math.max(maxC, 0) + 1).fill(''); const src = raws[r]; if (src) for (const c in src) if (+c < row.length) row[c] = src[c]; rows[r] = row; }
  // trailing empty rows/columns that only carried a style stay in the table: the style needs a cell to live on
  const meta = {};
  const cols = {}, align = [];
  const colSt = {};
  for (const [c, o] of Object.entries(ws.columnData || {})) {
    const st = fromUniverStyle(styleOf(snap, o?.s));
    colSt[c] = st;
    const { align: a, ...rest } = st;
    if (a && ALIGN[a] && +c <= maxC) align[+c] = a; else if (a) rest.align = a;
    const e = { ...(o?.w && o.w !== (ws.defaultColumnWidth || 104) ? { width: Math.round(o.w) } : {}), ...(o?.hd ? { hidden: true } : {}), ...rest };
    if (!isEmpty(e)) cols[colName(+c)] = e;
  }
  for (let c = 0; c < align.length; c++) if (align[c] === undefined) align[c] = '';
  if (!isEmpty(cols)) meta.cols = cols;
  const rowsMeta = {}, rowSt = {};
  for (const [r, o] of Object.entries(ws.rowData || {})) {
    const st = fromUniverStyle(styleOf(snap, o?.s)); rowSt[r] = st;
    const e = { ...(o?.h && o.h !== (ws.defaultRowHeight || 24) && !o.ia ? { height: Math.round(o.h) } : {}), ...(o?.hd ? { hidden: true } : {}), ...st };
    if (!isEmpty(e)) rowsMeta[+r + 1] = e;
  }
  const cells = {};
  // what a cell adds to its column and row, memoised by (style id, column, styled row): most cells share a few styles
  const ownMemo = new Map();
  const ownStyle = (s, r, c) => {
    const key = typeof s === 'string' ? `${s}|${c}|${rowSt[r] ? r : ''}` : null;
    if (key && ownMemo.has(key)) return ownMemo.get(key);
    const st = fromUniverStyle(styleOf(snap, s));
    const base = { ...(align[+c] ? { align: align[+c] } : {}), ...(colSt[c] || {}), ...(rowSt[r] || {}) };
    const own = styleDiff(st, base);
    // a key the column sets but this cell clears
    for (const k of Object.keys(base)) if (!(k in st) && k !== 'align') own[k] = k === 'border' ? {} : false;
    if (key) ownMemo.set(key, own);
    return own;
  };
  for (const [r, row] of Object.entries(cd)) for (const [c, cell] of Object.entries(row || {})) {
    if (!cell) continue;
    let own = cell.s ? ownStyle(cell.s, r, c) : null;
    if (cell.custom?.folio) own = { ...own, data: cell.custom.folio };
    if (own && !isEmpty(own)) cells[addr(+r, +c)] = own;
  }
  if (!isEmpty(cells)) meta.cells = sortCells(cells);
  if (!isEmpty(rowsMeta)) meta.rows = rowsMeta;
  if (ws.mergeData?.length) meta.merges = ws.mergeData.map(fromRange);
  const fz = ws.freeze;
  if (fz && (fz.xSplit > 0 || fz.ySplit > 0)) meta.freeze = { ...(fz.ySplit > 0 ? { rows: fz.ySplit } : {}), ...(fz.xSplit > 0 ? { cols: fz.xSplit } : {}) };
  if (ws.tabColor) meta.tab = ws.tabColor;
  if (ws.hidden) meta.hidden = true;
  if (ws.showGridlines === 0) meta.gridlines = false;
  if (ws.zoomRatio && ws.zoomRatio !== 1) meta.zoom = ws.zoomRatio;
  const id = ws.id;
  const dv = res[RES.dv]?.[id];
  if (dv?.length) meta.validation = dv.map(({ uid, ranges, ...rule }) => ({ range: fromRanges(ranges), ...clean(rule) }));
  const cf = res[RES.cf]?.[id];
  if (cf?.length) meta.cf = cf.map(({ cfId, ranges, stopIfTrue, ...rest }) => ({ range: fromRanges(ranges), ...(stopIfTrue ? { stopIfTrue } : {}), ...rest }));
  const notes = res[RES.notes]?.[id];
  if (notes) { const o = {}; for (const row of Object.values(notes)) for (const n of Object.values(row || {})) { if (!n?.note) continue; const extra = clean({ ...(n.width !== 160 ? { width: n.width } : {}), ...(n.height !== 72 ? { height: n.height } : {}), ...(n.show ? { show: true } : {}) }); o[addr(n.row, n.col)] = isEmpty(extra) ? n.note : { note: n.note, ...extra }; } if (!isEmpty(o)) meta.notes = sortCells(o); }
  const flt = res[RES.filter]?.[id];
  if (flt?.ref) meta.filter = { range: fromRange(flt.ref), ...(flt.filterColumns?.length ? { columns: flt.filterColumns } : {}) };
  return { name: ws.name, rows, align, meta };
}
/** charts, slicers and buttons float over the grid as Univer DOM drawings; Folio keeps them in sheet meta, not twice */
function withoutFolioDoms(v) {
  const out = {};
  for (const [sheet, d] of Object.entries(v || {})) {
    const data = Object.fromEntries(Object.entries(d?.data || {}).filter(([, x]) => !String(x?.componentKey || '').startsWith('folio-')));
    if (Object.keys(data).length) out[sheet] = { ...d, data, order: (d.order || []).filter((id) => id in data) };
  }
  return out;
}
/** {} or { files: {}, objects: {} }: a plugin's resource that holds nothing (Univer's OLE attachments write one) */
const deepEmpty = (v) => v == null || (Array.isArray(v) ? v.every(deepEmpty) : typeof v === 'object' ? Object.values(v).every(deepEmpty) : false);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const cellKey = (a) => { const p = parseAddr(a) || [0, 0]; return p[0] * 20000 + p[1]; };
const sortCells = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => cellKey(a[0]) - cellKey(b[0])));

function workbookFromUniver(snap, res) {
  const wb = {};
  const names = res[RES.names];
  if (names) { const o = {}; for (const n of Object.values(names)) { const sheet = n.localSheetId && n.localSheetId !== 'AllDefaultWorkbook' ? snap.sheets?.[n.localSheetId]?.name : null; o[n.name] = sheet || n.comment ? clean({ ref: n.formulaOrRefString, sheet, comment: n.comment }) : n.formulaOrRefString; } if (!isEmpty(o)) wb.names = o; }
  const known = new Set(Object.values(RES));
  const pass = {};
  for (const [k, v] of Object.entries(res)) if (!known.has(k) && !/MOCK|_UI_PLUGIN$|PROTECTION|RANGE_THEME/i.test(k) && !deepEmpty(v)) pass[k] = k === 'SHEET_DRAWING_PLUGIN' ? withoutFolioDoms(v) : v;
  for (const k of Object.keys(pass)) if (deepEmpty(pass[k])) delete pass[k];
  if (!isEmpty(pass)) wb.univer = pass;
  return wb;
}

/** the baseline toUniver(text) would compute at the first save; pure, so a worker can do it */
export const baselineOf = (text, opts = {}) => canonicalOf(toUniver(text, opts).data);
/** canonical, comparable form of a snapshot: one JSON per sheet id plus the workbook part */
export function canonicalOf(snap) {
  const res = parseRes(snap);
  const out = { sheets: {}, workbook: JSON.stringify(workbookFromUniver(snap, res)) };
  for (const id of snap.sheetOrder) out.sheets[id] = JSON.stringify(sheetFromUniver(snap, snap.sheets[id], res));
  return out;
}

/**
 * Write a Univer snapshot back into the document it came from. Untouched sheets keep their exact text.
 * `loaded` is what toUniver() returned for that document.
 */
export function fromUniver(snap, loaded, { sheetMeta = {}, workbook = null, dirty = null, cache = null } = {}) {
  // `dirty` (Set of sheet ids, '*' for all) and `cache` (Map kept by the caller) let the window skip sheets nothing
  // changed since its last save: their block from that save is reused as is.
  const { doc, baseline } = loaded;
  const res = parseRes(snap);
  const oldSheets = sheetsOf(doc);
  const byId = new Map(oldSheets.map((b, i) => [sheetId(i), b]));
  const reuse = cache && dirty && !dirty.has('*');
  const next = snap.sheetOrder.map((id) => {
    const old = byId.get(id);
    const own = { ...folioMeta(old?.meta), ...(sheetMeta[id] || {}) };
    const ownKey = cache ? JSON.stringify(own) : '';
    if (reuse && !dirty.has(id) && cache.get(id)?.own === ownKey && cache.get(id).name === snap.sheets[id].name) return cache.get(id).block;
    const block = sheetBlock(id, old, own);
    cache?.set(id, { own: ownKey, name: snap.sheets[id].name, block });
    return block;
  });
  function sheetBlock(id, old, own) {
    const cur = JSON.stringify(sheetFromUniver(snap, snap.sheets[id], res));
    const ownSame = JSON.stringify(dropEmpty(own)) === JSON.stringify(dropEmpty(folioMeta(old?.meta)));
    if (old && baseline.sheets[id] === cur && ownSame) return old;
    const s = JSON.parse(cur);
    const meta = { ...s.meta, ...dropEmpty(own) };
    return { type: 'sheet', name: s.name, named: old ? old.named || old.name !== s.name : true, headingLines: old && old.name === s.name ? old.headingLines : [], rows: s.rows.length ? s.rows : [['']], align: s.align, meta };
  }
  // sheets take the slots the old sheets had; extra sheets go after the last one; removed sheets leave
  const blocks = []; let k = 0;
  const lastSheet = doc.blocks.reduce((a, b, i) => (b.type === 'sheet' ? i : a), -1);
  doc.blocks.forEach((b, i) => {
    if (b.type !== 'sheet') { blocks.push(b); return; }
    if (k < next.length) blocks.push(next[k++]);
    if (i === lastSheet) while (k < next.length) blocks.push(next[k++]);
  });
  while (k < next.length) blocks.push(next[k++]);
  const out = { ...doc, blocks };
  const wbNow = workbookFromUniver(snap, res);
  const wbOwn = workbook ? dropEmpty(workbook) : stripUniverKeys(doc.workbook);
  if (JSON.stringify(wbNow) !== baseline.workbook || JSON.stringify(wbOwn) !== JSON.stringify(stripUniverKeys(doc.workbook))) setWorkbook(out, { ...wbOwn, ...wbNow });
  return serializeDoc(out);
}
/** meta keys sheet-md v2 does not know (written by a newer Folio or by hand) survive edits */
export const folioMeta = (m) => Object.fromEntries(Object.entries(m || {}).filter(([k]) => !UNIVER_KEYS.has(k)));
const dropEmpty = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) && !(Array.isArray(v) && !v.length)));
const stripUniverKeys = (wb) => Object.fromEntries(Object.entries(wb || {}).filter(([k]) => k !== 'names' && k !== 'univer'));

/** for tests and the data engine: text → text through Univer's model, without a Univer instance */
export const roundTrip = (text) => { const l = toUniver(text); return fromUniver(JSON.parse(JSON.stringify(l.data)), l); };
