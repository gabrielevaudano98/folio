// Folio — PowerPoint (.pptx) and PowerPoint templates (.potx) to slides-md.
// pptxtojson (MIT) reads the shapes; the package structure (sizes, layouts, placeholders, theme, sections,
// hidden slides) is read here straight from the XML, so the result is a native Folio deck:
// slide layouts become masters with placeholders, titles and body text become flow Markdown,
// everything else becomes placed objects at the same geometry.
import JSZip from 'jszip';
import { SIZES } from './slides-core.js';

const PX = 4 / 3; // CSS px per point
const EMU_PX = 1 / 9525;
const round = (n) => Math.round(n * 10) / 10;
const attr = (xml, name) => (xml.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
const unxml = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&');
const norm = (base, target) => { const parts = (base.replace(/[^/]*$/, '') + target).split('/'); const out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); } return out.join('/'); };

/* ---------- the package ---------- */
async function rels(zip, part) {
  const relPath = part.replace(/([^/]*)$/, '_rels/$1.rels');
  const xml = (await zip.file(relPath)?.async('string')) || '';
  const map = {};
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) { const id = attr(m[0], 'Id'), t = attr(m[0], 'Target'), type = attr(m[0], 'Type') || ''; if (id && t) map[id] = { target: attr(m[0], 'TargetMode') === 'External' ? t : norm(part, t), type: type.split('/').pop() }; }
  return map;
}
/** theme colours and fonts as Folio tokens */
export function themeTokens(xml) {
  const col = (name) => { const m = xml.match(new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`)); if (!m) return null; return '#' + (attr(m[1], 'val') && /srgbClr/.test(m[1]) ? attr(m[1], 'val') : attr(m[1], 'lastClr') || '000000').toLowerCase(); };
  const font = (kind) => { const m = xml.match(new RegExp(`<a:${kind}>[\\s\\S]*?<a:latin [^>]*typeface="([^"]*)"`)); return m ? unxml(m[1]) : null; };
  const t = { paper: col('lt1'), ink: col('dk1'), muted: col('dk2'), accent: col('accent1'), card: col('lt2'), 'heading-font': font('majorFont'), 'body-font': font('minorFont') };
  for (const k of Object.keys(t)) if (!t[k] || /^\+/.test(t[k])) delete t[k];
  return t;
}
const FOLIO_LAYOUTS = ['default', 'title', 'section', 'two-columns', 'cards', 'image-right', 'image-left', 'quote', 'big-number', 'blank', 'title-only'];
/** PowerPoint layout types to Folio layouts */
export function folioLayout(type, name = '') {
  const n = String(name).toLowerCase();
  // a layout Folio wrote ("Folio · two-columns") names its Folio layout
  const own = n.match(/^folio · ([\w-]+)$/); if (own && FOLIO_LAYOUTS.includes(own[1])) return own[1];
  const T = { title: 'title', secHead: 'section', twoObj: 'two-columns', twoTxTwoObj: 'two-columns', twoColTx: 'two-columns', objTx: 'two-columns', picTx: 'image-right', blank: 'blank', titleOnly: 'title-only', obj: 'default', tx: 'default' };
  if (T[type]) return T[type];
  if (/title slide|titolo diapositiva|^title$/.test(n)) return 'title';
  if (/section|sezione/.test(n)) return 'section';
  if (/two|comparison|due|confronto/.test(n)) return 'two-columns';
  if (/blank|vuota/.test(n)) return 'blank';
  if (/title only|solo titolo/.test(n)) return 'title-only';
  return 'default';
}
/** placeholders of a layout (or master) part: role → geometry in EMU and style hints */
export function placeholders(xml) {
  const out = [];
  for (const m of xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
    const sp = m[1]; const ph = sp.match(/<p:ph\b[^>]*\/?>/); if (!ph) continue;
    const type = attr(ph[0], 'type') || 'body'; const idx = attr(ph[0], 'idx') || '0';
    const role = { title: 'title', ctrTitle: 'title', subTitle: 'subtitle', body: 'body', obj: 'body' }[type] || (attr(ph[0], 'type') ? null : 'body');
    const off = sp.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/), ext = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    const anchor = attr(sp.match(/<a:bodyPr\b[^>]*>/)?.[0] || '', 'anchor');
    const sz = sp.match(/<a:lvl1pPr[\s\S]*?<a:defRPr[^>]*\bsz="(\d+)"/) || sp.match(/<a:defRPr[^>]*\bsz="(\d+)"/) || sp.match(/<a:rPr[^>]*\bsz="(\d+)"/);
    const algn = attr(sp.match(/<a:lvl1pPr\b[^>]*>/)?.[0] || sp.match(/<a:pPr\b[^>]*>/)?.[0] || '', 'algn');
    const id = attr(sp.match(/<p:cNvPr\b[^>]*>/)?.[0] || '', 'id');
    out.push({ id, type, idx, role, geom: off && ext ? { x: +off[1], y: +off[2], w: +ext[1], h: +ext[2] } : null, valign: { b: 'bottom', ctr: 'middle' }[anchor] || null, size: sz ? +sz[1] / 100 : null, align: { ctr: 'center', r: 'right', just: 'justify' }[algn] || null });
  }
  return out;
}
/** default title and body sizes from a master's text styles, in pt */
function masterSizes(xml) {
  const pick = (tag) => { const m = xml.match(new RegExp(`<p:${tag}>[\\s\\S]*?<a:lvl1pPr[\\s\\S]*?<a:defRPr[^>]*\\bsz="(\\d+)"`)); return m ? +m[1] / 100 : null; };
  return { title: pick('titleStyle'), body: pick('bodyStyle') };
}

