// Folio — slides-md to PowerPoint at 1:1.
// Each slide is rendered off-screen at its real size and measured, so what PowerPoint gets is what Folio shows:
// text frames keep their position, fonts, sizes, colours and spacing; placed objects become native shapes, lines,
// pictures, tables, charts and media; masters become PowerPoint slide layouts with real placeholders.
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { parseChartSpec, resolveChart, toSeries } from './chart.js';
import { mastersFor, placeholdersFor } from './slides-core.js';
import { geometry, linePoints, linePath, parsePoints, pointsPath } from './slides-objects.js';

const IN = 1 / 96; // inches per CSS pixel
const PT = 0.75; // points per CSS pixel
const r2 = (n) => Math.round(n * 1000) / 1000;
const inch = (px) => r2(px * IN);

/* ---------- colours: any CSS colour (oklch, color-mix, var-resolved) to hex through a canvas ---------- */
let cctx = null; const ccache = new Map();
export function cssColor(c) {
  if (!c || c === 'transparent' || c === 'none') return null;
  if (ccache.has(c)) return ccache.get(c);
  if (!cctx) { const cv = document.createElement('canvas'); cv.width = cv.height = 1; cctx = cv.getContext('2d', { willReadFrequently: true }); }
  cctx.clearRect(0, 0, 1, 1); cctx.fillStyle = '#000'; cctx.fillStyle = c; cctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = cctx.getImageData(0, 0, 1, 1).data;
  const out = a === 0 ? null : { hex: [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), alpha: a / 255 };
  ccache.set(c, out); return out;
}
const transp = (alpha, opacity = 1) => Math.round((1 - alpha * opacity) * 100);

/* ---------- fonts: the portable family of a CSS stack ---------- */
const PLATFORM = /^(-apple-system|blinkmacsystemfont|system-ui|ui-[\w-]+|sans-serif|serif|monospace|cursive|fantasy|inherit|initial|sf pro.*|sf mono|new york|iowan old style|segoe ui variable.*|cascadia (code|mono))$/i;
export function pickFont(stack) {
  const list = String(stack || '').split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const named = list.find((f) => !PLATFORM.test(f));
  if (named) return named;
  if (list.some((f) => /mono/i.test(f))) return 'Consolas';
  if (list.some((f) => /^(serif|ui-serif|new york|iowan old style)$/i.test(f))) return 'Georgia';
  return 'Segoe UI';
}

/* ---------- svg paths to PowerPoint freeform points (in inches, relative to the shape) ---------- */
export function pathPoints(d, sx = 1, sy = 1) {
  const tok = String(d).match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) || [];
  const pts = []; let i = 0, cmd = '', x = 0, y = 0, x0 = 0, y0 = 0;
  const num = () => parseFloat(tok[i++]);
  const P = (px, py) => ({ x: r2(px * sx), y: r2(py * sy) });
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(); const C = cmd.toUpperCase();
    if (C === 'Z') { pts.push({ close: true }); x = x0; y = y0; continue; }
    if (C === 'M') { let nx = num(), ny = num(); if (rel) { nx += x; ny += y; } x = x0 = nx; y = y0 = ny; pts.push({ ...P(x, y), moveTo: true }); cmd = rel ? 'l' : 'L'; continue; }
    if (C === 'L') { let nx = num(), ny = num(); if (rel) { nx += x; ny += y; } x = nx; y = ny; pts.push(P(x, y)); continue; }
    if (C === 'H') { let nx = num(); if (rel) nx += x; x = nx; pts.push(P(x, y)); continue; }
    if (C === 'V') { let ny = num(); if (rel) ny += y; y = ny; pts.push(P(x, y)); continue; }
    if (C === 'C') { let [a, b, c, e, f, g] = [num(), num(), num(), num(), num(), num()]; if (rel) { a += x; b += y; c += x; e += y; f += x; g += y; } pts.push({ ...P(f, g), curve: { type: 'cubic', ...((p, q) => ({ x1: p.x, y1: p.y, x2: q.x, y2: q.y }))(P(a, b), P(c, e)) } }); x = f; y = g; continue; }
    if (C === 'Q') { let [a, b, f, g] = [num(), num(), num(), num()]; if (rel) { a += x; b += y; f += x; g += y; } const p = P(a, b); pts.push({ ...P(f, g), curve: { type: 'quadratic', x1: p.x, y1: p.y } }); x = f; y = g; continue; }
    return null; // arcs and the rest: not a freeform PowerPoint can take as is
  }
  return pts.some((p) => Number.isNaN(p.x) || Number.isNaN(p.y)) ? null : pts;
}

/** Folio shape names to PowerPoint preset shapes */
export const SHAPES = {
  rect: 'rect', predefined: 'rect', rounded: 'roundRect', state: 'roundRect', activity: 'roundRect', terminator: 'flowChartTerminator',
  ellipse: 'ellipse', circle: 'ellipse', usecase: 'ellipse', connector: 'ellipse', diamond: 'diamond', triangle: 'triangle', hexagon: 'hexagon',
  parallelogram: 'parallelogram', trapezoid: 'trapezoid', manual: 'flowChartManualInput', delay: 'flowChartDelay', offpage: 'flowChartOffpageConnector',
  step: 'chevron', cross: 'plus', star: 'star5', cloud: 'cloud', cylinder: 'can', document: 'flowChartDocument', callout: 'wedgeRectCallout', cube: 'cube',
};

/* ---------- pictures from the page ---------- */
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-size', 'font-family', 'font-weight'];
/** a standalone copy of a rendered <svg>: computed paint inlined, classes and CSS variables gone */
export function svgSnapshot(svg) {
  const clone = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, k) => {
    const cs = getComputedStyle(el); const out = dst[k];
    out.removeAttribute('class'); out.removeAttribute('style');
    if (cs.display === 'none') { out.setAttribute('display', 'none'); return; }
    for (const p of STYLE_PROPS) {
      let v = cs.getPropertyValue(p); if (!v) continue;
      if ((p === 'fill' || p === 'stroke') && !/^url\(/.test(v)) { const c = cssColor(v); v = c ? '#' + c.hex : 'none'; if (c && c.alpha < 1) out.setAttribute(p + '-opacity', String(c.alpha * (parseFloat(cs.getPropertyValue(p + '-opacity')) || 1))); }
      else if (p.endsWith('-opacity') && out.hasAttribute(p)) continue;
      out.setAttribute(p, v);
    }
  });
  const box = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.max(1, Math.round(box.width)))); clone.setAttribute('height', String(Math.max(1, Math.round(box.height))));
  const color = cssColor(getComputedStyle(svg).color);
  return new XMLSerializer().serializeToString(clone).replace(/currentColor/g, color ? '#' + color.hex : '#000000');
}
const svgData = (svg) => 'data:image/svg+xml;base64,' + b64(svgSnapshot(svg));

