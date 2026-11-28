// Folio — operations on a board model, addressed by id. The canvas, the code view, MCP (apply_board_ops) and undo all
// speak this one language: applyOps(model, ops) → { model, inverse, created }. A batch is all or nothing: the first
// failing op throws a BoardOpError naming the op, and the model passed in is never touched.
import { SHAPES, ARROWS, CONTAINERS, defaultSize, fitAuto, autoLayout, LAYOUT_ENGINE } from './board-core.js';
import { ID_RE, PORTS, NODE_STYLE_KEYS, EDGE_STYLE_KEYS, nearest } from './board-doc.js';

export const OP_NAMES = ['add', 'update', 'remove', 'connect', 'update_connector', 'disconnect', 'move', 'resize', 'set_parent', 'lock', 'set_data', 'front', 'back', 'unpin', 'layout', 'restore'];
export const LIMITS = { coord: 100000, minW: 8, maxW: 5000, label: 2000, bodyLines: 200, bodyLine: 500, data: 50 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const BAD_ATTR = /[{};\r\n]/;
let NEW_KEYS = 0; // keys of connectors made in this session (keys are never written; ids are)

export class BoardOpError extends Error {
  constructor(message, { index, op, suggestions } = {}) { super(message); this.index = index; this.op = op; this.suggestions = suggestions || []; }
}

/** an id from a label or kind: "Orders API" → orders-api, unique in the model */
export function makeId(model, base) {
  let b = String(base || 'shape').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'shape';
  if (!/^[A-Za-z_]/.test(b)) b = 'n-' + b;
  const taken = new Set([...model.nodes.map((n) => n.id), ...model.edges.map((e) => e.id).filter(Boolean)]);
  if (!taken.has(b)) return b;
  let i = 2; while (taken.has(`${b}-${i}`)) i++;
  return `${b}-${i}`;
}

/**
 * Apply a batch of operations. Returns a new model (the input is not changed), the inverse batch (one `restore` op that
 * puts every touched element back), the ids created, and the elements touched.
 * opts.force lets moves, resizes and removals touch locked shapes.
 */
export function applyOps(model, ops, opts = {}) {
  if (!Array.isArray(ops)) throw new BoardOpError('ops must be a list');
  const m = clone({ ...model, errors: undefined, warnings: undefined });
  m.errors = model.errors; m.warnings = model.warnings;
  m.zTouched = [...(model.zTouched || [])];
  const snapN = new Map(), snapE = new Map(); // first-touch snapshots: id/key → { before, index }
  const touchN = (id) => { if (!snapN.has(id)) { const i = m.nodes.findIndex((n) => n.id === id); snapN.set(id, { before: i < 0 ? null : clone(m.nodes[i]), index: i }); } };
  const touchE = (key) => { if (!snapE.has(key)) { const i = m.edges.findIndex((e) => e.key === key); snapE.set(key, { before: i < 0 ? null : clone(m.edges[i]), index: i }); } };
  const layoutBefore = clone(model.layout || null), zBefore = [...(model.zTouched || [])];
  const created = [];
  ops.forEach((op, index) => {
    const fail = (msg, suggestions) => { throw new BoardOpError(`op ${index + 1} (${op?.op}): ${msg}`, { index, op, suggestions }); };
    if (!op || typeof op !== 'object' || !OP_NAMES.includes(op.op)) fail(`unknown op; use one of ${OP_NAMES.filter((o) => o !== 'restore').join(', ')}`, nearest(op?.op || '', OP_NAMES));
    const nodeOf = (id, what = 'shape') => {
      const n = m.nodes.find((x) => x.id === id);
      if (!n) { const s = nearest(id, m.nodes.map((x) => x.id)); fail(`No ${what} "${id}"${s.length ? `; did you mean ${s.join(', ')}?` : ''}`, s); }
      return n;
    };
    const ids = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
    const edgeOf = (o) => {
      let list;
      if (o.id) list = m.edges.filter((e) => e.id === o.id || e.key === o.id);
      else if (o.from && o.to) list = m.edges.filter((e) => e.from === o.from && e.to === o.to);
      else fail('name the connector by id, or by from and to');
      if (!list.length) {
        const s = o.id ? nearest(o.id, m.edges.map((e) => e.id).filter(Boolean)) : m.edges.filter((e) => e.from === o.from || e.to === o.to).map((e) => `${e.from} -> ${e.to}`).slice(0, 3);
        fail(o.id ? `No connector "${o.id}"${s.length ? `; did you mean ${s.join(', ')}?` : ''}` : `No connector from ${o.from} to ${o.to}${s.length ? `; there is ${s.join(', ')}` : ''}`, s);
      }
      if (o.index != null) { const e = list[o.index]; if (!e) fail(`there are ${list.length} connectors from ${o.from} to ${o.to}; index is 0 to ${list.length - 1}`); return [e]; }
      return list;
    };
    const kindOf = (k) => { if (k == null) return null; if (!SHAPES.includes(k)) { const s = nearest(k, SHAPES); fail(`Unknown kind "${k}"${s.length ? `; did you mean ${s.join(', ')}?` : ''} (list_shape_kinds lists them)`, s); } return k; };
    const label = (s) => { if (s == null) return s; s = String(s); if (/\\|\r/.test(s)) fail('a label cannot contain a backslash or a carriage return'); if (s.length > LIMITS.label) fail(`a label is at most ${LIMITS.label} characters`); return s; };
    const body = (lines) => { if (lines == null) return lines; if (!Array.isArray(lines) || lines.length > LIMITS.bodyLines) fail(`a body is a list of at most ${LIMITS.bodyLines} lines`); for (const l of lines) if (typeof l !== 'string' || l.trim() === ']' || /[\r\n]/.test(l) || l.length > LIMITS.bodyLine) fail(`a body line is text without line breaks, at most ${LIMITS.bodyLine} characters, and not "]"`); return lines; };
    const attrs = (patch, base = {}, what = 'style') => {
      const out = { ...base };
      for (const [k, v] of Object.entries(patch || {})) {
        if (!/^[A-Za-z_][\w-]*$/.test(k) || (typeof v === 'string' && BAD_ATTR.test(v))) fail(`${what} "${k}" has a character that is not allowed ({ } ; or a line break)`);
        if (v === null || v === false || v === '') delete out[k]; else out[k] = typeof v === 'number' ? String(v) : v;
      }
      if (Object.keys(out).length > LIMITS.data) fail(`at most ${LIMITS.data} ${what} keys`);
      return out;
    };
    const coord = (v) => (v == null ? v : (typeof v !== 'number' || !Number.isFinite(v) ? fail('x and y are numbers') : clamp(Math.round(v), -LIMITS.coord, LIMITS.coord)));
    const size = (v) => (v == null ? v : (typeof v !== 'number' || !Number.isFinite(v) ? fail('w and h are numbers') : clamp(Math.round(v), LIMITS.minW, LIMITS.maxW)));
    const tagList = (t) => { if (t == null) return t; const l = (Array.isArray(t) ? t : [t]).map((x) => String(x).replace(/^#/, '')); for (const x of l) if (!/^[\w-]+$/.test(x)) fail(`tag "${x}" may use letters, digits, - and _`); return [...new Set(l)]; };
    const lockedGuard = (n, what) => { if (n.locked && !opts.force) fail(`${n.id} is locked; unlock it first, or pass force: true to ${what} it anyway`); };
    const port = (p) => { if (p == null) return null; if (!PORTS.includes(p)) fail(`a port is one of ${PORTS.join(', ')}`); return p; };
    const parentOk = (id, parent) => {
      if (parent == null) return null;
      const p = nodeOf(parent, 'container');
      for (let q = p; q; q = q.parent ? m.nodes.find((x) => x.id === q.parent) : null) if (q.id === id) fail(`${id} cannot be inside itself`);
      return p.id;
    };
    const style = (n, patch) => {
      const keys = n.from ? EDGE_STYLE_KEYS : NODE_STYLE_KEYS;
      for (const k of Object.keys(patch || {})) if (!keys.has(k)) fail(`"${k}" is not a style key; style keys: ${[...keys].join(', ')}${n.from ? '' : '. Other keys go in data'}`);
      return attrs(patch, n.style, 'style');
    };
    switch (op.op) {
      case 'add': {
        const shape = kindOf(op.kind ?? op.shape) || 'rect';
        if (op.id != null && !ID_RE.test(op.id)) fail('an id starts with a letter or _ and has letters, digits, - and _');
        const exists = op.id != null && m.nodes.find((n) => n.id === op.id);
        if (exists && !exists.implicit) fail(`A shape "${op.id}" already exists; use update`);
        if ((op.x == null) !== (op.y == null)) fail('give x and y together, or neither to let auto layout place the shape');
        const id = op.id ?? makeId(m, op.label || shape);
        touchN(id);
        const [dw, dh] = defaultSize(shape);
        const n = { id, kind: shape, shape, label: label(op.label) ?? id, parent: parentOk(id, op.in ?? op.parent), tags: tagList(op.tags) || [], data: attrs(op.data, {}, 'data'), body: body(op.body) || [],
          x: coord(op.x) ?? null, y: coord(op.y) ?? null, w: size(op.w) ?? dw, h: size(op.h) ?? dh, sized: op.w != null || op.h != null, auto: op.x == null, style: {}, locked: !!op.locked, codeStyle: {}, codePos: null, codeSize: null, src: { code: null, view: null } };
        n.style = style(n, op.style);
        fitAuto(n);
        if (exists) m.nodes[m.nodes.indexOf(exists)] = { ...n, src: exists.src };
        else m.nodes.push(n);
        created.push(id);
        break;
      }
      case 'update': {
        const n = nodeOf(op.id); touchN(n.id);
        if (op.kind ?? op.shape) { const k = kindOf(op.kind ?? op.shape); if (k !== n.shape) { n.shape = k; if (!n.sized) { [n.w, n.h] = defaultSize(k); fitAuto(n); } } }
        if (op.label !== undefined) n.label = label(op.label) ?? n.id;
        if (op.in !== undefined || op.parent !== undefined) n.parent = parentOk(n.id, op.in !== undefined ? op.in : op.parent);
        if (op.tags !== undefined) n.tags = tagList(op.tags) || [];
        if (op.add_tags) n.tags = [...new Set([...(n.tags || []), ...tagList(op.add_tags)])];
        if (op.remove_tags) { const r = new Set(tagList(op.remove_tags)); n.tags = n.tags.filter((t) => !r.has(t)); }
        if (op.data !== undefined) n.data = attrs(op.data, n.data, 'data');
        if (op.body !== undefined) { n.body = body(op.body) || []; fitAuto(n); }
        if (op.style !== undefined) n.style = style(n, op.style);
        if (op.x != null || op.y != null || op.w != null || op.h != null) lockedGuard(n, 'move');
        if ((op.x == null) !== (op.y == null) && n.auto) fail(`${n.id} has no position yet; give x and y together`);
        if (op.x != null) { n.x = coord(op.x); n.auto = false; }
        if (op.y != null) { n.y = coord(op.y); n.auto = false; }
        if (op.w != null) { n.w = size(op.w); n.sized = true; }
        if (op.h != null) { n.h = size(op.h); n.sized = true; }
        if (op.locked !== undefined) n.locked = !!op.locked;
        n.implicit = false;
        break;
      }
      case 'remove': {
        for (const id of ids(op.id ?? op.ids)) {
          const n = nodeOf(id); lockedGuard(n, 'remove');
          touchN(id);
          for (const e of m.edges.filter((e) => e.from === id || e.to === id)) touchE(e.key);
          for (const c of m.nodes.filter((c) => c.parent === id)) { touchN(c.id); c.parent = null; }
          m.nodes = m.nodes.filter((x) => x.id !== id); m.edges = m.edges.filter((e) => e.from !== id && e.to !== id);
        }
        break;
      }
      case 'connect': {
        const from = nodeOf(op.from).id, to = nodeOf(op.to).id;
        const kop = op.op_type ?? op.arrow ?? '->';
        if (!ARROWS[kop]) fail(`Unknown connector "${kop}"; use one of ${Object.keys(ARROWS).join(' ')}`, nearest(kop, Object.keys(ARROWS)));
        if (op.id != null) { if (!ID_RE.test(op.id)) fail('a connector id starts with a letter or _'); if (m.nodes.some((n) => n.id === op.id) || m.edges.some((e) => e.id === op.id)) fail(`the id "${op.id}" is taken`); }
        const key = op.id || `#new${++NEW_KEYS}`;
        touchE(key);
        const e = { key, id: op.id || null, from, fromPort: port(op.fromPort), to, toPort: port(op.toPort), op: kop, label: label(op.label) || '', tags: tagList(op.tags) || [], data: attrs(op.data, {}, 'data'), ...ARROWS[kop], start: ARROWS[kop].start || null, end: ARROWS[kop].end || null, style: {}, codeStyle: {}, via: null, src: { code: null, view: null } };
        e.style = style(e, op.style);
        m.edges.push(e);
        if (op.id) created.push(op.id);
        break;
      }
      case 'update_connector': {
        for (const e of edgeOf(op)) {
          touchE(e.key);
          if (op.label !== undefined) e.label = label(op.label) || '';
          const kop = op.op_type ?? op.arrow;
          if (kop != null) { if (!ARROWS[kop]) fail(`Unknown connector "${kop}"`, nearest(kop, Object.keys(ARROWS))); e.op = kop; e.line = ARROWS[kop].line; e.start = ARROWS[kop].start || null; e.end = ARROWS[kop].end || null; }
          if (op.fromPort !== undefined) e.fromPort = port(op.fromPort);
          if (op.toPort !== undefined) e.toPort = port(op.toPort);
          if (op.style !== undefined) e.style = style(e, op.style);
          if (op.data !== undefined) e.data = attrs(op.data, e.data, 'data');
          if (op.tags !== undefined) e.tags = tagList(op.tags) || [];
          if (op.via !== undefined) e.via = op.via == null ? null : op.via.map((p) => [coord(p[0]), coord(p[1])]);
          if (op.reverse) { [e.from, e.to] = [e.to, e.from]; [e.fromPort, e.toPort] = [e.toPort, e.fromPort]; [e.start, e.end] = [e.end, e.start]; }
          if (op.new_id !== undefined) { if (op.new_id && (!ID_RE.test(op.new_id) || m.nodes.some((n) => n.id === op.new_id) || m.edges.some((x) => x !== e && x.id === op.new_id))) fail(`the id "${op.new_id}" cannot be used`); e.id = op.new_id || null; }
        }
        break;
      }
      case 'disconnect': {
        const list = edgeOf(op);
        for (const e of list) touchE(e.key);
        const gone = new Set(list);
        m.edges = m.edges.filter((e) => !gone.has(e));
        break;
      }
      case 'move': {
        const list = ids(op.id ?? op.ids).map((id) => nodeOf(id));
        if (op.x != null || op.y != null) {
          if (list.length !== 1) fail('x and y move one shape; use dx and dy for several');
          const n = list[0]; lockedGuard(n, 'move'); touchN(n.id);
          if ((op.x == null || op.y == null) && n.auto) fail(`${n.id} has no position yet; give x and y together`);
          if (op.x != null) n.x = coord(op.x); if (op.y != null) n.y = coord(op.y);
          pin(n);
        } else {
          const dx = coord(op.dx ?? 0), dy = coord(op.dy ?? 0);
          for (const n of list) { lockedGuard(n, 'move'); touchN(n.id); n.x = coord((n.x ?? 0) + dx); n.y = coord((n.y ?? 0) + dy); pin(n); }
        }
        break;
      }
      case 'resize': {
        const n = nodeOf(op.id); lockedGuard(n, 'resize'); touchN(n.id);
        if (op.w != null) n.w = size(op.w); if (op.h != null) n.h = size(op.h);
        n.sized = true;
        break;
      }
      case 'set_parent': { const n = nodeOf(op.id); touchN(n.id); n.parent = parentOk(n.id, op.parent ?? op.in ?? null); break; }
      case 'lock': for (const id of ids(op.id ?? op.ids)) { const n = nodeOf(id); touchN(n.id); n.locked = op.locked !== false; } break;
      case 'set_data': { const n = nodeOf(op.id); touchN(n.id); n.data = op.replace ? attrs(op.data, {}, 'data') : attrs(op.data, n.data, 'data'); break; }
      case 'front': case 'back': {
        const pick = new Set(ids(op.id ?? op.ids).map((id) => nodeOf(id).id));
        for (const id of pick) touchN(id);
        // every shape whose relative order changes is touched, so undo can put the order back
        const moving = m.nodes.filter((n) => pick.has(n.id)), rest = m.nodes.filter((n) => !pick.has(n.id));
        for (const n of m.nodes) touchN(n.id);
        m.nodes = op.op === 'front' ? [...rest, ...moving] : [...moving, ...rest];
        m.zTouched = [...new Set([...m.zTouched, ...pick])];
        break;
      }
      case 'unpin': for (const id of ids(op.id ?? op.ids)) { const n = nodeOf(id); lockedGuard(n, 'move'); touchN(n.id); n.auto = true; n.x = null; n.y = null; } break;
      case 'layout': {
        const dir = op.dir || m.settings?.direction || 'LR';
        if (!['LR', 'RL', 'TB', 'BT'].includes(dir)) fail('dir is LR, RL, TB or BT');
        const all = op.scope !== 'auto';
        const pinnedLocked = m.nodes.filter((n) => n.locked && !opts.force);
        for (const n of m.nodes) touchN(n.id);
        const keep = new Map(pinnedLocked.map((n) => [n.id, [n.x, n.y, n.auto]]));
        const wasAuto = new Set(m.nodes.filter((n) => n.auto || n.x == null).map((n) => n.id));
        autoLayout(m, { dir, all });
        for (const [id, [x, y, auto]] of keep) { const n = m.nodes.find((q) => q.id === id); n.x = x; n.y = y; n.auto = auto; }
        if (!all) for (const n of m.nodes) if (wasAuto.has(n.id) && !keep.has(n.id)) pin(n);
        if (all) { for (const n of m.nodes) if (!keep.has(n.id)) { n.auto = false; if (CONTAINERS.includes(n.shape)) n.sized = true; } m.layout = { engine: LAYOUT_ENGINE.engine, version: LAYOUT_ENGINE.version, dir }; }
        break;
      }
      case 'restore': {
        // the inverse of a batch: put the snapshots back, in index order
        for (const s of op.nodes || []) touchN(s.id);
        for (const s of op.edges || []) touchE(s.key);
        m.nodes = m.nodes.filter((n) => !(op.nodes || []).some((s) => s.id === n.id));
        for (const s of [...(op.nodes || [])].filter((s) => s.before).sort((a, b) => a.index - b.index)) m.nodes.splice(Math.min(s.index, m.nodes.length), 0, clone(s.before));
        m.edges = m.edges.filter((e) => !(op.edges || []).some((s) => s.key === e.key));
        for (const s of [...(op.edges || [])].filter((s) => s.before).sort((a, b) => a.index - b.index)) m.edges.splice(Math.min(s.index, m.edges.length), 0, clone(s.before));
        if ('layout' in op) m.layout = clone(op.layout);
        if (op.zTouched) m.zTouched = [...op.zTouched];
        break;
      }
    }
  });
  const inverse = [{ op: 'restore', nodes: [...snapN].map(([id, s]) => ({ id, ...s })), edges: [...snapE].map(([key, s]) => ({ key, ...s })), layout: layoutBefore, zTouched: zBefore }];
  return { model: m, inverse, created, touched: { nodes: [...snapN.keys()], edges: [...snapE.keys()] } };
}
// a shape that moves is no longer auto; a container that was sized by the layout keeps that size
function pin(n) { n.auto = false; if (CONTAINERS.includes(n.shape) && !n.sized) n.sized = true; }

/** a short account of what a batch changed, for MCP answers and the review UI */
export function summarize(before, after) {
  const bN = new Map(before.nodes.map((n) => [n.id, n])), aN = new Map(after.nodes.map((n) => [n.id, n]));
  const bE = new Map(before.edges.map((e) => [e.key, e])), aE = new Map(after.edges.map((e) => [e.key, e]));
  const J = (v) => JSON.stringify(v ?? null);
  const s = { added: [], removed: [], changed: [], moved: [], connected: [], disconnected: [], reconnected: [] };
  for (const [id, n] of aN) { const b = bN.get(id); if (!b) s.added.push(id); else { if (['shape', 'label', 'parent', 'tags', 'data', 'body', 'style', 'locked'].some((f) => J(n[f]) !== J(b[f]))) s.changed.push(id); if (!n.auto && (n.x !== b.x || n.y !== b.y || n.w !== b.w || n.h !== b.h || b.auto)) s.moved.push(id); } }
  for (const id of bN.keys()) if (!aN.has(id)) s.removed.push(id);
  const name = (e) => `${e.from} ${e.op} ${e.to}${e.id ? ` (=${e.id})` : ''}`;
  for (const [k, e] of aE) { const b = bE.get(k); if (!b) s.connected.push(name(e)); else if (['from', 'to', 'op', 'label', 'style', 'fromPort', 'toPort', 'data', 'via', 'id'].some((f) => J(e[f]) !== J(b[f]))) s.reconnected.push(name(e)); }
  for (const [k, e] of bE) if (!aE.has(k)) s.disconnected.push(name(e));
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v.length));
}
