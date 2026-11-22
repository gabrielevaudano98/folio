// Folio — slides-md engine. A superset of Marp's Markdown: `---` between slides, HTML-comment directives,
// `![bg]` backgrounds, comments as speaker notes; plus Folio layouts and `:::` blocks.
import MarkdownIt from 'markdown-it';
import container from 'markdown-it-container';
import taskLists from 'markdown-it-task-lists';
import mark from 'markdown-it-mark';
import katex from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { extractObjects, geometry, textStyle, linePoints, linePath, fillCss, fillSvg, frameCss, flipCss, adjustCss, safeColor, parsePoints, pointsPath } from './slides-objects.js';
import { shapeSvg } from './board-core.js';
import { refsPlugin } from './refs-syntax.js';
import { smartArt, parseItems } from './slides-smartart.js';

export const LAYOUTS = [
  ['default', 'Title and content'], ['title', 'Title'], ['section', 'Section header'], ['two-columns', 'Two columns'],
  ['image-right', 'Image right'], ['image-left', 'Image left'], ['quote', 'Quote'], ['big-number', 'Big number'],
  ['cards', 'Cards'], ['blank', 'Blank'],
];
export const THEMES = [['folio', 'Folio'], ['graphite', 'Graphite'], ['paper', 'Paper']];
/** slide sizes: name → [width, height] in px */
import { parseAnim } from './slides-motion.js';
export const SIZES = { '16:9': [1280, 720], '4:3': [960, 720], '1:1': [1080, 1080], '9:16': [720, 1280], '16:10': [1280, 800], A4: [1123, 794], 'A4-portrait': [794, 1123] };
/** theme tokens a deck (or its template) may set in front matter, and the CSS variable each one drives */
// pictures in slide text keep their address in data-src, so nothing is requested until the view checks it (workspace boundary, web-image setting)
// srcset is dropped: a candidate list cannot be checked one address at a time, and Folio never writes one
export const lazySrc = (h) => h.replace(/\ssrcset="[^"]*"/gi, '').replace(/<img\b([^>]*?)\ssrc="/gi, '<img$1 data-src="');
export const TOKENS = { paper: '--sl-bg', ink: '--sl-ink', muted: '--sl-muted', accent: '--sl-accent', card: '--sl-card', 'heading-font': '--sl-face', 'body-font': '--sl-body' };
const FONT_NAME = /^[\w \-'",.]{1,120}$/;
const MARP_THEME = { default: 'folio', gaia: 'paper', uncover: 'graphite' };
const DIRECTIVES = ['theme', 'paginate', 'header', 'footer', 'class', 'backgroundColor', 'backgroundImage', 'color', 'layout', 'size', 'transition', 'math', 'title', 'author', 'description', 'marp', 'style', 'headingDivider', 'source', 'master', 'section', 'animate', 'advance', 'link'];
const LOCAL = ['paginate', 'header', 'footer', 'class', 'backgroundColor', 'backgroundImage', 'color'];
const SPOT = ['layout', 'source', 'master', 'section', 'transition', 'advance', 'link']; // Folio layouts apply to one slide only

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const md = new MarkdownIt({
  html: true, linkify: true, typographer: true,
  highlight(code, lang) {
    if (lang === 'chart') return `<pre class="chart-host"><div class="chart-block" data-spec="${escape(encodeURIComponent(code))}"></div></pre>`;
    if (lang && hljs.getLanguage(lang)) { try { return `<pre><code class="hljs">${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`; } catch {} }
    return `<pre><code class="hljs">${escape(code)}</code></pre>`;
  },
}).use(taskLists).use(mark).use(katex.default || katex, { throwOnError: false });
md.use(refsPlugin, { escape });
// URI schemes are case-insensitive: DATA:/HTTPS: become data:/https:, so the sanitizer and the image checks see one spelling
{ const base = md.normalizeLink.bind(md); md.normalizeLink = (url) => base(url.replace(/^([a-z][a-z0-9+.-]+):/i, (m) => m.toLowerCase())); }
for (const name of ['left', 'right', 'columns', 'column', 'card', 'center', 'note', 'small', 'big', 'box', 'shape']) {
  md.use(container.default || container, name, { render: (t, i) => (t[i].nesting === 1 ? `<div class="sx-${name}">\n` : '</div>\n') });
}

/* ---------- parse ---------- */
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { raw: '', data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { raw: m[0], data, body: text.slice(m[0].length) };
}

/** split the body on `---` lines that are outside code fences */
export function splitSlides(body) {
  const lines = body.split('\n');
  const chunks = []; let cur = []; let fence = null;
  for (const l of lines) {
    const f = l.match(/^\s*(```|~~~)/);
    if (f) fence = fence ? (l.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && /^(---|\*\*\*|___)\s*$/.test(l)) { chunks.push(cur.join('\n')); cur = []; continue; }
    cur.push(l);
  }
  chunks.push(cur.join('\n'));
  return chunks;
}

const FLAG = /^\s*(master|hidden)\s*$/;
export const COMMENT = /^\s*comment(?:\s*\(([^,)]*)(?:,\s*([^)]*))?\))?\s*:\s*([\s\S]*?)\s*$/;
function parseComments(chunk) {
  const directives = {}; const notes = []; const comments = []; const anims = [];
  const body = chunk.replace(/<!--([\s\S]*?)-->/g, (all, inner) => {
    const flag = inner.match(FLAG); if (flag) { directives[flag[1]] = ''; return ''; }
    const c = inner.match(COMMENT); if (c) { comments.push({ author: (c[1] || '').trim(), date: (c[2] || '').trim(), text: c[3], raw: all }); return ''; }
    const lines = inner.trim().split(/\r?\n/);
    const parsed = lines.map((l) => l.trim().match(/^(_?)([a-zA-Z]+)\s*:\s*(.*)$/));
    if (parsed.length && parsed.every((p) => p && DIRECTIVES.includes(p[2]))) {
      for (const p of parsed) { if (p[2] === 'animate') anims.push(p[3].trim()); else directives[(p[1] || '') + p[2]] = p[3].trim().replace(/^["']|["']$/g, ''); }
      return '';
    }
    notes.push(inner.trim());
    return '';
  });
  return { body, directives, notes: notes.join('\n\n'), comments, anims };
}

function parseBg(body) {
  const bgs = [];
  const rest = body.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (all, alt, src) => {
    const words = alt.trim().split(/\s+/);
    if (words[0]?.toLowerCase() !== 'bg') return all;
    const bg = { src, fit: 'cover', side: null, size: null, filters: [] };
    for (const w of words.slice(1)) {
      const lw = w.toLowerCase();
      const side = lw.match(/^(left|right)(?::(\d+)%)?$/);
      if (side) { bg.side = side[1]; bg.size = side[2] ? Number(side[2]) : 50; }
      else if (['contain', 'fit'].includes(lw)) bg.fit = 'contain';
      else if (lw === 'cover') bg.fit = 'cover';
      else if (lw === 'auto') bg.fit = 'none';
      else if (/^\d+%$/.test(lw)) bg.fit = lw;
      else if (/^(grayscale|sepia|invert)$/.test(lw)) bg.filters.push(`${lw}(1)`);
      else if (/^blur(:\d+px)?$/.test(lw)) bg.filters.push(`blur(${lw.split(':')[1] || '10px'})`);
      else if (/^(brightness|opacity|contrast):[\d.]+$/.test(lw)) { const [k, v] = lw.split(':'); bg.filters.push(`${k}(${v})`); }
    }
    bgs.push(bg);
    return '';
  });
  return { body: rest, bgs };
}

export function parseDeck(text, { template = null } = {}) {
  const fm = parseFrontmatter(text);
  const tpl = template ? parseDeck(template) : null;
  const chunks = splitSlides(fm.body);
  const global = { theme: 'folio', paginate: 'false', size: '16:9', ...(tpl ? Object.fromEntries(Object.entries(tpl.fm.data).filter(([k]) => !['marp', 'title', 'template', 'description', 'author'].includes(k) && !k.startsWith('template-'))) : {}) };
  for (const [k, v] of Object.entries(fm.data)) global[k] = v;
  const carried = {};
  const slides = chunks.map((src, i) => {
    const { body, directives, notes, comments, anims } = parseComments(src);
    for (const [k, v] of Object.entries(directives)) {
      if (k.startsWith('_') || SPOT.includes(k)) continue;
      if (LOCAL.includes(k)) carried[k] = v; else global[k] = v;
    }
    const eff = { ...global, ...carried };
    for (const [k, v] of Object.entries(directives)) { if (k.startsWith('_')) eff[k.slice(1)] = v; else if (SPOT.includes(k)) eff[k] = v; }
    if (!directives.layout && !directives._layout) delete eff.layout;
    const { body: withObjects, bgs } = parseBg(body);
    const { flow: content, objects } = extractObjects(withObjects);
    let layout = eff.layout || 'default';
    const cls = (eff.class || '').split(/\s+/).filter(Boolean);
    if (!eff.layout && cls.includes('lead')) layout = 'title';
    if (!eff.layout && bgs.some((b) => b.side === 'right')) layout = 'image-right';
    if (!eff.layout && bgs.some((b) => b.side === 'left')) layout = 'image-left';
    const title = ((content.trim() || withObjects).match(/^\s*#{1,6}\s+(.+)$/m) || [])[1]?.replace(/[*_`]/g, '') || '';
    const mParts = directives.master != null ? String(directives.master).trim().split(/\s+/).filter(Boolean) : null;
    const master = mParts ? (mParts[0] || 'all') : null; const only = !!mParts && mParts.includes('only');
    return { index: i, src, content: content.trim(), objects, directives, notes, comments, bgs, layout, classes: cls, eff, title, master, only, hidden: directives.hidden != null, section: directives.section || null, animations: anims.map(parseAnim), transition: directives.transition ?? null, advance: directives.advance ?? null };
  });
  let n = 0; for (const sl of slides) sl.number = sl.master ? null : ++n;
  const masters = [...(tpl ? tpl.masters.map((m) => ({ ...m, fromTemplate: true })) : []), ...slides.filter((sl) => sl.master)];
  const theme = MARP_THEME[global.theme] || (THEMES.some(([t]) => t === global.theme) ? global.theme : 'folio');
  const [w, h] = SIZES[global.size] || SIZES['16:9'];
  return { fm, slides, shown: slides.filter((sl) => !sl.master && !sl.hidden), masters, global, theme, width: w, height: h, template: tpl ? true : false };
}

