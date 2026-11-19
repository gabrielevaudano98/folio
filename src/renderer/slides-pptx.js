// Folio — slides-md to PowerPoint. Maps each layout to native, editable PowerPoint text boxes and images.
import PptxGenJS from 'pptxgenjs';
import { parseChartSpec, resolveChart, toSeries } from './chart.js';

const THEME = {
  folio: { bg: 'FCFCFC', ink: '1F1F1F', muted: '6B6B6B', card: 'F0F0F0', face: 'Segoe UI Semibold', body: 'Segoe UI' },
  graphite: { bg: '1C1C1C', ink: 'F3F3F3', muted: 'A8A8A8', card: '2E2E2E', face: 'Segoe UI Semibold', body: 'Segoe UI' },
  paper: { bg: 'F4F4F4', ink: '1F1F1F', muted: '6B6B6B', card: 'FFFFFF', face: 'Georgia', body: 'Segoe UI' },
};
const hex = (c) => (c && /^#?[0-9a-f]{6}$/i.test(c) ? c.replace('#', '') : null);

function runsFrom(el, t, base = {}) {
  // turn a block element into pptxgenjs text runs, one paragraph per block or list item
  const out = [];
  const inline = (node, opts) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.textContent) out.push({ text: n.textContent.replace(/\s+/g, ' '), options: { ...opts } }); }
      else if (n.nodeType === 1) {
        const tag = n.tagName.toLowerCase();
        if (['ul', 'ol'].includes(tag)) continue;
        const o = { ...opts };
        if (tag === 'strong' || tag === 'b') o.bold = true;
        if (tag === 'em' || tag === 'i') o.italic = true;
        if (tag === 'u') o.underline = { style: 'sng' };
        if (tag === 's' || tag === 'del') o.strike = 'sngStrike';
        if (tag === 'code') o.fontFace = 'Consolas';
        if (tag === 'a') o.hyperlink = { url: n.getAttribute('href') || '' };
        if (tag === 'br') { out.push({ text: '', options: { ...opts, breakLine: true } }); continue; }
        inline(n, o);
      }
    }
  };
  const PARA = ['bullet', 'indentLevel', 'paraSpaceAfter', 'align'];
  const para = (node, opts) => {
    const start = out.length;
    const runOpts = Object.fromEntries(Object.entries(opts).filter(([k]) => !PARA.includes(k)));
    inline(node, runOpts);
    if (out.length === start) out.push({ text: ' ', options: { ...runOpts } });
    for (const k of PARA) if (k in opts) out[start].options[k] = opts[k];
    out[out.length - 1].options.breakLine = true;
  };
  const block = (node, level = 0) => {
    const tag = node.tagName?.toLowerCase();
    if (!tag) return;
    if (tag === 'ul' || tag === 'ol') {
      for (const li of node.children) {
        const box = li.querySelector(':scope > input[type=checkbox]');
        para(li, { ...base, color: t.ink, bullet: box ? false : tag === 'ol' ? { type: 'number' } : { indent: 18 }, indentLevel: level, ...(box ? { } : {}) });
        if (box) out[out.length - 1].text = (box.checked ? '☑ ' : '☐ ') + out[out.length - 1].text;
        for (const sub of li.querySelectorAll(':scope > ul, :scope > ol')) block(sub, level + 1);
      }
    } else if (/^h[1-6]$/.test(tag)) para(node, { ...base, bold: true, fontFace: t.face, fontSize: Math.max(18, (base.fontSize || 20) + 6 - Number(tag[1])), color: t.ink, paraSpaceAfter: 6 });
    else if (tag === 'blockquote') para(node, { ...base, italic: true, color: t.muted });
    else if (tag === 'pre') para(node, { ...base, fontFace: 'Consolas', fontSize: 14, color: t.ink });
    else if (tag === 'p' || tag === 'div') { if (node.querySelector('img') && !node.textContent.trim()) return; para(node, { ...base, color: t.ink, paraSpaceAfter: 6 }); }
    else if (tag === 'table') { for (const tr of node.querySelectorAll('tr')) para({ childNodes: [document.createTextNode([...tr.children].map((c) => c.textContent.trim()).join('   |   '))] }, { ...base, color: t.ink }); }
  };
  for (const c of el.children) block(c);
  return out;
}

