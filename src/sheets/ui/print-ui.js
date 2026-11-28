// Folio Sheets — print and PDF (area 8). The print area of the sheet (or its used range) becomes an HTML table with
// the grid's styles, merges and widths; @page carries paper, orientation and margins; <thead> repeats the title rows
// on every page; "fit" scales the table to the page width. Chromium renders it to PDF through Folio's export channel
// (printToPDF in a sandboxed, script-free window: src/main/main.js `export:pdf`).
// Why not Puppeteer in the app: driving Chromium from Puppeteer needs a remote-debugging port, which AGENTS.md
// invariant 4 rules out; Puppeteer (puppeteer-core) renders the same HTML for headless batch PDFs from the command
// line (scripts/sheet-pdf.mjs), so both paths share this file's buildPrintHtml().
import { toRange, colName, splitRef } from '../core/a1.js';
import { L } from './i18n.js';

const PAPER = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
const MARGIN = { normal: [19, 18], wide: [25, 25], narrow: [13, 6] }; // mm: [top/bottom, left/right]
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BORDER = { 1: '0.5pt solid', 2: '0.5pt dotted', 3: '0.5pt dotted', 4: '0.5pt dashed', 7: '2pt double', 8: '1pt solid', 13: '1.5pt solid' };

/** pure: sheet data → a complete HTML document for printing */
export function buildPrintHtml({ title, cells, styles = {}, merges = [], colWidths = {}, rowHeights = {}, range, print = {}, defaultWidth = 104, display }) {
  const [pw, ph] = PAPER[print.paper] || PAPER.A4; const land = print.orientation === 'landscape';
  const [mv, mh] = MARGIN[print.margins] || MARGIN.normal;
  const pageW = (land ? ph : pw) - 2 * mh; // mm
  const r = range;
  const repeat = print.repeatRows ? toRange(print.repeatRows) : null;
  const skip = new Set(); const span = new Map();
  for (const m of merges) { span.set(`${m.startRow},${m.startColumn}`, [m.endRow - m.startRow + 1, m.endColumn - m.startColumn + 1]); for (let i = m.startRow; i <= m.endRow; i++) for (let j = m.startColumn; j <= m.endColumn; j++) if (i !== m.startRow || j !== m.startColumn) skip.add(`${i},${j}`); }
  const widths = []; for (let c = r.startColumn; c <= r.endColumn; c++) widths.push(colWidths[c] ?? defaultWidth);
  const totalPx = widths.reduce((a, b) => a + b, 0) + (print.headings ? 36 : 0);
  const pagePx = pageW * 96 / 25.4;
  const scale = print.fit === 'width' || print.fit === 'page' ? Math.min(1, pagePx / totalPx) : Number(print.fit) > 0 ? Number(print.fit) : 1;
  const css = (s) => {
    if (!s) return '';
    const o = [];
    if (s.bl) o.push('font-weight:700'); if (s.it) o.push('font-style:italic'); if (s.ul?.s) o.push('text-decoration:underline'); if (s.st?.s) o.push('text-decoration:line-through');
    if (s.ff) o.push(`font-family:${esc(s.ff)}`); if (s.fs) o.push(`font-size:${s.fs}pt`); if (s.cl?.rgb) o.push(`color:${s.cl.rgb}`); if (s.bg?.rgb) o.push(`background:${s.bg.rgb}`);
    if (s.ht) o.push(`text-align:${{ 1: 'left', 2: 'center', 3: 'right', 4: 'justify' }[s.ht]}`); if (s.vt) o.push(`vertical-align:${{ 1: 'top', 2: 'middle', 3: 'bottom' }[s.vt]}`);
    if (s.tb === 3) o.push('white-space:pre-wrap');
    for (const [k, side] of [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']]) if (s.bd?.[k]?.s) o.push(`border-${side}:${BORDER[s.bd[k].s] || '0.5pt solid'} ${s.bd[k].cl?.rgb || '#000'}`);
    return o.join(';');
  };
  const row = (i) => {
    const tds = [];
    if (print.headings) tds.push(`<th class="h">${i + 1}</th>`);
    for (let j = r.startColumn; j <= r.endColumn; j++) {
      if (skip.has(`${i},${j}`)) continue;
      const cell = cells[i]?.[j]; const st = typeof cell?.s === 'string' ? styles[cell.s] : cell?.s;
      const sp = span.get(`${i},${j}`); const txt = display(i, j);
      const num = typeof cell?.v === 'number' || /^-?[\d.,]+%?$/.test(txt);
      tds.push(`<td${sp ? ` rowspan="${sp[0]}" colspan="${sp[1]}"` : ''}${num ? ' class="n"' : ''} style="${css(st)}">${esc(txt)}</td>`);
    }
    return `<tr style="height:${rowHeights[i] || 24}px">${tds.join('')}</tr>`;
  };
  const head = print.headings ? `<tr><th class="h"></th>${widths.map((_, k) => `<th class="h">${colName(r.startColumn + k)}</th>`).join('')}</tr>` : '';
  const rep = repeat ? Array.from({ length: repeat.endRow - repeat.startRow + 1 }, (_, k) => row(repeat.startRow + k)).join('') : '';
  const bodyRows = []; for (let i = r.startRow; i <= r.endRow; i++) if (!repeat || i < repeat.startRow || i > repeat.endRow) bodyRows.push(row(i));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: ${print.paper || 'A4'} ${land ? 'landscape' : 'portrait'}; margin: ${mv}mm ${mh}mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10pt -apple-system, "Segoe UI", system-ui, sans-serif; color: #111; }
.wrap { zoom: ${scale}; }
table { border-collapse: collapse; table-layout: fixed; }
td, th { padding: 2px 4px; overflow: hidden; white-space: nowrap; text-overflow: clip; vertical-align: bottom; ${print.gridlines ? 'border: 0.5pt solid #c8c8c8;' : ''} }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
th.h { background: #f0f0f0; color: #555; font-weight: 500; font-size: 8pt; text-align: center; border: 0.5pt solid #c8c8c8; }
thead { display: table-header-group; } tr { break-inside: avoid; }
footer { position: fixed; bottom: -${mv - 6}mm; left: 0; right: 0; font-size: 8pt; color: #777; display: flex; justify-content: space-between; }
</style></head><body><div class="wrap"><table><colgroup>${print.headings ? '<col style="width:36px">' : ''}${widths.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>
<thead>${head}${rep}</thead><tbody>${bodyRows.join('')}</tbody></table></div>
${print.footer !== false ? `<footer><span>${esc(title)}</span><span>${esc(new Date().toISOString().slice(0, 10))}</span></footer>` : ''}</body></html>`;
}

/** the active sheet → PDF through Folio's export channel */
export async function exportPdf(surface, { print: viaPrint = false } = {}) {
  const ws = surface.ws(); const id = ws.getSheetId();
  const snap = surface.snapshot(); const sh = snap.sheets[id];
  const p = surface.print();
  const area = p.areas?.[ws.getSheetName()] || p.area;
  const a1 = area ? splitRef(area).range : ws.getDataRange().getA1Notation();
  const range = toRange(a1);
  const disp = ws.getRange(a1).getDisplayValues();
  const colWidths = Object.fromEntries(Object.entries(sh.columnData || {}).filter(([, o]) => o?.w).map(([c, o]) => [c, o.hd ? 0 : o.w]));
  const rowHeights = Object.fromEntries(Object.entries(sh.rowData || {}).filter(([, o]) => o?.h).map(([r, o]) => [r, o.h]));
  const html = buildPrintHtml({ title: `${(surface.path() || '').split('/').pop()?.replace(/\.sheet\.md$/, '')} — ${ws.getSheetName()}`, cells: sh.cellData || {}, styles: snap.styles || {}, merges: sh.mergeData || [], colWidths, rowHeights, range, print: p, defaultWidth: sh.defaultColumnWidth || 104, display: (i, j) => disp[i - range.startRow]?.[j - range.startColumn] ?? '' });
  const out = await surface.ctx.exportPdf(html, { suffix: ws.getSheetName().toLowerCase().replace(/[^a-z-]+/g, '-').slice(0, 20) || 'sheet' });
  if (out) surface.ctx.toast(viaPrint ? L('PDF saved. Open it to print.') : L('PDF saved.'));
  return out;
}
