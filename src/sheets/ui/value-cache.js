/* Computed values of big workbooks, kept between sessions so the grid shows numbers while the formula worker
 * recomputes. The file stores only formulas (FORMATS.md), so the values live outside it, in the window's storage,
 * keyed by a hash of the exact file text: a file edited elsewhere has another hash and gets nothing. The worker
 * still recalculates everything; this only fills the first frames. Small workbooks are not cached. */
const KEY = 'folio.sheets.values';
const MIN_FORMULAS = 5000, KEEP = 3, MAX_CHARS = 4_000_000;

/** 53-bit string hash (cyrb53): fast enough for a few MB */
export function hashText(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + s.length;
}
const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const isFormula = (c) => c && (c.f || c.si);
const okValue = (v) => typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' || typeof v === 'boolean';

/** fill the formula cells of a freshly built snapshot with the values saved for this exact text; returns how many */
export function applyValues(text, data) {
  const hit = readAll().find((e) => e.h === hashText(text));
  if (!hit) return 0;
  let n = 0;
  for (const [id, cells] of Object.entries(hit.v)) {
    const cd = data.sheets?.[id]?.cellData; if (!cd) continue;
    for (const key in cells) { const [r, c] = key.split(',').map(Number); const cell = cd[r]?.[c]; if (isFormula(cell) && cell.v === undefined) { cell.v = cells[key]; n++; } }
  }
  return n;
}

/** keep the values of the formula cells of a settled snapshot; false when not worth it or not allowed */
export function storeValues(text, snap) {
  const h = hashText(text);
  const all = readAll();
  if (all.some((e) => e.h === h)) return false;
  const v = {}; let n = 0;
  for (const [id, sh] of Object.entries(snap.sheets || {})) {
    const out = {};
    for (const r in sh.cellData || {}) for (const c in sh.cellData[r]) {
      const cell = sh.cellData[r][c];
      if (isFormula(cell) && cell.v !== undefined && cell.v !== null && okValue(cell.v)) { out[`${r},${c}`] = cell.v; n++; }
    }
    if (Object.keys(out).length) v[id] = out;
  }
  if (n < MIN_FORMULAS) return false;
  const next = [{ h, v }, ...all].slice(0, KEEP);
  let json = JSON.stringify(next);
  while (json.length > MAX_CHARS && next.length > 1) { next.pop(); json = JSON.stringify(next); }
  if (json.length > MAX_CHARS) return false;
  try { localStorage.setItem(KEY, json); return true; } catch { return false; }
}
