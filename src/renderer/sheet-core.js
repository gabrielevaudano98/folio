// Folio — sheet-md: spreadsheets as plain Markdown tables.
//   ## Sheet name            one heading + one table = one sheet (tab)
//   | Item | Qty | Price | Total |       row 1 is the header row, cell A1 is "Item"
//   | Pens | 3   | 2.5   | =B2*C2 |      formulas start with "=", pipes inside are written \|
//   <!-- sheet: {"cols":{"D":{"format":"currency"}}} -->   optional formatting, invisible in other viewers
import { readCell } from '../sheets/core/cell-text.js';
import { Parser } from 'hot-formula-parser';

export const colName = (c) => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
export const colIndex = (s) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const addr = (r, c) => `${colName(c)}${r + 1}`;
export function parseAddr(a) { const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(a.trim()); return m ? [Number(m[2]) - 1, colIndex(m[1])] : null; }

/* ---------- markdown <-> model ---------- */
const splitRow = (line) => {
  let s = line.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out = []; let cur = '';
  for (let i = 0; i < s.length; i++) { if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; } else if (s[i] === '|') { out.push(cur.trim()); cur = ''; } else cur += s[i]; }
  out.push(cur.trim());
  return out;
};
const isSep = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').every((c) => /^:?-+:?$/.test(c.trim()));

export function parseWorkbook(text) {
  const lines = text.split('\n');
  const blocks = []; let buf = [];
  const flush = () => { if (buf.length) blocks.push({ type: 'text', lines: buf }); buf = []; };
  let i = 0, fence = false;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (!fence && /^\s*\|/.test(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
      // heading directly above (ignoring blank lines) names the sheet
      let name = null, hIdx = -1;
      for (let j = buf.length - 1; j >= 0; j--) { if (!buf[j].trim()) continue; const m = buf[j].match(/^#{2,3}\s+(.+)$/); if (m) { name = m[1].trim(); hIdx = j; } break; }
      let headingLines = [];
      if (hIdx >= 0) { headingLines = buf.splice(hIdx); }
      flush();
      const start = i;
      const rows = [splitRow(l)];
      const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''));
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      let meta = {};
      let j = i; while (j < lines.length && !lines[j].trim()) j++;
      const mm = j < lines.length && lines[j].match(/^<!--\s*sheet:\s*([\s\S]*?)\s*-->\s*$/);
      if (mm) { try { meta = JSON.parse(mm[1]); } catch {} i = j + 1; }
      const b = { type: 'sheet', name: name || `Sheet${blocks.filter((x) => x.type === 'sheet').length + 1}`, named: !!name, headingLines, rows, align, meta };
      b.raw = [...headingLines, ...lines.slice(start, i)];
      b.sig = signature(b);
      blocks.push(b);
      continue;
    }
    buf.push(l); i++;
  }
  flush();
  if (!blocks.some((b) => b.type === 'sheet')) blocks.push({ type: 'sheet', name: 'Sheet1', named: true, headingLines: [], rows: [['', '', '']], align: [], meta: {}, fresh: true });
  return blocks;
}

const signature = (b) => JSON.stringify([b.name, b.rows, b.align, b.meta]);
const escCell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
/** run a generator of steps to its end (the synchronous form of a sliced job) */
export const drain = (g) => { let r = g.next(); while (!r.done) r = g.next(); return r.value; };
export const serializeWorkbook = (blocks) => drain(serializeWorkbookSteps(blocks));
/**
 * The same, as steps: it yields every few thousand rows, so a caller can give the window back between slices
 * (Folio Sheets saves 50k-row workbooks this way). Loops, not spreads: Math.max(...rows) overflows past ~120k rows.
 */