/* ---------- text: pptxtojson's HTML to Markdown ---------- */
const ESC_START = /^(\s*)([#>+-]|\d+\.|\*)(\s)/;
function inlineMd(html) {
  // spans with bold/italic/underline/link styles to Markdown; everything else to text
  let out = ''; const stack = [];
  const re = /<(\/?)(\w+)([^>]*)>|([^<]+)/g; let m;
  while ((m = re.exec(html))) {
    if (m[4] != null) { out += unxml(m[4]).replace(/([*_`\\[\]])/g, '\\$1'); continue; }
    const [, close, tag, rest] = m; const t = tag.toLowerCase();
    if (t === 'br') { out += '  \n'; continue; }
    if (close) {
      const top = stack.pop(); if (!top) continue;
      if (!top.post) continue;
      // emphasis cannot start or end on a space in Markdown: keep the spaces outside the markers
      const inner = out.slice(top.at); const lead = inner.match(/^\s*/)[0], trail = inner.slice(lead.length).match(/\s*$/)[0];
      const core = inner.slice(lead.length, inner.length - trail.length);
      out = out.slice(0, top.at - top.pre.length) + (core ? lead + top.pre + core + top.post + trail : inner);
      continue;
    }
    const style = unxml(attr(rest, 'style') || '');
    let pre = '', post = '';
    if (t === 'a') { const href = unxml(attr(rest, 'href') || ''); if (href) { pre = '['; post = `](${href})`; } }
    if (/font-weight:\s*(bold|[6-9]00)/.test(style) || t === 'b' || t === 'strong') { pre += '**'; post = '**' + post; }
    if (/font-style:\s*italic/.test(style) || t === 'i' || t === 'em') { pre += '*'; post = '*' + post; }
    if (/line-through/.test(style)) { pre += '~~'; post = '~~' + post; }
    out += pre; stack.push({ pre, post, at: out.length });
  }
  return out.replace(/\*\*\*\*|~~~~/g, '');
}
/** paragraphs and lists to Markdown, plus the look of the first run (size, colour, font, alignment) */
export function htmlToMd(html) {
  const lines = []; let look = null; const sizes = [];
  const s = String(html || '');
  const blocks = s.match(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>|<\/?(ul|ol)\b[^>]*>/g) || [];
  const lists = [];
  for (const b of blocks) {
    if (/^<(ul|ol)/.test(b)) { lists.push(b.startsWith('<ol') ? 'ol' : 'ul'); continue; }
    if (/^<\/(ul|ol)/.test(b)) { lists.pop(); continue; }
    const inner = b.replace(/^<(p|li)\b[^>]*>|<\/(p|li)>$/g, '');
    const text = inlineMd(inner).replace(/ /g, ' ').trimEnd();
    if (!look) {
      const span = inner.match(/<span\b[^>]*style="([^"]*)"/); const st = unxml(span?.[1] || '');
      const ps = unxml(attr(b, 'style') || '');
      if (text.trim()) look = { size: parseFloat((st.match(/font-size:\s*([\d.]+)pt/) || [])[1]) || null, color: (st.match(/color:\s*(#[0-9a-f]{3,8})/i) || [])[1] || null, font: ((st.match(/font-family:\s*"?([^";]+)"?/) || [])[1] || '').trim() || null, bold: /font-weight:\s*(bold|[6-9]00)/.test(st), align: (ps.match(/text-align:\s*(\w+)/) || [])[1] || null };
    }
    const psz = parseFloat((unxml(inner.match(/<span\b[^>]*style="([^"]*)"/)?.[1] || '').match(/font-size:\s*([\d.]+)pt/) || [])[1]) || null;
    sizes.push({ size: psz, chars: plain(inner).length, li: b.startsWith('<li'), at: lines.length });
    if (b.startsWith('<li')) { const depth = Math.max(0, lists.length - 1); const n = lists[lists.length - 1] === 'ol' ? '1.' : '-'; lines.push(`${'  '.repeat(depth)}${n} ${text.trim()}`); }
    else lines.push(text.trim() ? text.replace(ESC_START, '$1\\$2$3') : '');
  }
  // the box's size is the size most of its text has; clearly bigger paragraphs become headings
  const weight = {}; for (const z of sizes) if (z.size) weight[z.size] = (weight[z.size] || 0) + z.chars;
  const dominant = +Object.entries(weight).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  if (look && dominant) look.size = dominant;
  if (dominant && sizes.length > 1) for (const z of sizes) if (!z.li && z.size && z.size >= dominant * 1.25 && lines[z.at]?.trim()) lines[z.at] = `${z.size >= dominant * 1.8 ? '#' : '##'} ${lines[z.at].replace(/^\*\*(.*)\*\*$/, '$1').replace(/^\\/, '')}`;
  // paragraphs are separated by blank lines; list items stay together
  const md = []; for (const [i, l] of lines.entries()) { const isItem = /^\s*(-|\d+\.) /.test(l); const prevItem = i && /^\s*(-|\d+\.) /.test(lines[i - 1]); if (i && !(isItem && prevItem) && l !== '' && md[md.length - 1] !== '') md.push(''); if (l !== '' || md[md.length - 1] !== '') md.push(l); }
  return { md: md.join('\n').replace(/\n{3,}/g, '\n\n').trim(), look };
}
/** repeat a replace until nothing changes, so a tag cannot be rebuilt out of what is left (`<<b>script>`) */
const until = (s, re, to = '') => { for (let p = null; p !== s;) { p = s; s = s.replace(re, to); } return s; };
const plain = (html) => unxml(until(String(html || '').replace(/<br\s*\/?>/g, ' ').replace(/<\/(p|li)>/g, '\n'), /<[^>]+>/g)).replace(/ /g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).join(' ');

/* ---------- shapes ---------- */
export const PRESETS = {
  rect: 'rect', roundRect: 'rounded', snip1Rect: 'rect', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'triangle', diamond: 'diamond', hexagon: 'hexagon', octagon: 'hexagon',
  parallelogram: 'parallelogram', trapezoid: 'trapezoid', chevron: 'step', homePlate: 'step', plus: 'cross', star5: 'star', star4: 'star', star6: 'star', cloud: 'cloud', can: 'cylinder',
  flowChartProcess: 'rect', flowChartAlternateProcess: 'rounded', flowChartDecision: 'diamond', flowChartTerminator: 'terminator', flowChartDocument: 'document', flowChartManualInput: 'manual',
  flowChartDelay: 'delay', flowChartOffpageConnector: 'offpage', flowChartConnector: 'ellipse', flowChartMagneticDisk: 'cylinder', flowChartInputOutput: 'parallelogram', flowChartPredefinedProcess: 'predefined',
  wedgeRectCallout: 'callout', wedgeRoundRectCallout: 'callout', cube: 'cube', foldedCorner: 'note',
};
const LINES = /^(line|straightConnector\d*|bentConnector\d*|curvedConnector\d*)$/;
/** an SVG path in a w×h box to Folio's unit box (numbers scaled; arcs kept as they are drawn in the same box) */
export function unitPath(d, w, h) {
  if (!w || !h) return null;
  let i = 0; const tok = String(d).match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) || [];
  const out = []; let cmd = '', k = 0;
  const f = (v, axis) => String(Math.round((v / (axis ? h : w)) * 10000) / 10000);
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) { cmd = tok[i++]; out.push(cmd); k = 0; continue; }
    const C = cmd.toUpperCase(); const v = parseFloat(tok[i++]);
    if (C === 'A') { const pos = k % 7; out.push(pos === 0 ? f(v, 0) : pos === 1 ? f(v, 1) : pos === 5 ? f(v, 0) : pos === 6 ? f(v, 1) : String(v)); }
    else if (C === 'H') out.push(f(v, 0)); else if (C === 'V') out.push(f(v, 1));
    else out.push(f(v, k % 2));
    k++;
  }
  return out.join(' ');
}

/* ---------- the converter ---------- */
const q = (v) => (/[\s"]/.test(String(v)) ? `"${String(v).replace(/"/g, "'")}"` : String(v));
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false && !Number.isNaN(v)).map(([k, v]) => (k.startsWith('#') ? k : `${k}=${q(v)}`)).join(' ');
const color = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c.toLowerCase() : null);
const fillAttr = (fill) => {
  if (!fill) return null;
  if (fill.type === 'color') return color(fill.value);
  if (fill.type === 'gradient' && fill.value?.colors?.length) { const cs = fill.value.colors.map((c) => color(c.color)).filter(Boolean); if (cs.length >= 2) return fill.value.path === 'line' ? `linear(${cs[0]},${cs[cs.length - 1]},${Math.round(((fill.value.rot || 0) + 90) % 360)})` : `radial(${cs[0]},${cs[cs.length - 1]})`; return cs[0] || null; }
  return null;
};

/**
 * a .pptx or .potx as slides-md.
 * saveAsset(name, bytes) stores a picture or clip next to the deck and returns its relative path.
 * With template: true (always for .potx) the result is a Folio template: the layouts as masters, one sample slide each.
 */
export async function importPowerPoint(buf, { name = 'Presentation', template = false, saveAsset, parse } = {}) {
  let zip = await JSZip.loadAsync(buf);
  const ct = (await zip.file('[Content_Types].xml')?.async('string')) || '';
  const isTemplate = template || /presentationml\.template\.main\+xml/.test(ct);
  const presXml = (await zip.file('ppt/presentation.xml')?.async('string')) || '';
  if (!presXml) throw new Error('This file is not a PowerPoint presentation.');
  const presRels = await rels(zip, 'ppt/presentation.xml');
  const sz = presXml.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  const srcW = sz ? +sz[1] * EMU_PX : 1280, srcH = sz ? +sz[2] * EMU_PX : 720;
  // the nearest Folio size; everything scales by the width
  const sizeName = Object.entries(SIZES).sort((a, b) => Math.abs(a[1][0] / a[1][1] - srcW / srcH) - Math.abs(b[1][0] / b[1][1] - srcW / srcH))[0][0];
  const [W, H] = SIZES[sizeName]; const k = W / srcW; void H;
  const P = (pt) => round(pt * PX * k); // pptxtojson points to Folio px
  const E = (emu) => round(emu * EMU_PX * k); // EMU to Folio px

  // masters, layouts and theme
  const masterPart = Object.values(presRels).find((r) => r.type === 'slideMaster')?.target;
  const masterXml = masterPart ? (await zip.file(masterPart)?.async('string')) || '' : '';
  const masterRels = masterPart ? await rels(zip, masterPart) : {};
  const themePart = Object.values(masterRels).find((r) => r.type === 'theme')?.target || Object.values(presRels).find((r) => r.type === 'theme')?.target;
  const tokens = themeTokens((themePart && (await zip.file(themePart)?.async('string'))) || '');
  const msizes = masterSizes(masterXml);
  const masterPh = placeholders(masterXml);
  const layoutParts = Object.values(masterRels).filter((r) => r.type === 'slideLayout').map((r) => r.target);
  const layouts = new Map(); // part → info
  for (const part of layoutParts) {
    const xml = (await zip.file(part)?.async('string')) || '';
    const lname = unxml(attr(xml.match(/<p:cSld\b[^>]*>/)?.[0] || '', 'name') || '');
    const ph = placeholders(xml).map((p) => {
      const base = masterPh.find((m) => m.type === p.type || (m.role && m.role === p.role)) || {};
      return { ...p, geom: p.geom || base.geom, valign: p.valign || base.valign, size: p.size || base.size || (p.role === 'title' ? msizes.title : msizes.body), align: p.align || base.align };
    });
    layouts.set(part, { part, name: lname, type: attr(xml.match(/<p:sldLayout\b[^>]*>/)?.[0] || '', 'type'), key: folioLayout(attr(xml.match(/<p:sldLayout\b[^>]*>/)?.[0] || '', 'type'), lname), ph });
  }

  // slides (a template gets one synthetic slide per layout, so its layouts come out with their shapes)
  let slideParts = (presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)?.[1].match(/<p:sldId\b[^>]*>/g) || []).map((t) => ({ id: attr(t, 'id'), part: presRels[attr(t, 'r:id')]?.target })).filter((s) => s.part);
  let synthetic = false;
  if (isTemplate || !slideParts.length) {
    ({ zip, slideParts } = await synthesize(zip, presXml, ct, layoutParts));
    synthetic = true;
  }
  const slideInfo = [];
  for (const s of slideParts) {
    const xml = (await zip.file(s.part)?.async('string')) || '';
    const r = await rels(zip, s.part);
    const layoutPart = Object.values(r).find((x) => x.type === 'slideLayout')?.target;
    slideInfo.push({ ...s, hidden: /<p:sld\b[^>]*\bshow="0"/.test(xml), ph: placeholders(xml), layout: layouts.get(layoutPart) || null });
  }
  // sections
  const sectionOf = {};
  for (const m of presXml.matchAll(/<p14:section\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/p14:section>/g)) { const first = m[2].match(/<p14:sldId id="(\d+)"/); if (first) sectionOf[first[1]] = unxml(m[1]); }

  const out = await zip.generateAsync({ type: 'arraybuffer' });
  const lib = parse ? null : await import('pptxtojson');
  const parsed = await (parse || lib.parse || lib.default?.parse)(out, { imageMode: 'base64', videoMode: 'blob', audioMode: 'blob' });

  let assetN = 0;
  const save = async (dataOrBlob, ext, label) => {
    if (!saveAsset || !dataOrBlob) return null;
    let bytes;
    if (dataOrBlob.startsWith('data:')) { const b = atob(dataOrBlob.split(',')[1] || ''); bytes = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i); ext = ext || (dataOrBlob.match(/^data:\w+\/([\w+]+)/)?.[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg'); }
    else { try { bytes = new Uint8Array(await (await fetch(dataOrBlob)).arrayBuffer()); } catch { return null; } }
    return saveAsset(`${label || 'pic'}-${++assetN}.${ext || 'bin'}`, bytes);
  };

  // one object per pptxtojson element; a name like `!!claim` (Folio's export, PowerPoint's Morph) keeps its id
  let idN = 0; let spidMap = {};
  const own = (el, prefix) => { const nm = String(el.name || ''); const id = /^!!([\w-]+)$/.test(nm) ? nm.slice(2) : `${prefix}${++idN}`; spidMap[String(el.id)] = id; return `#${id}`; };
  const convert = async (el, dx = 0, dy = 0, skipIds = new Set()) => {
    if ((el.type === 'text' || el.type === 'shape') && skipIds.has(String(el.id))) return [];
    const x = P(el.left + dx), y = P(el.top + dy), w = P(el.width), h = P(el.height);
    const geo = { x, y, w, h, rotate: el.rotate ? round(el.rotate) : undefined, flip: (el.isFlipH ? 'h' : '') + (el.isFlipV ? 'v' : '') || undefined };
    if (el.type === 'group' || el.type === 'diagram') {
      const kids = [];
      for (const c of el.elements || []) kids.push(...(await convert(c, el.type === 'group' ? el.left + dx : dx, el.type === 'group' ? el.top + dy : dy)));
      return kids;
    }
    if (el.type === 'image' || el.type === 'math') {
      const src = await save(el.base64 || el.picBase64, null, 'picture'); if (!src) return [];
      const r = el.rect || {}; const l = (r.l || 0) / 100, t = (r.t || 0) / 100, rr = (r.r || 0) / 100, b = (r.b || 0) / 100;
      const crop = l || t || rr || b ? `${round(l * 1000) / 1000},${round(t * 1000) / 1000},${round((1 - l - rr) * 1000) / 1000},${round((1 - t - b) * 1000) / 1000}` : undefined;
      const mask = { ellipse: 'ellipse', roundRect: 'rounded', diamond: 'diamond', hexagon: 'hexagon', triangle: 'triangle', star5: 'star' }[el.geom];
      return [`![${el.type === 'math' ? (el.latex || 'Equation').replace(/[[\]]/g, '') : ''}](${src}){${attrs({ ...geo, crop, mask, stroke: el.borderWidth ? color(el.borderColor) : null, border: el.borderWidth ? P(el.borderWidth) : null })}}`];
    }
    if (el.type === 'video' || el.type === 'audio') {
      const src = await save(el.blob, el.type === 'video' ? 'mp4' : 'mp3', el.type); if (!src) return [];
      return [`::: media ${attrs({ src, ...geo })} :::`];
    }
    if (el.type === 'table') {
      const rows = el.data || []; if (!rows.length) return [];
      const cell = (c) => plain(c.text).replace(/\|/g, '\\|') || ' ';
      const head = `| ${rows[0].map(cell).join(' | ')} |`, sep = `|${rows[0].map(() => ' --- ').join('|')}|`;
      return [`::: box ${attrs({ [own(el, 't')]: 1, ...geo })}\n${[head, sep, ...rows.slice(1).map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n')}\n:::`];
    }
    if (el.type === 'chart') {
      const T = { barChart: el.barDir === 'bar' ? 'bar' : 'column', bar3DChart: 'column', lineChart: 'line', line3DChart: 'line', areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie', doughnutChart: 'pie', scatterChart: 'scatter' };
      const items = el.data || []; const cats = items[0]?.values?.map((v) => items[0].xlabels?.[v.x] ?? v.x) || [];
      if (!items.length) return [];
      const table = [`| | ${items.map((s) => s.key).join(' | ')} |`, `|---|${items.map(() => '---').join('|')}|`, ...cats.map((c, i) => `| ${c} | ${items.map((s) => s.values[i]?.y ?? '').join(' | ')} |`)];
      return [`::: box ${attrs({ [own(el, 'c')]: 1, ...geo })}\n\`\`\`chart\ntype: ${T[el.chartType] || 'column'}\n${(el.grouping || el.barGrouping) === 'stacked' ? 'stacked: true\n' : ''}data:\n${table.join('\n')}\n\`\`\`\n:::`];
    }
    // shapes and text boxes
    const shapType = el.shapType || 'rect';
    if (LINES.test(shapType) || (el.type === 'shape' && el.strokeOnly && /^M[^A-Za-z]*L[^A-Za-z]*$/i.test(String(el.path || '').trim()))) {
      // a line: from one corner to the other, flips decide which
      let lx = x, ly = y, lw = w, lh = h;
      if (el.isFlipH) { lx = round(x + w); lw = -w; } if (el.isFlipV) { ly = round(y + h); lh = -h; }
      const end = (e) => (e && e.type && e.type !== 'none' ? 'arrow' : undefined);
      return [`::: line ${attrs({ [own(el, 'l')]: 1, x: lx, y: ly, w: lw, h: lh, rotate: geo.rotate, head: end(el.tailEnd), tail: end(el.headEnd), stroke: color(el.borderColor), width: el.borderWidth ? P(el.borderWidth) : undefined, dash: el.borderType && el.borderType !== 'solid' ? 'true' : undefined, route: /^bent/.test(shapType) ? 'elbow' : undefined })} :::`];
    }
    const { md, look } = htmlToMd(el.content);
    const fill = fillAttr(el.fill);
    const stroke = el.borderWidth ? color(el.borderColor) : null;
    const textLook = look ? { size: look.size ? P(look.size) : undefined, color: color(look.color) && color(look.color) !== tokens.ink ? color(look.color) : undefined, font: look.font && look.font !== tokens['body-font'] ? look.font : undefined, align: look.align && look.align !== 'left' ? look.align : undefined } : {};
    const valign = { mid: 'middle', down: 'bottom' }[el.vAlign];
    const preset = PRESETS[shapType];
    const isBox = el.type === 'text' || shapType === 'rect' || (shapType === 'roundRect' && md);
    if (isBox) {
      if (!md && !fill && !stroke) return [];
      const radius = shapType === 'roundRect' ? round(Math.min(w, h) * (el.keypoints?.adj ?? 0.1667)) : undefined;
      // PowerPoint lets text overflow its frame; a Folio box clips, so an unfilled text box gets room to grow
      const roomy = !fill && !stroke && md ? { h: round(h * 1.12 + 8) } : {};
      return [`::: box ${attrs({ [own(el, 'b')]: 1, ...geo, ...roomy, fill, stroke, border: stroke ? P(el.borderWidth) : undefined, radius, valign: valign && valign !== 'top' ? valign : undefined, ...textLook })}\n${md}\n:::`];
    }
    if (preset) return [`::: shape ${attrs({ [own(el, 's')]: 1, type: preset, ...geo, fill: fill || 'none', stroke, border: stroke ? P(el.borderWidth) : undefined, dash: el.borderType && el.borderType !== 'solid' ? 'true' : undefined, ...textLook })}${md ? `\n${md}\n:::` : ' :::'}`];
    // any other geometry: a free shape with its outline
    const d = el.path && el.pathViewBox ? unitPath(el.path, el.pathViewBox.width, el.pathViewBox.height) : null;
    const lines = [];
    if (d) lines.push(`::: path ${attrs({ [own(el, 'p')]: 1, ...geo, d, fill: fill || 'none', stroke, border: stroke ? P(el.borderWidth) : undefined })} :::`);
    if (md) lines.push(`::: box ${attrs({ [own(el, 'b')]: 1, ...geo, valign: valign || 'middle', align: 'center', ...textLook })}\n${md}\n:::`);
    return lines;
  };

  // a slide: title and body placeholders go to the flow, the rest is placed
  const ROLE_SKIP = /^(dt|ftr|sldNum|hdr)$/;
  let paginate = false;
  const slideText = async (s, info, { asMaster = false } = {}) => {
    const lines = []; const flow = { title: '', body: '', subtitle: '' };
    const byId = Object.fromEntries((info?.ph || []).map((p) => [String(p.id), p]));
    const skip = new Set();
    for (const el of s.elements) {
      const ph = (el.type === 'text' || el.type === 'shape') && byId[String(el.id)];
      if (!ph) continue;
      if (ROLE_SKIP.test(ph.type)) { if (ph.type === 'sldNum') paginate = true; skip.add(String(el.id)); continue; }
      if (!asMaster && ph.role && info.layout?.ph.some((p) => p.role === ph.role) && !flow[ph.role]) {
        const { md } = htmlToMd(el.content);
        flow[ph.role] = ph.role === 'title' ? plain(el.content) : md; skip.add(String(el.id)); if (ph.role !== 'title') spidMap[String(el.id)] = 'body';
      }
    }
    if (flow.title) lines.push(`# ${flow.title.replace(/^#+\s*/, '')}`);
    if (flow.subtitle) lines.push(flow.subtitle);
    if (flow.body) lines.push(flow.body);
    const objs = [];
    for (const el of s.elements) objs.push(...(await convert(el, 0, 0, skip)));
    return { flow: lines.join('\n\n'), objects: objs };
  };

  const blocks = [];
  // masters: one per Folio layout used, from the PowerPoint layout that maps to it
  // several PowerPoint layouts can map to one Folio layout: the richest one becomes its master
  const usedKeys = new Map();
  const score = (si, i) => (si.layout?.ph.filter((p) => p.role).length || 0) * 10 + (parsed.slides[i]?.layoutElements?.length || 0);
  slideInfo.forEach((si, i) => { const L = si.layout; if (!L) return; const cur = usedKeys.get(L.key); if (!cur || score(si, i) > score(slideInfo[cur.i], cur.i)) usedKeys.set(L.key, { L, i }); });
  for (const [key, { L, i }] of [...usedKeys]) {
    const s = parsed.slides[i];
    // a layout with nothing on it (no shapes, no placeholders) needs no master
    if (!(s.layoutElements || []).length && !L.ph.some((p) => p.role && p.geom)) { usedKeys.delete(key); continue; }
    const lines = [`<!-- master: ${key} only -->`];
    const bg = fillAttr(s.fill); if (bg) lines.push(bg.startsWith('#') ? `<!-- _backgroundColor: ${bg} -->` : `<!-- _backgroundImage: ${bg.replace(/^linear\((#\w+),(#\w+),(\d+)\)$/, 'linear-gradient($3deg, $1, $2)').replace(/^radial\((#\w+),(#\w+)\)$/, 'radial-gradient($1, $2)')} -->`);
    else if (s.fill?.type === 'image') { const src = await save(s.fill.value?.base64, null, 'background'); if (src) lines.push(`![bg](${src})`); }
    lines.push(`## Master: ${L.name || key}`);
    for (const el of s.layoutElements || []) lines.push(...(await convert(el)));
    for (const p of L.ph) {
      if (!p.role || !p.geom || ROLE_SKIP.test(p.type) || lines.some((l) => l.includes(`placeholder=${p.role} `))) continue;
      const g = p.geom;
      lines.push(`::: box ${attrs({ placeholder: p.role, x: E(g.x), y: E(g.y), w: E(g.w), h: E(g.h), size: p.size ? P(p.size) : undefined, align: p.align || undefined, valign: p.valign || undefined })}\n${p.role === 'title' ? '## Slide title' : p.role === 'subtitle' ? 'Subtitle' : '- First level\n  - Second level'}\n:::`);
    }
    blocks.push(lines.join('\n\n'));
  }
  // slides
  let section = null; const sampled = new Set();
  for (const [i, si] of slideInfo.entries()) {
    const s = parsed.slides[i]; if (!s) continue;
    if (synthetic) { const k2 = si.layout?.key; const u = usedKeys.get(k2); if (u ? u.i !== i : sampled.has(k2)) continue; sampled.add(k2); } // one sample slide per Folio layout
    const lines = [];
    const key = si.layout?.key;
    if (key && key !== 'default') lines.push(`<!-- layout: ${key} -->`);
    if (sectionOf[si.id] && sectionOf[si.id] !== section) { section = sectionOf[si.id]; lines.push(`<!-- section: ${until(section, /--!?>/g)} -->`); }
    if (si.hidden) lines.push('<!-- hidden -->');
    const master = usedKeys.get(key); const mbg = master ? fillAttr(parsed.slides[master.i].fill) : tokens.paper || '#ffffff';
    const bg = fillAttr(s.fill); if (bg && bg !== mbg) lines.push(bg.startsWith('#') ? `<!-- _backgroundColor: ${bg} -->` : `<!-- _backgroundImage: ${bg.replace(/^linear\((#\w+),(#\w+),(\d+)\)$/, 'linear-gradient($3deg, $1, $2)').replace(/^radial\((#\w+),(#\w+)\)$/, 'radial-gradient($1, $2)')} -->`);
    else if (s.fill?.type === 'image' && !master) { const src = await save(s.fill.value?.base64, null, 'background'); if (src) lines.push(`![bg](${src})`); }
    if (synthetic) {
      const L = si.layout; lines.push(`# ${(L?.name || 'Layout').replace(/^Folio · /, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())}`);
      if (L?.ph.some((p) => p.role === 'subtitle')) lines.push('Replace with your subtitle');
      if (L?.ph.some((p) => p.role === 'body')) lines.push('- A first point\n- A second point\n  - A detail');
    } else {
      spidMap = {};
      const { flow, objects } = await slideText(s, si);
      if (flow) lines.push(flow);
      lines.push(...objects);
      // transitions, auto-advance and animations, read from the slide part
      const sx = (await zip.file(si.part)?.async('string')) || '';
      const motion = await import('./slides-pptx-motion.js');
      const { transition, advance } = motion.readTransition(sx);
      if (transition) lines.unshift(`<!-- transition: ${transition} -->`);
      if (advance) lines.unshift(`<!-- advance: ${advance} -->`);
      const anims = motion.readAnimations(sx, (spid) => spidMap[spid]);
      if (anims.length) lines.push(`<!--\n${anims.map((a) => 'animate: ' + a).join('\n')}\n-->`);
    }
    const note = plain(s.note); if (note && !synthetic) lines.push(`<!-- ${until(note, /--!?>/g, '—>')} -->`);
    blocks.push(lines.join('\n\n'));
  }

  const fm = ['marp: true'];
  if (isTemplate) fm.push(`template-name: ${q(name)}`, `template-description: ${q(`Imported from ${name}.potx`)}`);
  fm.push('theme: folio');
  if (sizeName !== '16:9') fm.push(`size: ${sizeName}`);
  for (const [kk, v] of Object.entries(tokens)) fm.push(`${kk}: ${v.startsWith('#') ? `"${v}"` : v}`);
  if (paginate || isTemplate) fm.push('paginate: true');
  return `---\n${fm.join('\n')}\n---\n\n${blocks.join('\n\n---\n\n')}\n`;
}

/** a template package has layouts but no slides: add one slide per layout so every layout is read */
async function synthesize(zip, presXml, ct, layoutParts) {
  const z = zip;
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const slideParts = []; let presRels = (await z.file('ppt/_rels/presentation.xml.rels')?.async('string')) || '';
  let ids = '', types = ct.replace('presentationml.template.main+xml', 'presentationml.presentation.main+xml');
  // drop existing slides from the list: the synthetic ones replace them
  layoutParts.forEach((lp, n) => {
    const part = `ppt/slides/folio-layout-${n + 1}.xml`;
    z.file(part, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    z.file(`ppt/slides/_rels/folio-layout-${n + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../${lp.replace(/^ppt\//, '')}"/></Relationships>`);
    const rid = `rIdFolio${n + 1}`;
    presRels = presRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/folio-layout-${n + 1}.xml"/></Relationships>`);
    ids += `<p:sldId id="${9000 + n}" r:id="${rid}"/>`;
    types = types.replace('</Types>', `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`);
    slideParts.push({ id: String(9000 + n), part });
  });
  let pres = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, '').replace(/<p:sldIdLst\/>/, '');
  // the slide list goes right after the master lists, as the schema orders them
  const after = ['</p:handoutMasterIdLst>', '</p:notesMasterIdLst>', '</p:sldMasterIdLst>'].find((t) => pres.includes(t));
  pres = after ? pres.replace(after, `${after}<p:sldIdLst>${ids}</p:sldIdLst>`) : pres;
  pres = pres.replace(/<p:extLst>[\s\S]*<\/p:extLst>/, ''); // sections refer to slides that are gone
  z.file('ppt/presentation.xml', pres); z.file('ppt/_rels/presentation.xml.rels', presRels); z.file('[Content_Types].xml', types);
  return { zip: z, slideParts };
}
