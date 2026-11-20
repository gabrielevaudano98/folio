// Folio — printable handouts and notes pages for a deck, as one HTML document for printToPDF.
// Pages are A4 portrait. Slides are scaled copies of the rendered slides, so they match the deck exactly.

const A4 = [794, 1123];
const M = 56; // page margin, px
/** columns × rows for each handout size */
export const GRIDS = { 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [2, 2], 6: [2, 3], 9: [3, 3] };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** where each slide goes on a handout page: [{ x, y, w, h, k }] in page px, plus the note-lines box for 3 per page */
export function handoutCells(perPage, sw, sh, [pw, ph] = A4) {
  const [cols, rows] = GRIDS[perPage] || GRIDS[3];
  const lines = perPage === 3;
  const top = M + 28, bottom = M + 20; // header and footer bands
  const areaW = pw - M * 2, areaH = ph - top - bottom;
  const gap = 24;
  const cw = lines ? areaW * 0.5 : (areaW - gap * (cols - 1)) / cols;
  const ch = (areaH - gap * (rows - 1)) / rows;
  const k = Math.min(cw / sw, ch / sh);
  const w = sw * k, h = sh * k;
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = M + c * (cw + gap) + (lines ? 0 : (cw - w) / 2), y = top + r * (ch + gap) + (ch - h) / 2;
    cells.push({ x, y, w, h, k, ...(lines ? { lines: { x: M + areaW * 0.5 + gap, y, w: areaW * 0.5 - gap, h } } : {}) });
  }
  return cells;
}

/** the notes text of a slide as paragraphs (notes are plain text with blank lines between paragraphs) */
const notesHtml = (t) => String(t || '').trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

export function handoutHtml({ deck, slides, slidesHtml, perPage = 3, notes = false, css = '', fonts = '', title = '' }) {
  const [pw, ph] = A4; const sw = deck.width, sh = deck.height;
  const pages = [];
  const head = (n, total) => `<div class="ho-head"><span>${esc(title)}</span><span>${n} / ${total}</span></div>`;
  const slideBox = (html, c) => `<div class="ho-slide" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px"><div class="ho-scale" style="width:${sw}px;height:${sh}px;zoom:${c.k}">${html}</div></div>`;
  if (notes) {
    // a notes page: the slide in the top half, its speaker notes below
    const areaW = pw - M * 2; const k = Math.min(areaW / sw, (ph * 0.42) / sh);
    const w = sw * k, h = sh * k; const x = (pw - w) / 2, y = M + 28;
    slides.forEach((s, i) => {
      pages.push(`<div class="ho-page">${head(i + 1, slides.length)}${slideBox(slidesHtml[i], { x, y, w, h, k })}
        <div class="ho-num" style="top:${y + h + 18}px">Slide ${s.number ?? s.index + 1}${s.title ? ` · ${esc(s.title)}` : ''}</div>
        <div class="ho-notes" style="left:${M}px;top:${y + h + 56}px;width:${areaW}px;bottom:${M + 20}px">${notesHtml(s.notes) || '<p class="ho-empty">No speaker notes.</p>'}</div></div>`);
    });
  } else {
    const cells = handoutCells(perPage, sw, sh);
    const total = Math.ceil(slides.length / perPage);
    for (let p = 0; p < total; p++) {
      const items = slides.slice(p * perPage, p * perPage + perPage).map((s, j) => {
        const c = cells[j];
        const lines = c.lines ? `<div class="ho-lines" style="left:${c.lines.x}px;top:${c.lines.y}px;width:${c.lines.w}px;height:${c.lines.h}px">${'<i></i>'.repeat(Math.max(3, Math.floor(c.lines.h / 28)))}</div>` : '';
        return slideBox(slidesHtml[p * perPage + j], c) + lines;
      }).join('');
      pages.push(`<div class="ho-page">${head(p + 1, total)}${items}</div>`);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${fonts}
@page { size: ${pw}px ${ph}px; margin: 0; }
html, body { margin: 0; width: ${pw}px; overflow: hidden; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${css}
.ho-page { position: relative; width: ${pw}px; height: ${ph}px; overflow: hidden; page-break-after: always; break-after: page; font: 11px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1f1f1f; }
.ho-page:last-child { page-break-after: auto; break-after: auto; }
.ho-head { position: absolute; left: ${M}px; right: ${M}px; top: ${M - 8}px; display: flex; justify-content: space-between; color: #6b6b6b; font-size: 10px; letter-spacing: .02em; }
.ho-slide { position: absolute; overflow: hidden; outline: 0.75px solid #c8c8c8; }
.ho-scale { transform-origin: 0 0; }
.ho-scale > .slide { box-shadow: none; }
.ho-lines { position: absolute; display: flex; flex-direction: column; justify-content: space-evenly; }
.ho-lines i { display: block; border-bottom: 0.75px solid #c8c8c8; }
.ho-num { position: absolute; left: ${M}px; right: ${M}px; color: #6b6b6b; font-size: 10px; }
.ho-notes { position: absolute; font-size: 13px; line-height: 1.6; overflow: hidden; }
.ho-notes p { margin: 0 0 .7em; } .ho-empty { color: #8f8f8f; font-style: italic; }
</style></head><body>${pages.join('')}</body></html>`;
}
