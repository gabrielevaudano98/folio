// Folio — charts. One spec, three homes: sheets, pages and slides.
//
//   ```chart
//   type: bar            column | bar | line | area | pie | donut | combo | scatter
//   title: Costs by item
//   source: Budget.sheet.md
//   sheet: Costs
//   range: A1:G5         first row = series names, first column = categories
//   by: columns          columns (default) or rows
//   stacked: true
//   lines: Margin        combo: the series drawn as lines (comma-separated; default the last one)
//   secondary: true      combo: the line series use a second value axis on the right
//   labels: true         value labels on bars, points and slices
//   xtitle: Month        horizontal axis title
//   ytitle: Revenue      vertical axis title
//   y2title: Margin      secondary axis title (combo with secondary: true)
//   ```
// or inline data instead of source/sheet/range:
//   data:
//   | Month | Users |
//   | Jan | 10 |
import { parseWorkbook, evaluator, parseAddr, display } from './sheet-core.js';

export const CHART_TYPES = [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['donut', 'Donut'], ['combo', 'Combo'], ['scatter', 'Scatter']];
/** keys a spec writes, in this order; a key that is absent, empty or false is left out */
export const SPEC_KEYS = ['type', 'title', 'source', 'sheet', 'range', 'by', 'stacked', 'lines', 'secondary', 'labels', 'xtitle', 'ytitle', 'y2title'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const truthy = (v) => v === true || v === 'true';
const KEY_LINE = /^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:\s*(.*)$/;

export function parseChartSpec(src) {
  const spec = { type: 'column', by: 'columns' };
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(KEY_LINE);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === 'data') { spec.data = lines.slice(i + 1).filter((l) => /^\s*\|/.test(l)).filter((l) => !/^\s*\|?\s*:?-+/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); break; }
    spec[k] = m[2].trim();
  }
  spec.stacked = truthy(spec.stacked);
  for (const k of ['labels', 'secondary']) if (k in spec) spec[k] = truthy(spec[k]);
  return spec;
}
export function specToText(spec) {
  return SPEC_KEYS.filter((k) => spec[k] !== undefined && spec[k] !== '' && spec[k] !== false && !(k === 'by' && spec[k] === 'columns')).map((k) => `${k}: ${spec[k]}`).join('\n');
}

/**
 * Change one key of a chart block's text and nothing else: the line that holds the key is rewritten in place (the
 * author's spacing kept), a new key goes just before `data:` (or at the end), and an empty or false value removes the line.
 */
export function setSpecKey(text, key, value) {
  const lines = String(text).split('\n');
  let limit = lines.findIndex((l) => /^\s*data\s*:/i.test(l)); if (limit < 0) limit = lines.length;
  const at = lines.slice(0, limit).findIndex((l) => l.match(KEY_LINE)?.[1].toLowerCase() === key.toLowerCase());
  const gone = value === undefined || value === null || value === '' || value === false;
  const v = String(value ?? '').replace(/\n/g, ' ').trim();
  if (gone || !v) { if (at >= 0) lines.splice(at, 1); return lines.join('\n'); }
  if (at >= 0) { lines[at] = lines[at].replace(/^(\s*[a-zA-Z][a-zA-Z0-9]*\s*:\s*).*$/, (_, head) => head + v); return lines.join('\n'); }
  let ins = limit; while (ins > 0 && limit === lines.length && lines[ins - 1].trim() === '') ins--;
  lines.splice(ins, 0, `${key}: ${v}`);
  return lines.join('\n');
}

