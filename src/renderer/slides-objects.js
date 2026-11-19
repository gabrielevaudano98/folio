// Folio — placed objects on a slide (slides-md v2).
//   ::: box #id x=80 y=160 w=520 h=300 rotate=0 z=2 fill=#f2f2f2 radius=12
//   Markdown body
//   :::
//   ::: shape #id type=ellipse x=.. y=.. w=.. h=.. fill=#111      (optional label as body)
//   ![alt](src){x=700 y=120 w=480 h=320 crop=0,0,1,.8}
// Pure text functions. Every edit rewrites only the opener line (or the one image line) of one object, so the rest of
// the slide, and every other slide, keeps its bytes.

const KINDS = ['box', 'shape'];
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

const OPEN = /^(\s*):::\s*(box|shape)\b(.*)$/;
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
