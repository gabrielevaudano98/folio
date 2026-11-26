// Folio Sheets — references inside formulas (area 16): which cells a formula reads, and circular references.
// Univer's formula engine gives the live dependency tree for one cell (panels/audit.js); this module works on the
// file alone, so the data engine, MCP tools and tests can find cycles and broken references without a grid. Pure.
import { parseAddr, toRange, addr } from './a1.js';

const REF = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}:\$?[A-Z]{1,3})(?![\w(])/g;
/** references of a formula → [{ sheet|null, range: "A1:B2", text }]; strings in quotes are skipped */
export function refsOf(formula) {
  const s = String(formula || '').replace(/"(?:[^"]|"")*"/g, (m) => ' '.repeat(m.length));
  const out = [];
  for (const m of s.matchAll(REF)) {
    const before = s[m.index - 1];
    if (before && /[\w.]/.test(before)) continue; // part of a name such as LOG10 or Sheet1.A
    out.push({ sheet: m[1] ? m[1].replace(/''/g, "'") : m[2] || null, range: m[3].replace(/\$/g, ''), text: m[0], index: m.index });
  }
  return out;
}
/** formulas of a workbook: { "Sheet!A1": "=…" } → cycles as lists of cells ["S!A1", "S!B1", "S!A1"] */
export function findCycles(formulas, { maxCells = 20000 } = {}) {
  const graph = new Map();
  for (const [cell, f] of Object.entries(formulas)) {
    const [sheet] = cell.split('!');
    const deps = [];
    for (const r of refsOf(f)) {
      let rg; try { rg = toRange(r.range); } catch { continue; }
      if (rg.rangeType) continue; // whole rows and columns: too wide to expand, Univer reports those itself
      const n = (rg.endRow - rg.startRow + 1) * (rg.endColumn - rg.startColumn + 1);
      if (n > maxCells) continue;
      for (let i = rg.startRow; i <= rg.endRow; i++) for (let j = rg.startColumn; j <= rg.endColumn; j++) { const k = `${r.sheet || sheet}!${addr(i, j)}`; if (formulas[k] !== undefined) deps.push(k); }
    }
    graph.set(cell, deps);
  }
  const state = new Map(), stack = [], cycles = [], seen = new Set();
  const visit = (v) => {
    state.set(v, 1); stack.push(v);
    for (const w of graph.get(v) || []) {
      if (state.get(w) === 1) { const c = stack.slice(stack.indexOf(w)).concat(w); const key = [...c].slice(0, -1).sort().join('|'); if (!seen.has(key)) { seen.add(key); cycles.push(c); } }
      else if (!state.get(w)) visit(w);
    }
    stack.pop(); state.set(v, 2);
  };
  for (const v of graph.keys()) if (!state.get(v)) visit(v);
  return cycles;
}
/** a formula with each single-cell reference replaced by its value (Evaluate formula, one step) */
export function substitute(formula, valueOf) {
  const refs = refsOf(formula).filter((r) => parseAddr(r.range));
  let out = String(formula); let shift = 0;
  for (const r of refs) {
    const v = valueOf(r.sheet, r.range); const txt = typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v == null ? '0' : String(v);
    out = out.slice(0, r.index + shift) + txt + out.slice(r.index + shift + r.text.length); shift += txt.length - r.text.length;
  }
  return out;
}
