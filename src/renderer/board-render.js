// Folio — a board drawn without a DOM: board model → SVG string. Used by export, MCP render_board and tests. Same model
// in, byte-identical SVG out (text is measured with a fixed character-width table unless the caller passes a measure).
// The exported SVG carries the board's source in <metadata> and a PNG carries it in an iTXt chunk, so either file opens
// again as the same board.
import { CONTAINERS, shapeSvg, labelBox, edgePath, autoLayout } from './board-core.js';

const NS = 'http://www.w3.org/2000/svg';
export const SOURCE_NS = 'https://folio.md/board';
export const PNG_KEY = 'folio-board';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = (v) => Math.round(v * 100) / 100;

// average advance of common characters at 1px font size (system sans): good enough to wrap labels the same everywhere
const NARROW = new Set('iljtfI.,:;\'!|()[] '), WIDE = new Set('mwMW@%&');
export function charWidth(text, size = 13, bold = false) {
  let w = 0;
  for (const ch of String(text)) w += NARROW.has(ch) ? 0.3 : WIDE.has(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.64 : /[^\x00-\x7f]/.test(ch) ? 0.9 : 0.53;
  return w * size * (bold ? 1.06 : 1);
}
export function wrapText(text, width, size = 13, bold = false, measure = charWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (measure(t, size, bold) > width && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

/** style of a shape or connector: rules by tag first, then its own */
export function effectiveStyle(model, el) {
  const out = {};
  for (const r of model.rules || []) if (r.match.startsWith('#') && (el.tags || []).includes(r.match.slice(1))) Object.assign(out, r.style);
  return Object.assign(out, el.style || {});
}

/** the long description: every shape and connector with its label, readable by a screen reader */
export function describeForReaders(model) {
  const label = (n) => (n.label && n.label !== n.id ? `“${n.label.replace(/\n/g, ' ')}”` : n.id);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const shapes = model.nodes.map((n) => `${label(n)} (${n.shape}${n.parent ? `, in ${label(byId.get(n.parent) || { id: n.parent })}` : ''})`);
  const edges = model.edges.map((e) => `${label(byId.get(e.from) || { id: e.from })} to ${label(byId.get(e.to) || { id: e.to })}${e.label ? ` “${e.label}”` : ''}`);
  return `${model.nodes.length} shape${model.nodes.length === 1 ? '' : 's'}: ${shapes.join('; ') || 'none'}. ${model.edges.length} connector${model.edges.length === 1 ? '' : 's'}: ${edges.join('; ') || 'none'}.`;
}

const THEMES = {
  light: { bg: '#ffffff', ink: '#1c1c1c', muted: '#777777', fill: '#ffffff', container: 'rgba(0,0,0,.025)', cstroke: '#9a9a9a', labelBg: '#ffffff' },
  dark: { bg: '#161616', ink: '#e8e8e8', muted: '#9a9a9a', fill: '#232323', container: 'rgba(255,255,255,.04)', cstroke: '#6e6e6e', labelBg: '#161616' },
};
function css(t) {
  return `.b-shape{fill:${t.fill};stroke:var(--b-stroke,${t.ink});stroke-width:var(--b-sw,1.5)}.b-container{fill:${t.container};stroke:var(--b-stroke,${t.cstroke});stroke-width:var(--b-sw,1.2);stroke-dasharray:6 4}.b-line{fill:none;stroke:var(--b-stroke,${t.ink});stroke-width:var(--b-sw,1.5)}.b-dash{stroke-dasharray:6 4}.b-dot{stroke-dasharray:1.5 4;stroke-linecap:round}.b-dashed .b-shape,.b-dashed .b-line{stroke-dasharray:6 4}.b-dotted .b-shape{stroke-dasharray:1.5 4}.b-fill-ink{fill:var(--b-stroke,${t.ink})}.b-hit{fill:transparent}.b-text{fill:var(--b-text,${t.ink});font-family:-apple-system,"Segoe UI",system-ui,sans-serif}.b-muted{fill:${t.muted}}.b-mono{font-family:ui-monospace,"SF Mono",Consolas,monospace}.b-edge-line{fill:none;stroke:var(--b-stroke,${t.ink});stroke-width:var(--b-sw,1.5)}.b-elabel-bg{fill:${t.labelBg}}.bd-mk{fill:${t.ink};stroke:${t.ink}}.bd-mk-o{fill:${t.bg};stroke:${t.ink}}.bd-mk-line{fill:none;stroke:${t.ink}}`;
}
export function markerDefs() {
  const mk = (id, path, open, w = 12, h = 12, rx = 10, ry = 6) => ['e', 's'].map((d) => `<marker id="m-${id}-${d}" viewBox="0 0 ${w} ${h}" refX="${rx}" refY="${ry}" markerWidth="${w}" markerHeight="${h}" markerUnits="userSpaceOnUse" orient="${d === 'e' ? 'auto' : 'auto-start-reverse'}"><path class="${open ? 'bd-mk-o' : 'bd-mk'}" d="${path}"/></marker>`).join('');
  return mk('arrow', 'M1,1 L11,6 L1,11 Z', false)
    + mk('open', 'M1,1 L11,6 L1,11', true).replace(/class="bd-mk-o"/g, 'class="bd-mk-line"')
    + mk('triangle', 'M1,1 L13,7 L1,13 Z', true, 14, 14, 13, 7)
    + mk('diamond', 'M1,6 L8,1 L15,6 L8,11 Z', false, 16, 12, 15, 6)
    + mk('diamondOpen', 'M1,6 L8,1 L15,6 L8,11 Z', true, 16, 12, 15, 6)
    + mk('circle', 'M6,2 A4,4 0 1 1 5.99,2 Z', false, 12, 12, 10, 6);
}

/** the markup of one shape, as the canvas draws it (label wrapped with `measure`) */
export function nodeInner(n, style, measure = charWidth) {
  const s = style;
  let inner = shapeSvg({ ...n, style: s });
  const table = ['class', 'interface', 'table'].includes(n.shape);
  const fs = Number(s.size) || (n.shape === 'text' ? 15 : 13);
  const bold = !!s.bold || table;
  if (table) {
    const head = 30;
    inner += `<path class="b-line" d="M0,${head} H${n.w}"/>`;
    inner += n.shape === 'interface' ? `<text class="b-text" x="${r2(n.w / 2)}" y="12" text-anchor="middle" font-size="10">«interface»</text><text class="b-text" x="${r2(n.w / 2)}" y="25" text-anchor="middle" font-weight="600" font-size="${fs}">${esc(n.label)}</text>`
      : `<text class="b-text" x="${r2(n.w / 2)}" y="${head / 2 + 5}" text-anchor="middle" font-weight="600" font-size="${fs}">${esc(n.label)}</text>`;
    let y = head + 4;
    for (const l of n.body) {
      if (l.trim() === '--') { inner += `<path class="b-line" d="M0,${y + 2} H${n.w}"/>`; y += 8; continue; }
      if (n.shape === 'table') {
        const [name = '', type = '', ...rest] = l.trim().split(/\s+/); const key = rest.join(' ');
        inner += `<text class="b-text b-mono" x="8" y="${y + 15}" font-size="12">${key ? `<tspan font-weight="700" font-size="10">${esc(key)} </tspan>` : ''}${esc(name)}</text><text class="b-text b-muted b-mono" x="${r2(n.w - 8)}" y="${y + 15}" text-anchor="end" font-size="11">${esc(type)}</text>`;
      } else inner += `<text class="b-text b-mono" x="8" y="${y + 15}" font-size="12">${esc(l)}</text>`;
      y += 22;
    }
    return inner;
  }
  if (n.shape === 'note' && n.body.length) {
    const lb = labelBox(n);
    const lines = [n.label, ...n.body].flatMap((l, i) => wrapText(l, lb.w, fs, i === 0, measure).map((t) => [t, i === 0]));
    return inner + lines.map(([t, b], i) => `<text class="b-text" x="${r2(lb.x)}" y="${r2(lb.y + 14 + i * 19)}" font-size="${fs}"${b ? ' font-weight="600"' : ''}>${esc(t)}</text>`).join('');
  }
  if (!n.label || (['initial', 'final', 'fork'].includes(n.shape) && n.label === n.id)) return inner;
  const lb = labelBox(n);
  if (lb.vertical) return inner + `<text class="b-text" font-weight="600" font-size="${fs}" text-anchor="middle" transform="translate(${r2(lb.w / 2 + 5)},${r2(lb.h / 2)}) rotate(-90)">${esc(n.label)}</text>`;
  const size = lb.size || fs;
  const lines = wrapText(n.label, Math.max(20, lb.w), size, bold || lb.bold, measure);
  const lh = fs * 1.3, total = lines.length * lh;
  const va = lb.valign || s.valign || 'middle';
  const y0 = va === 'top' ? lb.y + fs : lb.y + (lb.h - total) / 2 + fs * 0.98;
  const al = s.align || lb.align || 'center';
  const x = al === 'left' ? lb.x : al === 'right' ? lb.x + lb.w : lb.x + lb.w / 2;
  const anchor = al === 'left' ? 'start' : al === 'right' ? 'end' : 'middle';
  return inner + `<text class="b-text" font-size="${size}" text-anchor="${anchor}"${bold || lb.bold ? ' font-weight="600"' : ''}>${lines.map((l, i) => `<tspan x="${r2(x)}" y="${r2(y0 + i * lh)}">${esc(l)}</tspan>`).join('')}</text>`;
}
export function nodeVars(s) { return [s.stroke && `--b-stroke:${s.stroke}`, s.color && `--b-text:${s.color}`, s.width && `--b-sw:${s.width}`, s.opacity && `opacity:${s.opacity}`].filter(Boolean).join(';'); }
export function nodeClass(n, s) { return ['b-node', s.dashed || s.line === 'dashed' ? 'b-dashed' : '', s.line === 'dotted' ? 'b-dotted' : '', CONTAINERS.includes(n.shape) ? 'b-is-container' : ''].filter(Boolean).join(' '); }

/** the bounding box of the drawn shapes (and connector waypoints) */
export function boardBounds(model, pad = 50) {
  const ns = model.nodes.filter((n) => n.x != null);
  if (!ns.length) return { x: 0, y: 0, w: 200, h: 100 };
  const xs = [], ys = [];
  for (const n of ns) { xs.push(n.x, n.x + n.w); ys.push(n.y, n.y + n.h + (['actor', 'server', 'mobile', 'initial', 'final', 'fork'].includes(n.shape) ? 44 : 0)); }
  for (const e of model.edges) for (const [x, y] of e.via || []) { xs.push(x); ys.push(y); }
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad + 20 - y0 };
}

/**
 * Render a board model to a standalone SVG string.
 * opts: { theme: 'light'|'dark', title, description, source (the .board.md text to embed), ids (only these shapes and
 * the connectors between them), region {x,y,w,h}, scale, measure, maxSize (largest side in px) }
 */
export function renderBoardSvg(model, opts = {}) {
  const m = { ...model, nodes: model.nodes.map((n) => ({ ...n })), edges: model.edges };
  if (m.nodes.some((n) => n.x == null || n.y == null)) autoLayout(m);
  let nodes = m.nodes, edges = m.edges;
  if (opts.ids?.length) { const keep = new Set(opts.ids); nodes = nodes.filter((n) => keep.has(n.id) || (n.parent && keep.has(n.parent))); const ids = new Set(nodes.map((n) => n.id)); edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to)); }
  const theme = THEMES[opts.theme] || THEMES.light;
  const by = new Map(nodes.map((n) => [n.id, n]));
  const b = opts.region || boardBounds({ nodes, edges });
  const scale = opts.scale || 1;
  let W = b.w * scale, H = b.h * scale;
  if (opts.maxSize && Math.max(W, H) > opts.maxSize) { const k = opts.maxSize / Math.max(W, H); W *= k; H *= k; }
  const measure = opts.measure || charWidth;
  const title = opts.title ?? model.title ?? '';
  const desc = opts.description || describeForReaders({ nodes, edges });
  const drawNode = (n) => { const s = effectiveStyle(m, n); return `<g class="${nodeClass(n, s)}" transform="translate(${r2(n.x)},${r2(n.y)})"${nodeVars(s) ? ` style="${nodeVars(s)}"` : ''}>${nodeInner(n, s, measure)}</g>`; };
  const drawEdge = (e) => {
    const a = by.get(e.from), c = by.get(e.to); if (!a || !c) return '';
    const s = effectiveStyle(m, e);
    const { d, mid } = edgePath(a, c, { ...e, style: s });
    const lw = e.label ? measure(e.label, 12) + 10 : 0;
    const label = e.label ? `<rect class="b-elabel-bg" x="${r2(mid[0] - lw / 2)}" y="${r2(mid[1] - 10)}" width="${r2(lw)}" height="20" rx="4"/><text class="b-text" x="${r2(mid[0])}" y="${r2(mid[1] + 4)}" text-anchor="middle" font-size="12">${esc(e.label)}</text>` : '';
    const vars = [s.stroke && `--b-stroke:${s.stroke}`, s.width && `--b-sw:${s.width}`].filter(Boolean).join(';');
    return `<g class="b-edge"${vars ? ` style="${vars}"` : ''}><path class="b-edge-line${e.line === 'dashed' ? ' b-dash' : e.line === 'dotted' ? ' b-dot' : ''}" d="${d}"${e.start ? ` marker-start="url(#m-${e.start}-s)"` : ''}${e.end ? ` marker-end="url(#m-${e.end}-e)"` : ''}/>${label}</g>`;
  };
  const meta = opts.source != null ? `<metadata><folio:board xmlns:folio="${SOURCE_NS}" version="1"><![CDATA[${String(opts.source).replace(/]]>/g, ']]]]><![CDATA[>')}]]></folio:board></metadata>` : '';
  return `<svg xmlns="${NS}" viewBox="${r2(b.x)} ${r2(b.y)} ${r2(b.w)} ${r2(b.h)}" width="${Math.round(W)}" height="${Math.round(H)}" role="img" aria-labelledby="board-title board-desc">`
    + `<title id="board-title">${esc(title || 'Board')}</title><desc id="board-desc">${esc(desc)}</desc>${meta}`
    + `<style>${css(theme)}</style><defs>${markerDefs()}</defs>`
    + `<rect x="${r2(b.x)}" y="${r2(b.y)}" width="${r2(b.w)}" height="${r2(b.h)}" fill="${theme.bg}"/>`
    + `<g>${nodes.filter((n) => CONTAINERS.includes(n.shape)).map(drawNode).join('')}</g>`
    + `<g>${edges.map(drawEdge).join('')}</g>`
    + `<g>${nodes.filter((n) => !CONTAINERS.includes(n.shape)).map(drawNode).join('')}</g></svg>`;
}