/** a CSS gradient (as computed) painted on a canvas at w×h, optionally with rounded corners */
export function gradientPng(css, w, h, radius = 0) {
  const m = String(css).match(/(repeating-)?(linear|radial)-gradient\((.*)\)\s*$/); if (!m) return null;
  const parts = []; let depth = 0, cur = '';
  for (const ch of m[3]) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += ch; }
  parts.push(cur.trim());
  const scale = 2, W = Math.max(2, Math.round(w * scale)), H = Math.max(2, Math.round(h * scale));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g2 = cv.getContext('2d');
  let first = parts[0], grad;
  const isStop = (p) => !!cssColor(p.replace(/\s+-?[\d.]+%?$/, '').replace(/\s+-?[\d.]+%?$/, ''));
  if (m[2] === 'linear') {
    let ang = 180;
    if (!isStop(first)) {
      parts.shift();
      const dm = first.match(/(-?[\d.]+)(deg|turn|rad)/); const to = first.match(/^to\s+(.+)$/);
      if (dm) ang = dm[2] === 'turn' ? +dm[1] * 360 : dm[2] === 'rad' ? (+dm[1] * 180) / Math.PI : +dm[1];
      else if (to) { const s = to[1]; ang = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 }[s] ?? 180; }
    }
    const t = (ang * Math.PI) / 180, L = Math.abs(W * Math.sin(t)) + Math.abs(H * Math.cos(t));
    const dx = (Math.sin(t) * L) / 2, dy = (-Math.cos(t) * L) / 2;
    grad = g2.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
  } else {
    if (!isStop(first)) parts.shift();
    grad = g2.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
  }
  const stops = parts.map((p) => { const pm = p.match(/^(.*?)(?:\s+(-?[\d.]+)%)?$/); return { c: cssColor(pm[1].trim()), at: pm[2] != null ? +pm[2] / 100 : null }; }).filter((s) => s.c);
  if (!stops.length) return null;
  stops.forEach((s, k) => { if (s.at == null) s.at = stops.length === 1 ? 0 : k / (stops.length - 1); grad.addColorStop(Math.min(1, Math.max(0, s.at)), `rgba(${parseInt(s.c.hex.slice(0, 2), 16)},${parseInt(s.c.hex.slice(2, 4), 16)},${parseInt(s.c.hex.slice(4), 16)},${s.c.alpha})`); });
  g2.fillStyle = grad;
  if (radius > 0) { g2.beginPath(); g2.roundRect(0, 0, W, H, radius * scale); g2.fill(); } else g2.fillRect(0, 0, W, H);
  return cv.toDataURL('image/png');
}
async function canvasData(img) {
  // a picture that is already on the page, as a data URL the presentation can embed
  const src = img.currentSrc || img.src || '';
  if (src.startsWith('data:')) return src;
  try { await img.decode(); } catch {}
  const cv = document.createElement('canvas'); cv.width = img.naturalWidth || 1; cv.height = img.naturalHeight || 1;
  cv.getContext('2d').drawImage(img, 0, 0); return cv.toDataURL('image/png');
}

/* ---------- text: paragraphs and runs from what the browser laid out ---------- */
const BLOCK = /^(block|list-item|flex|grid|table|flow-root)$/;
const isBlock = (el) => BLOCK.test(getComputedStyle(el).display);
function runOptions(el, opacity) {
  const cs = getComputedStyle(el);
  const o = { fontSize: r2(parseFloat(cs.fontSize) * PT), fontFace: pickFont(cs.fontFamily) };
  const c = cssColor(cs.color); if (c) { o.color = c.hex; const t = transp(c.alpha, opacity); if (t) o.transparency = t; }
  if (parseInt(cs.fontWeight, 10) >= 600) o.bold = true;
  if (cs.fontStyle === 'italic') o.italic = true;
  const deco = cs.textDecorationLine || '';
  if (deco.includes('underline')) o.underline = { style: 'sng' };
  if (deco.includes('line-through')) o.strike = 'sngStrike';
  const ls = parseFloat(cs.letterSpacing); if (ls) o.charSpacing = r2(ls * PT);
  if (cs.verticalAlign === 'super') o.superscript = true; else if (cs.verticalAlign === 'sub') o.subscript = true;
  const a = el.closest('a[href]'); if (a) { const href = a.getAttribute('href') || ''; if (/^(https?:|mailto:)/i.test(href)) o.hyperlink = { url: href }; }
  const bg = cssColor(cs.backgroundColor); if (bg && /^(mark|code|kbd)$/i.test(el.tagName)) o.highlight = bg.hex;
  return o;
}
const SKIP = 'img, svg, video, audio, canvas, .chart-block, table, .sm-sr, .katex-mathml, input, script, style';
/**
 * the paragraphs inside a block, each with its runs and where the browser put it.
 * lists become bulleted or numbered paragraphs with their nesting level.
 */
export function paragraphsOf(root, { opacity = 1 } = {}) {
  const out = []; let cur = null;
  const open = (owner, extra = {}) => { cur = { owner, runs: [], nodes: [], ...extra }; out.push(cur); };
  const close = () => { cur = null; };
  const text = (node) => {
    const el = node.parentElement; const cs = getComputedStyle(el);
    let t = node.textContent; const pre = /^pre/.test(cs.whiteSpace);
    if (!pre) t = t.replace(/\s+/g, ' ');
    if (cs.textTransform === 'uppercase') t = t.toUpperCase(); else if (cs.textTransform === 'lowercase') t = t.toLowerCase();
    if (!t) return;
    if (!cur) open(root.contains(el) ? el.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,dt,dd,figcaption,div,header,footer,span') || root : root);
    const o = runOptions(el, opacity);
    if (pre && t.includes('\n')) t.split('\n').forEach((line, k, all) => { cur.runs.push({ text: line || ' ', options: { ...o, breakLine: k < all.length - 1 } }); });
    else cur.runs.push({ text: t, options: o });
    cur.nodes.push(node);
  };
  const walk = (el, level, list) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (n.textContent.trim() || (cur && n.textContent)) text(n); continue; }
      if (n.nodeType !== 1) continue;
      if (n.matches(SKIP) || n.closest('.sm-sr')) continue;
      const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (n.tagName === 'BR') { if (cur?.runs.length) cur.runs[cur.runs.length - 1].options.breakLine = true; continue; }
      if (n.matches('.katex')) { const tex = n.querySelector('annotation')?.textContent; if (tex) { if (!cur) open(el); cur.runs.push({ text: tex, options: { ...runOptions(n, opacity), italic: true } }); } continue; }
      const tag = n.tagName;
      if (tag === 'UL' || tag === 'OL') { close(); walk(n, list ? level + 1 : level, tag); close(); continue; }
      if (tag === 'LI') {
        close(); const box = n.querySelector(':scope > input[type=checkbox]');
        const type = getComputedStyle(n).listStyleType;
        const pad = parseFloat(getComputedStyle(n.parentElement).paddingLeft) || 0;
        open(n, { level, bullet: box || type === 'none' ? false : list === 'OL' || /decimal|alpha|roman/.test(type) ? { type: 'number', indent: r2(pad * PT) } : { indent: r2(pad * PT) } });
        if (box) cur.runs.push({ text: box.checked ? '☑ ' : '☐ ', options: runOptions(n, opacity) });
        walk(n, level, list); close(); continue;
      }
      if (isBlock(n)) { if (cur && !cur.runs.length) { walk(n, level, list); close(); continue; } close(); walk(n, level, list); close(); continue; } // a loose list item's first paragraph stays on the bullet
      walk(n, level, list);
    }
  };
  walk(root, 0, null);
  // measure each paragraph: line boxes from a range, grown to the line height the browser used
  const res = [];
  for (const p of out) {
    while (p.runs.length && !p.runs[0].text.trim() && !p.runs[0].options.breakLine) { p.runs.shift(); }
    if (!p.runs.length) continue;
    p.runs[0].text = p.runs[0].text.replace(/^ +/, ''); const last = p.runs[p.runs.length - 1]; last.text = last.text.replace(/ +$/, '') || ' ';
    const rg = document.createRange(); rg.setStartBefore(p.nodes[0]); rg.setEndAfter(p.nodes[p.nodes.length - 1]);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
    const ocs = getComputedStyle(p.owner);
    const fs = parseFloat(ocs.fontSize) || 16; const lh = parseFloat(ocs.lineHeight) || fs * 1.2;
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    for (const r of rects) { const half = Math.max(0, (lh - r.height) / 2); top = Math.min(top, r.top - half); bottom = Math.max(bottom, r.bottom + half); left = Math.min(left, r.left); right = Math.max(right, r.right); }
    if (!Number.isFinite(top)) continue;
    const align = { start: 'left', left: 'left', center: 'center', right: 'right', end: 'right', justify: 'justify' }[ocs.textAlign] || 'left';
    const lines = new Set(rects.map((r) => Math.round(r.bottom / 4))).size;
    res.push({ lines, runs: p.runs, top, bottom, left, right, lineSpacing: r2(lh * PT), align, bullet: p.bullet, level: p.level || 0 });
  }
  return res;
}
/** paragraphs to pptxgenjs text runs, with the measured gaps as space before */
export function textRuns(paras, top) {
  const runs = []; let prev = top;
  for (const p of paras) {
    const first = runs.length;
    for (const r of p.runs) runs.push({ text: r.text, options: { ...r.options } });
    const o = runs[first].options;
    o.align = p.align; o.lineSpacing = p.lineSpacing;
    const gap = Math.round((p.top - prev) * PT * 10) / 10; if (gap > 0.5) o.paraSpaceBefore = gap;
    if (p.bullet) { o.bullet = p.bullet; if (p.level) o.indentLevel = p.level; } else if (p.bullet === false) o.bullet = false;
    // pptxgenjs reads paragraph settings from every run of the paragraph: give them all the same
    const para = Object.fromEntries(['align', 'lineSpacing', 'paraSpaceBefore', 'bullet', 'indentLevel'].filter((k) => k in o).map((k) => [k, o[k]]));
    for (let k = first + 1; k < runs.length; k++) Object.assign(runs[k].options, para);
    runs[runs.length - 1].options.breakLine = true;
    prev = p.bottom;
  }
  if (runs.length) delete runs[runs.length - 1].options.breakLine;
  return runs;
}

