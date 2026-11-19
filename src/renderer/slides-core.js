// Folio — slides-md engine. A superset of Marp's Markdown: `---` between slides, HTML-comment directives,
// `![bg]` backgrounds, comments as speaker notes; plus Folio layouts and `:::` blocks.
import MarkdownIt from 'markdown-it';
import container from 'markdown-it-container';
import taskLists from 'markdown-it-task-lists';
import mark from 'markdown-it-mark';
import katex from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { extractObjects, geometry, textStyle, linePoints, linePath } from './slides-objects.js';
import { shapeSvg } from './board-core.js';
import { refsPlugin } from './refs-syntax.js';

export const LAYOUTS = [
  ['default', 'Title and content'], ['title', 'Title'], ['section', 'Section header'], ['two-columns', 'Two columns'],
  ['image-right', 'Image right'], ['image-left', 'Image left'], ['quote', 'Quote'], ['big-number', 'Big number'],
  ['cards', 'Cards'], ['blank', 'Blank'],
];
export const THEMES = [['folio', 'Folio'], ['graphite', 'Graphite'], ['paper', 'Paper']];
const MARP_THEME = { default: 'folio', gaia: 'paper', uncover: 'graphite' };
const DIRECTIVES = ['theme', 'paginate', 'header', 'footer', 'class', 'backgroundColor', 'backgroundImage', 'color', 'layout', 'size', 'transition', 'math', 'title', 'author', 'description', 'marp', 'style', 'headingDivider', 'source'];
const LOCAL = ['paginate', 'header', 'footer', 'class', 'backgroundColor', 'backgroundImage', 'color'];
const SPOT = ['layout', 'source']; // Folio layouts apply to one slide only

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