/** the board source embedded in an exported SVG, or null */
export function sourceFromSvg(svg) {
  const m = String(svg).match(/<folio:board\b[^>]*>([\s\S]*?)<\/folio:board>/);
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/* ---------- PNG text chunks ---------- */
let CRC;
function crc32(bytes) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const isPng = (u8) => SIG.every((v, i) => u8[i] === v);
/** add (or replace) an uncompressed iTXt chunk before IEND */
export function pngWithText(bytes, key, text) {
  const u8 = new Uint8Array(bytes);
  if (!isPng(u8)) throw new Error('Not a PNG file');
  const enc = new TextEncoder();
  const data = new Uint8Array([...enc.encode(key), 0, 0, 0, 0, 0, ...enc.encode(text)]);
  const chunks = []; let p = 8;
  while (p < u8.length) {
    const len = new DataView(u8.buffer, u8.byteOffset + p, 4).getUint32(0);
    const type = String.fromCharCode(...u8.slice(p + 4, p + 8));
    const end = p + 12 + len;
    const isOurs = type === 'iTXt' && new TextDecoder().decode(u8.slice(p + 8, p + 8 + Math.min(len, key.length + 1))) === key + '\0';
    if (type === 'IEND') {
      const head = new Uint8Array(8); new DataView(head.buffer).setUint32(0, data.length); head.set(enc.encode('iTXt'), 4);
      const body = new Uint8Array([...head.slice(4), ...data]);
      const crc = new Uint8Array(4); new DataView(crc.buffer).setUint32(0, crc32(body));
      chunks.push(head, data, crc);
    }
    if (!isOurs) chunks.push(u8.slice(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  const out = new Uint8Array(8 + chunks.reduce((s, c) => s + c.length, 0));
  out.set(SIG, 0); let o = 8; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
/** the text of an iTXt or tEXt chunk with this keyword, or null */
export function pngText(bytes, key = PNG_KEY) {
  const u8 = new Uint8Array(bytes);
  if (!isPng(u8)) return null;
  let p = 8; const dec = new TextDecoder();
  while (p + 8 <= u8.length) {
    const len = new DataView(u8.buffer, u8.byteOffset + p, 4).getUint32(0);
    const type = String.fromCharCode(...u8.slice(p + 4, p + 8));
    const d = u8.slice(p + 8, p + 8 + len);
    if (type === 'iTXt' || type === 'tEXt') {
      const z = d.indexOf(0);
      if (dec.decode(d.slice(0, z)) === key) {
        if (type === 'tEXt') return dec.decode(d.slice(z + 1));
        if (d[z + 1] !== 0) return null; // compressed: not written by Folio
        let q = z + 3; q = d.indexOf(0, q) + 1; q = d.indexOf(0, q) + 1; // language tag, translated keyword
        return dec.decode(d.slice(q));
      }
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return null;
}