/* ---------- render ---------- */
export function renderSlide(deck, s, { number = true } = {}) {
  let e = s.eff;
  // a master's own background (<!-- _backgroundColor --> / _backgroundImage / _color) applies to its slides unless they set one
  const mbg = {}; for (const m of mastersFor(deck, s)) for (const k of ['backgroundColor', 'backgroundImage', 'color', 'class']) { const v = m.directives['_' + k] ?? m.directives[k]; if (v != null) mbg[k] = v; }
  if (Object.keys(mbg).length) { const own = s.directives; e = { ...e }; for (const [k, v] of Object.entries(mbg)) if (own['_' + k] == null && own[k] == null) e[k] = v; }
  const style = [];
  for (const [k, v] of Object.entries(TOKENS)) {
    const val = e[k]; if (val == null || val === '') continue;
    if (k.endsWith('-font')) { if (FONT_NAME.test(val)) style.push(`${v}:${val.split(',').map((f) => `'${f.trim().replace(/["']/g, '')}'`).join(', ')}, system-ui, sans-serif`); }
    else if (safeColor(val)) style.push(`${v}:${safeColor(val)}`);
  }
  if (safeColor(e.backgroundColor)) style.push(`--sl-bg:${safeColor(e.backgroundColor)}`);
  if (safeColor(e.color)) style.push(`--sl-ink:${safeColor(e.color)}`);
  const grad = /^(linear|radial)-gradient\([#\w\s,.%()-]+\)$/i.test(String(e.backgroundImage || '').trim()) ? String(e.backgroundImage).trim() : null;
  if (grad) style.push(`background-image:${grad}`);
  const bgImg = grad ? null : e.backgroundImage?.match(/url\(["']?([^"')]+)/)?.[1];
  const bgs = [...s.bgs, ...(bgImg ? [{ src: bgImg, fit: 'cover', side: null, filters: [] }] : [])];
  const full = bgs.filter((b) => !b.side), side = bgs.filter((b) => b.side);
  const sideW = side[0]?.size || 50;
  const clean = (m) => lazySrc(DOMPurify.sanitize(md.render(m), { ADD_ATTR: ['target', 'data-spec', 'data-ref', 'data-label'], FORBID_TAGS: ['style', 'script', 'iframe'] })); // body, placeholders: pictures wait for the resolver
  const ph = s.master ? {} : placeholdersFor(deck, s);
  let html, phHtml = '';
  if (ph.title || ph.body || ph.subtitle) {
    const { title, rest } = splitTitle(s.content);
    const parts = { title: ph.title ? title : '', body: ph.body ? rest : '', subtitle: !ph.body && ph.subtitle ? rest : '' };
    const flow = [ph.title ? '' : title, ph.body || ph.subtitle ? '' : rest].filter(Boolean).join('\n\n');
    html = clean(flow);
    phHtml = ROLES.filter((r) => ph[r] && parts[r]).map((r) => {
      const o = ph[r], g = geometry(o), a = o.attrs;
      const st = [`left:${g.x}px`, `top:${g.y}px`, `width:${g.w}px`, `height:${g.h}px`, ...textStyle(a)];
      if (safeColor(a.color)) st.push(`color:${safeColor(a.color)}`);
      const bg = fillCss(a.fill); if (bg) st.push(`background:${bg}`);
      if (a.radius) st.push(`border-radius:${parseFloat(a.radius) || 0}px`);
      return `<div class="sl-ph sl-ph-${r}${a.fit === 'shrink' ? ' sl-obj is-fit' : ''}" style="${st.join(';')}">${clean(parts[r])}</div>`;
    }).join('');
  } else html = clean(s.content);
  const placed = placedHtml(deck, s, zoomDepth ? { inert: true } : undefined);
  const img = (b) => `<img class="sl-img" data-src="${escape(b.src)}" alt="" style="object-fit:${b.fit === 'none' ? 'none' : /%$/.test(b.fit) ? 'contain' : b.fit};${b.filters.length ? `filter:${b.filters.join(' ')};` : ''}">`;
  const theme = MARP_THEME[e.theme] || (THEMES.some(([t]) => t === e.theme) ? e.theme : deck.theme);
  return `<section class="slide theme-${theme} layout-${escape(s.layout)} ${s.classes.map((c) => 'cls-' + escape(c)).join(' ')}${side.length ? ' has-side side-' + side[0].side : ''}" style="width:${deck.width}px;height:${deck.height}px;--side:${sideW}%;${style.join(';')}">
    ${full.length ? `<div class="sl-bg">${full.map(img).join('')}</div>` : ''}
    ${side.length ? `<div class="sl-side">${side.map(img).join('')}</div>` : ''}
    ${masterLayer(deck, s)}
    <div class="sl-body${phHtml ? ' has-ph' : ''}">${html}</div>
    ${phHtml ? `<div class="sl-phs">${phHtml}</div>` : ''}
    ${placed ? `<div class="sl-placed">${placed}</div>` : ''}
    ${e.header ? `<header class="sl-header">${escape(e.header)}</header>` : ''}
    ${e.footer ? `<footer class="sl-footer">${escape(e.footer)}</footer>` : ''}
    ${number && e.paginate === 'true' && !s.master ? `<span class="sl-num">${s.number ?? s.index + 1}</span>` : ''}
    ${s.master ? `<span class="sl-master-tag">Master${s.master !== 'all' ? ': ' + escape(s.master) : ''}</span>` : ''}
  </section>`;
}

/** placed objects of a slide; inert (for masters) leaves out the ids the canvas selects by */
/** the slide a zoom shows: `slide=` (its number) or `section=` (the section's first slide) */
export function zoomTarget(deck, a) {
  const list = deck.slides.filter((x) => !x.master);
  if (a.section) return list.find((x) => x.section === a.section) || null;
  const n = parseInt(a.slide, 10); return Number.isFinite(n) ? list.find((x) => x.number === n) || null : null;
}
let zoomDepth = 0;
function zoomHtml(deck, o, cls, ref, st) {
  const a = o.attrs; const t = zoomTarget(deck, a); const g = geometry(o);
  const k = Math.min(g.w / deck.width, g.h / deck.height);
  let inner = '<div class="sl-zoom-missing">Pick a slide for this zoom</div>';
  if (t && zoomDepth < 1) { zoomDepth++; try { inner = `<div class="sl-zoom-view" style="width:${deck.width}px;height:${deck.height}px;transform:scale(${k})">${renderSlide(deck, t, { number: false })}</div>`; } finally { zoomDepth--; } }
  const label = t ? (a.section ? `Zoom to section ${a.section}` : `Zoom to slide ${t.number}`) : 'Zoom';
  return `<div class="${cls.join(' ')}"${ref} data-zoom="${t ? t.number : ''}"${a.section ? ` data-zoom-section="${escape(a.section)}"` : ''} role="link" aria-label="${escape(label)}" style="${st.join(';')}">${inner}</div>`;
}
function placedHtml(deck, s, { inert = String(s.index).startsWith('m') } = {}) {
  const byId = Object.fromEntries((s.objects || []).filter((o) => o.id && o.kind !== 'line').map((o) => [o.id, geometry(o)]));
  return (s.objects || []).map((o, n) => {
    const g = geometry(o);
    if (o.kind === 'line') return lineHtml(o, n, byId, inert);
    const st = [`left:${g.x}px`, `top:${g.y}px`, `width:${g.w}px`, `height:${g.h}px`, `z-index:${10 + g.z}`];
    const a = o.attrs;
    const tf = [g.rotate ? `rotate(${g.rotate}deg)` : '', o.kind === 'image' || o.kind === 'icon' ? flipCss(a) : ''].filter(Boolean);
    if (tf.length) st.push(`transform:${tf.join(' ')}`);
    if (g.opacity != null) st.push(`opacity:${g.opacity}`);
    st.push(...frameCss(o));
    const cls = ['sl-obj', 'sl-' + o.kind]; if (['true', '1', 'yes'].includes(String(a.lock || '').toLowerCase())) cls.push('is-locked');
    const ref = (inert ? '' : ` data-obj="${n}"${o.id ? ` data-id="${escape(o.id)}"` : ''}`) + (a.link ? ` data-link="${escape(a.link)}"` : '');
    if (a.link) cls.push('has-link');
    if (o.kind === 'zoom') return zoomHtml(deck, o, cls, ref, st);
    if (inert) cls.push('is-master');
    if (a.placeholder) cls.push('is-placeholder');
    if (o.kind === 'image') {
      const adj = adjustCss(a.adjust); const imgF = adj.length ? `filter:${adj.join(' ')};` : '';
      if (a.radius) st.push(`border-radius:${parseFloat(a.radius) || 0}px`, 'overflow:hidden');
      if (a.border || a.stroke) st.push(`outline:${parseFloat(a.border) || 1}px solid ${safeColor(a.stroke) || 'currentColor'}`, `outline-offset:-${parseFloat(a.border) || 1}px`);
      const crop = (a.crop || '').split(',').map(Number);
      if (crop.length === 4 && crop.every((v) => !Number.isNaN(v))) { const [cx, cy, cw, ch] = crop; st.push('overflow:hidden'); return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}"><img class="sl-img" data-src="${escape(o.src)}" alt="${escape(a.alt || o.alt || '')}" style="position:absolute;width:${100 / cw}%;height:${100 / ch}%;left:${(-cx / cw) * 100}%;top:${(-cy / ch) * 100}%;object-fit:fill;${imgF}"></div>`; }
      return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}"><img class="sl-img" data-src="${escape(o.src)}" alt="${escape(a.alt || o.alt || '')}" style="object-fit:${a.fit === 'contain' ? 'contain' : 'cover'};${imgF}"></div>`;
    }
    if (a.fill && o.kind === 'box') { const bg = fillCss(a.fill); if (bg) st.push(`background:${bg}`); }
    if (safeColor(a.color)) st.push(`color:${safeColor(a.color)}`);
    if (a.radius) st.push(`border-radius:${parseFloat(a.radius) || 0}px`);
    const ts = textStyle(a);
    if (a.fit === 'shrink') cls.push('is-fit');
    if (o.kind === 'box') st.push(...ts);
    const inner = lazySrc(DOMPurify.sanitize(md.render(o.body || ''), { ADD_ATTR: ['target', 'data-spec', 'data-ref', 'data-label'], FORBID_TAGS: ['style', 'script', 'iframe'] })); // text boxes too
    if (o.kind === 'icon') {
      return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}"><span class="sl-icon-svg" data-icon="${escape(a.name || 'circle')}" data-sw="${escape(a.weight || '2')}"></span></div>`;
    }
    if (o.kind === 'media') {
      const audio = /\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(a.src || '');
      const opts = `${a.loop === 'true' ? ' loop' : ''}${a.muted === 'true' ? ' muted' : ''}${a.autoplay === 'true' ? ' data-autoplay="1"' : ''}`;
      return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}">${audio ? `<audio class="sl-media-el" controls preload="metadata" data-src="${escape(a.src || '')}"${opts}></audio>` : `<video class="sl-media-el" controls preload="metadata" playsinline data-src="${escape(a.src || '')}"${a.poster ? ` data-poster="${escape(a.poster)}"` : ''}${opts}></video>`}</div>`;
    }
    if (o.kind === 'smartart') {
      const c = safeColor(a.fill) || null;
      const items = parseItems(o.body); const flat = (list) => list.map((x) => `<li>${escape(x.text)}${x.children.length ? `<ul>${flat(x.children)}</ul>` : ''}</li>`).join('');
      return `<div class="${cls.join(' ')}" data-type="${escape(a.type || 'process')}"${ref} style="${st.join(';')}${c ? `;--sm-c:${c}` : ''}" role="img" aria-label="${escape((a.type || 'process') + ' diagram')}"><ul class="sm-sr">${flat(items)}</ul>${smartArt(a.type || 'process', o.body, g.w, g.h, { size: parseFloat(a.size) || null })}</div>`;
    }
    if (o.kind === 'path') {
      const gid = `sp-${s.index}-${n}`; const fl = fillSvg(a.fill, gid);
      const closed = a.d ? true : a.closed === 'true';
      const d = a.d ? String(a.d).replace(/[^MLCZQHVmlczqhv\d.,\s-]/g, '') : pointsPath(parsePoints(a.points), closed, a.smooth === 'true');
      const sw = a.border != null && a.border !== '' ? parseFloat(a.border) || 0 : 2.5;
      const flip = flipCss(a);
      return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}"><svg viewBox="0 0 1 1" preserveAspectRatio="none" width="${g.w}" height="${g.h}"${flip ? ` style="transform:${flip}"` : ''}>${fl.defs}<path d="${d}" style="fill:${closed ? fl.fill || 'var(--sl-ink)' : 'none'};${closed && !fl.fill ? 'fill-opacity:.12;' : ''}stroke:${safeColor(a.stroke) || 'var(--sl-ink)'};stroke-width:${sw}px" fill-rule="evenodd" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"${a.dash === 'true' ? ` stroke-dasharray="${sw * 3} ${sw * 2}"` : ''}/></svg></div>`;
    }
    if (o.kind === 'shape') {
      const gid = `sg-${s.index}-${n}`; const fl = fillSvg(a.fill, gid);
      const svg = shapeSvg({ shape: a.type || 'rect', w: g.w, h: g.h, style: { fill: fl.fill } }, 'sl-shape-fill' + (fl.fill ? ' has-fill' : ''));
      const sv = [safeColor(a.stroke) ? `--sh-stroke:${safeColor(a.stroke)}` : '', a.border != null && a.border !== '' ? `--sh-sw:${parseFloat(a.border) || 0}` : '', a.dash === 'true' ? '--sh-dash:8 6' : ''].filter(Boolean).join(';');
      const flip = flipCss(a);
      return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}"><svg viewBox="0 0 ${g.w} ${g.h}" width="${g.w}" height="${g.h}"${sv || flip ? ` style="${sv}${flip ? `;transform:${flip}` : ''}"` : ''}>${fl.defs}${svg}</svg><div class="sl-obj-text" style="${ts.join(';')}">${inner}</div></div>`;
    }
    return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}">${inner}</div>`;
  }).join('');
}