function parseComments(chunk) {
  const directives = {}; const notes = [];
  const body = chunk.replace(/<!--([\s\S]*?)-->/g, (all, inner) => {
    const lines = inner.trim().split(/\r?\n/);
    const parsed = lines.map((l) => l.trim().match(/^(_?)([a-zA-Z]+)\s*:\s*(.*)$/));
    if (parsed.length && parsed.every((p) => p && DIRECTIVES.includes(p[2]))) {
      for (const p of parsed) directives[(p[1] || '') + p[2]] = p[3].trim().replace(/^["']|["']$/g, '');
      return '';
    }
    notes.push(inner.trim());
    return '';
  });
  return { body, directives, notes: notes.join('\n\n') };
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

export function parseDeck(text) {
  const fm = parseFrontmatter(text);
  const chunks = splitSlides(fm.body);
  const global = { theme: 'folio', paginate: 'false', size: '16:9' };
  for (const [k, v] of Object.entries(fm.data)) global[k] = v;
  const carried = {};
  const slides = chunks.map((src, i) => {
    const { body, directives, notes } = parseComments(src);
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
    return { index: i, src, content: content.trim(), objects, directives, notes, bgs, layout, classes: cls, eff, title };
  });
  const theme = MARP_THEME[global.theme] || (THEMES.some(([t]) => t === global.theme) ? global.theme : 'folio');
  const [w, h] = global.size === '4:3' ? [960, 720] : [1280, 720];
  return { fm, slides, global, theme, width: w, height: h };
}

/* ---------- render ---------- */
export function renderSlide(deck, s, { number = true } = {}) {
  const e = s.eff;
  const style = [];
  if (e.backgroundColor) style.push(`--sl-bg:${e.backgroundColor}`);
  if (e.color) style.push(`--sl-ink:${e.color}`);
  const bgImg = e.backgroundImage?.match(/url\(["']?([^"')]+)/)?.[1];
  const bgs = [...s.bgs, ...(bgImg ? [{ src: bgImg, fit: 'cover', side: null, filters: [] }] : [])];
  const full = bgs.filter((b) => !b.side), side = bgs.filter((b) => b.side);
  const sideW = side[0]?.size || 50;
  const html = DOMPurify.sanitize(md.render(s.content), { ADD_ATTR: ['target', 'data-spec', 'data-ref', 'data-label'], FORBID_TAGS: ['style', 'script', 'iframe'] });
  const byId = Object.fromEntries((s.objects || []).filter((o) => o.id && o.kind !== 'line').map((o) => [o.id, geometry(o)]));
  const placed = (s.objects || []).map((o, n) => {
    const g = geometry(o);
    if (o.kind === 'line') return lineHtml(o, n, byId);
    const st = [`left:${g.x}px`, `top:${g.y}px`, `width:${g.w}px`, `height:${g.h}px`, `z-index:${10 + g.z}`];
    if (g.rotate) st.push(`transform:rotate(${g.rotate}deg)`);
    if (g.opacity != null) st.push(`opacity:${g.opacity}`);
    const a = o.attrs; const cls = ['sl-obj', 'sl-' + o.kind]; if (['true', '1', 'yes'].includes(String(a.lock || '').toLowerCase())) cls.push('is-locked');
    const ref = ` data-obj="${n}"${o.id ? ` data-id="${escape(o.id)}"` : ''}`;
    if (o.kind === 'image') {
      const crop = (a.crop || '').split(',').map(Number);
      if (crop.length === 4 && crop.every((v) => !Number.isNaN(v))) { const [cx, cy, cw, ch] = crop; st.push('overflow:hidden'); return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}"><img class="sl-img" data-src="${escape(o.src)}" alt="${escape(a.alt || o.alt || '')}" style="position:absolute;width:${100 / cw}%;height:${100 / ch}%;left:${(-cx / cw) * 100}%;top:${(-cy / ch) * 100}%;object-fit:fill"></div>`; }
      return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}"><img class="sl-img" data-src="${escape(o.src)}" alt="${escape(a.alt || o.alt || '')}" style="object-fit:${a.fit || 'cover'}"></div>`;
    }
    if (a.fill && o.kind === 'box') st.push(`background:${escape(a.fill)}`);
    if (a.color) st.push(`color:${escape(a.color)}`);
    if (a.radius) st.push(`border-radius:${parseFloat(a.radius) || 0}px`);
    const ts = textStyle(a);
    if (a.fit === 'shrink') cls.push('is-fit');
    if (o.kind === 'box') st.push(...ts);
    if (a.border) st.push(`border:${parseFloat(a.border) || 1}px solid ${escape(a.stroke || 'currentColor')}`);
    const inner = DOMPurify.sanitize(md.render(o.body || ''), { ADD_ATTR: ['target', 'data-spec', 'data-ref', 'data-label'], FORBID_TAGS: ['style', 'script', 'iframe'] });
    if (o.kind === 'icon') {
      return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}"><span class="sl-icon-svg" data-icon="${escape(a.name || 'circle')}" data-sw="${escape(a.weight || '2')}"></span></div>`;
    }
    if (o.kind === 'media') {
      const audio = /\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(a.src || '');
      const opts = `${a.loop === 'true' ? ' loop' : ''}${a.muted === 'true' ? ' muted' : ''}${a.autoplay === 'true' ? ' data-autoplay="1"' : ''}`;
      return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}">${audio ? `<audio class="sl-media-el" controls preload="metadata" data-src="${escape(a.src || '')}"${opts}></audio>` : `<video class="sl-media-el" controls preload="metadata" playsinline data-src="${escape(a.src || '')}"${a.poster ? ` data-poster="${escape(a.poster)}"` : ''}${opts}></video>`}</div>`;
    }
    if (o.kind === 'shape') {
      const svg = shapeSvg({ shape: a.type || 'rect', w: g.w, h: g.h, style: { fill: a.fill } }, 'sl-shape-fill');
      return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}"><svg viewBox="0 0 ${g.w} ${g.h}" width="${g.w}" height="${g.h}">${svg}</svg><div class="sl-obj-text" style="${ts.join(';')}">${inner}</div></div>`;
    }
    return `<div class="${cls.join(' ')}"${ref} style="${st.join(';')}">${inner}</div>`;
  }).join('');
  const img = (b) => `<img class="sl-img" data-src="${escape(b.src)}" alt="" style="object-fit:${b.fit === 'none' ? 'none' : /%$/.test(b.fit) ? 'contain' : b.fit};${b.filters.length ? `filter:${b.filters.join(' ')};` : ''}">`;
  const theme = MARP_THEME[e.theme] || (THEMES.some(([t]) => t === e.theme) ? e.theme : deck.theme);
  return `<section class="slide theme-${theme} layout-${escape(s.layout)} ${s.classes.map((c) => 'cls-' + escape(c)).join(' ')}${side.length ? ' has-side side-' + side[0].side : ''}" style="width:${deck.width}px;height:${deck.height}px;--side:${sideW}%;${style.join(';')}">
    ${full.length ? `<div class="sl-bg">${full.map(img).join('')}</div>` : ''}
    ${side.length ? `<div class="sl-side">${side.map(img).join('')}</div>` : ''}
    <div class="sl-body">${html}</div>
    ${placed ? `<div class="sl-placed">${placed}</div>` : ''}
    ${e.header ? `<header class="sl-header">${escape(e.header)}</header>` : ''}
    ${e.footer ? `<footer class="sl-footer">${escape(e.footer)}</footer>` : ''}
    ${number && e.paginate === 'true' ? `<span class="sl-num">${s.index + 1}</span>` : ''}
  </section>`;
}

function lineHtml(o, n, byId) {
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
  return `<div class="sl-obj sl-line${['true', '1', 'yes'].includes(String(a.lock || '').toLowerCase()) ? ' is-locked' : ''}${a.from || a.to ? ' is-connector' : ''}" data-obj="${n}"${o.id ? ` data-id="${escape(o.id)}"` : ''} data-x1="${x1}" data-y1="${y1}" data-x2="${x2}" data-y2="${y2}" style="left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;z-index:${10 + g.z}"><svg width="${bw}" height="${bh}" viewBox="${bx} ${by} ${bw} ${bh}"><path class="sl-line-hit" d="${d}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dash}/>${heads}</svg></div>`;
}

/* ---------- synced copies ---------- */
const SOURCE_LINE = /^[ \t]*<!--\s*source\s*:[^>]*-->[ \t]*\n?/m;
/** the content of a slide without its `source` directive, for comparing a copy with its source */
export const syncBody = (chunk) => chunk.replace(SOURCE_LINE, '').replace(/^\n+|\s+$/g, '');
/** slide n (1-based) of a deck as source text */
export function slideChunk(deckText, n) { const fm = parseFrontmatter(deckText); return splitSlides(fm.body)[n - 1] ?? null; }
/** a copy of a source slide that remembers where it came from */
export const syncedCopy = (ref, sourceChunk) => `\n<!-- source: ${ref} -->\n${syncBody(sourceChunk)}\n`;

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
    return lines.every((l) => /^_?[a-zA-Z]+\s*:/.test(l.trim()) && DIRECTIVES.includes(l.trim().replace(/^_/, '').split(':')[0].trim())) ? all : '';
  }).replace(/\n+$/, '');
  if (text.trim()) out += `\n\n<!--\n${text.trim()}\n-->`;
  return out + '\n';
}
export function setGlobal(fmRaw, key, value) {
  if (!fmRaw) return `---\nmarp: true\n${key}: ${value}\n---\n\n`;
  const re = new RegExp(`^${key}:.*$`, 'm');
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
