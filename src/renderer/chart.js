// Folio — charts. One spec, three homes: sheets, pages and slides.
//
//   ```chart
//   type: bar            bar | column | line | area | pie | scatter
//   title: Costs by item
//   source: Budget.sheet.md
//   sheet: Costs
//   range: A1:G5         first row = series names, first column = categories
//   by: columns          columns (default) or rows
//   stacked: true
//   ```
// or inline data instead of source/sheet/range:
//   data:
//   | Month | Users |
//   | Jan | 10 |
import { parseWorkbook, evaluator, parseAddr, display } from './sheet-core.js';

export const CHART_TYPES = [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['scatter', 'Scatter']];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function parseChartSpec(src) {
  const spec = { type: 'column', by: 'columns' };
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([a-zA-Z]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === 'data') { spec.data = lines.slice(i + 1).filter((l) => /^\s*\|/.test(l)).filter((l) => !/^\s*\|?\s*:?-+/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); break; }
    spec[k] = m[2].trim();
  }
  spec.stacked = spec.stacked === 'true' || spec.stacked === true;
  return spec;
}
export function specToText(spec) {
  const keys = ['type', 'title', 'source', 'sheet', 'range', 'by', 'stacked'];
  return keys.filter((k) => spec[k] !== undefined && spec[k] !== '' && spec[k] !== false && !(k === 'by' && spec[k] === 'columns')).map((k) => `${k}: ${spec[k]}`).join('\n');
}

/** values: 2D array (row 0 = header). Text-only columns (or rows) are dropped from the series. */
export function toSeries(values, by = 'columns') {
  if (!values?.length) return { categories: [], series: [] };
  let t = values;
  if (by === 'rows') t = values[0].map((_, c) => values.map((r) => r[c]));
  const head = t[0];
  const isNum = (v) => typeof v === 'number' || (v !== '' && v != null && Number.isFinite(Number(v)));
  // keep only categories that carry at least one number (drops text rows such as "Owner" when series are in rows)
  const body = t.slice(1).filter((r) => r.slice(1).some(isNum));
  const categories = body.map((r) => String(r[0] ?? ''));
  const series = [];
  for (let c = 1; c < head.length; c++) {
    const vals = body.map((r) => (typeof r[c] === 'number' ? r[c] : r[c] === '' || r[c] == null ? null : Number.isFinite(Number(r[c])) ? Number(r[c]) : NaN));
    if (vals.some((v) => Number.isNaN(v)) || vals.every((v) => v == null)) continue;
    series.push({ name: String(head[c] ?? `Series ${c}`), values: vals });
  }
  return { categories, series };
}

/** values from a sheet-md text */
export function sheetRange(text, sheetName, range) {
  const sheets = parseWorkbook(text).filter((b) => b.type === 'sheet');
  const s = (sheetName && sheets.find((x) => x.name.toLowerCase() === sheetName.toLowerCase())) || sheets[0];
  if (!s) throw new Error('No sheet found');
  const ev = evaluator(s);
  let r0 = 0, c0 = 0, r1 = s.rows.length - 1, c1 = Math.max(...s.rows.map((r) => r.length)) - 1;
  if (range) { const [a, b] = range.split(':').map(parseAddr); if (!a || !b) throw new Error(`Bad range ${range}`); [r0, c0] = a; [r1, c1] = b; }
  const out = [];
  for (let r = r0; r <= r1; r++) { const row = []; for (let c = c0; c <= c1; c++) { const v = ev.value(r, c); row.push(ev.isError(v) ? null : v); } out.push(row); }
  return out;
}

export async function resolveChart(spec, readNote) {
  if (spec.data) return spec.data.map((r) => r.map((v) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : v)));
  if (!spec.source) throw new Error('A chart needs "source" and "range", or inline "data".');
  return sheetRange(await readNote(spec.source), spec.sheet, spec.range);
}

