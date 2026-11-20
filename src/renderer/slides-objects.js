// Folio — placed objects on a slide (slides-md v2).
//   ::: box #id x=80 y=160 w=520 h=300 rotate=0 z=2 fill=#f2f2f2 radius=12
//   Markdown body
//   :::
//   ::: shape #id type=ellipse x=.. y=.. w=.. h=.. fill=#111      (optional label as body)
//   ![alt](src){x=700 y=120 w=480 h=320 crop=0,0,1,.8}
// Pure text functions. Every edit rewrites only the opener line (or the one image line) of one object, so the rest of
// the slide, and every other slide, keeps its bytes.

export const KINDS = ['box', 'shape', 'line', 'icon', 'media', 'path', 'smartart', 'zoom'];
const NUM = ['x', 'y', 'w', 'h', 'rotate', 'z', 'radius', 'opacity'];

/** `#id x=1 fill="#fff" alt="a b"` → { id, attrs, tokens } */
export function parseAttrs(s) {
  const attrs = {}; const tokens = []; let id = null;
  const re = /\s*(#[\w-]+|[\w-]+=(?:"[^"]*"|'[^']*'|[^\s"']+)|\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    const t = m[1]; tokens.push(t);
    if (t[0] === '#' && id == null) { id = t.slice(1); continue; }
    const kv = t.match(/^([\w-]+)=(.*)$/);
    if (kv) attrs[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return { id, attrs, tokens };
}

const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : /[\s"']/.test(String(v)) ? `"${String(v).replace(/"/g, '')}"` : String(v));

/** rewrite the tokens: change what the patch names, drop null, append the rest. Untouched tokens keep their text. */
export function patchTokens(tokens, patch) {
  const left = { ...patch }; const out = [];
  for (const t of tokens) {
    if (t[0] === '#') { if ('id' in left) { if (left.id != null) out.push('#' + left.id); delete left.id; } else out.push(t); continue; }
    const kv = t.match(/^([\w-]+)=(.*)$/);
    if (kv && kv[1] in left) { const v = left[kv[1]]; delete left[kv[1]]; if (v != null) out.push(`${kv[1]}=${fmt(v)}`); }
    else out.push(t);
  }
  if ('id' in left && left.id != null) out.unshift('#' + left.id);
  delete left.id;
  for (const [k, v] of Object.entries(left)) if (v != null) out.push(`${k}=${fmt(v)}`);
  return out;
}

const OPEN = /^(\s*):::\s*(box|shape|line|icon|media|path|smartart|zoom)\b(.*)$/;
const SELF = /\s:::\s*$/;
const IMG = /^(\s*)!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\{([^}]*)\}\s*$/;

/** top-level placed objects of a slide chunk, in document order */
export function scanObjects(text) {
  const lines = text.split('\n'); const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = l.match(/^\s*(```|~~~)/);
    if (f) { fence = fence ? (l.trim().startsWith(fence) ? null : fence) : f[1]; continue; }
    if (fence) continue;
    const o = l.match(OPEN);
    if (o) {
      const self = SELF.test(o[3]);
      const rest = self ? o[3].replace(SELF, '') : o[3];
      let close = i;
      if (!self) {
        let depth = 1; let inFence = null;
        for (let j = i + 1; j < lines.length; j++) {
          const lj = lines[j];
          const fj = lj.match(/^\s*(```|~~~)/);
          if (fj) { inFence = inFence ? (lj.trim().startsWith(inFence) ? null : inFence) : fj[1]; continue; }
          if (inFence) continue;
          if (/^\s*:::\s*$/.test(lj)) { depth--; if (!depth) { close = j; break; } }
          else if (/^\s*:::\s*\S/.test(lj) && !SELF.test(lj)) depth++;
        }
        if (close === i) { close = lines.length - 1; }
      }
      const p = parseAttrs(rest);
      out.push({ kind: o[2], ...p, open: i, close, self, indent: o[1], body: lines.slice(i + 1, self ? i + 1 : close).join('\n') });
      i = close; continue;
    }
    const im = l.match(IMG);
    if (im && im[2].trim().split(/\s+/)[0].toLowerCase() !== 'bg') {
      const p = parseAttrs(im[4]);
      if (['x', 'y', 'w', 'h'].some((k) => k in p.attrs)) out.push({ kind: 'image', ...p, open: i, close: i, self: true, indent: im[1], alt: im[2], src: im[3], body: '' });
    }
  }
  return out;
}

/** geometry as numbers, with defaults */
export function geometry(o) {
  const g = {}; for (const k of NUM) { const v = parseFloat(o.attrs[k]); if (!Number.isNaN(v)) g[k] = v; }
  return { x: 0, y: 0, w: 320, h: 180, rotate: 0, z: 0, ...g };
}

/** split a chunk into flow text and placed objects */
export function extractObjects(text) {
  const objs = scanObjects(text);
  if (!objs.length) return { flow: text, objects: [] };
  const drop = new Set(); for (const o of objs) for (let i = o.open; i <= o.close; i++) drop.add(i);
  const flow = text.split('\n').filter((_, i) => !drop.has(i)).join('\n').replace(/\n{3,}/g, '\n\n');
  return { flow, objects: objs };
}

const find = (objs, ref) => (typeof ref === 'number' ? objs[ref] : objs.find((o) => o.id === ref));

/** change attributes of one object (ref: index or id). patch value null removes the attribute. */
export function setObjectAttrs(text, ref, patch) {
  const objs = scanObjects(text); const o = find(objs, ref);
  if (!o) return text;
  const lines = text.split('\n');
  const tokens = patchTokens(o.tokens, patch);
  const l = lines[o.open];
  if (o.kind === 'image') {
    lines[o.open] = l.replace(/\{[^}]*\}\s*$/, `{${tokens.join(' ')}}`);
  } else {
    lines[o.open] = `${o.indent}::: ${o.kind}${tokens.length ? ' ' + tokens.join(' ') : ''}${o.self ? ' :::' : ''}`;
  }
  return lines.join('\n');
}

/** move/resize several objects at once (a group drag), still one pass */
export function setMany(text, patches) {
  let out = text;
  for (const [ref, patch] of patches) out = setObjectAttrs(out, ref, patch);
  return out;
}

export function removeObject(text, ref) {
  const o = find(scanObjects(text), ref);
  if (!o) return text;
  const lines = text.split('\n'); lines.splice(o.open, o.close - o.open + 1);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** copy of one object's source lines, for duplicate and clipboard */
export function objectSource(text, ref) {
  const o = find(scanObjects(text), ref);
  return o ? text.split('\n').slice(o.open, o.close + 1).join('\n') : '';
}

/** append a block at the end of the slide's content (before trailing notes comments stay untouched) */
export function addObject(text, block) {
  return text.replace(/\n*$/, '') + '\n\n' + block.replace(/\n*$/, '') + '\n';
}

/** next free id like box-3 */
export function nextId(text, prefix = 'box') {
  const used = new Set(scanObjects(text).map((o) => o.id)); let n = 1;
  while (used.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

/* ---------- arrange (P2): pure geometry helpers ---------- */
const box = (g) => ({ l: g.x, t: g.y, r: g.x + g.w, b: g.y + g.h });
export const locked = (o) => ['true', '1', 'yes'].includes(String(o.attrs.lock || '').toLowerCase());
export const groupOf = (o) => o.attrs.group || null;

/** align the picked objects to each other (2+), or to the slide (1). modes: left center right top middle bottom */
export function alignPatches(objs, picked, mode, slide) {
  const gs = picked.map((i) => ({ i, g: geometry(objs[i]) }));
  const bb = gs.length > 1
    ? { l: Math.min(...gs.map((s) => s.g.x)), t: Math.min(...gs.map((s) => s.g.y)), r: Math.max(...gs.map((s) => s.g.x + s.g.w)), b: Math.max(...gs.map((s) => s.g.y + s.g.h)) }
    : { l: 0, t: 0, r: slide.width, b: slide.height };
  return gs.map(({ i, g }) => {
    const p = {};
    if (mode === 'left') p.x = bb.l; else if (mode === 'right') p.x = bb.r - g.w; else if (mode === 'center') p.x = (bb.l + bb.r) / 2 - g.w / 2;
    if (mode === 'top') p.y = bb.t; else if (mode === 'bottom') p.y = bb.b - g.h; else if (mode === 'middle') p.y = (bb.t + bb.b) / 2 - g.h / 2;
    for (const k of Object.keys(p)) p[k] = Math.round(p[k]);
    return [i, p];
  }).filter(([i, p]) => Object.entries(p).some(([k, v]) => v !== geometry(objs[i])[k]));
}

/** spread 3+ objects so the gaps between them are equal ('h' or 'v') */
export function distributePatches(objs, picked, axis) {
  if (picked.length < 3) return [];
  const key = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h';
  const gs = picked.map((i) => ({ i, g: geometry(objs[i]) })).sort((a, b) => a.g[key] - b.g[key]);
  const first = gs[0].g[key], last = gs[gs.length - 1].g[key] + gs[gs.length - 1].g[size];
  const gap = (last - first - gs.reduce((s, o) => s + o.g[size], 0)) / (gs.length - 1);
  let pos = first;
  return gs.map(({ i, g }) => { const v = Math.round(pos); pos += g[size] + gap; return [i, { [key]: v }]; })
    .filter(([i, p]) => p[key] !== geometry(objs[i])[key]);
}

/** stacking: 'front' | 'back' | 'forward' | 'backward' */
export function zPatches(objs, picked, op) {
  const zs = objs.map((o) => geometry(o).z); const set = new Set(picked);
  if (op === 'front') { const top = Math.max(...zs); return picked.map((i, n) => [i, { z: top + 1 + n }]); }
  if (op === 'back') { const low = Math.min(...zs); return picked.map((i, n) => [i, { z: low - picked.length + n }]); }
  const out = [];
  for (const i of picked) {
    const z = zs[i];
    const others = zs.map((v, j) => [v, j]).filter(([, j]) => !set.has(j));
    const next = op === 'forward' ? others.filter(([v]) => v >= z).sort((a, b) => a[0] - b[0])[0] : others.filter(([v]) => v <= z).sort((a, b) => b[0] - a[0])[0];
    if (next) out.push([i, { z: op === 'forward' ? next[0] + 1 : next[0] - 1 }]);
  }
  return out;
}

/** a new, free group name */
export function nextGroup(objs) { const used = new Set(objs.map((o) => o.attrs.group)); let n = 1; while (used.has(`group-${n}`)) n++; return `group-${n}`; }

/** shift every x= and y= in copied object source (paste offset) and give it a fresh id */
export function retarget(src, text, dx = 24, dy = 24) {
  const kind = (src.match(/^\s*:::\s*(\w+)/) || [])[1] || 'image';
  const id = nextId(text, kind);
  let out = src.split('\n');
  const head = out[0];
  let h = head.replace(/ #[\w-]+/, '');
  h = /^\s*:::/.test(h) ? h.replace(/^(\s*:::\s*\w+)/, `$1 #${id}`) : h;
  h = h.replace(/\b(x|y)=(-?[\d.]+)/g, (m, a, v) => `${a}=${Math.round(parseFloat(v) + (a === 'x' ? dx : dy))}`);
  out[0] = h; return out.join('\n');
}

/** replace the Markdown body of a box or shape (the lines between its opener and closer) */
export function setObjectBody(text, ref, body) {
  const o = find(scanObjects(text), ref);
  if (!o || o.kind === 'image') return text;
  const lines = text.split('\n');
  const clean = body.replace(/\s+$/, '').split('\n');
  if (o.self) { lines.splice(o.open, 1, `${o.indent}::: ${o.kind}${o.tokens.length ? ' ' + o.tokens.join(' ') : ''}`, ...clean, `${o.indent}:::`); return lines.join('\n'); }
  lines.splice(o.open + 1, o.close - o.open - 1, ...(body.trim() ? clean : ['']));
  return lines.join('\n');
}

export const FONTS = { sans: 'inherit', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', rounded: 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif' };
/** text attributes → CSS declarations (shared by the renderer and the editor) */
export function textStyle(a) {
  const st = [];
  if (a.font) st.push(`font-family:${FONTS[a.font] || (/^[\w \-]{1,40}$/.test(a.font) ? `"${a.font}", sans-serif` : 'inherit')}`);
  if (a.size && parseFloat(a.size) > 0) st.push(`font-size:${parseFloat(a.size)}px`);
  if (['left', 'center', 'right', 'justify'].includes(a.align)) st.push(`text-align:${a.align}`);
  if (a.line && parseFloat(a.line) > 0) st.push(`line-height:${parseFloat(a.line)}`);
  if (a.bold === 'true') st.push('font-weight:700');
  const v = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[a.valign];
  if (v) st.push(`justify-content:${v}`);
  return st;
}

/** can the on-canvas text editor round-trip this body without losing anything? */
export function inlineSafe(body) {
  return !(/^\s*:::/m.test(body) || /^\s*(```|~~~)/m.test(body) || /!\[/.test(body)
    || /<\/?[a-zA-Z]/.test(body) || /\[\[|\{\{|\[\^|\$\$/.test(body) || /^\s*\[.+\]:\s*\S/m.test(body));
}

/* ---------- lines and connectors (P5) ----------
   ::: line #id x=100 y=100 w=300 h=0 head=arrow :::      from (x,y) to (x+w, y+h); w and h may be negative
   ::: line #id from=a.right to=b.left head=arrow :::     a connector that follows objects a and b */
const PORT = { top: [0.5, 0], right: [1, 0.5], bottom: [0.5, 1], left: [0, 0.5], center: [0.5, 0.5] };
export function portPoint(g, port = 'center') { const [fx, fy] = PORT[port] || PORT.center; return [g.x + g.w * fx, g.y + g.h * fy]; }
/** pick the facing ports of two boxes */
function facing(a, b) {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ['right', 'left'] : ['left', 'right']) : (dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']);
}
/** end points of a line, resolving from/to against the other objects' geometry (map id → geometry) */
export function linePoints(o, byId) {
  const g = geometry(o); const a = o.attrs;
  let p1 = [g.x, g.y], p2 = [g.x + g.w, g.y + g.h];
  const end = (spec) => { if (!spec) return null; const [id, port] = String(spec).split('.'); return byId[id] ? { g: byId[id], port } : null; };
  const f = end(a.from), t = end(a.to);
  if (f && t) { const [pf, pt] = facing(f.g, t.g); p1 = portPoint(f.g, f.port || pf); p2 = portPoint(t.g, t.port || pt); }
  else if (f) p1 = portPoint(f.g, f.port || facing(f.g, { x: p2[0], y: p2[1], w: 0, h: 0 })[0]);
  else if (t) p2 = portPoint(t.g, t.port || facing(t.g, { x: p1[0], y: p1[1], w: 0, h: 0 })[0]);
  return [p1, p2];
}
/** SVG path for a line: straight, or elbow (route=elbow) */
export function linePath([[x1, y1], [x2, y2]], route) {
  if (route === 'elbow') { const mx = (x1 + x2) / 2; return `M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}`; }
  return `M${x1},${y1} L${x2},${y2}`;
}

/* ---------- format (P6): fills, borders, shadows, picture adjustments ---------- */
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d.,\s%]+\)|transparent|none|currentColor)$/i;
export const safeColor = (c) => (c != null && COLOR.test(String(c).trim()) ? String(c).trim() : null);
/** fill=#hex | none | linear(#a,#b,90) | radial(#a,#b) → { kind, stops, angle } */
export function parseFill(f) {
  if (f == null || f === '') return null;
  const m = String(f).match(/^(linear|radial)\((.*)\)$/i);
  if (!m) { const c = safeColor(f); return c ? { kind: 'solid', color: c } : null; }
  const parts = m[2].split(',').map((x) => x.trim()).filter(Boolean);
  const angle = m[1].toLowerCase() === 'linear' && /^-?\d+(\.\d+)?$/.test(parts.at(-1)) ? parseFloat(parts.pop()) : 90;
  const stops = parts.map(safeColor).filter(Boolean);
  return stops.length >= 2 ? { kind: m[1].toLowerCase(), stops, angle } : null;
}
export function fillCss(f) {
  const p = parseFill(f); if (!p) return null;
  if (p.kind === 'solid') return p.color === 'none' ? 'transparent' : p.color;
  return p.kind === 'linear' ? `linear-gradient(${p.angle}deg, ${p.stops.join(', ')})` : `radial-gradient(circle, ${p.stops.join(', ')})`;
}
/** <defs> for an SVG gradient fill, and the value to use in fill= */
export function fillSvg(f, id) {
  const p = parseFill(f); if (!p) return { defs: '', fill: null };
  if (p.kind === 'solid') return { defs: '', fill: p.color === 'none' ? 'none' : p.color };
  const stops = p.stops.map((c, i) => `<stop offset="${(i / (p.stops.length - 1)) * 100}%" stop-color="${c}"/>`).join('');
  if (p.kind === 'radial') return { defs: `<defs><radialGradient id="${id}">${stops}</radialGradient></defs>`, fill: `url(#${id})` };
  const r = ((p.angle - 90) * Math.PI) / 180; const dx = Math.cos(r) / 2, dy = Math.sin(r) / 2;
  return { defs: `<defs><linearGradient id="${id}" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${stops}</linearGradient></defs>`, fill: `url(#${id})` };
}
export const SHADOWS = { soft: 'drop-shadow(0 6px 18px rgba(0,0,0,.18))', medium: 'drop-shadow(0 10px 24px rgba(0,0,0,.28))', hard: 'drop-shadow(6px 6px 0 rgba(0,0,0,.85))', glow: 'drop-shadow(0 0 14px rgba(255,255,255,.9))' };
const ADJUST = { brightness: [0, 3], contrast: [0, 3], saturate: [0, 3], grayscale: [0, 1], sepia: [0, 1], blur: [0, 40], invert: [0, 1], 'hue-rotate': [-360, 360] };
/** adjust=brightness:1.1,contrast:1.2,grayscale:1 → CSS filter functions */
export function adjustCss(v) {
  return String(v || '').split(',').map((x) => x.split(':').map((y) => y.trim())).filter(([k, n]) => ADJUST[k] && n !== '' && !Number.isNaN(parseFloat(n)))
    .map(([k, n]) => { const [lo, hi] = ADJUST[k]; const val = Math.max(lo, Math.min(hi, parseFloat(n))); return k === 'blur' ? `blur(${val}px)` : k === 'hue-rotate' ? `hue-rotate(${val}deg)` : `${k}(${val})`; });
}
export const MASKS = { circle: 'circle(50% at 50% 50%)', ellipse: 'ellipse(50% 50% at 50% 50%)', rounded: 'inset(0 round 12%)', diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)', hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)', triangle: 'polygon(50% 0, 100% 100%, 0 100%)', star: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' };
/** CSS for the outer box of any placed object (border, shadow, flip, mask, opacity filters) */
export function frameCss(o) {
  const a = o.attrs; const st = []; const filters = [];
  if (SHADOWS[a.shadow]) filters.push(SHADOWS[a.shadow]);
  if (o.kind !== 'image' && a.adjust) filters.push(...adjustCss(a.adjust));
  if (filters.length) st.push(`filter:${filters.join(' ')}`);
  if (o.kind === 'box' && (a.border || a.stroke)) st.push(`border:${parseFloat(a.border) || 1}px ${a.dash === 'true' ? 'dashed' : 'solid'} ${safeColor(a.stroke) || 'currentColor'}`);
  if (o.kind !== 'shape' && MASKS[a.mask]) st.push(`clip-path:${MASKS[a.mask]}`);
  return st;
}
export const flipCss = (a) => (a.flip === 'h' ? 'scaleX(-1)' : a.flip === 'v' ? 'scaleY(-1)' : a.flip === 'hv' ? 'scale(-1,-1)' : '');

/** point a positioned image at a new file, keeping its alt text and geometry */
export function replaceImageSrc(text, ref, src) {
  const o = find(scanObjects(text), ref); if (!o || o.kind !== 'image') return text;
  const lines = text.split('\n');
  lines[o.open] = lines[o.open].replace(/\]\(\s*<?[^)\s>]+>?(\s+"[^"]*")?\s*\)/, `](${src}$1)`);
  return lines.join('\n');
}

/* ---------- free shapes (P6) ----------
   ::: path #id x= y= w= h= points="0,0 0.5,1 1,0" closed=true smooth=true fill=#e8e8e8 :::   editable points, 0..1 of the box
   ::: path #id x= y= w= h= d="M0,0L1,0L1,1Z" fill=#e8e8e8 :::                               a merged outline (even-odd) */
const r3 = (v) => Math.round(v * 1000) / 1000;
export function parsePoints(s) { return String(s || '').trim().split(/\s+/).map((p) => p.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)); }
export const pointsText = (pts) => pts.map(([x, y]) => `${r3(x)},${r3(y)}`).join(' ');
/** SVG path data in 0..1 units for a points path, optionally smoothed (Catmull-Rom) */
export function pointsPath(pts, closed, smooth) {
  if (pts.length < 2) return '';
  if (!smooth || pts.length < 3) return 'M' + pts.map((p) => p.join(',')).join(' L') + (closed ? ' Z' : '');
  const P = closed ? [pts.at(-1), ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts.at(-1)];
  let d = `M${pts[0].join(',')}`;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 1; i <= n; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r3(c1[0])},${r3(c1[1])} ${r3(c2[0])},${r3(c2[1])} ${r3(p2[0])},${r3(p2[1])}`;
  }
  return d + (closed ? ' Z' : '');
}
/** simplify a drawn stroke (Ramer–Douglas–Peucker) */
export function simplify(pts, eps = 2) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts.at(-1)]; let idx = 0, max = 0;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = L < 1e-6 ? Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) : Math.abs((b[1] - a[1]) * pts[i][0] - (b[0] - a[0]) * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (d > max) { max = d; idx = i; }
  }
  return max > eps ? [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)] : [a, b];
}
/** slide-space points → a path block with its box and normalised points */
export function pathBlock(id, abs, extra = '') {
  const xs = abs.map((p) => p[0]), ys = abs.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x), h = Math.max(1, Math.max(...ys) - y);
  return `::: path #${id} x=${Math.round(x)} y=${Math.round(y)} w=${Math.round(w)} h=${Math.round(h)} points="${pointsText(abs.map(([px, py]) => [(px - x) / w, (py - y) / h]))}"${extra} :::`;
}
/** a MultiPolygon in slide space ([[[x,y],...ring], ...polygon], ...) → a path block with an even-odd outline */
export function polygonsBlock(id, multi, extra = '') {
  const all = multi.flat(2); const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x), h = Math.max(1, Math.max(...ys) - y);
  const d = multi.flatMap((poly) => poly.map((ring) => 'M' + ring.map(([px, py]) => `${r3((px - x) / w)},${r3((py - y) / h)}`).join('L') + 'Z')).join('');
  return `::: path #${id} x=${Math.round(x)} y=${Math.round(y)} w=${Math.round(w)} h=${Math.round(h)} d="${d}"${extra} :::`;
}