export function* serializeWorkbookSteps(blocks, every = 4000) {
  const out = []; let n = 0;
  const add = (lines) => { for (const l of lines) out.push(l); };
  for (const b of blocks) {
    if (b.type === 'text') { add(b.lines); continue; }
    if (b.raw && b.sig === signature(b)) { add(b.raw); continue; } // untouched: keep the author's formatting
    if (b.named) {
      const prevBlank = out.length && out.at(-1).trim() === '';
      if (out.length && !prevBlank) out.push('');
      out.push(`## ${b.name}`, '');
    } else add(b.headingLines);
    const rows = trim(b.rows);
    let ncol = 1; for (const r of rows) if (r.length > ncol) ncol = r.length;
    const width = new Array(ncol).fill(3);
    for (const r of rows) { for (let c = 0; c < ncol; c++) { const w = escCell(r[c]).length; if (w > width[c]) width[c] = w; } if (++n % every === 0) yield; }
    for (let c = 0; c < ncol; c++) width[c] = Math.min(40, width[c]);
    const pad = (s, c) => s + ' '.repeat(Math.max(0, width[c] - s.length));
    const line = (r) => { const cells = new Array(ncol); for (let c = 0; c < ncol; c++) cells[c] = pad(escCell(r[c]), c); return `| ${cells.join(' | ')} |`; };
    out.push(line(rows[0] || []));
    out.push(`| ${width.map((w, c) => { const a = b.align?.[c] || ''; const d = '-'.repeat(Math.max(3, w - (a === 'center' ? 2 : a ? 1 : 0))); return a === 'center' ? `:${d}:` : a === 'right' ? `${d}:` : a === 'left' ? `:${d}` : d; }).join(' | ')} |`);
    for (let i = 1; i < rows.length; i++) { out.push(line(rows[i])); if (++n % every === 0) yield; }
    const meta = cleanMeta(b.meta);
    if (meta) out.push('', `<!-- sheet: ${JSON.stringify(meta)} -->`);
    out.push('');
  }
  const text = out.join('\n');
  return blocks.every((b) => b.type === 'text' || (b.raw && b.sig === signature(b))) ? text : text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n*$/, '\n');
}
function trim(rows) {
  let r = rows.map((row) => { let n = row.length; while (n > 1 && (row[n - 1] ?? '') === '') n--; return row.slice(0, n); });
  let n = r.length; while (n > 2 && r[n - 1].every((v) => (v ?? '') === '')) n--;
  r = r.slice(0, Math.max(1, n));
  return r;
}
function cleanMeta(m) {
  // v1 keys keep their order first; sheet-md v2 keys (styles, merges, validation, cf, notes, filter…) follow as written
  const out = {};
  const empty = (v) => v === undefined || v === null || (typeof v === 'object' && (Array.isArray(v) ? !v.length : !Object.keys(v).length));
  for (const k of ['cols', 'cells', 'rows']) if (m?.[k] && Object.keys(m[k]).length) out[k] = Object.fromEntries(Object.entries(m[k]).filter(([, v]) => v && Object.keys(v).length));
  for (const [k, v] of Object.entries(m || {})) if (!['cols', 'cells', 'rows'].includes(k) && !empty(v)) out[k] = v;
  return Object.keys(out).filter((k) => !empty(out[k])).length ? Object.fromEntries(Object.entries(out).filter(([, v]) => !empty(v))) : null;
}

/* ---------- evaluation ---------- */
const num = (v) => { if (typeof v === 'number') return v; if (v === '' || v == null) return v; const s = String(v).trim().replace(/^([-+]?)[€$£]\s?/, '$1').replace(/,(?=\d{3}\b)/g, ''); if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(s)) return s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s); if (/^(true|false)$/i.test(s)) return /^true$/i.test(s); return v; };

function extraFunctions(p) {
  const flat2 = (r) => (Array.isArray(r) ? (Array.isArray(r[0]) ? r : r.map((x) => [x])) : [[r]]);
  const eq = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a == b); // eslint-disable-line eqeqeq
  p.setFunction('VLOOKUP', ([key, range, col, approx = true]) => {
    const t = flat2(range);
    if (approx === false || approx === 0) { const row = t.find((r) => eq(r[0], key)); if (!row) throw Error('#N/A'); return row[col - 1]; }
    let best = null; for (const r of t) if (typeof r[0] === 'number' && r[0] <= key) best = r; if (!best) throw Error('#N/A'); return best[col - 1];
  });
  p.setFunction('HLOOKUP', ([key, range, row, approx = true]) => {
    const t = flat2(range); const idx = t[0].findIndex((v) => eq(v, key)); if (idx < 0) throw Error('#N/A'); return t[row - 1][idx];
  });
  p.setFunction('XLOOKUP', ([key, look, ret, notFound]) => {
    const l = flat2(look).flat(), r = flat2(ret).flat(); const i = l.findIndex((v) => eq(v, key)); if (i < 0) { if (notFound !== undefined) return notFound; throw Error('#N/A'); } return r[i];
  });
  p.setFunction('MATCH', ([key, look, type = 1]) => { const l = flat2(look).flat(); const i = type === 0 ? l.findIndex((v) => eq(v, key)) : l.reduce((b, v, j) => (typeof v === 'number' && v <= key ? j : b), -1); if (i < 0) throw Error('#N/A'); return i + 1; });
  p.setFunction('INDEX', ([range, r = 1, c = 1]) => { const t = flat2(range); return t[(r || 1) - 1]?.[(c || 1) - 1]; });
  p.setFunction('TEXTJOIN', ([sep, skip, ...vals]) => vals.flat(Infinity).filter((v) => !(skip && (v === '' || v == null))).join(sep));
  p.setFunction('IFS', (args) => { for (let i = 0; i < args.length; i += 2) if (args[i]) return args[i + 1]; throw Error('#N/A'); });
  p.setFunction('TODAY', () => new Date(new Date().toDateString()));
}