/** the masters that apply to a slide, template masters first, 'all' before layout-specific */
export function mastersFor(deck, s) {
  if (s.master || !deck.masters?.length) return [];
  const own = deck.masters.filter((m) => m.master === s.layout);
  const all = own.some((m) => m.only) ? [] : deck.masters.filter((m) => m.master === 'all');
  return [...all, ...own];
}
/** layouts with their own arrangement: placeholders from the all-slides master do not apply to them */
const STRUCTURED = ['two-columns', 'cards', 'image-right', 'image-left', 'quote', 'big-number', 'blank'];
const ROLES = ['title', 'subtitle', 'body'];
/** placeholder boxes (::: box placeholder=title …) from the masters, later masters win per role */
export function placeholdersFor(deck, s) {
  const out = {};
  for (const m of mastersFor(deck, s)) {
    if (m.master === 'all' && STRUCTURED.includes(s.layout)) continue;
    for (const o of m.objects || []) if (o.kind === 'box' && ROLES.includes(o.attrs.placeholder)) out[o.attrs.placeholder] = o;
  }
  return out;
}
/** split a slide's flow text into title (first heading) and the rest */
export function splitTitle(content) {
  const lines = content.split('\n'); let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    if (!fence && /^\s*#{1,6}\s+\S/.test(lines[i])) return { title: lines[i], rest: [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').replace(/\n{3,}/g, '\n\n').trim() };
  }
  return { title: '', rest: content.trim() };
}