/* ---------- drawing ---------- */
const MARKS = ['circle', 'square', 'triangle', 'diamond', 'circle-open', 'square-open'];
const fmt = (v) => new Intl.NumberFormat(undefined, { notation: Math.abs(v) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(v);
function niceTicks(min, max, n = 5) {
  if (min === max) { max = min + 1; }
  const span = max - min, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e9) / 1e9);
  return out;
}
function mark(kind, x, y, i) {
  const s = 4.5, f = `fill:var(--ch-${(i % 6) + 1})`;
  switch (kind) {
    case 'square': return `<rect x="${x - s}" y="${y - s}" width="${s * 2}" height="${s * 2}" style="${f}"/>`;
    case 'triangle': return `<path d="M${x},${y - s - 1} L${x + s + 1},${y + s} L${x - s - 1},${y + s}Z" style="${f}"/>`;
    case 'diamond': return `<path d="M${x},${y - s - 1} L${x + s + 1},${y} L${x},${y + s + 1} L${x - s - 1},${y}Z" style="${f}"/>`;
    case 'circle-open': return `<circle cx="${x}" cy="${y}" r="${s}" class="ch-open" style="stroke:var(--ch-${(i % 6) + 1})"/>`;
    case 'square-open': return `<rect x="${x - s}" y="${y - s}" width="${s * 2}" height="${s * 2}" class="ch-open" style="stroke:var(--ch-${(i % 6) + 1})"/>`;
    default: return `<circle cx="${x}" cy="${y}" r="${s}" style="${f}"/>`;
  }
}

