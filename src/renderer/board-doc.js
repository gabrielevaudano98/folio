// Folio — board-md as a document: one parser that keeps every byte (a concrete syntax tree), one canonical graph model,
// and a writer that rewrites only the elements whose model changed. Every surface (canvas, code view, MCP, merge) goes
// through parseBoardDoc → boardModel → (edit the model, usually with board-ops.js) → writeBoardDoc.
//
//   ---
//   board: { version: 1, direction: LR }
//   ---
//   ```board
//   api: component "Orders API" in backend #critical {owner: payments}
//   user -> api "HTTPS" =e1
//   api -> db, cache "reads"        // fan-out
//   a -> b -> c                     // chain
//   ```
//   <!-- board-view
//   api @400,100 150x70 {fill: #eee} locked
//   e1 {route: curved} from=right to=left via 520,40
//   #critical {stroke: #555}
//   -->
//   ## Notes
//   - [api] Why not gRPC? (open)
//
// Inline boards (positions and styles on the code lines, `@x,y WxH {fill: …}`) are read and written as they are; the
// split form above is written only when a board has a view section, or has no positions at all.
import { SHAPES, ARROWS, defaultSize, fitAuto } from './board-core.js';

export const FORMAT_VERSION = 1;
export const SETTING_KEYS = ['version', 'direction', 'connectorStyle', 'layout', 'title', 'description'];
export const NODE_STYLE_KEYS = new Set(['fill', 'stroke', 'color', 'line', 'dashed', 'dotted', 'width', 'size', 'bold', 'italic', 'align', 'valign', 'opacity', 'rounded']);
export const EDGE_STYLE_KEYS = new Set(['route', 'stroke', 'width', 'color', 'opacity']);
const EDGE_TYPE_KEYS = new Set(['line', 'start', 'end']);
export const OPS = ['<->', '..|>', '-|>', '*--', 'o--', '-->', '..>', '->', '--', '..']; // longest first
export const PORTS = ['top', 'right', 'bottom', 'left'];
export const ID_RE = /^[A-Za-z_][\w-]*$/;
const OP_SRC = OPS.map((o) => o.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
const HEAD_RE = new RegExp(`^\\s*([\\w.-]+?(?:\\s*,\\s*[\\w.-]+?)*)\\s*(${OP_SRC})\\s*`);
const LAST_RE = /^\s*([\w.-]+(?:\s*,\s*[\w.-]+)*)/;
const NODE_HEAD = /^(\s*)([A-Za-z_][\w-]*)\s*:/;
const unq = (s) => (s ?? '').replace(/\\"/g, '"').replace(/\\n/g, '\n');
export const quote = (s) => `"${String(s).replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
const num = (v) => Math.round(Number(v));
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/* ---------- small helpers ---------- */
export function parseAttrs(s) {
  const out = {};
  if (!s) return out;
  for (const part of s.split(';')) {
    const [k, ...v] = part.split(':');
    if (!k.trim()) continue;
    out[k.trim()] = v.length ? v.join(':').trim() : true;
  }
  return out;
}
export function attrsText(obj) {
  const e = Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
  return e.length ? `{${e.map(([k, v]) => (v === true ? k : `${k}: ${v}`)).join('; ')}}` : '';
}
const sameObj = (a, b) => JSON.stringify(Object.entries(a || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).sort()) === JSON.stringify(Object.entries(b || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).sort());
const sameArr = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
/** a short, stable hash of a text (53 bits, hex): the revision MCP clients pass back as base_revision */
export function revisionOf(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
/** edit distance, for "did you mean" suggestions */
export function distance(a, b) {
  const m = a.length, n = b.length; if (!m || !n) return m + n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
export function nearest(word, list, max = 3) {
  const w = String(word).toLowerCase();
  return [...new Set(list)].map((x) => [x, distance(w, String(x).toLowerCase())]).filter(([x, d]) => d <= Math.max(2, Math.floor(w.length / 3)) || String(x).toLowerCase().startsWith(w)).sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, max).map(([x]) => x);
}
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/** lines with their own terminators, so mixed line endings come back byte for byte */
function splitLines(text) {
  const out = []; let i = 0;
  for (;;) {
    const j = text.indexOf('\n', i);
    if (j < 0) { out.push({ t: text.slice(i), e: '' }); break; }
    const cr = j > i && text[j - 1] === '\r';
    out.push({ t: text.slice(i, cr ? j - 1 : j), e: cr ? '\r\n' : '\n' });
    i = j + 1;
  }
  return out;
}

/* ---------- tokens of one line ---------- */
// Returns tokens with their spans so a changed field can be rewritten in place, keeping the rest of the line as typed.
function lex(s, from = 0) {
  const toks = []; let i = from;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    const st = i, rest = s.slice(i); let m;
    if (rest.startsWith('//')) { toks.push({ k: 'comment', s: st, e: s.length }); break; }
    if (c === '"') {
      let j = i + 1; while (j < s.length && s[j] !== '"') { if (s[j] === '\\') j++; j++; }
      if (j >= s.length) return { error: { col: st + 1, msg: 'This label has no closing quote', fix: 'Add a " at the end of the label' } };
      toks.push({ k: 'str', v: unq(s.slice(i + 1, j)), s: st, e: j + 1 }); i = j + 1; continue;
    }
    if (c === '{') {
      const j = s.indexOf('}', i);
      if (j < 0) return { error: { col: st + 1, msg: 'This { has no closing }', fix: 'Add a } after the last key' } };
      toks.push({ k: 'brace', v: parseAttrs(s.slice(i + 1, j)), s: st, e: j + 1 }); i = j + 1; continue;
    }
    if ((m = /^@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(rest))) { toks.push({ k: 'pos', v: [Number(m[1]), Number(m[2])], s: st, e: st + m[0].length }); i += m[0].length; continue; }
    if ((m = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?![\w.])/.exec(rest))) { toks.push({ k: 'size', v: [Number(m[1]), Number(m[2])], s: st, e: st + m[0].length }); i += m[0].length; continue; }
    if ((m = /^#([\w-]+)/.exec(rest))) { toks.push({ k: 'tag', v: m[1], s: st, e: st + m[0].length }); i += m[0].length; continue; }
    if ((m = /^=([A-Za-z_][\w-]*)/.exec(rest))) { toks.push({ k: 'eqid', v: m[1], s: st, e: st + m[0].length }); i += m[0].length; continue; }
    if (c === '[' && /^\[\s*(\/\/.*)?$/.test(rest)) { toks.push({ k: 'open', s: st, e: st + 1 }); i++; continue; }
    if ((m = /^(from|to)=(top|right|bottom|left)\b/.exec(rest))) { toks.push({ k: m[1] === 'from' ? 'fromPort' : 'toPort', v: m[2], s: st, e: st + m[0].length }); i += m[0].length; continue; }
    if ((m = /^via((?:\s+-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?)+)/.exec(rest))) {
      const pts = [...m[1].matchAll(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g)].map((p) => [Number(p[1]), Number(p[2])]);
      toks.push({ k: 'via', v: pts, s: st, e: st + m[0].length }); i += m[0].length; continue;
    }
    if ((m = /^[A-Za-z_][\w-]*/.exec(rest))) { toks.push({ k: 'word', v: m[0], s: st, e: st + m[0].length }); i += m[0].length; continue; }
    return { error: { col: st + 1, msg: `Unexpected “${rest.slice(0, 12)}”`, fix: 'Labels go in double quotes, styles and data in { }' } };
  }
  return { toks };
}

function splitStyle(attrs, styleKeys, typeKeys) {
  const style = {}, data = {}, type = {};
  for (const [k, v] of Object.entries(attrs || {})) (typeKeys?.has(k) ? type : styleKeys.has(k) ? style : data)[k] = v;
  return { style, data, type };
}
function endpoint(raw) {
  const m = raw.match(/^([\w.-]+?)(?:\.(top|right|bottom|left))?$/);
  return m ? { id: m[1], port: m[2] || null } : null;
}

/** one line of the code block → a statement */
function parseCodeLine(raw) {
  const t = raw.trim();
  if (!t) return { type: 'blank' };
  if (t.startsWith('//') || t.startsWith('%%')) return { type: 'comment' };
  let m = raw.match(NODE_HEAD);
  if (m) {
    const lx = lex(raw, m[0].length);
    if (lx.error) return { type: 'error', ...lx.error };
    const n = { type: 'node', id: m[2], toks: lx.toks, kind: null, label: null, parent: null, tags: [], attrs: {}, pos: null, size: null, open: false };
    for (let i = 0; i < lx.toks.length; i++) {
      const tk = lx.toks[i];
      if (tk.k === 'word' && tk.v === 'in' && lx.toks[i + 1]?.k === 'word') { tk.k = 'in'; tk.e = lx.toks[i + 1].e; tk.v = lx.toks[i + 1].v; lx.toks.splice(i + 1, 1); n.parent = tk.v; continue; }
      if (tk.k === 'word' && n.kind == null && n.label == null) { tk.k = 'kind'; n.kind = tk.v; continue; }
      if (tk.k === 'word') return { type: 'error', col: tk.s + 1, msg: `Unexpected word “${tk.v}”`, fix: n.kind ? `Put the label in quotes: "${tk.v}"` : 'Write the kind before the label' };
      if (tk.k === 'str') { if (n.label != null) return { type: 'error', col: tk.s + 1, msg: 'A shape has one label', fix: 'Join the two quoted texts' }; n.label = tk.v; continue; }
      if (tk.k === 'tag') { n.tags.push(tk.v); continue; }
      if (tk.k === 'brace') { Object.assign(n.attrs, tk.v); continue; }
      if (tk.k === 'pos') { n.pos = tk.v; continue; }
      if (tk.k === 'size') { n.size = tk.v; continue; }
      if (tk.k === 'open') { n.open = true; continue; }
      if (tk.k === 'comment') continue;
      return { type: 'error', col: tk.s + 1, msg: tk.k === 'eqid' ? 'Only connectors take an =id' : 'Unexpected text on a shape line', fix: tk.k === 'eqid' ? `A shape's id is the name before the colon (${m[2]}:)` : 'Check the shape syntax: id: kind "Label"' };
    }
    return n;
  }
  // a connector line: groups of ids joined by operators, then label, tags, {data}, =id
  let rest = raw, at = 0; const groups = [], ops = [];
  for (;;) {
    const h = HEAD_RE.exec(rest);
    if (!h) break;
    groups.push(h[1]); ops.push(h[2]); at += h[0].length; rest = raw.slice(at);
  }
  if (!ops.length) {
    const w = raw.match(/^\s*([A-Za-z_][\w-]*)\s+([a-z-]+)\b/);
    if (w && SHAPES.includes(w[2])) return { type: 'error', col: w[0].indexOf(w[2]) + 1, msg: 'A shape line needs a colon after the id', fix: `Write ${w[1]}: ${w[2]}` };
    return { type: 'error', col: 1, msg: 'This line is not a shape or a connector', fix: 'A shape is id: kind "Label"; a connector is a -> b' };
  }
  const last = LAST_RE.exec(rest);
  if (!last) return { type: 'error', col: at + 1, msg: `Nothing after “${ops.at(-1)}”`, fix: `Name the target shape: ${ops.at(-1)} id` };
  groups.push(last[1]); const headEnd = at + last[0].length;
  const lx = lex(raw, headEnd);
  if (lx.error) return { type: 'error', ...lx.error };
  const gs = groups.map((g) => g.split(/\s*,\s*/).map(endpoint));
  if (gs.some((g) => g.some((x) => !x))) return { type: 'error', col: 1, msg: 'A connector end is not a shape id', fix: 'Ids are letters, digits, - and _' };
  const e = { type: 'edges', groups: gs, ops, headEnd, toks: lx.toks, label: '', tags: [], attrs: {}, id: null };
  for (const tk of lx.toks) {
    if (tk.k === 'str') e.label = tk.v;
    else if (tk.k === 'tag') e.tags.push(tk.v);
    else if (tk.k === 'brace') Object.assign(e.attrs, tk.v);
    else if (tk.k === 'eqid') e.id = tk.v;
    else if (tk.k !== 'comment') return { type: 'error', col: tk.s + 1, msg: tk.k === 'word' ? `Unexpected word “${tk.v}”` : 'Unexpected text on a connector line', fix: 'A connector label goes in double quotes: a -> b "label"' };
  }
  return e;
}