export async function buildPptx(deck, { dataUrl, renderSlide, readNote }) {
  const pptx = new PptxGenJS();
  const wide = deck.width / deck.height > 1.5;
  pptx.layout = wide ? 'LAYOUT_WIDE' : 'LAYOUT_4x3';
  const W = wide ? 13.333 : 10, H = 7.5;
  pptx.title = deck.global.title || deck.slides[0]?.title || 'Slides';

  for (const s of deck.shown || deck.slides) {
    const themeName = ['folio', 'graphite', 'paper'].includes(s.eff.theme) ? s.eff.theme : deck.theme;
    const t = { ...THEME[(s.classes.includes('invert') ? 'graphite' : themeName)] };
    if (hex(s.eff.color)) t.ink = hex(s.eff.color);
    const slide = pptx.addSlide();
    slide.background = { color: hex(s.eff.backgroundColor) || t.bg };

    const dom = document.createElement('div');
    dom.innerHTML = renderSlide(deck, s);
    const body = dom.querySelector('.sl-body');

    // backgrounds
    let x0 = 0.9, w0 = W - 1.8;
    for (const b of s.bgs) {
      let data; try { data = await dataUrl(b.src); } catch { continue; }
      const sizing = { type: b.fit === 'contain' ? 'contain' : 'cover' };
      if (b.side) {
        const sw = W * (b.size || 50) / 100;
        const bx = b.side === 'right' ? W - sw : 0;
        slide.addImage({ data, x: bx, y: 0, w: sw, h: H, sizing: { ...sizing, w: sw, h: H } });
        if (b.side === 'right') w0 = W - sw - 1.5; else { x0 = sw + 0.6; w0 = W - sw - 1.5; }
      } else slide.addImage({ data, x: 0, y: 0, w: W, h: H, sizing: { ...sizing, w: W, h: H } });
    }

    // native, editable PowerPoint charts
    const charts = [...body.querySelectorAll('.chart-block[data-spec]')];
    for (const el of charts) (el.closest('pre') || el).remove();
    const chartData = [];
    for (const el of charts) {
      const spec = parseChartSpec(decodeURIComponent(el.dataset.spec));
      try { chartData.push([spec, toSeries(await resolveChart(spec, readNote), spec.by === 'rows' ? 'rows' : 'columns')]); } catch {}
    }
    const firstHead = body.querySelector(':scope > h1, :scope > h2');
    const lay = s.layout;
    if (lay === 'title' || lay === 'section' || lay === 'big-number' || lay === 'quote') {
      const big = lay === 'big-number' ? 96 : lay === 'quote' ? 34 : lay === 'section' ? 50 : 48;
      const main = lay === 'quote' ? body.querySelector('blockquote') : firstHead;
      const rest = [...body.children].filter((c) => c !== main);
      const center = lay === 'title';
      if (main) slide.addText(main.textContent.trim(), { x: x0, y: lay === 'section' ? H * 0.42 : H * 0.26, w: w0, h: H * 0.32, fontFace: t.face, fontSize: big, bold: lay !== 'quote', italic: lay === 'quote', color: t.ink, align: center ? 'center' : 'left', valign: 'bottom', fit: 'shrink' });
      const sub = document.createElement('div'); rest.forEach((c) => sub.appendChild(c.cloneNode(true)));
      const runs = runsFrom(sub, t, { fontSize: 22, fontFace: t.body, color: t.muted });
      runs.forEach((r) => (r.options.color = t.muted));
      if (runs.length) slide.addText(runs, { x: x0, y: H * 0.6, w: w0, h: H * 0.25, align: center ? 'center' : 'left', valign: 'top', fit: 'shrink' });
    } else {
      let y = 0.6;
      if (firstHead) { slide.addText(firstHead.textContent.trim(), { x: x0, y, w: w0, h: 0.9, fontFace: t.face, fontSize: 34, bold: true, color: t.ink, valign: 'top', fit: 'shrink' }); y = 1.6; }
      const cols = [...body.querySelectorAll(':scope > .sx-left, :scope > .sx-right, :scope > .sx-card, :scope > .sx-columns > *')];
      const flow = document.createElement('div');
      [...body.children].filter((c) => c !== firstHead && !cols.includes(c) && !c.classList.contains('sx-columns')).forEach((c) => flow.appendChild(c.cloneNode(true)));
      const flowRuns = runsFrom(flow, t, { fontSize: 20, fontFace: t.body });
      if (cols.length) {
        if (flowRuns.length) { slide.addText(flowRuns, { x: x0, y, w: w0, h: 0.8, valign: 'top', fit: 'shrink' }); y += 0.9; }
        const gap = 0.4, cw = (w0 - gap * (cols.length - 1)) / cols.length;
        cols.forEach((c, i) => {
          const card = c.classList.contains('sx-card');
          const runs = runsFrom(c, t, { fontSize: 18, fontFace: t.body });
          slide.addText(runs.length ? runs : ' ', { x: x0 + i * (cw + gap), y, w: cw, h: H - y - 0.7, valign: 'top', fit: 'shrink', fill: card ? { color: t.card } : undefined, margin: card ? 14 : 0, rectRadius: card ? 0.15 : 0, shape: card ? pptx.ShapeType.roundRect : undefined });
        });
      } else if (flowRuns.length) slide.addText(flowRuns, { x: x0, y, w: chartData.length ? w0 * 0.42 : w0, h: H - y - 0.7, valign: 'top', fit: 'shrink' });
      // inline images
      const imgs = [...body.querySelectorAll('img')];
      for (const [i, img] of imgs.entries()) {
        let data; try { data = await dataUrl(img.getAttribute('src') || ''); } catch { continue; }
        const iw = Math.min(w0 / imgs.length - 0.2, 5.5);
        slide.addImage({ data, x: x0 + i * (iw + 0.2), y: H - 3.6, w: iw, h: 3, sizing: { type: 'contain', w: iw, h: 3 } });
      }
    }
    if (chartData.length) {
      const hasText = [...body.children].some((c) => c !== firstHead && c.textContent.trim());
      const cx = hasText ? x0 + w0 * 0.45 : x0, cw = hasText ? w0 * 0.55 : w0, cy = firstHead ? 1.6 : 0.7, ch = H - cy - 0.8;
      const T = { column: 'bar', bar: 'bar', line: 'line', area: 'area', pie: 'pie', scatter: 'scatter' };
      const shades = ['1F1F1F', '5C5C5C', '8F8F8F', 'BDBDBD', '3D3D3D', '767676'];
      chartData.forEach(([spec, { categories, series }], i) => {
        const h = ch / chartData.length;
        const type = T[spec.type] || 'bar';
        const data = type === 'scatter' ? [{ name: 'X', values: series[0]?.values || [] }, { name: series[1]?.name || 'Y', values: (series[1] || series[0])?.values || [] }] : series.map((se) => ({ name: se.name, labels: categories, values: se.values.map((v) => v ?? 0) }));
        slide.addChart(pptx.ChartType[type], data, {
          x: cx, y: cy + i * h, w: cw, h: h - 0.1, barDir: spec.type === 'bar' ? 'bar' : 'col', barGrouping: spec.stacked ? 'stacked' : 'clustered',
          chartColors: type === 'pie' ? shades.slice(0, Math.max(1, categories.length)) : shades, showLegend: series.length > 1 || type === 'pie', legendPos: 'b',
          showTitle: !!spec.title, title: spec.title || '', titleFontSize: 14, catAxisLabelColor: t.muted, valAxisLabelColor: t.muted, legendColor: t.ink, titleColor: t.ink,
          showPercent: type === 'pie', dataLabelColor: t.ink, valGridLine: { color: 'DDDDDD', size: 0.5 }, catGridLine: { style: 'none' },
        });
      });
    }
    if (s.eff.footer) slide.addText(s.eff.footer, { x: 0.9, y: H - 0.55, w: W - 3, h: 0.35, fontSize: 11, color: t.muted, fontFace: t.body });
    if (s.eff.paginate === 'true') slide.addText(String(s.index + 1), { x: W - 1.2, y: H - 0.55, w: 0.6, h: 0.35, fontSize: 11, color: t.muted, align: 'right' });
    if (s.notes) slide.addNotes(s.notes);
  }
  return pptx.write({ outputType: 'uint8array' });
}