/* ---------- the writer: one place that knows how a slide or a master takes objects ---------- */
function sinkFor(target) {
  if (target.objects) { // a slide master being defined
    return {
      master: true,
      // layout objects take one plain string: keep the first run's look for the whole frame
      text: (t, o) => {
        if (!Array.isArray(t)) return target.objects.push({ text: { text: t, options: o } });
        const look = { ...(t[0]?.options || {}) }; delete look.breakLine; delete look.paraSpaceBefore;
        target.objects.push({ text: { text: t.map((r) => r.text + (r.options.breakLine ? '\n' : '')).join(''), options: { ...look, ...o } } });
      },
      shape: (type, o) => target.objects.push({ text: { text: '', options: { ...o, shape: type } } }),
      image: (o) => target.objects.push({ image: o }),
      table: () => {}, chart: () => {}, media: () => {},
    };
  }
  return {
    master: false,
    // pptxgenjs links runs, not text boxes: a clear shape on top carries the object's link
    text: (t, o) => {
      if (!o.hyperlink || o.placeholder) return target.addText(t, o);
      const { hyperlink, ...rest } = o; target.addText(t, rest);
      target.addShape('rect', { x: o.x, y: o.y, w: o.w, h: o.h, ...(o.rotate ? { rotate: o.rotate } : {}), fill: { color: 'FFFFFF', transparency: 100 }, line: { type: 'none' }, hyperlink, objectName: `${o.objectName || 'Text'} link` });
    },
    shape: (type, o) => target.addShape(type, o),
    image: (o) => target.addImage(o),
    table: (rows, o) => target.addTable(rows, o),
    chart: (type, data, o) => target.addChart(type, data, o),
    media: (o) => target.addMedia(o),
  };
}

const SHADOW = { soft: { blur: 13.5, offset: 4.5, opacity: 0.18 }, medium: { blur: 18, offset: 7.5, opacity: 0.28 }, hard: { blur: 0, offset: 6.4, opacity: 0.85, angle: 45 } };
const shadowOf = (a) => { const s = SHADOW[a.shadow]; return s ? { type: 'outer', color: '000000', angle: s.angle ?? 90, blur: s.blur, offset: s.offset, opacity: s.opacity } : undefined; };