/** one line of the view section → a statement */
function parseViewLine(raw, codeIds) {
  const t = raw.trim();
  if (!t) return { type: 'blank' };
  if (t.startsWith('//') || t.startsWith('%%')) return { type: 'comment' };
  let m;
  if ((m = raw.match(/^\s*#([\w-]+)\s*(\{[^}]*\})\s*(\/\/.*)?$/))) return { type: 'rule', match: '#' + m[1], style: parseAttrs(m[2].slice(1, -1)) };
  if ((m = raw.match(/^\s*layer\s+([\w-]+)((?:\s+(?:hidden|locked))*)\s*(\/\/.*)?$/))) return { type: 'layer', name: m[1], hidden: /hidden/.test(m[2]), locked: /locked/.test(m[2]) };
  if ((m = raw.match(/^\s*layout\s+([a-z][\w-]*)(?:\s+([\w.+-]+))?(?:\s+(LR|RL|TB|BT))?\s*(\/\/.*)?$/)) && !codeIds.has('layout')) return { type: 'layout', engine: m[1], version: m[2] || null, dir: m[3] || null };
  if (!(m = raw.match(/^(\s*)([A-Za-z_][\w-]*)(?=\s|$)/))) return { type: 'unknown', msg: 'Not a view line', fix: 'A view line starts with a shape or connector id' };
  const lx = lex(raw, m[0].length);
  if (lx.error) return { type: 'unknown', msg: lx.error.msg, fix: lx.error.fix };
  const v = { type: 'view', id: m[2], toks: lx.toks, pos: null, size: null, style: {}, locked: false, fromPort: null, toPort: null, via: null };
  for (const tk of lx.toks) {
    if (tk.k === 'pos') v.pos = tk.v;
    else if (tk.k === 'size') v.size = tk.v;
    else if (tk.k === 'brace') Object.assign(v.style, tk.v);
    else if (tk.k === 'word' && tk.v === 'locked') { tk.k = 'locked'; v.locked = true; }
    else if (tk.k === 'fromPort') v.fromPort = tk.v;
    else if (tk.k === 'toPort') v.toPort = tk.v;
    else if (tk.k === 'via') v.via = tk.v;
    else if (tk.k !== 'comment') return { type: 'unknown', msg: `Unexpected “${raw.slice(tk.s, tk.e)}”`, fix: 'A view line is: id @x,y WxH {style} locked' };
  }
  return v;
}

/* ---------- front matter ---------- */
function scalar(v) { const s = v.trim().replace(/^["']|["']$/g, ''); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s; }
function parseFrontMatter(lines) {
  if (lines[0]?.t !== '---') return { end: -1, settings: {}, warnings: [], found: false };
  let end = -1; for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i].t)) { end = i; break; }
  if (end < 0) return { end: -1, settings: {}, warnings: [], found: false };
  const settings = {}, warnings = []; let found = false;
  for (let i = 1; i < end; i++) {
    const m = lines[i].t.match(/^board\s*:\s*(.*)$/);
    if (!m) continue;
    found = true;
    const put = (k, v, line) => { settings[k] = scalar(v); if (!SETTING_KEYS.includes(k)) warnings.push({ line: line + 1, msg: `Unknown board setting “${k}”, kept as it is` }); };
    const inline = m[1].trim();
    if (inline.startsWith('{')) {
      const body = inline.replace(/^\{|\}\s*$/g, '');
      for (const part of body.split(',')) { const [k, ...v] = part.split(':'); if (k.trim()) put(k.trim(), v.join(':'), i); }
    } else if (!inline) {
      for (let j = i + 1; j < end && /^\s+\S/.test(lines[j].t); j++) { const mm = lines[j].t.match(/^\s+([\w-]+)\s*:\s*(.*)$/); if (mm) put(mm[1], mm[2], j); }
    }
  }
  return { end, settings, warnings, found };
}

/* ---------- the document ---------- */
/**
 * Parse a whole .board.md text. Never throws; problems go to errors (code lines) and warnings (everything else).
 * The returned doc is immutable input for boardModel() and writeBoardDoc().
 */
export function parseBoardDoc(text) {
  const lines = splitLines(text);
  const eol = lines.find((l) => l.e)?.e || '\n';
  const fm = parseFrontMatter(lines);
  const warnings = [...fm.warnings], errors = [];
  const settings = { ...fm.settings };
  const version = settings.version == null ? FORMAT_VERSION : Number(settings.version);
  const readOnly = !(version <= FORMAT_VERSION);
  if (readOnly) warnings.push({ line: 1, msg: `This board was written by a newer Folio (format version ${settings.version}); it opens read-only`, kind: 'version' });
  // the code block
  let bo = -1, bc = -1;
  for (let i = fm.end + 1; i < lines.length; i++) if (/^```board(\s.*)?$/.test(lines[i].t)) { bo = i; break; }
  if (bo >= 0) { for (let i = bo + 1; i < lines.length; i++) if (/^```[ \t]*$/.test(lines[i].t)) { bc = i; break; } }
  if (bo >= 0 && bc < 0) { warnings.push({ line: bo + 1, msg: 'The board block has no closing ```; Folio will not write it', kind: 'block' }); }
  const hasBlock = bo >= 0 && bc > bo;
  // the view section: the first <!-- board-view comment after the block
  let vo = -1, vc = -1, viewTruncated = false;
  if (hasBlock) {
    for (let i = bc + 1; i < lines.length; i++) {
      if (/^```board(\s.*)?$/.test(lines[i].t)) break;
      if (/^\s*<!--\s*board-view\b/.test(lines[i].t)) { vo = i; break; }
    }
    if (vo >= 0) {
      if (/-->\s*$/.test(lines[vo].t)) vc = vo;
      else { for (let i = vo + 1; i < lines.length; i++) if (lines[i].t.trim() === '-->') { vc = i; break; } }
      if (vc < 0) { viewTruncated = true; vc = lines.length; warnings.push({ line: vo + 1, msg: 'The board-view section has no closing -->; shapes it cannot place use auto layout', kind: 'view' }); }
    }
  }
  const doc = { text, lines, eol, fmEnd: fm.end, settings, version, readOnly, hasBlock, bo, bc, vo, vc, viewTruncated, errors, warnings, codeItems: [], viewItems: [], notes: [] };
  const nodes = new Map(), edges = new Map(), order = [];
  const edgeIds = new Set();
  let edgeSeq = 0, inlineGeometry = false;
  // code
  if (hasBlock) {
    for (let i = bo + 1; i < bc; i++) {
      const st = parseCodeLine(lines[i].t);
      if (st.type === 'node') {
        const item = { type: 'node', start: i, end: i, st, id: st.id };
        if (st.open) { let j = i + 1; while (j < bc && lines[j].t.trim() !== ']') j++; item.end = Math.min(j, bc - 1); item.body = lines.slice(i + 1, j).map((l) => l.t.replace(/^\s{2}/, '')); item.closed = j < bc; i = item.end; }
        if (nodes.has(st.id) && !nodes.get(st.id).implicit) { errors.push({ line: item.start + 1, col: 1, msg: `The id “${st.id}” is used twice; this line is ignored`, fix: 'Give one of the shapes another id' }); doc.codeItems.push({ type: 'other', start: item.start, end: item.end }); continue; }
        const { style, data } = splitStyle(st.attrs, NODE_STYLE_KEYS);
        const shape = st.kind == null ? 'rect' : SHAPES.includes(st.kind) ? st.kind : 'rect';
        if (st.kind != null && !SHAPES.includes(st.kind)) { const near = nearest(st.kind, SHAPES); errors.push({ line: i + 1, col: (st.toks.find((t) => t.k === 'kind')?.s ?? 0) + 1, msg: `Unknown kind “${st.kind}”, drawn as a rectangle`, fix: near.length ? `Did you mean ${near.join(', ')}?` : 'list_shape_kinds shows every kind', soft: true }); }
        const [dw, dh] = defaultSize(shape);
        if (st.pos || st.size || Object.keys(style).length) inlineGeometry = true;
        const n = { id: st.id, kind: st.kind, shape, label: st.label ?? st.id, parent: st.parent, tags: st.tags, data, body: item.body || [], x: st.pos ? st.pos[0] : null, y: st.pos ? st.pos[1] : null, w: st.size ? st.size[0] : dw, h: st.size ? st.size[1] : dh, sized: !!st.size, auto: !st.pos, style, locked: false, codeStyle: { ...style }, codePos: st.pos, codeSize: st.size, src: { code: [item.start + 1, item.end + 1], view: null } };
        fitAuto(n);
        nodes.set(n.id, n); order.push(n.id);
        doc.codeItems.push(item);
      } else if (st.type === 'edges') {
        const keys = [];
        const many = st.groups.reduce((a, g, k) => a + (k ? g.length * st.groups[k - 1].length : 0), 0) > 1;
        if (st.id && many) errors.push({ line: i + 1, col: (st.toks.find((t) => t.k === 'eqid')?.s ?? 0) + 1, msg: 'An =id names one connector; this line draws several', fix: 'Write that connector on its own line', soft: true });
        if (st.id && edgeIds.has(st.id)) errors.push({ line: i + 1, col: 1, msg: `The connector id “${st.id}” is used twice`, fix: 'Give one of them another =id', soft: true });
        const { style, data, type } = splitStyle(st.attrs, EDGE_STYLE_KEYS, EDGE_TYPE_KEYS);
        if (Object.keys(style).length) inlineGeometry = true;
        for (let k = 1; k < st.groups.length; k++) for (const a of st.groups[k - 1]) for (const b of st.groups[k]) {
          const id = st.id && !many && !edgeIds.has(st.id) ? st.id : null;
          if (id) edgeIds.add(id);
          const key = id || `#${++edgeSeq}`;
          const kind = ARROWS[st.ops[k - 1]];
          const e = { key, id, from: a.id, fromPort: a.port, to: b.id, toPort: b.port, op: st.ops[k - 1], label: st.label, tags: [...st.tags], data: { ...data }, line: type.line || kind.line, start: type.start ? (type.start === 'none' ? null : type.start) : kind.start || null, end: type.end ? (type.end === 'none' ? null : type.end) : kind.end || null, style: { ...style }, codeStyle: { ...style }, codeFromPort: a.port, codeToPort: b.port, via: null, src: { code: [i + 1, i + 1], view: null } };
          edges.set(key, e); keys.push(key);
        }
        doc.codeItems.push({ type: 'edges', start: i, end: i, st, keys, many });
      } else if (st.type === 'error') {
        errors.push({ line: i + 1, col: st.col, msg: st.msg, fix: st.fix });
        doc.codeItems.push({ type: 'other', start: i, end: i, error: true });
      } else doc.codeItems.push({ type: 'other', start: i, end: i });
    }
  }
  // shapes named only by connectors
  for (const e of edges.values()) for (const id of [e.from, e.to]) if (!nodes.has(id)) {
    const n = { id, kind: null, shape: 'rect', label: id, parent: null, tags: [], data: {}, body: [], x: null, y: null, w: 120, h: 60, sized: false, auto: true, style: {}, locked: false, codeStyle: {}, codePos: null, codeSize: null, implicit: true, src: { code: null, view: null } };
    nodes.set(id, n); order.push(id);
  }
  for (const n of nodes.values()) if (n.parent && !nodes.has(n.parent)) warnings.push({ line: n.src.code?.[0] ?? 1, msg: `${n.id} is in “${n.parent}”, which is not a shape`, kind: 'parent' });
  // view
  const rules = [], layers = {}; let layout = null; const viewOrder = [];
  if (vo >= 0) {
    const codeIds = new Set([...nodes.keys(), ...edgeIds]);
    const edgeById = new Map([...edges.values()].filter((e) => e.id).map((e) => [e.id, e]));
    const atEof = lines.at(-1).t === '' && lines.at(-1).e === '' ? 1 : 0; // the empty "line" after a final newline
    const first = vo, last = viewTruncated ? lines.length - 1 - atEof : vc - 1;
    for (let i = first + 1; i <= last; i++) {
      const st = parseViewLine(lines[i].t, codeIds);
      const item = { type: st.type, start: i, end: i, st };
      if (st.type === 'view') {
        const n = nodes.get(st.id), e = n ? null : edgeById.get(st.id);
        if (n && !n.src.view) {
          if (st.pos) { n.x = st.pos[0]; n.y = st.pos[1]; n.auto = false; }
          if (st.size) { n.w = st.size[0]; n.h = st.size[1]; n.sized = true; }
          n.style = { ...n.codeStyle, ...st.style }; n.locked = st.locked; n.src.view = [i + 1, i + 1];
          item.ref = { node: st.id }; viewOrder.push(st.id);
        } else if (e && !e.src.view) {
          e.style = { ...e.codeStyle, ...st.style }; if (st.fromPort) e.fromPort = st.fromPort; if (st.toPort) e.toPort = st.toPort; if (st.via) e.via = st.via; e.src.view = [i + 1, i + 1];
          item.ref = { edge: e.key };
        } else { item.type = 'orphan'; warnings.push({ line: i + 1, msg: n || e ? `A second view line for “${st.id}” is ignored` : `View line for “${st.id}”, which is not in the code; kept, not drawn`, kind: 'orphan', id: st.id }); }
      } else if (st.type === 'rule') rules.push({ match: st.match, style: st.style });
      else if (st.type === 'layer') layers[st.name] = { hidden: st.hidden, locked: st.locked };
      else if (st.type === 'layout') layout = { engine: st.engine, version: st.version, dir: st.dir };
      else if (st.type === 'unknown') warnings.push({ line: i + 1, msg: `${st.msg}; kept as it is`, fix: st.fix, kind: 'view' });
      doc.viewItems.push(item);
    }
  }
  // notes: "## Notes" list items under the block, anchored by [ids]
  const tailFrom = vo >= 0 ? Math.min(vc + 1, lines.length) : hasBlock ? bc + 1 : fm.end + 1;
  for (let i = tailFrom, on = false; i < lines.length; i++) {
    const h = lines[i].t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { on = h[1].length === 2 && /^notes\s*$/i.test(h[2].trim()); continue; }
    const m = on && lines[i].t.match(/^\s*[-*]\s+(?:\[([^\]]+)\]\s*)?(.*?)(?:\s+\((open|decision|done|task|question)\))?\s*$/i);
    if (m && m[2]) doc.notes.push({ on: m[1] ? m[1].split(/\s*,\s*/) : [], text: m[2], kind: m[3]?.toLowerCase() || 'note', line: i + 1 });
  }
  // z-order: shapes without a view line first (code order), then view lines in their order
  const zOrder = [...order.filter((id) => !nodes.get(id).src.view), ...viewOrder];
  doc.mode = vo >= 0 ? 'split' : inlineGeometry ? 'inline' : 'split';
  doc.nodes = nodes; doc.edges = edges; doc.zOrder = zOrder; doc.rules = rules; doc.layers = layers; doc.layout = layout;
  doc.title = settings.title || (lines.slice(fm.end + 1, hasBlock ? bo : lines.length).find((l) => /^#\s+\S/.test(l.t))?.t.replace(/^#\s+/, '').trim()) || '';
  doc.description = settings.description || '';
  return doc;
}

/** the editable graph: plain objects every surface reads and changes */
export function boardModel(doc) {
  return {
    mode: doc.mode, readOnly: doc.readOnly, settings: { ...doc.settings }, title: doc.title, description: doc.description,
    nodes: doc.zOrder.map((id) => clone(doc.nodes.get(id))),
    edges: [...doc.edges.values()].map(clone),
    rules: clone(doc.rules), layers: clone(doc.layers), layout: clone(doc.layout), notes: clone(doc.notes),
    errors: doc.errors, warnings: doc.warnings, zTouched: [],
  };
}
/** parse and model in one step */
export function loadBoard(text) { const doc = parseBoardDoc(text); return { doc, model: boardModel(doc) }; }

/* ---------- the writer ---------- */
// What each element looks like in the code and in the view, for a given mode. The writer compares these between the
// document as parsed and the model; an element whose fields are equal keeps its lines byte for byte.
const effLabel = (n) => n.label ?? n.id;
const pinned = (n) => !(n.auto || n.x == null || n.y == null);
function nodeCodeFields(n, mode) {
  const f = { kind: n.shape, label: effLabel(n), parent: n.parent || null, tags: n.tags || [], data: n.data || {}, body: n.body || [] };
  if (mode === 'inline') { f.pos = pinned(n) ? [num(n.x), num(n.y)] : null; f.size = n.sized ? [num(n.w), num(n.h)] : null; f.style = n.style || {}; }
  else {
    // split: looks stay where the code already had them (an old line read as style); nothing new is added to the code
    f.pos = pinned(n) && n.codePos ? n.codePos : null;
    f.size = n.sized && n.codeSize ? n.codeSize : null;
    f.style = Object.fromEntries(Object.entries(n.codeStyle || {}).filter(([k]) => n.style && k in n.style));
  }
  return f;
}
function nodeViewFields(n) {
  const code = nodeCodeFields(n, 'split');
  const style = {}; for (const [k, v] of Object.entries(n.style || {})) if (code.style[k] !== v) style[k] = v;
  const pos = pinned(n) ? [num(n.x), num(n.y)] : null, size = n.sized ? [num(n.w), num(n.h)] : null;
  return { pos: pos && !(code.pos && sameArr(pos, code.pos)) ? pos : null, size: size && !(code.size && sameArr(size, code.size)) ? size : null, style, locked: !!n.locked };
}
const viewEmpty = (v) => !v.pos && !v.size && !Object.keys(v.style).length && !v.locked && !v.fromPort && !v.toPort && !v.via;
function edgeOp(e, o) {
  const fits = (op) => { const k = ARROWS[op]; return !!k && k.line === e.line && (k.start || null) === (e.start || null) && (k.end || null) === (e.end || null); };
  if (o && fits(o.op)) return { op: o.op, type: {} };
  if (fits(e.op)) return { op: e.op, type: {} };
  const op = OPS.find(fits);
  if (op) return { op, type: {} };
  const base = ARROWS[e.op] ? e.op : '--', k = ARROWS[base], type = {};
  if (k.line !== e.line) type.line = e.line;
  if ((k.start || null) !== (e.start || null)) type.start = e.start || 'none';
  if ((k.end || null) !== (e.end || null)) type.end = e.end || 'none';
  return { op: base, type };
}
// Where a connector's ports live: the code keeps the ports it was written with; a port set on the canvas of a split
// board goes to the view.
function edgePorts(e, o, mode) {
  if (mode === 'inline') return { cf: e.fromPort || null, ct: e.toPort || null, vf: null, vt: null };
  const side = (cur, code) => { const c = code && cur ? code : null; return { c, v: cur && cur !== c ? cur : null }; };
  const f = side(e.fromPort || null, o?.codeFromPort || null), t = side(e.toPort || null, o?.codeToPort || null);
  return { cf: f.c, ct: t.c, vf: f.v, vt: t.v };
}
function edgeCodeFields(e, mode, o) {
  const { op, type } = edgeOp(e, o);
  const p = edgePorts(e, o, mode);
  const style = mode === 'inline' ? e.style || {} : Object.fromEntries(Object.entries(e.codeStyle || {}).filter(([k]) => e.style && k in e.style));
  return { from: e.from, fromPort: p.cf, to: e.to, toPort: p.ct, op, label: e.label || '', tags: e.tags || [], id: e.id || null, attrs: { ...(e.data || {}), ...type, ...style } };
}
function edgeViewFields(e, o) {
  const code = edgeCodeFields(e, 'split', o), p = edgePorts(e, o, 'split');
  const style = {}; for (const [k, v] of Object.entries(e.style || {})) if (code.attrs[k] !== v) style[k] = v;
  return { pos: null, size: null, style, locked: false, fromPort: p.vf, toPort: p.vt, via: e.via?.length ? e.via.map(([x, y]) => [num(x), num(y)]) : null };
}

// Rewrite one line from its tokens: unchanged tokens keep their text and the spaces before them, removed tokens go,
// new tokens are placed after the last kept token of a lower rank. A trailing // comment stays.
function rebuild(raw, prefixEnd, toks, want, rank) {
  const keyOf = (t) => (t.k === 'tag' ? 'tag:' + t.v : t.k);
  const wanted = new Map(want.map((w) => [w.key || w.k, w]));
  let pos = prefixEnd; const kept = [];
  const comment = toks.find((t) => t.k === 'comment');
  for (const t of toks) {
    if (t.k === 'comment') continue;
    const w = wanted.get(keyOf(t)), gap = raw.slice(pos, t.s);
    pos = t.e;
    if (!w) continue;
    wanted.delete(keyOf(t));
    kept.push({ gap: gap || ' ', text: w.same ? raw.slice(t.s, t.e) : w.text, rank: rank(w) });
  }
  for (const w of wanted.values()) {
    const r = rank(w); let at = kept.length;
    for (let i = 0; i < kept.length; i++) if (kept[i].rank > r) { at = i; break; }
    kept.splice(at, 0, { gap: ' ', text: w.text, rank: r });
  }
  let out = raw.slice(0, prefixEnd) + kept.map((k) => k.gap + k.text).join('');
  if (comment) out += (raw.slice(pos, comment.s) || ' ') + raw.slice(comment.s);
  return out;
}
const NODE_RANK = { kind: 0, str: 1, in: 2, tag: 3, pos: 4, size: 5, brace: 6, open: 7 };
const filled = (o) => Object.values(o || {}).some((v) => v !== undefined && v !== null && v !== '' && v !== false);
function nodeLine(id, st, raw, f, of) {
  const has = (k) => !!st?.toks.some((t) => t.k === k);
  const want = [];
  if (!st || has('kind') || f.kind !== 'rect') want.push({ k: 'kind', text: f.kind, same: of && f.kind === of.kind });
  if (f.label !== id || has('str')) want.push({ k: 'str', text: quote(f.label), same: of && f.label === of.label });
  if (f.parent) want.push({ k: 'in', text: `in ${f.parent}`, same: of && f.parent === of.parent });
  for (const tg of f.tags) want.push({ k: 'tag', key: 'tag:' + tg, text: '#' + tg, same: true });
  if (f.pos) want.push({ k: 'pos', text: `@${f.pos[0]},${f.pos[1]}`, same: of && sameArr(f.pos, of.pos) });
  if (f.size) want.push({ k: 'size', text: `${f.size[0]}x${f.size[1]}`, same: of && sameArr(f.size, of.size) });
  const attrs = { ...f.data, ...f.style };
  if (filled(attrs)) want.push({ k: 'brace', text: attrsText(attrs), same: of && sameObj(attrs, { ...of.data, ...of.style }) });
  if (f.body.length) want.push({ k: 'open', text: '[', same: true });
  if (!st) return `${id}:${want.map((w) => ' ' + w.text).join('')}`;
  return rebuild(raw, raw.match(NODE_HEAD)[0].length, st.toks, want, (w) => NODE_RANK[w.k]);
}
const EDGE_RANK = { str: 1, tag: 2, brace: 3, eqid: 4 };
const edgeHead = (f) => `${f.from}${f.fromPort ? '.' + f.fromPort : ''} ${f.op} ${f.to}${f.toPort ? '.' + f.toPort : ''}`;
function edgeLine(st, raw, f, of) {
  const want = [];
  if (f.label) want.push({ k: 'str', text: quote(f.label), same: of && f.label === of.label });
  for (const tg of f.tags) want.push({ k: 'tag', key: 'tag:' + tg, text: '#' + tg, same: true });
  if (filled(f.attrs)) want.push({ k: 'brace', text: attrsText(f.attrs), same: of && sameObj(f.attrs, of.attrs) });
  if (f.id) want.push({ k: 'eqid', text: '=' + f.id, same: of && f.id === of.id });
  if (!st) return edgeHead(f) + want.map((w) => ' ' + w.text).join('');
  const headSame = of && f.from === of.from && f.to === of.to && f.op === of.op && f.fromPort === of.fromPort && f.toPort === of.toPort;
  if (headSame) return rebuild(raw, st.headEnd, st.toks, want, (w) => EDGE_RANK[w.k]);
  const head = raw.match(/^\s*/)[0] + edgeHead(f), d = head.length - st.headEnd;
  return rebuild(head + raw.slice(st.headEnd), head.length, st.toks.map((t) => ({ ...t, s: t.s + d, e: t.e + d })), want, (w) => EDGE_RANK[w.k]);
}
const VIEW_RANK = { pos: 0, size: 1, brace: 2, fromPort: 3, toPort: 4, via: 5, locked: 6 };
function viewLine(id, st, raw, v, ov) {
  const want = [];
  if (v.pos) want.push({ k: 'pos', text: `@${v.pos[0]},${v.pos[1]}`, same: ov && sameArr(v.pos, ov.pos) });
  if (v.size) want.push({ k: 'size', text: `${v.size[0]}x${v.size[1]}`, same: ov && sameArr(v.size, ov.size) });
  if (Object.keys(v.style).length) want.push({ k: 'brace', text: attrsText(v.style), same: ov && sameObj(v.style, ov.style) });
  if (v.fromPort) want.push({ k: 'fromPort', text: `from=${v.fromPort}`, same: ov && v.fromPort === ov.fromPort });
  if (v.toPort) want.push({ k: 'toPort', text: `to=${v.toPort}`, same: ov && v.toPort === ov.toPort });
  if (v.via) want.push({ k: 'via', text: `via ${v.via.map((p) => p.join(',')).join(' ')}`, same: ov && sameArr(v.via, ov.via) });
  if (v.locked) want.push({ k: 'locked', text: 'locked', same: true });
  if (!st) return [id, ...want.map((w) => w.text)].join(' ');
  return rebuild(raw, raw.match(/^(\s*)([A-Za-z_][\w-]*)/)[0].length, st.toks, want, (w) => VIEW_RANK[w.k]);
}

export class BoardWriteError extends Error {}
const J = (v) => JSON.stringify(v);

/**
 * Write a model back over the document it came from. Only elements whose model differs from the document are
 * rewritten; every other byte (comments, blank lines, spacing, line endings, unreadable lines, the text around the
 * block) is copied. Returns the new text, === doc.text when nothing changed.
 */
export function writeBoardDoc(doc, model) {
  if (doc.readOnly) throw new BoardWriteError('This board was written by a newer version of Folio and is read-only.');
  if (!doc.hasBlock && doc.bo >= 0) throw new BoardWriteError('The board block has no closing ```; fix it in the code view first.');
  const mode = model.mode || doc.mode, converting = mode !== doc.mode;
  const L = doc.lines, eol = doc.eol, T = (t) => ({ t, e: eol });
  const zt = new Set(model.zTouched || []);
  const nodesIn = model.nodes, edgesIn = model.edges.map((e) => ({ ...e }));
  const mnodes = new Map(nodesIn.map((n) => [n.id, n])), medges = new Map(edgesIn.map((e) => [e.key, e]));
  const used = new Set([...mnodes.keys(), ...edgesIn.map((e) => e.id).filter(Boolean)]);
  const freshId = () => { let i = 1; while (used.has('e' + i)) i++; used.add('e' + i); return 'e' + i; };
  // a connector that needs a view line needs an id: styling one adds `=id` to its line and changes no other line
  const eview = new Map();
  if (mode === 'split') for (const e of edgesIn) {
    const o = doc.edges.get(e.key), v = edgeViewFields(e, o);
    if (!viewEmpty(v)) { if (!e.id) e.id = freshId(); eview.set(e.key, v); }
  }
  /* --- code block --- */
  const code = []; // entries { lines, node?, edges? }
  const keep = (it) => L.slice(it.start, it.end + 1);
  for (const it of doc.codeItems) {
    if (it.type === 'node') {
      const o = doc.nodes.get(it.id), n = mnodes.get(it.id);
      if (!n) continue;
      const f = nodeCodeFields(n, mode), of = nodeCodeFields(o, doc.mode);
      if (J(f) === J(of)) { code.push({ lines: keep(it), node: n.id }); continue; }
      const out = [{ t: nodeLine(n.id, it.st, L[it.start].t, f, of), e: L[it.start].e || eol }];
      if (f.body.length) {
        if (sameArr(f.body, of.body) && it.st.open) out.push(...L.slice(it.start + 1, it.end + 1));
        else { out[0].e = eol; out.push(...f.body.map((b) => T('  ' + b)), { t: ']', e: it.st.open ? L[it.end].e || eol : L[it.start].e || eol }); }
      }
      code.push({ lines: out, node: n.id });
    } else if (it.type === 'edges') {
      const pairs = it.keys.map((k) => { const o = doc.edges.get(k), e = medges.get(k); return e ? [edgeCodeFields(e, mode, o), edgeCodeFields(o, doc.mode, o)] : null; });
      if (pairs.every((p) => p && J(p[0]) === J(p[1]))) { code.push({ lines: keep(it), edges: it.keys }); continue; }
      const raw = L[it.start].t, end = L[it.start].e || eol;
      if (!it.many) { if (pairs[0]) code.push({ lines: [{ t: edgeLine(it.st, raw, pairs[0][0], pairs[0][1]), e: end }], edges: it.keys }); continue; }
      // a line that draws several connectors: a fan-out keeps its unchanged targets together, changed ones get a line each
      const indent = raw.match(/^\s*/)[0], st = it.st;
      const same = [], changed = [];
      pairs.forEach((p, i) => { if (p) (J(p[0]) === J(p[1]) ? same : changed).push(i); });
      const out = [];
      if (st.groups.length === 2 && st.groups[0].length === 1 && same.length) {
        const s = st.groups[0][0], ends = same.map((i) => st.groups[1][i]);
        out.push({ t: `${indent}${s.id}${s.port ? '.' + s.port : ''} ${st.ops[0]} ${ends.map((x) => x.id + (x.port ? '.' + x.port : '')).join(', ')}${raw.slice(st.headEnd).replace(/^(?=\S)/, ' ')}`, e: eol });
      } else for (const i of same) out.push(T(indent + edgeLine(null, '', pairs[i][0])));
      for (const i of changed) out.push(T(indent + edgeLine(null, '', pairs[i][0])));
      if (out.length) out.at(-1).e = end;
      code.push({ lines: out, edges: it.keys });
    } else code.push({ lines: keep(it) });
  }
  // z-order of an inline board is the order of its shape lines
  if (mode === 'inline' && !converting) reorder(code, nodesIn.map((n) => n.id), (x) => x.node, zt);
  const needsLine = (n) => { const f = nodeCodeFields(n, mode); return !doc.nodes.has(n.id) || f.kind !== 'rect' || f.label !== n.id || !!f.parent || f.tags.length > 0 || filled(f.data) || f.body.length > 0 || filled(f.style) || !!f.pos || !!f.size; };
  const addN = nodesIn.filter((n) => !doc.nodes.get(n.id)?.src.code && needsLine(n));
  if (addN.length) {
    const fresh = addN.map((n) => { const f = nodeCodeFields(n, mode); const lines = [T(nodeLine(n.id, null, '', f))]; if (f.body.length) lines.push(...f.body.map((b) => T('  ' + b)), T(']')); return { lines, node: n.id }; });
    let at = findLast(code, (x) => x.node) + 1;
    if (!at) { const fe = code.findIndex((x) => x.edges); at = fe >= 0 ? fe : contentEnd(code); }
    code.splice(at, 0, ...fresh);
  }
  const addE = edgesIn.filter((e) => !doc.edges.has(e.key));
  if (addE.length) {
    const fresh = addE.map((e) => ({ lines: [T(edgeLine(null, '', edgeCodeFields(e, mode, null)))], edges: [e.key] }));
    let at = findLast(code, (x) => x.edges) + 1;
    if (!at) { at = contentEnd(code); if (code.slice(0, at).some((x) => x.node)) fresh.unshift({ lines: [T('')] }); } // a blank line between shapes and connectors
    code.splice(at, 0, ...fresh);
  }
  /* --- view section --- */
  let view = null;
  if (mode === 'split') {
    view = [];
    for (const it of doc.viewItems) {
      if (it.ref?.node) {
        const o = doc.nodes.get(it.ref.node), n = mnodes.get(it.ref.node);
        if (!n) continue;
        const v = nodeViewFields(n), ov = nodeViewFields(o);
        if (J(v) === J(ov)) { view.push({ lines: [L[it.start]], node: n.id }); continue; }
        if (viewEmpty(v) && !zt.has(n.id)) continue; // back to auto with nothing to keep: the line goes
        view.push({ lines: [{ t: viewLine(n.id, it.st, L[it.start].t, v, ov), e: L[it.start].e || eol }], node: n.id });
      } else if (it.ref?.edge) {
        const o = doc.edges.get(it.ref.edge), e = medges.get(it.ref.edge);
        if (!e) continue;
        const v = eview.get(e.key) || edgeViewFields(e, o), ov = edgeViewFields(o, o);
        if (J(v) === J(ov)) { view.push({ lines: [L[it.start]], edge: e.key }); continue; }
        if (viewEmpty(v)) continue;
        view.push({ lines: [{ t: viewLine(e.id, it.st, L[it.start].t, v, ov), e: L[it.start].e || eol }], edge: e.key });
      } else if (it.type === 'layout') view.push({ lines: [L[it.start]], layout: true });
      else view.push({ lines: [L[it.start]] });
    }
    if (!converting) reorder(view, nodesIn.map((n) => n.id), (x) => x.node, zt);
    // new view lines: in id order among the others (two branches that place different shapes merge cleanly); a shape
    // brought to the front or back goes where its z-order says; a converted board keeps the order of its code
    for (const n of nodesIn) {
      if (doc.nodes.get(n.id)?.src.view && !converting) continue;
      const v = nodeViewFields(n);
      if (viewEmpty(v) && !zt.has(n.id)) continue;
      const entry = { lines: [T(viewLine(n.id, null, '', v))], node: n.id };
      let at;
      if (converting) at = findLast(view, (x) => x.node) + 1 || firstSlot(view);
      else if (zt.has(n.id)) {
        const idx = nodesIn.indexOf(n); let prev = -1;
        for (let i = idx - 1; i >= 0 && prev < 0; i--) prev = view.findIndex((x) => x.node === nodesIn[i].id);
        at = prev >= 0 ? prev + 1 : Math.max(view.findIndex((x) => x.node), firstSlot(view));
      } else {
        at = view.findIndex((x) => x.node && byId(x.node, n.id) > 0);
        if (at < 0) at = findLast(view, (x) => x.node) + 1 || firstSlot(view);
      }
      view.splice(at, 0, entry);
    }
    for (const e of edgesIn) {
      if (doc.edges.get(e.key)?.src.view && !converting) continue;
      const v = eview.get(e.key); if (!v) continue;
      const at = findLast(view, (x) => x.edge || x.node) + 1 || view.length;
      view.splice(at, 0, { lines: [T(viewLine(e.id, null, '', v))], edge: e.key });
    }
    // the layout record: engine and version of the last explicit layout
    if (J(model.layout || null) !== J(doc.layout || null)) {
      const line = model.layout ? T(`layout ${model.layout.engine}${model.layout.version ? ' ' + model.layout.version : ''}${model.layout.dir ? ' ' + model.layout.dir : ''}`) : null;
      const at = view.findIndex((x) => x.layout);
      if (at >= 0) { if (line) view[at] = { lines: [{ ...line, e: view[at].lines[0].e || eol }], layout: true }; else view.splice(at, 1); }
      else if (line) view.splice(firstSlot(view), 0, { lines: [line], layout: true });
    }
  }
  /* --- assemble --- */
  const codeLines = code.flatMap((x) => x.lines), viewLines = view ? view.flatMap((x) => x.lines) : [];
  if (!doc.hasBlock) {
    if (!codeLines.length && !viewLines.length) return doc.text;
    const before = doc.text.replace(/(\r?\n)*$/, '');
    const out = [before ? before + eol + eol : '', '```board', eol, ...codeLines.map((l) => l.t + eol), '```', eol];
    if (viewLines.length) out.push('<!-- board-view', eol, ...viewLines.map((l) => l.t + eol), '-->', eol);
    return out.join('');
  }
  const res = [...L.slice(0, doc.bo + 1), ...codeLines];
  if (doc.vo >= 0) {
    res.push(...L.slice(doc.bc, doc.vo + 1), ...viewLines);
    if (doc.viewTruncated) {
      // nothing changed: the file stays as it is; otherwise the section that was never closed is closed
      const kept = [...res, ...L.slice(res.length)];
      if (kept.length === L.length && kept.every((l, i) => l === L[i])) return doc.text;
      res.push({ t: '-->', e: /\n$/.test(doc.text) ? eol : '' });
    }
    else res.push(...L.slice(doc.vc));
  } else if (viewLines.length) {
    const fence = L[doc.bc];
    res.push({ t: fence.t, e: fence.e || eol }, T('<!-- board-view'), ...viewLines, { t: '-->', e: fence.e }, ...L.slice(doc.bc + 1));
  } else res.push(...L.slice(doc.bc));
  // a line in the middle that had no terminator (the last line before new ones) gets one
  for (let i = 0; i < res.length - 1; i++) if (!res[i].e) res[i] = { ...res[i], e: eol };
  return res.map((l) => l.t + l.e).join('');
}
const findLast = (arr, f) => { for (let i = arr.length - 1; i >= 0; i--) if (f(arr[i])) return i; return -1; };
function contentEnd(items) { let i = items.length; while (i > 0 && items[i - 1].lines.every((l) => !l.t.trim())) i--; return i; }
function firstSlot(view) { let i = 0; while (i < view.length && (view[i].layout || view[i].lines.every((l) => /^\s*(\/\/|%%)/.test(l.t)))) i++; return i; }
// Move as few entries as possible so that the entries with an id follow `want`: the longest run of untouched entries
// already in order stays, the others (and every touched entry) move next to their new neighbour.
function reorder(list, want, idOf, touched) {
  const rank = new Map(want.map((id, i) => [id, i]));
  const ents = list.filter((x) => idOf(x) != null && rank.has(idOf(x)));
  const seq = ents.map((x) => rank.get(idOf(x)));
  if (seq.every((r, i) => !i || r > seq[i - 1])) return;
  const cand = ents.map((x, i) => i).filter((i) => !touched.has(idOf(ents[i])));
  const tails = [], tailAt = [], prev = new Array(ents.length).fill(-1);
  for (const i of cand) {
    let lo = 0, hi = tails.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < seq[i]) lo = mid + 1; else hi = mid; }
    tails[lo] = seq[i]; tailAt[lo] = i; prev[i] = lo ? tailAt[lo - 1] : -1;
  }
  const stay = new Set(); for (let i = tails.length ? tailAt[tails.length - 1] : -1; i >= 0; i = prev[i]) stay.add(ents[i]);
  const moving = ents.filter((x) => !stay.has(x)).sort((a, b) => rank.get(idOf(a)) - rank.get(idOf(b)));
  for (const m of moving) list.splice(list.indexOf(m), 1);
  for (const m of moving) {
    const r = rank.get(idOf(m));
    let best = -1, bestR = -1;
    list.forEach((x, i) => { const xr = idOf(x) != null ? rank.get(idOf(x)) : undefined; if (xr != null && xr < r && xr > bestR) { bestR = xr; best = i; } });
    if (best >= 0) list.splice(best + 1, 0, m);
    else { const first = list.findIndex((x) => idOf(x) != null && rank.has(idOf(x))); list.splice(first < 0 ? list.length : first, 0, m); }
  }
}

