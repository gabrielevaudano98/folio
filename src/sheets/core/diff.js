// Folio Sheets — what changed between two versions of a workbook, cell by cell (areas 15 and 27).
// Both versions go through the same Univer model as the grid (convert.js), so "changed" means changed for the
// person — a value, a formula, a style, a rule — never a difference in how the Markdown was spaced.
// json-diff-ts computes the changeset; it can also be reverted (restore one change) and atomised for an audit trail.
import { diff, atomizeChangeset, revertChangeset, applyChangeset, Operation } from 'json-diff-ts';
import { toUniver } from './convert.js';
import { addr } from './a1.js';
import { fromUniverStyle } from './style.js';

/** a workbook as a flat, comparable object: { sheets: { Name: { cells: { A1: { raw, style } }, meta } }, workbook } */
export function flatten(text) {
  const { data, doc } = toUniver(text);
  const sheets = {};
  for (const id of data.sheetOrder) {
    const ws = data.sheets[id]; const cells = {};
    for (const [r, row] of Object.entries(ws.cellData || {})) for (const [c, x] of Object.entries(row || {})) {
      if (!x) continue;
      const raw = x.f ? x.f : x.v == null ? '' : x.t === 3 ? (Number(x.v) ? 'TRUE' : 'FALSE') : String(x.v);
      const st = fromUniverStyle(typeof x.s === 'string' ? data.styles?.[x.s] : x.s);
      if (raw === '' && !Object.keys(st).length) continue;
      cells[addr(+r, +c)] = Object.keys(st).length ? { raw, style: st } : { raw };
    }
    const block = doc.blocks.filter((b) => b.type === 'sheet')[data.sheetOrder.indexOf(id)];
    const { cols, cells: _c, rows, ...meta } = block?.meta || {};
    sheets[ws.name] = { cells, meta: { ...meta, ...(cols ? { cols } : {}), ...(rows ? { rows } : {}) } };
  }
  const fences = Object.fromEntries(doc.fences.map((f) => [`${f.lang} ${f.name}`.trim(), f.body]));
  return { sheets, workbook: doc.workbook || {}, blocks: fences };
}

/**
 * readable changes from `before` to `after` (texts) →
 * [{ kind: 'cell'|'sheet'|'rule'|'block'|'workbook', sheet, cell, field, before, after, op: 'add'|'remove'|'update' }]
 */
export function compareWorkbooks(before, after) {
  const a = flatten(before), b = flatten(after);
  const changes = diff(a, b, { keysToSkip: [] });
  const out = [];
  for (const atom of atomizeChangeset(changes)) {
    const path = atom.path.replace(/^\$\./, '');
    const parts = splitPath(path);
    const op = atom.type === Operation.ADD ? 'add' : atom.type === Operation.REMOVE ? 'remove' : 'update';
    const val = (v) => (v && typeof v === 'object' ? v : v);
    if (parts[0] === 'sheets' && parts.length === 2) out.push({ kind: 'sheet', sheet: parts[1], op });
    else if (parts[0] === 'sheets' && parts[2] === 'cells') out.push({ kind: 'cell', sheet: parts[1], cell: parts[3], field: parts[4] || 'raw', op, before: val(atom.oldValue ?? (op === 'remove' ? atom.value : undefined)), after: val(op === 'remove' ? undefined : atom.value) });
    else if (parts[0] === 'sheets' && parts[2] === 'meta') out.push({ kind: 'rule', sheet: parts[1], field: parts.slice(3).join('.'), op, before: atom.oldValue, after: atom.value });
    else if (parts[0] === 'blocks') out.push({ kind: 'block', field: parts[1], op, before: atom.oldValue, after: atom.value });
    else out.push({ kind: 'workbook', field: parts.slice(1).join('.'), op, before: atom.oldValue, after: atom.value });
  }
  // one line per cell: a cell whose raw and style both changed is one change with two fields
  const seen = new Map(); const merged = [];
  for (const c of out) {
    if (c.kind !== 'cell') { merged.push(c); continue; }
    const k = `${c.sheet}!${c.cell}`;
    if (seen.has(k)) { const m = seen.get(k); m.fields.push(c.field); if (c.field === 'raw') { m.before = c.before; m.after = c.after; } continue; }
    const m = { ...c, fields: [c.field] }; seen.set(k, m); merged.push(m);
  }
  return merged;
}
/** "sheets.Orders.cells.B2.raw" with names that may hold dots in brackets: ['sheets', 'Orders', 'cells', 'B2', 'raw'] */
function splitPath(p) {
  const out = []; let cur = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '.') { if (cur) out.push(cur); cur = ''; continue; }
    if (ch === '[') { if (cur) out.push(cur); cur = ''; const q = p[i + 1]; const end = p.indexOf(q === "'" || q === '"' ? q + ']' : ']', i + 1); cur = p.slice(i + (q === "'" || q === '"' ? 2 : 1), end); out.push(cur); cur = ''; i = end + (q === "'" || q === '"' ? 1 : 0); continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
export const summarise = (changes) => ({
  cells: changes.filter((c) => c.kind === 'cell').length,
  sheets: changes.filter((c) => c.kind === 'sheet').length,
  rules: changes.filter((c) => c.kind === 'rule').length,
  blocks: changes.filter((c) => c.kind === 'block').length,
});
export { revertChangeset, applyChangeset };
