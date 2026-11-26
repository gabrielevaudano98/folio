// Folio Sheets — A1 addresses and Univer ranges. Pure, used in the window, the data engine and tests.
export const colName = (c) => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
export const colIndex = (s) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const addr = (r, c) => `${colName(c)}${r + 1}`;

/** "B2" → [1, 1]; "$B$2" too */
export function parseAddr(a) { const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(String(a).trim()); return m ? [Number(m[2]) - 1, colIndex(m[1])] : null; }

// Univer RANGE_TYPE: NORMAL 0, ROW 1, COLUMN 2, ALL 3
const MAXR = 1048575, MAXC = 16383;
/** "A1:C3" | "A:A" | "2:4" | "B5" → Univer IRange (without unit or sheet ids) */
export function toRange(a1) {
  const s = String(a1).trim().replace(/\$/g, '');
  let m = /^([A-Z]{1,3}):([A-Z]{1,3})$/i.exec(s);
  if (m) return { startRow: 0, endRow: MAXR, startColumn: colIndex(m[1]), endColumn: colIndex(m[2]), rangeType: 2 };
  m = /^(\d+):(\d+)$/.exec(s);
  if (m) return { startRow: Number(m[1]) - 1, endRow: Number(m[2]) - 1, startColumn: 0, endColumn: MAXC, rangeType: 1 };
  const [a, b = a] = s.split(':'); const p = parseAddr(a), q = parseAddr(b);
  if (!p || !q) throw new Error(`Not a range: ${a1}`);
  return { startRow: Math.min(p[0], q[0]), endRow: Math.max(p[0], q[0]), startColumn: Math.min(p[1], q[1]), endColumn: Math.max(p[1], q[1]), rangeType: 0 };
}
/** Univer IRange → "A1:C3" (single cell → "A1") */
export function fromRange(r) {
  if (r.rangeType === 2) return `${colName(r.startColumn)}:${colName(r.endColumn)}`;
  if (r.rangeType === 1) return `${r.startRow + 1}:${r.endRow + 1}`;
  const a = addr(r.startRow, r.startColumn), b = addr(r.endRow, r.endColumn);
  return a === b ? a : `${a}:${b}`;
}
/** "A1:B2, D4" ↔ list of ranges */
export const toRanges = (s) => String(s).split(/\s*,\s*/).filter(Boolean).map(toRange);
export const fromRanges = (list) => list.map(fromRange).join(', ');

/** "Costs!B2:C3" | "'My sheet'!A1" | "A1" → { sheet, range } */
export function splitRef(ref) {
  const s = String(ref).trim(); const i = s.lastIndexOf('!');
  if (i < 0) return { sheet: null, range: s };
  return { sheet: s.slice(0, i).replace(/^'|'$/g, '').replace(/''/g, "'"), range: s.slice(i + 1) };
}
export const quoteSheet = (n) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${String(n).replace(/'/g, "''")}'`);

/** every cell [r, c] of a range, row-major; refuses enormous ranges */
export function* cells(range, limit = 1e6) {
  const n = (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
  if (n > limit) throw new Error('Range too large');
  for (let r = range.startRow; r <= range.endRow; r++) for (let c = range.startColumn; c <= range.endColumn; c++) yield [r, c];
}