/* ---------- conversions ---------- */
/** "Separate layout": an inline board becomes code + view. Same picture; positions and styles leave the code lines. */
export function separateLayout(text) {
  const doc = parseBoardDoc(text);
  if (doc.mode !== 'inline' || doc.readOnly) return text;
  const model = boardModel(doc);
  model.mode = 'split';
  for (const n of model.nodes) { n.codeStyle = {}; n.codePos = null; n.codeSize = null; }
  for (const e of model.edges) e.codeStyle = {};
  return writeBoardDoc(doc, model);
}

/* ---------- three-way merge ---------- */
const NODE_FIELDS = ['shape', 'label', 'parent', 'tags', 'data', 'body', 'x', 'y', 'w', 'h', 'sized', 'auto', 'style', 'locked'];
const EDGE_FIELDS = ['from', 'fromPort', 'to', 'toPort', 'op', 'label', 'tags', 'data', 'line', 'start', 'end', 'style', 'via', 'id'];
const eq = (a, b) => J(a ?? null) === J(b ?? null);
const edgeKeys = (list) => { const seen = {}; return new Map(list.map((e) => { const k = e.id ? '=' + e.id : `${e.from} ${e.op} ${e.to}`; seen[k] = (seen[k] || 0) + 1; return [e.id ? k : `${k} #${seen[k]}`, e]; })); };
/**
 * mergeBoards(base, mine, theirs): apply the per-element changes from base → mine onto theirs (the file as it is now on
 * disk). Different elements, or different fields of one element (code and view of the same shape), both apply. The same
 * field changed on both sides: the file wins and the local value comes back in `conflicts`, never silently dropped.
 * Deleted on disk while edited locally: the delete wins and the local edit is reported.
 */