/** objects and backgrounds of the master slides that apply to this slide, drawn under its content */
function masterLayer(deck, s) {
  const use = mastersFor(deck, s);
  if (!use.length) return '';
  const parts = use.map((m) => {
    const bg = m.bgs.filter((b) => !b.side).map((b) => `<img class="sl-img" data-src="${escape(b.src)}" alt="" style="object-fit:${b.fit === 'contain' ? 'contain' : 'cover'};${b.filters.length ? `filter:${b.filters.join(' ')};` : ''}">`).join('');
    const objs = placedHtml(deck, { ...m, objects: (m.objects || []).filter((o) => !o.attrs.placeholder), index: `m${m.index}${m.fromTemplate ? 't' : ''}` });
    return `${bg ? `<div class="sl-bg">${bg}</div>` : ''}${objs ? `<div class="sl-placed sl-master-objs">${objs}</div>` : ''}`;
  }).join('');
  return `<div class="sl-master" aria-hidden="true">${parts}</div>`;
}

function lineHtml(o, n, byId, inert = false) {
  const a = o.attrs; const g = geometry(o);
  const pts = linePoints(o, byId); const [[x1, y1], [x2, y2]] = pts;
  const pad = 16, sw = parseFloat(a.width) || 3;
  const bx = Math.min(x1, x2) - pad, by = Math.min(y1, y2) - pad, bw = Math.abs(x2 - x1) + pad * 2, bh = Math.abs(y2 - y1) + pad * 2;
  const color = escape(a.stroke || 'currentColor');
  const d = linePath(pts, a.route);
  const head = (tip, from) => { const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]); const L = 6 + sw * 3, W = 3 + sw * 1.6; const p = (dx, dy) => `${tip[0] - Math.cos(ang) * dx + Math.sin(ang) * dy},${tip[1] - Math.sin(ang) * dx - Math.cos(ang) * dy}`; return `<polygon points="${tip[0]},${tip[1]} ${p(L, W)} ${p(L, -W)}" fill="${color}"/>`; };
  const seg = a.route === 'elbow' ? [[(x1 + x2) / 2, y2], [(x1 + x2) / 2, y1]] : [[x1, y1], [x2, y2]];
  const heads = (/arrow/.test(a.head || '') ? head([x2, y2], seg[0]) : '') + (/arrow/.test(a.tail || '') ? head([x1, y1], seg[1]) : '');
  const dash = a.dash === 'true' ? ` stroke-dasharray="${sw * 3} ${sw * 2}"` : '';
  return `<div class="sl-obj sl-line${['true', '1', 'yes'].includes(String(a.lock || '').toLowerCase()) ? ' is-locked' : ''}${a.from || a.to ? ' is-connector' : ''}${inert ? ' is-master' : ''}"${inert ? '' : ` data-obj="${n}"${o.id ? ` data-id="${escape(o.id)}"` : ''}`} data-x1="${x1}" data-y1="${y1}" data-x2="${x2}" data-y2="${y2}" style="left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;z-index:${10 + g.z}"><svg width="${bw}" height="${bh}" viewBox="${bx} ${by} ${bw} ${bh}"><path class="sl-line-hit" d="${d}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dash}/>${heads}</svg></div>`;
}

