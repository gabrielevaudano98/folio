// Folio Sheets — cell styles. sheet-md keeps short, readable keys; Univer uses IStyleData. Pure.
//   { bold, italic, underline, strike, font, size, color, fill, align, valign, wrap, rotate, border, format | numfmt }
//   border: { top|bottom|left|right: "thin #1f1f1f" }   styles: thin hair dotted dashed double medium thick …

/** named number formats of sheet-md v1, and the pattern each one means */
export const NAMED_FORMATS = { number: '#,##0.00', integer: '#,##0', currency: '"€"#,##0.00', usd: '"$"#,##0.00', percent: '0.00%', date: 'yyyy-mm-dd', text: '@' };
const PATTERN_NAME = Object.fromEntries(Object.entries(NAMED_FORMATS).map(([k, v]) => [v, k]));

const H = { left: 1, center: 2, right: 3, justify: 4 }, V = { top: 1, middle: 2, bottom: 3 };
const inv = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const HI = inv(H), VI = inv(V);
export const BORDER = { thin: 1, hair: 2, dotted: 3, dashed: 4, 'dash-dot': 5, 'dash-dot-dot': 6, double: 7, medium: 8, 'medium-dashed': 9, 'medium-dash-dot': 10, 'medium-dash-dot-dot': 11, 'slant-dash-dot': 12, thick: 13 };
const BI = inv(BORDER);
const SIDES = { top: 't', bottom: 'b', left: 'l', right: 'r' };

/** "#abc" | "rgb(1,2,3)" | "#AABBCC" → "#aabbcc" */
export function hex(c) {
  if (!c) return c;
  const s = String(c).trim();
  let m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return '#' + [...m[1]].map((x) => x + x).join('').toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : s;
}

/** sheet-md style → Univer IStyleData (null when empty) */
export function toUniverStyle(st) {
  if (!st) return null;
  const u = {};
  const pattern = st.numfmt || NAMED_FORMATS[st.format];
  if (pattern) u.n = { pattern };
  if (st.bold) u.bl = 1;
  if (st.italic) u.it = 1;
  if (st.underline) u.ul = { s: 1 };
  if (st.strike) u.st = { s: 1 };
  if (st.font) u.ff = st.font;
  if (st.size) u.fs = Number(st.size);
  if (st.color) u.cl = { rgb: hex(st.color) };
  if (st.fill) u.bg = { rgb: hex(st.fill) };
  if (H[st.align]) u.ht = H[st.align];
  if (V[st.valign]) u.vt = V[st.valign];
  if (st.wrap === true) u.tb = 3; else if (st.wrap === 'clip') u.tb = 2;
  if (st.rotate) u.tr = { a: Number(st.rotate) };
  if (st.border) {
    const bd = {};
    for (const [side, k] of Object.entries(SIDES)) {
      const v = st.border[side]; if (!v) continue;
      const [kind = 'thin', color = '#000000'] = String(v).split(/\s+/);
      bd[k] = { s: BORDER[kind] ?? 1, cl: { rgb: hex(color) } };
    }
    if (Object.keys(bd).length) u.bd = bd;
  }
  if (st.x) Object.assign(u, st.x);
  return Object.keys(u).length ? u : null;
}

/** Univer IStyleData → sheet-md style ({} when empty). Unknown Univer keys are kept under `x` so nothing is lost. */
export function fromUniverStyle(u) {
  const st = {};
  if (!u) return st;
  const known = new Set(['n', 'bl', 'it', 'ul', 'st', 'ff', 'fs', 'cl', 'bg', 'ht', 'vt', 'tb', 'tr', 'bd']);
  if (u.n?.pattern) { const name = PATTERN_NAME[u.n.pattern]; if (name) st.format = name; else st.numfmt = u.n.pattern; }
  if (u.bl) st.bold = true;
  if (u.it) st.italic = true;
  if (u.ul?.s) st.underline = true;
  if (u.st?.s) st.strike = true;
  if (u.ff) st.font = u.ff;
  if (u.fs) st.size = u.fs;
  if (u.cl?.rgb) st.color = hex(u.cl.rgb);
  if (u.bg?.rgb) st.fill = hex(u.bg.rgb);
  if (HI[u.ht]) st.align = HI[u.ht];
  if (VI[u.vt]) st.valign = VI[u.vt];
  if (u.tb === 3) st.wrap = true; else if (u.tb === 2) st.wrap = 'clip';
  if (u.tr?.a) st.rotate = u.tr.a;
  if (u.bd) {
    const b = {};
    for (const [side, k] of Object.entries(SIDES)) { const v = u.bd[k]; if (v && v.s) b[side] = `${BI[v.s] || 'thin'} ${hex(v.cl?.rgb) || '#000000'}`; }
    if (Object.keys(b).length) st.border = b;
  }
  const extra = Object.fromEntries(Object.entries(u).filter(([k, v]) => !known.has(k) && v != null && !(typeof v === 'object' && !Object.keys(v).length)));
  if (Object.keys(extra).length) st.x = extra;
  return st;
}

/** keys of `a` that differ from `b` (shallow compare of JSON values): what a cell adds on top of its column */
export function styleDiff(a, b = {}) {
  const out = {};
  for (const [k, v] of Object.entries(a)) if (JSON.stringify(v) !== JSON.stringify(b[k])) out[k] = v;
  return out;
}
export const isEmpty = (o) => !o || !Object.keys(o).length;
