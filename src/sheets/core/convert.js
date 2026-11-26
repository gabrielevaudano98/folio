// Folio Sheets — sheet-md v2 ⇄ Univer IWorkbookData. Pure: the window, the data engine, the CLI and tests share it.
//
// Lossless rule: a sheet that the person did not change is written back exactly as it was read. We compare the
// sheet as Univer holds it now with the same sheet converted at load time (the baseline), not with the file text,
// so differences in how a value can be written (":---:" or {"align":"center"}) never rewrite an untouched sheet.
import { addr, colName, colIndex, parseAddr, toRange, fromRange, toRanges, fromRanges } from './a1.js';
import { toUniverStyle, fromUniverStyle, styleDiff, isEmpty } from './style.js';
import { readDoc, sheetsOf, setWorkbook, serializeDoc } from './sheetmd.js';
import { shiftFormula } from '../../renderer/sheet-core.js';

export const RES = { dv: 'SHEET_DATA_VALIDATION_PLUGIN', cf: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', notes: 'SHEET_NOTE_PLUGIN', filter: 'SHEET_FILTER_PLUGIN', names: 'SHEET_DEFINED_NAME_PLUGIN' };
/** meta keys that live in Univer's model; every other key (charts, slicers, print, protect, view…) is Folio's own */
export const UNIVER_KEYS = new Set(['cols', 'cells', 'rows', 'merges', 'freeze', 'tab', 'hidden', 'gridlines', 'zoom', 'validation', 'cf', 'notes', 'filter']);
const ALIGN = { left: 1, center: 2, right: 3 };

/* ---------- values ---------- */
const BR = /<br\s*\/?>/gi;
/** markdown cell text → Univer cell (value part only) */
export function cellFromRaw(raw) {
  const s = String(raw ?? '');
  if (s === '') return null;
  if (s.length > 1 && s.startsWith('=')) return { f: s };
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) && String(Number(s)) === s) return { v: Number(s), t: 2 };
  if (s === 'TRUE' || s === 'FALSE') return { v: s === 'TRUE' ? 1 : 0, t: 3 };
  return { v: s.replace(BR, '\n'), t: 1 };
}
/** Univer cell → markdown cell text (formulas stay formulas; values of formulas are never stored) */
export function rawFromCell(cell) {
  if (!cell) return '';
  if (cell.f) return cell.f;
  let v = cell.v;
  if ((v == null || v === '') && cell.p?.body?.dataStream) v = cell.p.body.dataStream.replace(/\r?\n$/, '').replace(/\r\n?/g, '\n');
  if (v == null) return '';
  if (cell.t === 3 || typeof v === 'boolean') return v === true || v === 1 || v === '1' || v === 'TRUE' ? 'TRUE' : 'FALSE';
  if (cell.t === 2 || typeof v === 'number') { const n = Number(v); return Number.isFinite(n) ? String(n) : String(v); }
  return String(v).replace(/\r?\n/g, '<br>');
}

/* ---------- md → Univer ---------- */
const sheetId = (i) => `sheet-${i + 1}`;