/* ---------- synced copies ---------- */
const SOURCE_LINE = /^[ \t]*<!--\s*source\s*:[^>]*-->[ \t]*\n?/m;
/** the content of a slide without its `source` directive, for comparing a copy with its source */
export const syncBody = (chunk) => chunk.replace(SOURCE_LINE, '').replace(/^\n+|\s+$/g, '');
/** slide n (1-based) of a deck as source text */
export function slideChunk(deckText, n) { const fm = parseFrontmatter(deckText); return splitSlides(fm.body)[n - 1] ?? null; }
/** a copy of a source slide that remembers where it came from */
export const syncedCopy = (ref, sourceChunk) => `\n<!-- source: ${ref} -->\n${syncBody(sourceChunk)}\n`;

/* ---------- slide management (P8) ---------- */
/** add or remove a bare flag comment like <!-- hidden --> */
export function setFlag(chunk, flag, on) {
  const re = new RegExp(`[ \\t]*<!--\\s*${flag}\\s*-->[ \\t]*\\n?`, 'g');
  const without = chunk.replace(re, '');
  if (!on) return without;
  const lead = without.match(/^\n*/)[0];
  return lead + `<!-- ${flag} -->\n` + without.slice(lead.length);
}
const oneLine = (t) => String(t).replace(/-->/g, '—>').replace(/\s*\n\s*/g, ' ').trim();
export function addComment(chunk, { author = '', date = '', text }) {
  const meta = author || date ? ` (${oneLine(author).replace(/[(),]/g, '')}${date ? ', ' + date : ''})` : '';
  return chunk.replace(/\n*$/, '') + `\n\n<!-- comment${meta}: ${oneLine(text)} -->\n`;
}
/** remove the k-th comment of a slide */
export function removeComment(chunk, k) {
  let n = -1;
  return chunk.replace(/[ \t]*<!--([\s\S]*?)-->[ \t]*\n?/g, (all, inner) => (COMMENT.test(inner) && ++n === k ? '' : all)).replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}