/** which series a combo chart draws as lines: the ones named in `lines`, else the last one (when there are two or more) */
export function comboLines(series, spec) {
  const names = String(spec.lines ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const named = series.map((s) => names.includes(String(s.name).toLowerCase()));
  if (named.some(Boolean)) return named;
  return series.map((_, i) => series.length > 1 && i === series.length - 1);
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
const r1 = (v) => Math.round(v * 10) / 10;
/** a value label; drawn only when it fits the room it has (px), so dense charts stay readable */
const valText = (txt, x, y, anchor = 'middle', room = Infinity) => (String(txt).length * 6.4 <= room + 4 ? `<text class="ch-val" x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}">${esc(txt)}</text>` : '');

export function chartSvg({ categories, series }, spec, { width = 640, height = 360 } = {}) {
  const type = spec.type || 'column';
  const round = type === 'pie' || type === 'donut', combo = type === 'combo', labels = truthy(spec.labels);
  const title = spec.title ? `<text class="ch-title" x="0" y="18">${esc(spec.title)}</text>` : '';
  // value labels above the highest point need a little headroom (bars that run sideways get it on the right)
  const top = (spec.title ? 34 : 8) + (labels && !round && type !== 'bar' ? 12 : 0);
  if (!series.length) return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Empty chart">${title}<text class="ch-empty" x="${width / 2}" y="${height / 2}" text-anchor="middle">No numbers in this range</text></svg>`;
  const asLine = combo ? comboLines(series, spec) : series.map(() => type === 'line' || type === 'scatter');
  const legend = series.length > 1 || round;
  const legendItems = round ? categories : series.map((s) => s.name);
  const legendSvg = legend ? `<g class="ch-legend" transform="translate(0,${height - 14})">${(() => { let x = 0; return legendItems.map((name, i) => { const w = Math.min(200, 28 + String(name).length * 8.5); const g = `<g transform="translate(${x},0)">${!round && asLine[i] ? (combo ? `<path class="ch-line" d="M-2,-4 L14,-4" style="stroke:var(--ch-${(i % 6) + 1})"/>` : '') + mark(MARKS[i % 6], 6, -4, i) : `<rect x="0" y="-9" width="11" height="11" rx="2" style="fill:var(--ch-${(i % 6) + 1})"/>`}<text x="16" y="0">${esc(name)}</text></g>`; x += w; return g; }).join(''); })()}</g>` : '';
  const xTitle = round ? '' : String(spec.xtitle ?? '').trim(), yTitle = round ? '' : String(spec.ytitle ?? '').trim();
  const bottom = (legend ? 46 : 26) + (xTitle ? 18 : 0);
  const label = `aria-label="${esc(spec.title || type + ' chart')}: ${esc(series.map((s) => `${s.name} ${s.values.map((v, i) => `${categories[i]} ${v ?? 'none'}`).join(', ')}`).join('; '))}"`;

  if (round) {
    const s = series[0]; const vals = s.values.map((v) => Math.max(0, v || 0)); const tot = vals.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min(width * 0.5, height - top - bottom) / 2 - 6, cx = width / 2 - (width > 420 ? 80 : 0), cy = top + (height - top - bottom) / 2;
    const ri = type === 'donut' ? r1(r * 0.58) : 0;
    let a0 = -Math.PI / 2; let out = '';
    vals.forEach((v, i) => {
      const a1 = a0 + (v / tot) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      const [x0, y0] = p(a0), [x1, y1] = p(a1), [lx, ly] = [cx + Math.cos((a0 + a1) / 2) * (r + 16), cy + Math.sin((a0 + a1) / 2) * (r + 16)];
      const tip = type === 'donut' ? `<title>${esc(categories[i])}: ${fmt(s.values[i] ?? 0)}</title>` : '';
      if (type === 'donut') {
        const q = (a) => [r1(cx + Math.cos(a) * ri), r1(cy + Math.sin(a) * ri)];
        const [u0, w0] = q(a0), [u1, w1] = q(a1);
        if (v === tot) out += `<path class="ch-slice" fill-rule="evenodd" d="M${r1(cx - r)},${r1(cy)} a${r1(r)},${r1(r)} 0 1 0 ${r1(2 * r)},0 a${r1(r)},${r1(r)} 0 1 0 ${r1(-2 * r)},0Z M${r1(cx - ri)},${r1(cy)} a${ri},${ri} 0 1 0 ${r1(2 * ri)},0 a${ri},${ri} 0 1 0 ${r1(-2 * ri)},0Z" style="fill:var(--ch-${(i % 6) + 1})">${tip}</path>`;
        else if (v > 0) out += `<path class="ch-slice" d="M${r1(x0)},${r1(y0)} A${r1(r)},${r1(r)} 0 ${large} 1 ${r1(x1)},${r1(y1)} L${u1},${w1} A${ri},${ri} 0 ${large} 0 ${u0},${w0}Z" style="fill:var(--ch-${(i % 6) + 1})">${tip}</path>`;
      } else out += v === tot ? `<circle cx="${cx}" cy="${cy}" r="${r}" class="ch-slice" style="fill:var(--ch-${(i % 6) + 1})"/>` : `<path class="ch-slice" d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}Z" style="fill:var(--ch-${(i % 6) + 1})"/>`;
      if (v / tot > 0.04) out += `<text class="ch-lbl" x="${type === 'donut' ? r1(lx) : lx}" y="${type === 'donut' ? r1(ly + 4) : ly + 4}" text-anchor="${lx > cx ? 'start' : 'end'}">${labels ? fmt(s.values[i]) : `${Math.round((v / tot) * 100)}%`}</text>`;
      a0 = a1;
    });
    if (type === 'donut') {
      // the total and the series name sit in the hole only when they fit its width (slides draw text up to 1.4 times larger)
      const room = 2 * ri * 0.8, total = fmt(vals.reduce((a, b) => a + b, 0));
      const size = Math.min(20, Math.floor(room / (total.length * 0.62 * 1.4)));
      const sub = ri >= 44 ? Math.floor(room / (6.4 * 1.4)) : 0, name = s.name.length > sub ? (sub >= 4 ? s.name.slice(0, sub - 1) + '…' : '') : s.name;
      if (size >= 10) out += `<text class="ch-total" x="${cx}" y="${r1(cy + (name ? 2 : size * 0.35))}" text-anchor="middle" style="font-size:${size}px">${total}</text>${name ? `<text class="ch-sub" x="${cx}" y="${r1(cy + 20)}" text-anchor="middle">${esc(name)}</text>` : ''}`;
    }
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" ${label}>${title}${out}${legendSvg}</svg>`;
  }

  const horizontal = type === 'bar';
  const lineS = series.filter((_, i) => combo && asLine[i]), barS = combo ? series.filter((_, i) => !asLine[i]) : series;
  const secondary = combo && truthy(spec.secondary) && lineS.length > 0 && barS.length > 0;
  const y2Title = secondary ? String(spec.y2title ?? '').trim() : '';
  const left = (horizontal ? Math.min(160, 12 + Math.max(...categories.map((c) => c.length)) * 7) : 54) + (yTitle ? 18 : 0), right = secondary ? 50 + (y2Title ? 18 : 0) : labels && horizontal && !spec.stacked ? 40 : 12;
  const pw = width - left - right, ph = height - top - bottom;
  let all = series.flatMap((s) => s.values.filter((v) => v != null));
  // stacked: positives pile up from 0, negatives pile down from 0 (as Excel), so the axis spans both totals
  const stackRange = (list) => categories.map((_, i) => list.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0)).concat(categories.map((_, i) => list.reduce((a, s) => a + Math.min(0, s.values[i] || 0), 0)));
  if (combo) {
    const bars = barS.flatMap((s) => s.values.filter((v) => v != null)), lines = lineS.flatMap((s) => s.values.filter((v) => v != null));
    all = (spec.stacked ? stackRange(barS) : bars).concat(secondary ? [] : lines);
  } else if (spec.stacked && type !== 'line' && type !== 'scatter') all = stackRange(series);
  // axis titles: the horizontal one under the axis, the vertical ones turned along their axis
  const axisTitles = (xTitle ? `<text class="ch-axis" x="${r1(left + pw / 2)}" y="${top + ph + 34}" text-anchor="middle">${esc(xTitle)}</text>` : '')
    + (yTitle ? `<text class="ch-axis" transform="translate(13,${r1(top + ph / 2)}) rotate(-90)" text-anchor="middle">${esc(yTitle)}</text>` : '')
    + (y2Title ? `<text class="ch-axis" transform="translate(${width - 13},${r1(top + ph / 2)}) rotate(90)" text-anchor="middle">${esc(y2Title)}</text>` : '');
  if (type === 'scatter') {
    const xs = series[0].values, ys = (series[1] || series[0]).values;
    const tx = niceTicks(Math.min(0, ...xs.filter((v) => v != null)), Math.max(...xs.filter((v) => v != null))), ty = niceTicks(Math.min(0, ...ys.filter((v) => v != null)), Math.max(...ys.filter((v) => v != null)));
    const X = (v) => left + ((v - tx[0]) / (tx.at(-1) - tx[0])) * pw, Y = (v) => top + ph - ((v - ty[0]) / (ty.at(-1) - ty[0])) * ph;
    let g = ty.map((t) => `<line class="ch-grid" x1="${left}" x2="${left + pw}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ch-tick" x="${left - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('');
    g += tx.map((t) => `<text class="ch-tick" x="${X(t)}" y="${top + ph + 16}" text-anchor="middle">${fmt(t)}</text>`).join('');
    g += xs.map((x, i) => (x == null || ys[i] == null ? '' : `<g><title>${esc(categories[i])}: ${x}, ${ys[i]}</title>${mark('circle', X(x), Y(ys[i]), 0)}</g>`)).join('');
    if (labels) g += xs.map((x, i) => (x == null || ys[i] == null ? '' : valText(categories[i], X(x) + 8, Y(ys[i]) - 6, 'start'))).join('');
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" ${label}>${title}${g}${axisTitles}</svg>`;
  }
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const V = (v) => ((v - ticks[0]) / (ticks.at(-1) - ticks[0])) * (horizontal ? pw : ph);
  let g = '';
  for (const t of ticks) {
    if (horizontal) g += `<line class="ch-grid${t === 0 ? ' ch-zero' : ''}" x1="${left + V(t)}" x2="${left + V(t)}" y1="${top}" y2="${top + ph}"/><text class="ch-tick" x="${left + V(t)}" y="${top + ph + 16}" text-anchor="middle">${fmt(t)}</text>`;
    else g += `<line class="ch-grid${t === 0 ? ' ch-zero' : ''}" x1="${left}" x2="${left + pw}" y1="${top + ph - V(t)}" y2="${top + ph - V(t)}"/><text class="ch-tick" x="${left - 6}" y="${top + ph - V(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  }
  // the secondary value axis (combo): its own scale, tick labels on the right, no grid of its own
  let V2 = V;
  if (secondary) {
    const vals2 = lineS.flatMap((s) => s.values.filter((v) => v != null));
    const t2 = niceTicks(Math.min(0, ...vals2), Math.max(0, ...vals2));
    V2 = (v) => ((v - t2[0]) / (t2.at(-1) - t2[0])) * ph;
    for (const t of t2) g += `<text class="ch-tick ch-tick2" x="${left + pw + 6}" y="${r1(top + ph - V2(t) + 4)}" text-anchor="start">${fmt(t)}</text>`;
  }
  const n = categories.length, band = (horizontal ? ph : pw) / Math.max(1, n);
  categories.forEach((c, i) => {
    const mid = band * (i + 0.5);
    if (horizontal) g += `<text class="ch-cat" x="${left - 8}" y="${top + mid + 4}" text-anchor="end">${esc(c)}</text>`;
    else if (n <= 24 || i % Math.ceil(n / 12) === 0) g += `<text class="ch-cat" x="${left + mid}" y="${top + ph + 16}" text-anchor="middle">${esc(c.length > 14 ? c.slice(0, 13) + '…' : c)}</text>`;
  });
  const zero = V(0);
  const bars = (list) => {
    const k = spec.stacked ? 1 : list.length, bw = Math.max(2, (band * 0.72) / k);
    const up = new Array(n).fill(0), down = new Array(n).fill(0);
    list.forEach(({ s, si }, bi) => s.values.forEach((v, i) => {
      if (v == null) return;
      const acc = v < 0 ? down : up;
      const off = spec.stacked ? V(acc[i] + v) - V(acc[i]) : 0;
      const base = spec.stacked ? V(acc[i]) : zero, len = spec.stacked ? off : V(v) - zero;
      const pos = band * i + band * 0.14 + (spec.stacked ? 0 : bi * bw);
      const thick = (spec.stacked ? band * 0.72 : bw) - 1;
      const tip = `<title>${esc(s.name)}, ${esc(categories[i])}: ${fmt(v)}</title>`;
      if (horizontal) g += `<rect class="ch-bar" x="${left + Math.min(base, base + len)}" y="${top + pos}" width="${Math.abs(len)}" height="${thick}" style="fill:var(--ch-${(si % 6) + 1})">${tip}</rect>`;
      else g += `<rect class="ch-bar" x="${left + pos}" y="${top + ph - Math.max(base, base + len)}" width="${thick}" height="${Math.abs(len)}" style="fill:var(--ch-${(si % 6) + 1})">${tip}</rect>`;
      if (labels) {
        const txt = fmt(v);
        if (spec.stacked) { if (Math.abs(len) >= (horizontal ? txt.length * 6.4 + 6 : 14)) g += horizontal ? valText(txt, left + base + len / 2, top + pos + thick / 2 + 4, 'middle') : valText(txt, left + pos + thick / 2, top + ph - base - len / 2 + 4, 'middle', thick + 8); }
        // past the bar end; a negative bar that reaches the axis edge takes its label inside, clear of the category labels
        else if (horizontal) { const after = v >= 0 || V(v) < txt.length * 6.4 + 8; g += valText(txt, left + V(v) + (after ? 4 : -4), top + pos + thick / 2 + 4, after ? 'start' : 'end'); }
        else { const below = v < 0 && V(v) >= 16; g += valText(txt, left + pos + thick / 2, top + ph - V(v) + (below ? 12 : -4), 'middle', band / k); }
      }
      if (spec.stacked) acc[i] += v;
    }));
  };
  const lines = (list, Vs) => {
    const z = Vs(0);
    list.forEach(({ s, si }) => {
      const pts = s.values.map((v, i) => (v == null ? null : [left + band * (i + 0.5), top + ph - Vs(v)]));
      const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]} ` : acc), '');
      if (type === 'area') {
        // each run of points between blank cells is filled down to the baseline on its own
        const runs = []; pts.forEach((p, i) => { if (p) (pts[i - 1] && runs.length ? runs.at(-1) : runs[runs.push([]) - 1]).push(p); });
        const fill = (dd, a, b) => `<path class="ch-area" d="${dd} L${b[0]},${top + ph - z} L${a[0]},${top + ph - z}Z" style="fill:var(--ch-${(si % 6) + 1})"/>`;
        if (runs.length <= 1) { const first = pts.find(Boolean), last = [...pts].reverse().find(Boolean); g += fill(d, first, last); }
        else for (const r of runs) g += fill(r.map((p, j) => `${j ? 'L' : 'M'}${p[0]},${p[1]} `).join(''), r[0], r.at(-1));
      }
      g += `<path class="ch-line" d="${d}" style="stroke:var(--ch-${(si % 6) + 1})"/>`;
      pts.forEach((p, i) => { if (p) g += `<g><title>${esc(s.name)}, ${esc(categories[i])}: ${fmt(s.values[i])}</title>${mark(MARKS[si % 6], p[0], p[1], si)}</g>`; });
      if (labels) pts.forEach((p, i) => { if (p) g += valText(fmt(s.values[i]), p[0], p[1] - 9, 'middle', band); });
    });
  };
  const all2 = series.map((s, si) => ({ s, si }));
  if (combo) { bars(all2.filter((_, i) => !asLine[i])); lines(all2.filter((_, i) => asLine[i]), V2); }
  else if (type === 'column' || type === 'bar') bars(all2);
  else lines(all2, V);
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" ${label}>${title}${g}${axisTitles}${legendSvg}</svg>`;
}

export function chartHtml(values, spec, size) { return chartSvg(toSeries(values, spec.by === 'rows' ? 'rows' : 'columns'), spec, size); }
export { display };