export function mergeBoards(base, mine, theirs) {
  const B = loadBoard(base), M = loadBoard(mine), Th = loadBoard(theirs);
  if (Th.doc.readOnly) return { text: theirs, conflicts: [], applied: 0, readOnly: true };
  const conflicts = []; let applied = 0;
  const out = Th.model;
  const bN = new Map(B.model.nodes.map((n) => [n.id, n])), mN = new Map(M.model.nodes.map((n) => [n.id, n])), tN = new Map(out.nodes.map((n) => [n.id, n]));
  for (const [id, mn] of mN) {
    const bn = bN.get(id), tn = tN.get(id);
    if (!bn) { if (!tn) { out.nodes.push(clone({ ...mn, src: { code: null, view: null } })); applied++; } else if (!NODE_FIELDS.every((f) => eq(mn[f], tn[f]))) conflicts.push({ id, field: 'added-twice', mine: mn, theirs: tn }); continue; }
    if (!tn) { if (!NODE_FIELDS.every((f) => eq(mn[f], bn[f]))) conflicts.push({ id, field: 'deleted', mine: mn, theirs: null }); continue; }
    for (const f of NODE_FIELDS) {
      if (eq(mn[f], bn[f])) continue;
      if (eq(tn[f], bn[f])) { tn[f] = clone(mn[f]); applied++; } else if (!eq(tn[f], mn[f])) conflicts.push({ id, field: f, mine: mn[f], theirs: tn[f] });
    }
  }
  for (const [id, bn] of bN) if (!mN.has(id) && tN.has(id)) {
    const tn = tN.get(id);
    if (NODE_FIELDS.every((f) => eq(tn[f], bn[f]))) { out.nodes = out.nodes.filter((n) => n.id !== id); out.edges = out.edges.filter((e) => e.from !== id && e.to !== id); applied++; }
    else conflicts.push({ id, field: 'deleted-locally', mine: null, theirs: tn });
  }
  const bE = edgeKeys(B.model.edges), mE = edgeKeys(M.model.edges), tE = edgeKeys(out.edges);
  let seq = 0;
  for (const [k, me] of mE) {
    const be = bE.get(k), te = tE.get(k);
    if (!be) { if (!te) { out.edges.push({ ...clone(me), key: `#merge${++seq}`, src: { code: null, view: null } }); applied++; } continue; }
    if (!te) continue;
    for (const f of EDGE_FIELDS) {
      if (eq(me[f], be[f])) continue;
      if (eq(te[f], be[f])) { te[f] = clone(me[f]); applied++; } else if (!eq(te[f], me[f])) conflicts.push({ id: k, field: f, mine: me[f], theirs: te[f] });
    }
  }
  for (const [k, be] of bE) if (!mE.has(k) && tE.has(k)) { const te = tE.get(k); if (EDGE_FIELDS.every((f) => eq(te[f], be[f]))) { out.edges = out.edges.filter((e) => e !== te); applied++; } }
  return { text: writeBoardDoc(Th.doc, out), conflicts, applied };
}