function decor(el) {
  // fill, border and radius of an element, as PowerPoint shape options
  const cs = getComputedStyle(el); const op = parseFloat(cs.opacity) || 1;
  const o = {}; const bg = cssColor(cs.backgroundColor);
  if (bg) o.fill = { color: bg.hex, transparency: transp(bg.alpha, op) };
  const bw = parseFloat(cs.borderTopWidth) || 0; const bc = cssColor(cs.borderTopColor);
  if (bw && bc && cs.borderTopStyle !== 'none') o.line = { color: bc.hex, width: r2(bw * PT), transparency: transp(bc.alpha, op), dashType: cs.borderTopStyle === 'dashed' ? 'dash' : cs.borderTopStyle === 'dotted' ? 'sysDot' : 'solid' };
  const rad = parseFloat(cs.borderTopLeftRadius) || 0;
  const grad = /gradient\(/.test(cs.backgroundImage) ? cs.backgroundImage : null;
  return { o, rad, grad, has: !!(o.fill || o.line || grad), cs };
}
const roundOf = (rad, w, h) => (rad > 0 ? { shape: 'roundRect', rectRadius: r2(Math.min(0.5, rad / Math.max(1, Math.min(w, h)))) } : { shape: 'rect' });

export async function buildPptx(deck, { dataUrl, renderSlide, readNote, prepare }) {
  const pptx = new PptxGenJS();
  const W = deck.width * IN, H = deck.height * IN;
  pptx.defineLayout({ name: 'FOLIO', width: r2(W), height: r2(H) });
  pptx.layout = 'FOLIO';
  pptx.title = deck.global.title || deck.slides.find((s) => !s.master)?.title || 'Slides';
  if (deck.global.author) pptx.author = deck.global.author;
  if (deck.global.description) pptx.subject = deck.global.description;
  pptx.company = 'Made with Folio';

  const list = deck.slides.filter((s) => !s.master);
  let palette = null; const anchors = [];
  // render every slide at 1:1, off-screen, with pictures, icons, charts and live values in place
  // prepare() mounts the slides off-screen, hydrated and fitted, and hands back the host
  const host = await prepare(list.map((s) => renderSlide(deck, s)).join(''));
  try {
    await document.fonts?.ready;
    const sections = [...host.querySelectorAll(':scope > section.slide')];
    const first = sections[0];
    if (first) {
      const cs = getComputedStyle(first);
      pptx.theme = { headFontFace: pickFont(cs.getPropertyValue('--sl-face')), bodyFontFace: pickFont(cs.getPropertyValue('--sl-body')) };
    }
    if (first) palette = themePalette(first);
    const defined = new Map(); let section = null; const usedSections = new Set();
    for (const [k, s] of list.entries()) {
      const sec = sections[k]; if (!sec) continue;
      const origin = sec.getBoundingClientRect();
      const ctx = { pptx, origin, dataUrl, readNote, deck, s, anchors, k, list };
      // the slide's layout: its masters (an all-slides master plus a layout master) as one PowerPoint layout
      const masters = mastersFor(deck, s);
      let masterName = null;
      if (masters.length) {
        const key = s.layout;
        if (!defined.has(key)) defined.set(key, await defineMaster(ctx, sec, key));
        masterName = defined.get(key);
      }
      if (s.section) section = s.section;
      if (section && !usedSections.has(section)) { pptx.addSection({ title: section }); usedSections.add(section); }
      const slide = pptx.addSlide({ ...(masterName ? { masterName } : {}), ...(section ? { sectionTitle: section } : {}) });
      if (s.hidden) slide.hidden = true;
      await background(ctx, sec, slide);
      const out = sinkFor(slide);
      for (const layer of sec.children) {
        if (layer.matches('.sl-master') && masterName) continue; // drawn by the layout
        await emitLayer(ctx, layer, out, { slide });
      }
      if (s.notes) slide.addNotes(s.notes);
    }
  } finally { host.remove(); }
  const bytes = await pptx.write({ outputType: 'uint8array' });
  const motion = list.map((s, k) => ({ n: k + 1, transition: s.transition ?? deck.global.transition ?? null, advance: s.advance ?? deck.global.advance ?? null, animations: s.animations }));
  return finishPackage(bytes, { palette, fonts: pptx.theme, anchors, motion, W: deck.width, H: deck.height, loop: String(deck.global.loop) === 'true', kiosk: String(deck.global.kiosk) === 'true' });
}

/** the deck's tokens as a PowerPoint colour scheme, so theme colours in PowerPoint are the deck's */
function themePalette(sec) {
  const cs = getComputedStyle(sec); const v = (n) => cssColor(cs.getPropertyValue(n).trim())?.hex;
  const ink = v('--sl-ink') || '1F1F1F', paper = v('--sl-bg') || 'FFFFFF';
  const accent = v('--sl-accent') || v('--ch-1') || ink;
  const ch = [2, 3, 4, 5, 6].map((n) => v('--ch-' + n));
  return { dk1: ink, lt1: paper, dk2: v('--sl-muted') || '6B6B6B', lt2: v('--sl-card') || 'F0F0F0', accent1: accent, accent2: ch[0] || accent, accent3: ch[1] || accent, accent4: ch[2] || accent, accent5: ch[3] || accent, accent6: ch[4] || accent, hlink: accent, folHlink: v('--sl-muted') || accent };
}
/** what pptxgenjs cannot write: the deck's colour scheme and how layout placeholders anchor their text */
export async function finishPackage(bytes, { palette, fonts = {}, anchors = [], motion = [], W = 1280, H = 720, loop = false, kiosk = false } = {}) {
  const moving = motion.filter((m) => m.transition || m.advance || m.animations?.length);
  if (!palette && !anchors.length && !moving.length && !loop && !kiosk) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  if (loop || kiosk) {
    // how the show runs: looping, or browsed at a kiosk
    const f = zip.file('ppt/presProps.xml');
    if (f) { const x = (await f.async('string')).replace(/<p:showPr[\s\S]*?<\/p:showPr>|<p:showPr[^>]*\/>/, '').replace(/(<p:presentationPr\b[^>]*>)/, `$1<p:showPr loop="1" showNarration="1">${kiosk ? '<p:kiosk/>' : '<p:present/>'}<p:sldAll/></p:showPr>`); zip.file('ppt/presProps.xml', x); }
  }
  if (moving.length) { const { writeMotion } = await import('./slides-pptx-motion.js'); await writeMotion(zip, moving, { W, H }); }
  if (palette) await withTheme(zip, palette, fonts);
  if (anchors.length) {
    for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
      let xml = await zip.file(name).async('string');
      const lname = (xml.match(/<p:cSld name="([^"]*)"/) || [])[1]; const mine = anchors.filter((a) => a.layout === lname.replace(/&amp;/g, '&').replace(/&#183;|&middot;/g, '·'));
      if (!mine.length) continue;
      xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
        const idx = +(sp.match(/<p:ph[\s\S]*?idx="(\d+)"/) || [])[1]; const a = mine.find((m) => m.idx === idx);
        return a ? sp.replace(/<a:bodyPr\b([^>]*?)(\/?)>/, (m0, at, selfClose) => `<a:bodyPr${at.replace(/\s(anchor|lIns|tIns|rIns|bIns)="[^"]*"/g, '')} lIns="0" tIns="0" rIns="0" bIns="0" anchor="${a.anchor}"${selfClose}>`) : sp;
      });
      zip.file(name, xml);
    }
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
async function withTheme(zip, pal, fonts = {}) {
  const f = zip.file('ppt/theme/theme1.xml'); if (!f) return;
  let xml = await f.async('string');
  const scheme = `<a:clrScheme name="Folio">${Object.entries(pal).map(([k, hex]) => `<a:${k}><a:srgbClr val="${hex}"/></a:${k}>`).join('')}</a:clrScheme>`;
  xml = xml.replace(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/, scheme).replace(/(<a:theme[^>]*name=")[^"]*"/, '$1Folio"');
  if (fonts.headFontFace || fonts.bodyFontFace) xml = xml.replace(/<a:fontScheme name="[^"]*"/, '<a:fontScheme name="Folio"');
  zip.file('ppt/theme/theme1.xml', xml);
}

async function background(ctx, sec, target) {
  const cs = getComputedStyle(sec);
  const rect = sec.getBoundingClientRect();
  if (/gradient\(/.test(cs.backgroundImage)) {
    const png = gradientPng(cs.backgroundImage, rect.width, rect.height);
    if (png) { target.background = { data: png }; return; }
  }
  const c = cssColor(cs.backgroundColor);
  target.background = { color: c?.hex || 'FFFFFF' };
}

/** a PowerPoint slide layout from the master layer of a slide, with title/body/subtitle placeholders */
async function defineMaster(ctx, sec, key) {
  const { pptx, deck, s } = ctx;
  const name = `Folio · ${key}`;
  const def = { title: name, objects: [] };
  // background from the master (a slide may override it, so read the theme token, not the slide)
  const mbg = mastersFor(deck, s).map((m) => m.directives._backgroundColor ?? m.directives.backgroundColor).filter(Boolean).pop();
  const bgc = cssColor(mbg || getComputedStyle(sec).getPropertyValue('--sl-bg').trim());
  def.background = { color: bgc?.hex || 'FFFFFF' };
  const layer = sec.querySelector(':scope > .sl-master');
  const out = sinkFor(def);
  if (layer) for (const el of layer.children) await emitLayer(ctx, el, out, {});
  // placeholders: geometry from the master box, text style from how this slide shows it
  const ph = placeholdersFor(deck, s);
  for (const role of ['title', 'subtitle', 'body']) {
    const o = ph[role]; if (!o) continue;
    const g = geometry(o); const el = sec.querySelector(`.sl-ph-${role}`);
    const opts = { name: role, type: role === 'title' ? 'title' : 'body', x: inch(g.x), y: inch(g.y), w: inch(g.w), h: inch(g.h), margin: 0, valign: { middle: 'middle', bottom: 'bottom' }[o.attrs.valign] || 'top' };
    const p = el ? paragraphsOf(el)[0] : null;
    if (p) { const r = p.runs[0].options; Object.assign(opts, { fontFace: r.fontFace, fontSize: r.fontSize, color: r.color, bold: !!r.bold, align: p.align }); }
    // pptxgenjs drops the anchor and insets of layout placeholders: note them for the package pass
    ctx.anchors?.push({ layout: name, idx: 100 + def.objects.length, anchor: { middle: 'ctr', bottom: 'b' }[opts.valign] || 't' });
    def.objects.push({ placeholder: { options: opts, text: '' } });
  }
  pptx.defineSlideMaster(def);
  return name;
}
function numberOpts(ctx, el) {
  const r = el.getBoundingClientRect(); const ro = runOptions(el, 1);
  return { x: inch(r.left - ctx.origin.left), y: inch(r.top - ctx.origin.top), w: inch(Math.max(r.width, 40)), h: inch(r.height), fontFace: ro.fontFace, fontSize: ro.fontSize, color: ro.color, align: getComputedStyle(el).textAlign === 'left' ? 'left' : 'right' };
}

/** one layer of a rendered slide: backgrounds, master objects, the flow body, placeholders, placed objects, header and footer */
async function emitLayer(ctx, el, out, { slide }) {
  if (el.matches('.sl-master')) {
    // each master with objects renders one .sl-master-objs group, in order: pair them with their models
    const groups = mastersFor(ctx.deck, ctx.s).map((m) => (m.objects || []).filter((o) => !o.attrs.placeholder)).filter((x) => x.length);
    let gi = 0;
    for (const c of el.children) {
      if (c.matches('.sl-master-objs')) { const scope = groups[gi++] || []; [...c.children].forEach((x, n) => { x._model = scope[n]; x._scope = scope; }); }
      await emitLayer(ctx, c, out, { slide });
    }
    return;
  }
  if (el.matches('.sl-bg, .sl-side')) { for (const img of el.querySelectorAll('img')) await picture(ctx, img, out); return; }
  if (el.matches('.sl-placed')) { for (const c of el.children) { await placed(ctx, c, out); ctx.objName = null; } return; }
  if (el.matches('.sl-phs')) {
    for (const c of el.children) {
      const role = ['title', 'subtitle', 'body'].find((r) => c.classList.contains('sl-ph-' + r));
      const paras = paragraphsOf(c);
      if (slide && role && paras.length) out.text(textRuns(paras, paras[0].top), { placeholder: role, valign: 'top', ...(role === 'body' ? { objectName: 'folio-body' } : {}) });
      else await flow(ctx, c, out);
    }
    return;
  }
  if (el.matches('.sl-num')) { if (slide) slide.slideNumber = numberOpts(ctx, el); return; }
  if (el.matches('.sl-master-tag')) return;
  if (el.matches('header, footer')) { textFrame(ctx, [el], out); return; }
  if (el.matches('.sl-body')) { ctx.objName = 'folio-body'; await flow(ctx, el, out); ctx.objName = null; return; }
}

/* ---------- the flow body: text frames grouped by column, plus cards, pictures, tables and charts ---------- */
const TEXTY = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|DL|FIGCAPTION|HEADER|FOOTER|SPAN|A|STRONG|EM)$/;
async function flow(ctx, root, out) {
  let group = [];
  const flush = () => { if (group.length) textFrame(ctx, group, out); group = []; };
  const visit = async (el) => {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    if (el.matches('.chart-block[data-spec]') || el.querySelector(':scope > .chart-block[data-spec]')) { flush(); await chart(ctx, el.matches('.chart-block') ? el : el.querySelector('.chart-block'), out); return; }
    if (el.tagName === 'TABLE') { flush(); table(ctx, el, out); return; }
    if (el.tagName === 'IMG') { flush(); await picture(ctx, el, out); return; }
    if (el.tagName === 'svg' || el.tagName === 'SVG') { flush(); svgPicture(ctx, el, out); return; }
    const pics = el.querySelectorAll('img, svg, table, .chart-block[data-spec]');
    const d = decor(el);
    if (d.has) { // a card: its own frame, with fill and text inside
      flush();
      if (!pics.length) { textFrame(ctx, [el], out, { frame: el }); return; }
      frameShape(ctx, el, out);
      for (const c of el.children) await visit(c);
      return;
    }
    if (TEXTY.test(el.tagName) && !pics.length) { group.push(el); return; }
    if (!pics.length && el.children.length === 0 && el.textContent.trim()) { group.push(el); return; }
    // a container (columns, figures, layouts): text runs inside are their own frames
    flush();
    const kids = [...el.childNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
    if (kids.some((n) => n.nodeType === 3) && !pics.length) { group.push(el); flush(); return; }
    for (const c of el.children) await visit(c);
    flush();
  };
  for (const c of root.children) await visit(c);
  flush();
}

function frameShape(ctx, el, out) {
  const r = el.getBoundingClientRect(); const d = decor(el);
  const x = inch(r.left - ctx.origin.left), y = inch(r.top - ctx.origin.top), w = inch(r.width), h = inch(r.height);
  if (d.grad) { const png = gradientPng(d.grad, r.width, r.height, d.rad); if (png) out.image({ data: png, x, y, w, h }); }
  if (d.o.fill || d.o.line) { const rr = roundOf(d.rad, r.width, r.height); out.shape(rr.shape, { x, y, w, h, ...d.o, ...(rr.rectRadius ? { rectRadius: rr.rectRadius } : {}) }); }
}

/** a text frame for a run of text blocks (or one card), positioned where the browser drew it */
function textFrame(ctx, els, out, { frame = null, opts = {} } = {}) {
  const paras = els.flatMap((el) => paragraphsOf(el, { opacity: parseFloat(getComputedStyle(el).opacity) || 1 }));
  if (!paras.length && !frame) return;
  const rects = els.map((e) => e.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.right));
  const o = ctx.origin;
  if (frame) {
    const r = rects[0]; const d = decor(frame); const cs = d.cs;
    const pad = ['Left', 'Right', 'Bottom', 'Top'].map((s) => parseFloat(cs['padding' + s]) || 0);
    const cTop = r.top + pad[3], cBottom = r.bottom - pad[2];
    const pTop = paras[0]?.top ?? cTop, pBottom = paras[paras.length - 1]?.bottom ?? cTop;
    const gapT = pTop - cTop, gapB = cBottom - pBottom;
    const valign = Math.abs(gapT - gapB) < 6 && gapT > 6 ? 'middle' : gapB < 4 && gapT > 10 ? 'bottom' : 'top';
    const margin = [pad[0], pad[1], pad[2], pad[3] + (valign === 'top' ? Math.max(0, gapT) : 0)].map((v) => r2(v * PT));
    const rr = roundOf(d.rad, r.width, r.height);
    const x = inch(r.left - o.left), y = inch(r.top - o.top), w = inch(r.width), h = inch(r.height);
    if (d.grad) { const png = gradientPng(d.grad, r.width, r.height, d.rad); if (png) out.image({ data: png, x, y, w, h }); }
    out.text(paras.length ? textRuns(paras, paras[0].top) : '', { ...(ctx.objName ? { objectName: ctx.objName } : {}), x, y, w, h, margin, valign, wrap: true, ...d.o, ...rr, ...opts });
    return;
  }
  const top = Math.min(...paras.map((p) => p.top)), bottom = Math.max(...paras.map((p) => p.bottom));
  const slack = 6; // PowerPoint's text measures a touch wider than Chromium's
  const single = paras.every((p) => p.lines <= 1); // one-line text never wraps, whatever font PowerPoint finds
  out.text(textRuns(paras, top), { ...(ctx.objName ? { objectName: ctx.objName } : {}), x: inch(left - o.left - slack / 2), y: inch(top - o.top), w: inch(right - left + slack), h: inch(bottom - top + 2), margin: 0, valign: 'top', wrap: !single, ...opts });
}

function table(ctx, el, out) {
  const r = el.getBoundingClientRect(); const o = ctx.origin;
  const rows = [...el.rows].map((tr) => [...tr.cells].map((td) => {
    const cs = getComputedStyle(td); const ro = runOptions(td, 1);
    const opt = { bold: !!ro.bold || td.tagName === 'TH', fontFace: ro.fontFace, fontSize: ro.fontSize, color: ro.color, align: { start: 'left', center: 'center', right: 'right', end: 'right' }[cs.textAlign] || 'left', valign: 'middle', margin: ['Left', 'Right', 'Bottom', 'Top'].map((s) => r2((parseFloat(cs['padding' + s]) || 0) * PT)) };
    const bg = cssColor(cs.backgroundColor); if (bg) opt.fill = { color: bg.hex, transparency: transp(bg.alpha) };
    const side = (s) => { const w = parseFloat(cs[`border${s}Width`]) || 0; const c = cssColor(cs[`border${s}Color`]); return w && c && cs[`border${s}Style`] !== 'none' ? { type: 'solid', pt: r2(w * PT), color: c.hex } : { type: 'none' }; };
    opt.border = [side('Top'), side('Right'), side('Bottom'), side('Left')];
    if (td.colSpan > 1) opt.colspan = td.colSpan; if (td.rowSpan > 1) opt.rowspan = td.rowSpan;
    const paras = paragraphsOf(td);
    return { text: paras.length ? textRuns(paras, paras[0].top).map((x) => { delete x.options.paraSpaceBefore; return x; }) : '', options: opt };
  }));
  const first = el.rows[0]; const colW = first ? [...first.cells].map((c) => inch(c.getBoundingClientRect().width)) : undefined;
  out.table(rows, { x: inch(r.left - o.left), y: inch(r.top - o.top), w: inch(r.width), colW, rowH: [...el.rows].map((tr) => inch(tr.getBoundingClientRect().height)), autoPage: false });
}

async function chart(ctx, el, out) {
  const r = el.getBoundingClientRect(); const o = ctx.origin;
  let spec, series, categories;
  try { spec = parseChartSpec(decodeURIComponent(el.dataset.spec)); ({ categories, series } = toSeries(await resolveChart(spec, ctx.readNote), spec.by === 'rows' ? 'rows' : 'columns')); } catch { const svg = el.querySelector('svg'); if (svg) svgPicture(ctx, svg, out); return; }
  const T = { column: 'bar', bar: 'bar', line: 'line', area: 'area', pie: 'pie', scatter: 'scatter' };
  const type = T[spec.type] || 'bar';
  const sec = el.closest('section.slide'); const scs = getComputedStyle(sec);
  const shades = [1, 2, 3, 4, 5, 6].map((n) => cssColor(scs.getPropertyValue('--ch-' + n).trim())?.hex).filter(Boolean);
  const ink = cssColor(scs.color)?.hex || '1F1F1F', muted = cssColor(scs.getPropertyValue('--sl-muted').trim())?.hex || '6B6B6B', rule = cssColor(scs.getPropertyValue('--sl-rule').trim())?.hex || 'DDDDDD';
  const data = type === 'scatter' ? [{ name: 'X', values: series[0]?.values || [] }, { name: series[1]?.name || 'Y', values: (series[1] || series[0])?.values || [] }] : series.map((se) => ({ name: se.name, labels: categories, values: se.values.map((v) => v ?? 0) }));
  const body = pickFont(scs.fontFamily);
  out.chart(ctx.pptx.ChartType[type], data, {
    x: inch(r.left - o.left), y: inch(r.top - o.top), w: inch(r.width), h: inch(Math.max(r.height, 120)), barDir: spec.type === 'bar' ? 'bar' : 'col', barGrouping: spec.stacked ? 'stacked' : 'clustered',
    chartColors: type === 'pie' ? shades.slice(0, Math.max(1, categories.length)) : shades, showLegend: series.length > 1 || type === 'pie', legendPos: 'b', legendFontFace: body,
    showTitle: !!spec.title, title: spec.title || '', titleFontSize: 14, titleFontFace: body, catAxisLabelColor: muted, valAxisLabelColor: muted, legendColor: ink, titleColor: ink,
    catAxisLabelFontFace: body, valAxisLabelFontFace: body, showPercent: type === 'pie', dataLabelColor: ink, valGridLine: { color: rule, size: 0.5 }, catGridLine: { style: 'none' },
  });
}

/** a picture where the page shows it, honouring object-fit and the frame it sits in */
async function picture(ctx, img, out, { rotate = 0, transparency = 0, flipH = false, flipV = false, shadow } = {}) {
  const frame = img.closest('.sl-obj') || img; const fr = frame.getBoundingClientRect(); const ir = img.getBoundingClientRect();
  if (fr.width < 1 || fr.height < 1) return;
  let data; try { data = await canvasData(img); } catch { return; }
  const o = ctx.origin; const nw = img.naturalWidth || ir.width, nh = img.naturalHeight || ir.height;
  const cs = getComputedStyle(img); const fit = cs.objectFit;
  const extra = { ...(ctx.objName ? { objectName: ctx.objName } : {}), ...(rotate ? { rotate } : {}), ...(transparency ? { transparency } : {}), ...(flipH ? { flipH } : {}), ...(flipV ? { flipV } : {}), ...(shadow ? { shadow } : {}) };
  // the visible window: the frame when the image overflows it (crop), else the image box
  const vis = { left: Math.max(fr.left, ir.left), top: Math.max(fr.top, ir.top), right: Math.min(fr.right, ir.right), bottom: Math.min(fr.bottom, ir.bottom) };
  if (fit === 'cover' || fit === 'contain' || fit === 'none' || fit === 'scale-down') {
    const s = fit === 'cover' ? Math.max(ir.width / nw, ir.height / nh) : fit === 'none' ? 1 : Math.min(ir.width / nw, ir.height / nh, fit === 'scale-down' ? 1 : Infinity);
    const dw = nw * s, dh = nh * s; const pos = cs.objectPosition.split(' ').map((v) => (parseFloat(v) || 50) / 100);
    const dl = ir.left + (ir.width - dw) * pos[0], dt = ir.top + (ir.height - dh) * (pos[1] ?? 0.5);
    const L = Math.max(vis.left, dl), T = Math.max(vis.top, dt), R = Math.min(vis.right, dl + dw), B = Math.min(vis.bottom, dt + dh);
    if (R - L < 1 || B - T < 1) return;
    out.image({ data, x: inch(L - o.left), y: inch(T - o.top), w: inch(dw), h: inch(dh), sizing: { type: 'crop', x: inch(L - dl), y: inch(T - dt), w: inch(R - L), h: inch(B - T) }, altText: img.alt || '', ...extra });
    return;
  }
  // fill (stretched), possibly larger than its frame (a model crop)
  if (ir.width > fr.width + 0.5 || ir.height > fr.height + 0.5 || ir.left < fr.left - 0.5 || ir.top < fr.top - 0.5) {
    out.image({ data, x: inch(vis.left - o.left), y: inch(vis.top - o.top), w: inch(ir.width), h: inch(ir.height), sizing: { type: 'crop', x: inch(vis.left - ir.left), y: inch(vis.top - ir.top), w: inch(vis.right - vis.left), h: inch(vis.bottom - vis.top) }, altText: img.alt || '', ...extra });
  } else out.image({ data, x: inch(ir.left - o.left), y: inch(ir.top - o.top), w: inch(ir.width), h: inch(ir.height), altText: img.alt || '', ...extra });
}
function svgPicture(ctx, svg, out, extra = {}) {
  const r = svg.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
  out.image({ data: svgData(svg), x: inch(r.left - ctx.origin.left), y: inch(r.top - ctx.origin.top), w: inch(r.width), h: inch(r.height), ...extra });
}

/* ---------- placed objects: native PowerPoint objects at their model geometry ---------- */
const a0 = (o) => o?.attrs || {};
/** a Folio link as a PowerPoint hyperlink: web addresses and slide jumps (next, previous, first, last, slide:N, zooms) */
function linkFor(ctx, L) {
  if (!L) return null; L = String(L);
  if (/^(https?|mailto):/i.test(L)) return { url: L };
  const n = ctx.list.length; let to = null;
  if (L === 'next') to = ctx.k + 2; else if (L === 'prev') to = ctx.k; else if (L === 'first') to = 1; else if (L === 'last') to = n;
  else { const m = L.match(/^(?:slide:|#)(\d+)$/); if (m) { const t = ctx.list.findIndex((x) => x.number === +m[1]); if (t >= 0) to = t + 1; } }
  return to >= 1 && to <= n ? { slide: to } : null;
}
function objectOf(ctx, el) {
  // the model object behind a rendered element: slide objects carry their index, master objects were paired by order
  if (el._model) return { o: el._model, scope: el._scope };
  const objs = ctx.s.objects || [];
  return el.dataset.obj != null ? { o: objs[+el.dataset.obj], scope: objs } : { o: null, scope: objs };
}
async function placed(ctx, el, out) {
  const { o, scope } = objectOf(ctx, el);
  const cs = getComputedStyle(el); const op = parseFloat(cs.opacity) || 1;
  const r = el.getBoundingClientRect(); const origin = ctx.origin;
  // geometry: the model's for slide objects, the unrotated layout box for master objects
  let g;
  if (o) g = geometry(o);
  else { const st = el.style; g = { x: parseFloat(st.left) || r.left - origin.left, y: parseFloat(st.top) || r.top - origin.top, w: parseFloat(st.width) || r.width, h: parseFloat(st.height) || r.height, rotate: parseFloat((st.transform.match(/rotate\((-?[\d.]+)deg/) || [])[1]) || 0 }; }
  const a = o?.attrs || {};
  const flip = String(a.flip || (/scaleX\(-1\)|scale\(-1/.test(el.style.transform + (el.querySelector('svg')?.style.transform || '')) ? 'h' : ''));
  ctx.objName = o?.id ? `!!${o.id}` : null; // PowerPoint's Morph and our animations find objects by this name
  const hyperlink = linkFor(ctx, a0(o).link || el.dataset.link);
  const base = { ...(ctx.objName ? { objectName: ctx.objName } : {}), ...(hyperlink ? { hyperlink } : {}), x: inch(g.x), y: inch(g.y), w: inch(g.w), h: inch(g.h), ...(g.rotate ? { rotate: g.rotate } : {}), ...(flip.includes('h') ? { flipH: true } : {}), ...(flip.includes('v') ? { flipV: true } : {}) };
  const shadow = shadowOf(a);
  const kind = ['line', 'image', 'icon', 'media', 'smartart', 'path', 'shape', 'zoom', 'box'].find((k) => el.classList.contains('sl-' + k)) || 'box';
  if (kind === 'zoom') {
    // PowerPoint's own zoom objects need a thumbnail it renders itself: a framed card that jumps to the slide stands in
    const t = ctx.list.find((x) => x.number === +el.dataset.zoom); const to = t ? ctx.list.indexOf(t) + 1 : null;
    const ink = cssColor(getComputedStyle(el).color)?.hex || '1F1F1F';
    out.text([{ text: t?.title || (a.section ? `Section ${a.section}` : `Slide ${t?.number ?? ''}`), options: { bold: true, fontSize: 18, color: ink } }, { text: a.section ? `\nSection · ${t ? 'slide ' + t.number : ''}` : `\nSlide ${t?.number ?? ''}`, options: { fontSize: 12, color: ink } }],
      { ...base, ...(to && !hyperlink ? { hyperlink: { slide: to } } : {}), shape: 'roundRect', rectRadius: 0.06, fill: { color: cssColor(getComputedStyle(el).backgroundColor)?.hex || 'F4F4F4' }, line: { color: ink, width: 0.75, transparency: 70 }, align: 'center', valign: 'middle' });
    return;
  }

  if (kind === 'line') return line(ctx, el, o, scope, out);
  if (kind === 'image') { const img = el.querySelector('img'); if (img) await picture(ctx, img, out, { rotate: g.rotate, transparency: op < 1 ? Math.round((1 - op) * 100) : 0, flipH: base.flipH, flipV: base.flipV, shadow }); return; }
  if (kind === 'icon') { const svg = el.querySelector('svg'); if (svg) out.image({ data: svgData(svg), ...base, ...(op < 1 ? { transparency: Math.round((1 - op) * 100) } : {}) }); return; }
  if (kind === 'media') {
    const m = el.querySelector('video, audio'); const src = a.src || m?.dataset.src || '';
    if (!src || out.master) return;
    let data; try { data = await ctx.dataUrl(src); } catch { return; }
    if (!data || data.length > 140e6) return;
    let cover; if (a.poster) { try { cover = await ctx.dataUrl(a.poster); } catch {} }
    out.media({ type: m?.tagName === 'AUDIO' ? 'audio' : 'video', data, extn: (src.split('.').pop() || 'mp4').toLowerCase(), ...base, ...(cover ? { cover } : {}) });
    return;
  }
  if (kind === 'smartart') {
    const svg = el.querySelector(':scope > svg') || el.querySelector('svg'); if (svg) svgPicture(ctx, svg, out);
    for (const lab of el.querySelectorAll('.sm-label')) textFrame(ctx, [lab], out);
    return;
  }
  if (kind === 'path') {
    const svg = el.querySelector('svg'); const path = svg?.querySelector('path'); if (!path) return;
    const pcs = getComputedStyle(path);
    const d = a.d || (a.points ? pointsPath(parsePoints(a.points), a.closed === 'true', a.smooth === 'true') : path.getAttribute('d'));
    const pts = pathPoints(d, g.w * IN, g.h * IN);
    if (!pts) { svgPicture(ctx, svg, out, { rotate: g.rotate }); return; }
    const fill = cssColor(pcs.fill); const st = cssColor(pcs.stroke); const fo = parseFloat(pcs.fillOpacity); const sw = parseFloat(pcs.strokeWidth) || 0;
    out.shape('custGeom', { ...base, points: pts, fill: fill && pcs.fill !== 'none' ? { color: fill.hex, transparency: transp(fill.alpha * (Number.isNaN(fo) ? 1 : fo), op) } : { type: 'none' }, line: st && sw ? { color: st.hex, width: r2(sw * PT), dashType: a.dash === 'true' ? 'dash' : 'solid' } : { type: 'none' }, ...(shadow ? { shadow } : {}) });
    return;
  }
  // box and shape: a native shape with its text
  const inner = kind === 'shape' ? el.querySelector('.sl-obj-text') : el;
  const paras = inner ? paragraphsOf(inner, { opacity: op }) : [];
  let shape = 'rect', geom = {}, fillOpt, lineOpt;
  if (kind === 'shape') {
    const svg = el.querySelector('svg'); const fillEl = svg?.querySelector('.sl-shape-fill, path, rect, ellipse, circle, polygon');
    const pcs = fillEl ? getComputedStyle(fillEl) : null;
    const type = a.type || 'rect';
    shape = SHAPES[type] || null;
    if (type === 'rounded') geom.rectRadius = r2(Math.min(0.5, 12 / Math.max(1, Math.min(g.w, g.h))));
    if (!shape) { const pts = fillEl?.tagName === 'path' ? pathPoints(fillEl.getAttribute('d'), IN, IN) : null; if (pts) { shape = 'custGeom'; geom.points = pts; } else { svgPicture(ctx, svg, out, { rotate: g.rotate }); shape = null; } }
    if (pcs) {
      const f = cssColor(pcs.fill); const fo = parseFloat(pcs.fillOpacity);
      fillOpt = f && pcs.fill !== 'none' ? { color: f.hex, transparency: transp(f.alpha * (Number.isNaN(fo) ? 1 : fo), op) } : { type: 'none' };
      if (/^url\(/.test(pcs.fill)) { const stop = svg.querySelector('stop'); const sc = stop && cssColor(getComputedStyle(stop).stopColor); fillOpt = sc ? { color: sc.hex } : { type: 'none' }; }
      const s = cssColor(pcs.stroke); const sw = parseFloat(pcs.strokeWidth) || 0;
      lineOpt = s && sw && pcs.stroke !== 'none' ? { color: s.hex, width: r2(sw * PT), transparency: transp(s.alpha, op), dashType: pcs.strokeDasharray && pcs.strokeDasharray !== 'none' ? 'dash' : 'solid' } : { type: 'none' };
    }
  } else {
    const d = decor(el);
    if (d.grad) { const png = gradientPng(d.grad, g.w, g.h, d.rad); if (png) out.image({ data: png, ...base }); }
    fillOpt = d.o.fill || { type: 'none' }; lineOpt = d.o.line || { type: 'none' };
    const rr = roundOf(d.rad, g.w, g.h); shape = rr.shape; if (rr.rectRadius) geom.rectRadius = rr.rectRadius;
  }
  const valign = { top: 'top', middle: 'middle', bottom: 'bottom' }[a.valign] || (kind === 'shape' ? 'middle' : 'top');
  const ics = getComputedStyle(inner || el);
  const pad = ['Left', 'Right', 'Bottom', 'Top'].map((s) => r2((parseFloat(ics['padding' + s]) || 0) * PT));
  if (kind === 'shape' && inner) { // the text area of a shape sits inside it
    const ir = inner.getBoundingClientRect(), er = el.getBoundingClientRect();
    pad[0] += r2((ir.left - er.left) * PT); pad[1] += r2((er.right - ir.right) * PT); pad[3] += r2((ir.top - er.top) * PT); pad[2] += r2((er.bottom - ir.bottom) * PT);
  }
  if (!shape) { if (paras.length) textFrame(ctx, [inner], out); return; }
  const opts = { ...base, ...geom, margin: pad, valign, wrap: true, fill: fillOpt, line: lineOpt, ...(shadow ? { shadow } : {}), ...(a.fit === 'shrink' ? { fit: 'shrink' } : {}) };
  const runs = paras.length ? textRuns(paras, paras[0].top) : null;
  if (runs) { delete runs[0].options.paraSpaceBefore; out.text(runs, { ...opts, shape }); }
  else if (fillOpt?.type !== 'none' || lineOpt?.type !== 'none') out.shape(shape, opts);
  // a box holding a table, a picture or a chart: those go on top, where they are drawn
  for (const t of el.querySelectorAll(':scope table')) table(ctx, t, out);
  for (const img of el.querySelectorAll(':scope img')) await picture(ctx, img, out);
  for (const c of el.querySelectorAll(':scope .chart-block[data-spec]')) await chart(ctx, c, out);
}

function line(ctx, el, o, scope, out) {
  const svg = el.querySelector('svg'); const path = svg?.querySelector('path:not(.sl-line-hit), line, polyline');
  let pts, a = {};
  if (o) { a = o.attrs; const byId = Object.fromEntries((scope || []).filter((x) => x.id && x.kind !== 'line').map((x) => [x.id, geometry(x)])); pts = linePoints(o, byId); }
  if (!pts && path) {
    // master lines: read the drawn path back in slide coordinates
    const sr = svg.getBoundingClientRect(); const d = path.getAttribute('d') || ''; const nums = d.match(/-?[\d.]+/g)?.map(Number) || [];
    const vb = svg.viewBox?.baseVal; const ox = sr.left - ctx.origin.left - (vb?.x || 0), oy = sr.top - ctx.origin.top - (vb?.y || 0);
    if (nums.length >= 4) pts = [[nums[0] + ox, nums[1] + oy], [nums[nums.length - 2] + ox, nums[nums.length - 1] + oy]];
    a = { head: el.querySelector('polygon') ? 'arrow' : '', route: /[CQ]/.test(d) ? 'curve' : /H|V/.test(d) ? 'elbow' : '' };
  }
  if (!pts) return;
  const pcs = path ? getComputedStyle(path) : getComputedStyle(el);
  const c = cssColor(pcs.stroke) || cssColor(getComputedStyle(el).color);
  const width = parseFloat(a.width) || parseFloat(pcs.strokeWidth) || 3;
  const ln = { color: c?.hex || '1F1F1F', width: r2(width * PT), dashType: a.dash === 'true' ? 'dash' : 'solid', ...(/arrow/.test(a.head || '') ? { endArrowType: 'triangle' } : {}), ...(/arrow/.test(a.tail || '') ? { beginArrowType: 'triangle' } : {}) };
  const [[x1, y1], [x2, y2]] = pts;
  const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  if (a.route === 'elbow' || a.route === 'curve') {
    const local = pathPoints(linePath(pts, a.route), IN, IN);
    if (local) { const shifted = local.map((p) => (p.close ? p : { ...p, x: r2(p.x - x * IN), y: r2(p.y - y * IN), ...(p.curve ? { curve: Object.fromEntries(Object.entries(p.curve).map(([k, v]) => [k, typeof v === 'number' ? r2(v - (k.startsWith('x') ? x : y) * IN) : v])) } : {}) })); out.shape('custGeom', { ...(ctx.objName ? { objectName: ctx.objName } : {}), x: inch(x), y: inch(y), w: inch(Math.max(w, 1)), h: inch(Math.max(h, 1)), points: shifted, fill: { type: 'none' }, line: ln }); return; }
  }
  out.shape('line', { ...(ctx.objName ? { objectName: ctx.objName } : {}), x: inch(x), y: inch(y), w: inch(w), h: inch(h), ...(x1 > x2 ? { flipH: true } : {}), ...(y1 > y2 ? { flipV: true } : {}), line: ln });
}