/** sections: the section a slide belongs to is the last `section:` at or before it */
export function sectionsOf(deck) {
  const out = []; let curr = null;
  deck.slides.forEach((sl) => { if (sl.section) { curr = { name: sl.section, start: sl.index, slides: [] }; out.push(curr); } if (curr) curr.slides.push(sl.index); });
  return out;
}

/* ---------- write back ---------- */
export function joinDeck(fmRaw, chunks) {
  return fmRaw + chunks.map((c, i) => (i === 0 ? c.replace(/\n+$/, '') : c.replace(/^\n+/, '\n').replace(/\n+$/, ''))).join('\n\n---\n') + '\n';
}
export function setDirective(chunk, key, value) {
  const re = new RegExp(`<!--\\s*_?${key}\\s*:[^>]*-->\\n?`);
  const line = `<!-- ${key}: ${value} -->`;
  if (re.test(chunk)) return value == null ? chunk.replace(re, '') : chunk.replace(re, line + '\n');
  if (value == null) return chunk;
  const lead = chunk.match(/^\n*/)[0];
  return lead + line + '\n' + chunk.slice(lead.length);
}
export function setNotes(chunk, text) {
  let out = chunk.replace(/<!--([\s\S]*?)-->\n?/g, (all, inner) => {
    const lines = inner.trim().split(/\r?\n/);
    return FLAG.test(inner) || COMMENT.test(inner) || lines.every((l) => /^_?[a-zA-Z]+\s*:/.test(l.trim()) && DIRECTIVES.includes(l.trim().replace(/^_/, '').split(':')[0].trim())) ? all : '';
  }).replace(/\n+$/, '');
  if (text.trim()) out += `\n\n<!--\n${text.trim()}\n-->`;
  return out + '\n';
}
export function setGlobal(fmRaw, key, value) {
  if (typeof value === 'string' && /^#/.test(value)) value = `"${value}"`;
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (value == null || value === '') return fmRaw && re.test(fmRaw) ? fmRaw.replace(new RegExp(`^${key}:.*\\r?\\n`, 'm'), '') : fmRaw;
  if (!fmRaw) return `---\nmarp: true\n${key}: ${value}\n---\n\n`;
  return re.test(fmRaw) ? fmRaw.replace(re, `${key}: ${value}`) : fmRaw.replace(/\n---\r?\n?$/, `\n${key}: ${value}\n---\n`);
}

export const TEMPLATES = {
  default: '## Slide title\n\n- First point\n- Second point\n- Third point',
  title: '<!-- layout: title -->\n# Presentation title\n\nSubtitle or speaker name',
  section: '<!-- layout: section -->\n# Section name',
  'two-columns': '<!-- layout: two-columns -->\n## Compare\n\n::: left\n### Before\n- Point\n:::\n\n::: right\n### After\n- Point\n:::',
  'image-right': '![bg right:45%](https://picsum.photos/id/1018/1200/900)\n\n## A picture and words\n\n- What the image shows\n- Why it matters',
  'image-left': '![bg left:45%](https://picsum.photos/id/1015/1200/900)\n\n## A picture and words\n\n- What the image shows\n- Why it matters',
  quote: '<!-- layout: quote -->\n> The best way to predict the future is to invent it.\n\n— Alan Kay',
  'big-number': '<!-- layout: big-number -->\n# 42%\n\nWhat this number means, in one line',
  cards: '<!-- layout: cards -->\n## Three ideas\n\n::: card\n### One\nShort text\n:::\n\n::: card\n### Two\nShort text\n:::\n\n::: card\n### Three\nShort text\n:::',
  blank: '<!-- layout: blank -->\n',
};

export const NEW_DECK = `---
marp: true
theme: folio
paginate: true
footer: ''
---

<!-- layout: title -->
# Presentation title

Your name, date

---

## Agenda

1. The problem
2. The idea
3. What happens next

---

<!-- layout: two-columns -->
## Before and after

::: left
### Today
- Manual steps
- Slow reviews
:::

::: right
### Tomorrow
- One click
- Instant feedback
:::

<!--
Speaker notes go in HTML comments, like in Marp.
-->
`;