export function chartSvg({ categories, series }, spec, { width = 640, height = 360 } = {}) {
  const type = spec.type || 'column';
  const title = spec.title ? `<text class="ch-title" x="0" y="18">${esc(spec.title)}</text>` : '';
  const top = spec.title ? 34 : 8;
  if (!series.length) return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Empty chart">${title}<text class="ch-empty" x="${width / 2}" y="${height / 2}" text-anchor="middle">No numbers in this range</text></svg>`;
  const legend = series.length > 1 || type === 'pie';
  const legendItems = type === 'pie' ? categories : series.map((s) => s.name);
  const legendSvg = legend ? `<g class="ch-legend" transform="translate(0,${height - 14})">${(() => { let x = 0; return legendItems.map((name, i) => { const w = Math.min(200, 28 + String(name).length * 8.5); const g = `<g transform="translate(${x},0)">${type === 'line' || type === 'scatter' ? mark(MARKS[i % 6], 6, -4, i) : `<rect x="0" y="-9" width="11" height="11" rx="2" style="fill:var(--ch-${(i % 6) + 1})"/>`}<text x="16" y="0">${esc(name)}</text></g>`; x += w; return g; }).join(''); })()}</g>` : '';
  const bottom = legend ? 46 : 26;
  const label = `aria-label="${esc(spec.title || type + ' chart')}: ${esc(series.map((s) => `${s.name} ${s.values.map((v, i) => `${categories[i]} ${v ?? 'none'}`).join(', ')}`).join('; '))}"`;

  if (type === 'pie') {
    const s = series[0]; const vals = s.values.map((v) => Math.max(0, v || 0)); const tot = vals.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min(width * 0.5, height - top - bottom) / 2 - 6, cx = width / 2 - (width > 420 ? 80 : 0), cy = top + (height - top - bottom) / 2;
    let a0 = -Math.PI / 2; let out = '';
    vals.forEach((v, i) => {
      const a1 = a0 + (v / tot) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      const [x0, y0] = p(a0), [x1, y1] = p(a1), [lx, ly] = [cx + Math.cos((a0 + a1) / 2) * (r + 16), cy + Math.sin((a0 + a1) / 2) * (r + 16)];
      out += v === tot ? `<circle cx="${cx}" cy="${cy}" r="${r}" class="ch-slice" style="fill:var(--ch-${(i % 6) + 1})"/>` : `<path class="ch-slice" d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}Z" style="fill:var(--ch-${(i % 6) + 1})"/>`;
      if (v / tot > 0.04) out += `<text class="ch-lbl" x="${lx}" y="${ly + 4}" text-anchor="${lx > cx ? 'start' : 'end'}">${Math.round((v / tot) * 100)}%</text>`;
      a0 = a1;
    });
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" ${label}>${title}${out}${legendSvg}</svg>`;
  }

  const horizontal = type === 'bar';
  const left = horizontal ? Math.min(160, 12 + Math.max(...categories.map((c) => c.length)) * 7) : 54, right = 12;
  const pw = width - left - right, ph = height - top - bottom;
  let all = series.flatMap((s) => s.values.filter((v) => v != null));
  if (spec.stacked && type !== 'line' && type !== 'scatter') all = categories.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0)).concat(all.filter((v) => v < 0));
  if (type === 'scatter') {
    const xs = series[0].values, ys = (series[1] || series[0]).values;
    const tx = niceTicks(Math.min(0, ...xs.filter((v) => v != null)), Math.max(...xs.filter((v) => v != null))), ty = niceTicks(Math.min(0, ...ys.filter((v) => v != null)), Math.max(...ys.filter((v) => v != null)));
    const X = (v) => left + ((v - tx[0]) / (tx.at(-1) - tx[0])) * pw, Y = (v) => top + ph - ((v - ty[0]) / (ty.at(-1) - ty[0])) * ph;
    let g = ty.map((t) => `<line class="ch-grid" x1="${left}" x2="${left + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ch-tick" x="${left - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('');
    g += tx.map((t) => `<text class="ch-tick" x="${X(t)}" y="${top + ph + 16}" text-anchor="middle">${fmt(t)}</text>`).join('');
    g += xs.map((x, i) => (x == null || ys[i] == null ? '' : `<g><title>${esc(categories[i])}: ${x}, ${ys[i]}</title>${mark('circle', X(x), Y(ys[i]), 0)}</g>`)).join('');
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" ${label}>${title}${g}</svg>`;
  }
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const V = (v) => ((v - ticks[0]) / (ticks.at(-1) - ticks[0])) * (horizontal ? pw : ph);
  let g = '';
  for (const t of ticks) {
    if (horizontal) g += `<line class="ch-grid${t === 0 ? ' ch-zero' : ''}" x1="${left + V(t)}" x2="${left + V(t)}" y1="${top}" y2="${top + ph}"/><text class="ch-tick" x="${left + V(t)}" y="${top + ph + 16}" text-anchor="middle">${fmt(t)}</text>`;
    else g += `<line class="ch-grid${t === 0 ? ' ch-zero' : ''}" x1="${left}" x2="${left + pw}" y1="${top + ph - V(t)}" y2="${top + ph - V(t)}"/><text class="ch-tick" x="${left - 6}" y="${top + ph - V(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  }
  const n = categories.length, band = (horizontal ? ph : pw) / Math.max(1, n);
  categories.forEach((c, i) => {
    const mid = band * (i + 0.5);
    if (horizontal) g += `<text class="ch-cat" x="${left - 8}" y="${top + mid + 4}" text-anchor="end">${esc(c)}</text>`;
    else if (n <= 24 || i % Math.ceil(n / 12) === 0) g += `<text class="ch-cat" x="${left + mid}" y="${top + ph + 16}" text-anchor="middle">${esc(c.length > 14 ? c.slice(0, 13) + '…' : c)}</text>`;
  });
  const zero = V(0);
  if (type === 'column' || type === 'bar') {
    const k = spec.stacked ? 1 : series.length, bw = Math.max(2, (band * 0.72) / k);
    const acc = new Array(n).fill(0);
    series.forEach((s, si) => s.values.forEach((v, i) => {
      if (v == null) return;
      const off = spec.stacked ? V(acc[i] + Math.max(v, 0)) - V(acc[i]) : 0;
      const base = spec.stacked ? V(acc[i]) : zero, len = spec.stacked ? off : V(v) - zero;
      const pos = band * i + band * 0.14 + (spec.stacked ? 0 : si * bw);
      const tip = `<title>${esc(s.name)}, ${esc(categories[i])}: ${fmt(v)}</title>`;
      if (horizontal) g += `<rect class="ch-bar" x="${left + Math.min(base, base + len)}" y="${top + pos}" width="${Math.abs(len)}" height="${(spec.stacked ? band * 0.72 : bw) - 1}" style="fill:var(--ch-${(si % 6) + 1})">${tip}</rect>`;
      else g += `<rect class="ch-bar" x="${left + pos}" y="${top + ph - Math.max(base, base + len)}" width="${(spec.stacked ? band * 0.72 : bw) - 1}" height="${Math.abs(len)}" style="fill:var(--ch-${(si % 6) + 1})">${tip}</rect>`;
      if (spec.stacked) acc[i] += Math.max(v, 0);
    }));
  } else {
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => (v == null ? null : [left + band * (i + 0.5), top + ph - V(v)]));
      const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]} ` : acc), '');
      if (type === 'area') { const first = pts.find(Boolean), last = [...pts].reverse().find(Boolean); g += `<path class="ch-area" d="${d} L${last[0]},${top + ph - zero} L${first[0]},${top + ph - zero}Z" style="fill:var(--ch-${(si % 6) + 1})"/>`; }
      g += `<path class="ch-line" d="${d}" style="stroke:var(--ch-${(si % 6) + 1})"/>`;
      pts.forEach((p, i) => { if (p) g += `<g><title>${esc(s.name)}, ${esc(categories[i])}: ${fmt(s.values[i])}</title>${mark(MARKS[si % 6], p[0], p[1], si)}</g>`; });
    });
  }
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" ${label}>${title}${g}${legendSvg}</svg>`;
}

export function chartHtml(values, spec, size) { return chartSvg(toSeries(values, spec.by === 'rows' ? 'rows' : 'columns'), spec, size); }
export { display };