/** sheet-md text → { data: IWorkbookData, doc, baseline } */
export function toUniver(text, { id = 'folio-wb', name = 'Workbook' } = {}) {
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
    const ncol = Math.max(0, ...b.rows.map((r) => r.length));
    const put = (r, c, cell) => { (cellData[r] ||= {})[c] = cell; };
    b.rows.forEach((row, r) => row.forEach((raw, c) => { const v = cellFromRaw(raw); if (v) put(r, c, v); }));
    // styles: a cell gets column ⊕ row ⊕ its own style, so Univer shows exactly what sheet-md says
    const styledCols = new Set([...Object.keys(m.cols || {}).map(colIndex), ...(b.align || []).map((a, c) => (a ? c : -1)).filter((c) => c >= 0)]);
    const cellsMeta = m.cells || {};
    const touch = new Set();
    for (const r of Object.keys(cellData)) for (const c of Object.keys(cellData[r])) touch.add(`${r},${c}`);
    for (const a of Object.keys(cellsMeta)) { const p = parseAddr(a); if (p) touch.add(`${p[0]},${p[1]}`); }
    for (const rk of Object.keys(m.rows || {})) for (let c = 0; c < ncol; c++) touch.add(`${Number(rk) - 1},${c}`);
    for (const c of styledCols) for (let r = 0; r < b.rows.length; r++) touch.add(`${r},${c}`);
    for (const key of touch) {
      const [r, c] = key.split(',').map(Number);
      const own = cellsMeta[addr(r, c)] || {};
      const { data: custom, ...ownStyle } = own;
      const st = { ...colStyle(c), ...rowStyle(r), ...ownStyle };
      const s = styleRef(st);
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
  const baseline = canonicalOf(data);
  return { data, doc, baseline };
}

/* ---------- Univer → md ---------- */
function parseRes(snapshot) {
  const out = {};
  for (const r of snapshot.resources || []) { try { const v = typeof r.data === 'string' ? (r.data ? JSON.parse(r.data) : null) : r.data; if (v && Object.keys(v).length) out[r.name] = v; } catch { /* unreadable: dropped */ } }
  return out;
}
const styleOf = (snap, s) => (s == null ? null : typeof s === 'string' ? snap.styles?.[s] : s);

/** formulas shared by Univer (si) written out as ordinary formulas */
function expandShared(cellData) {
  const roots = new Map();
  for (const [r, row] of Object.entries(cellData || {})) for (const [c, cell] of Object.entries(row || {})) if (cell?.si && cell.f) roots.set(cell.si, { f: cell.f, r: Number(r), c: Number(c) });
  return (r, c, cell) => (cell && !cell.f && cell.si && roots.has(cell.si) ? (() => { const o = roots.get(cell.si); return { ...cell, f: shiftFormula(o.f, r - o.r, c - o.c) }; })() : cell);
}

/** one Univer worksheet → { name, rows, align, meta } */
export function sheetFromUniver(snap, ws, res) {
  const cd = ws.cellData || {};
  const shared = expandShared(cd);
  let maxR = -1, maxC = -1;
  for (const [r, row] of Object.entries(cd)) for (const [c, cell] of Object.entries(row || {})) { if (rawFromCell(shared(+r, +c, cell)) !== '' || cell?.s || cell?.custom) { maxR = Math.max(maxR, +r); maxC = Math.max(maxC, +c); } }
  const rows = [];
  for (let r = 0; r <= Math.max(maxR, 0); r++) { const row = []; for (let c = 0; c <= Math.max(maxC, 0); c++) row.push(rawFromCell(shared(r, c, cd[r]?.[c]))); rows.push(row); }
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
  for (const [r, row] of Object.entries(cd)) for (const [c, cell] of Object.entries(row || {})) {
    if (!cell) continue;
    const st = fromUniverStyle(styleOf(snap, cell.s));
    const base = { ...(align[+c] ? { align: align[+c] } : {}), ...(colSt[c] || {}), ...(rowSt[r] || {}) };
    const own = cell.s ? styleDiff(st, base) : {};
    // a key the column sets but this cell clears
    if (cell.s) for (const k of Object.keys(base)) if (!(k in st) && k !== 'align') own[k] = k === 'border' ? {} : false;
    if (cell.custom?.folio) own.data = cell.custom.folio;
    if (!isEmpty(own)) cells[addr(+r, +c)] = own;
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
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const cellKey = (a) => { const p = parseAddr(a) || [0, 0]; return p[0] * 20000 + p[1]; };
const sortCells = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => cellKey(a[0]) - cellKey(b[0])));

function workbookFromUniver(snap, res) {
  const wb = {};
  const names = res[RES.names];
  if (names) { const o = {}; for (const n of Object.values(names)) { const sheet = n.localSheetId && n.localSheetId !== 'AllDefaultWorkbook' ? snap.sheets?.[n.localSheetId]?.name : null; o[n.name] = sheet || n.comment ? clean({ ref: n.formulaOrRefString, sheet, comment: n.comment }) : n.formulaOrRefString; } if (!isEmpty(o)) wb.names = o; }
  const known = new Set(Object.values(RES));
  const pass = {};
  for (const [k, v] of Object.entries(res)) if (!known.has(k) && !/MOCK|_UI_PLUGIN$|PROTECTION|RANGE_THEME/i.test(k) && !isEmpty(v)) pass[k] = k === 'SHEET_DRAWING_PLUGIN' ? withoutFolioDoms(v) : v;
  for (const k of Object.keys(pass)) if (isEmpty(pass[k])) delete pass[k];
  if (!isEmpty(pass)) wb.univer = pass;
  return wb;
}

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
export function fromUniver(snap, loaded, { sheetMeta = {}, workbook = null } = {}) {
  const { doc, baseline } = loaded;
  const res = parseRes(snap);
  const oldSheets = sheetsOf(doc);
  const byId = new Map(oldSheets.map((b, i) => [sheetId(i), b]));
  const next = snap.sheetOrder.map((id) => {
    const cur = JSON.stringify(sheetFromUniver(snap, snap.sheets[id], res));
    const old = byId.get(id);
    const own = { ...folioMeta(old?.meta), ...(sheetMeta[id] || {}) };
    const ownSame = JSON.stringify(dropEmpty(own)) === JSON.stringify(dropEmpty(folioMeta(old?.meta)));
    if (old && baseline.sheets[id] === cur && ownSame) return old;
    const s = JSON.parse(cur);
    const meta = { ...s.meta, ...dropEmpty(own) };
    return { type: 'sheet', name: s.name, named: old ? old.named || old.name !== s.name : true, headingLines: old && old.name === s.name ? old.headingLines : [], rows: s.rows.length ? s.rows : [['']], align: s.align, meta };
  });
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