/** references to other documents used in formulas: ={{Budget.sheet#Costs!H6}}*2 */
export function formulaRefs(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\|\s*=[^|\n]*/g)) for (const r of m[0].matchAll(/\{\{([^}\n]+?)\}\}/g)) out.add(r[1].trim());
  return [...out];
}
const withRefs = (f) => f.replace(/\{\{([^}\n]+?)\}\}/g, (m, r) => `REF("${r.trim().replace(/"/g, '')}")`);

export function evaluator(sheet, { external = null } = {}) {
  const rows = sheet.rows;
  const cache = new Map(), busy = new Set();
  const pool = [];
  const parserAt = (depth) => {
    if (pool[depth]) return pool[depth];
    const p = new Parser(); extraFunctions(p);
    p.setFunction('REF', ([raw]) => {
      const v = external?.get(String(raw));
      if (v === undefined) throw Error(external ? '#REF!' : '#BUSY!');
      if (v && v.error) throw Error(v.error);
      return v;
    });
    p.on('callCellValue', (c, done) => done(val(c.row.index, c.column.index, depth + 1)));
    p.on('callRangeValue', (s, e, done) => {
      const out = [];
      for (let r = s.row.index; r <= Math.min(e.row.index, rows.length - 1); r++) { const row = []; for (let c = s.column.index; c <= e.column.index; c++) row.push(val(r, c, depth + 1)); out.push(row); }
      done(out.length ? out : [[]]);
    });
    return (pool[depth] = p);
  };
  function val(r, c, depth = 0) {
    const k = r * 10000 + c;
    if (cache.has(k)) { const v = cache.get(k); return v && v.error ? v.error : v; }
    const raw = rows[r]?.[c] ?? '';
    if (typeof raw !== 'string' || !raw.startsWith('=') || raw.length < 2) {
      // text kept as text by the apostrophe rule, or with entities (cell-text.js), is read as that text
      const t = typeof raw === 'string' && /^'|&|<br/i.test(raw) ? readCell(raw) : null;
      const v = t && t.t === 1 ? t.v : num(raw); cache.set(k, v); return v;
    }
    if (busy.has(k) || depth > 60) return '#CYCLE!';
    busy.add(k);
    let v;
    try {
      const res = parserAt(depth).parse(withRefs(raw.slice(1)));
      v = res.error ? { error: res.error } : res.result;
    } catch (e) { v = { error: String(e.message || e).startsWith('#') ? e.message : '#ERROR!' }; }
    busy.delete(k);
    cache.set(k, v);
    return v && v.error ? v.error : v;
  }
  return { value: (r, c) => val(r, c), isError: (v) => typeof v === 'string' && /^#[A-Z/0!?]+[!?]?$/.test(v) };
}

/* ---------- formatting ---------- */
export const FORMATS = [['', 'Automatic'], ['number', 'Number'], ['integer', 'Whole number'], ['currency', 'Currency (€)'], ['usd', 'Currency ($)'], ['percent', 'Percent'], ['date', 'Date'], ['text', 'Plain text']];
export function display(v, fmt) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '#NUM!';
    switch (fmt) {
      case 'number': return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
      case 'integer': return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
      case 'currency': return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(v);
      case 'usd': return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(v);
      case 'percent': return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(v);
      case 'date': { const d = new Date(Math.round((v - 25569) * 86400000)); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString(); }
      default: return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
    }
  }
  return String(v);
}

/* ---------- references: shift when copying, inserting or deleting ---------- */
const REF = /(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g;
export function shiftFormula(f, dr, dc) {
  if (!f || !String(f).startsWith('=')) return f;
  return f.replace(/"[^"]*"|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g, (m, ca, col, ra, row) => {
    if (m.startsWith('"')) return m;
    const c = ca ? colIndex(col) : colIndex(col) + dc, r = ra ? Number(row) : Number(row) + dr;
    if (c < 0 || r < 1) return '#REF!';
    return `${ca}${colName(c)}${ra}${r}`;
  });
}
export function adjustForInsert(f, axis, at, count) {
  if (!f || !String(f).startsWith('=')) return f;
  return f.replace(/"[^"]*"|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g, (m, ca, col, ra, row) => {
    if (m.startsWith('"')) return m;
    let c = colIndex(col), r = Number(row) - 1;
    if (axis === 'row' && r >= at) r += count;
    if (axis === 'col' && c >= at) c += count;
    if (r < 0 || c < 0) return '#REF!';
    return `${ca}${colName(c)}${ra}${r + 1}`;
  });
}
export { REF };
