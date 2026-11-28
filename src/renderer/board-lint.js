// Folio — board checks and compact views for assistants: lint (structure, layout, review basics), a short outline of
// the graph without any styling, and shape search.
import { CONTAINERS, autoLayout } from './board-core.js';
import { charWidth, wrapText } from './board-render.js';
import { quote, attrsText } from './board-doc.js';

const box = (n) => ({ x: n.x, y: n.y, w: n.w, h: n.h });
const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (c, p) => c.x >= p.x && c.y >= p.y && c.x + c.w <= p.x + p.w && c.y + c.h <= p.y + p.h;
const center = (n) => [n.x + n.w / 2, n.y + n.h / 2];
function cross(p1, p2, p3, p4) {
  const d = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
const NO_EDGES_EXPECTED = new Set(['text', 'note', 'callout', 'frame', 'group', 'swimlane', 'package']);

/**
 * Every issue on a board: [{ code, severity: error|warning|info, message, ids, line? }].
 * opts.layout (default true) adds the layout checks; they use the drawn positions (auto shapes placed first).
 */
export function boardIssues(doc, model, opts = {}) {
  const out = [];
  const add = (code, severity, message, ids = [], line) => out.push({ code, severity, message, ids, ...(line ? { line } : {}) });
  for (const e of doc.errors) add(e.soft && /Unknown kind/.test(e.msg) ? 'unknown-kind' : 'syntax', e.soft ? 'warning' : 'error', `Line ${e.line}${e.col ? `, column ${e.col}` : ''}: ${e.msg}${e.fix ? `. ${e.fix}` : ''}`, [], e.line);
  for (const w of doc.warnings) add(w.kind === 'orphan' ? 'orphan-view-line' : w.kind === 'version' ? 'newer-version' : w.kind === 'parent' ? 'missing-container' : 'warning', w.kind === 'version' ? 'error' : 'warning', `Line ${w.line}: ${w.msg}`, w.id ? [w.id] : [], w.line);
  const ids = new Map(model.nodes.map((n) => [n.id, n]));
  for (const n of model.nodes) if (n.implicit) add('undeclared-shape', 'info', `${n.id} is only named by connectors; it is drawn as a rectangle labelled with its id`, [n.id]);
  const seen = new Map();
  for (const e of model.edges) {
    const k = `${e.from} ${e.op} ${e.to}`;
    if (seen.has(k)) add('duplicate-connector', 'warning', `Two connectors ${k}${e.label || seen.get(k).label ? '' : ' with the same label'}`, [e.from, e.to]);
    else seen.set(k, e);
    if (e.from === e.to) add('self-loop', 'info', `${e.from} connects to itself`, [e.from]);
  }
  const deg = new Map(model.nodes.map((n) => [n.id, { in: 0, out: 0 }]));
  for (const e of model.edges) { deg.get(e.from) && deg.get(e.from).out++; deg.get(e.to) && deg.get(e.to).in++; }
  for (const n of model.nodes) {
    const d = deg.get(n.id);
    if (!d.in && !d.out && !NO_EDGES_EXPECTED.has(n.shape) && !model.nodes.some((c) => c.parent === n.id) && model.edges.length) add('orphan-shape', 'info', `${n.id} has no connectors`, [n.id]);
    if (n.shape === 'diamond' && d.out < 2 && model.edges.length) add('decision-exits', 'warning', `Decision ${n.id} has ${d.out} way${d.out === 1 ? '' : 's'} out; a decision needs at least two`, [n.id]);
    if (n.parent && ids.has(n.parent) && !CONTAINERS.includes(ids.get(n.parent).shape)) add('parent-not-container', 'info', `${n.id} is in ${n.parent}, which is a ${ids.get(n.parent).shape}, not a container`, [n.id, n.parent]);
  }
  if (!doc.title) add('missing-title', 'info', 'The board has no title: add a # heading above the block (or title: in the board settings)');
  const unlabeled = model.edges.filter((e) => !e.label);
  if (unlabeled.length && model.edges.length) add('unlabeled-connector', 'info', `${unlabeled.length} connector${unlabeled.length === 1 ? ' has' : 's have'} no label: ${unlabeled.slice(0, 8).map((e) => `${e.from} ${e.op} ${e.to}`).join(', ')}${unlabeled.length > 8 ? ', …' : ''}`, [...new Set(unlabeled.flatMap((e) => [e.from, e.to]))]);
  if (opts.layout !== false) {
    const m = { ...model, nodes: model.nodes.map((n) => ({ ...n })) };
    autoLayout(m);
    const by = new Map(m.nodes.map((n) => [n.id, n]));
    const anc = (n, p) => { for (let q = n; q; q = q.parent ? by.get(q.parent) : null) if (q.id === p.id) return true; return false; };
    const plain = m.nodes.filter((n) => !CONTAINERS.includes(n.shape));
    for (let i = 0; i < plain.length; i++) for (let j = i + 1; j < plain.length; j++) {
      const a = plain[i], b = plain[j];
      if (inter(box(a), box(b)) && !anc(a, b) && !anc(b, a)) add('overlap', 'warning', `${a.id} and ${b.id} overlap`, [a.id, b.id]);
    }
    for (const n of m.nodes) {
      const p = n.parent && by.get(n.parent);
      if (p && CONTAINERS.includes(p.shape) && !inside(box(n), box(p))) add('outside-container', 'warning', `${n.id} is in ${p.id} but drawn outside it`, [n.id, p.id]);
      if (!n.label || ['class', 'interface', 'table', 'text', 'actor', 'server', 'mobile', 'initial', 'final', 'fork', 'swimlane', 'group', 'frame', 'package'].includes(n.shape)) continue;
      const fs = Number(n.style?.size) || 13, lines = wrapText(n.label, Math.max(20, n.w - 12), fs, !!n.style?.bold);
      const longest = Math.max(...lines.map((l) => charWidth(l, fs)));
      if (lines.length * fs * 1.3 > n.h - 4 || longest > n.w - 4) add('label-overflow', 'info', `The label of ${n.id} does not fit its shape (${n.w}x${n.h})`, [n.id]);
    }
    const segs = m.edges.filter((e) => by.has(e.from) && by.has(e.to) && e.from !== e.to).map((e) => [e, center(by.get(e.from)), center(by.get(e.to))]);
    let crossings = 0; const crossIds = new Set();
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const [e1, a1, b1] = segs[i], [e2, a2, b2] = segs[j];
      if ([e1.from, e1.to].some((x) => x === e2.from || x === e2.to)) continue;
      if (cross(a1, b1, a2, b2)) { crossings++; crossIds.add(e1.from).add(e1.to).add(e2.from).add(e2.to); }
    }
    if (crossings) add('crossings', 'info', `${crossings} connector crossing${crossings === 1 ? '' : 's'} (counted on straight lines between centres)`, [...crossIds]);
    // a flow with a start: shapes no path reaches
    const starts = m.nodes.filter((n) => (n.shape === 'initial' || (n.shape === 'terminator' && !model.edges.some((e) => e.to === n.id))));
    if (starts.length && model.edges.length) {
      const reach = new Set(starts.map((n) => n.id)), q = [...reach];
      while (q.length) { const id = q.shift(); for (const e of model.edges) { const nxt = e.from === id ? e.to : e.op === '<->' && e.to === id ? e.from : null; if (nxt && !reach.has(nxt)) { reach.add(nxt); q.push(nxt); } } }
      const un = m.nodes.filter((n) => !reach.has(n.id) && !NO_EDGES_EXPECTED.has(n.shape) && !CONTAINERS.includes(n.shape));
      if (un.length) add('unreachable', 'warning', `No path from the start reaches ${un.map((n) => n.id).join(', ')}`, un.map((n) => n.id));
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** a compact outline: ids, kinds, labels, containment, tags, data and connectors; no positions, no styles */
export function describeBoard(model) {
  const kids = new Map();
  for (const n of model.nodes) { const p = n.parent && model.nodes.some((q) => q.id === n.parent) ? n.parent : null; (kids.get(p) || kids.set(p, []).get(p)).push(n); }
  const lines = [];
  if (model.title) lines.push(`# ${model.title}`);
  lines.push(`${model.nodes.length} shapes, ${model.edges.length} connectors${model.settings?.direction ? `, direction ${model.settings.direction}` : ''}`);
  const walk = (n, ind) => {
    const data = attrsText(n.data);
    lines.push(`${ind}${n.id}: ${n.shape}${n.label !== n.id ? ' ' + quote(n.label) : ''}${(n.tags || []).map((t) => ' #' + t).join('')}${data ? ' ' + data : ''}${n.locked ? ' (locked)' : ''}${n.body?.length ? ` [${n.body.length} lines]` : ''}`);
    for (const c of kids.get(n.id) || []) walk(c, ind + '  ');
  };
  for (const n of kids.get(null) || []) walk(n, '');
  for (const e of model.edges) lines.push(`${e.from} ${e.op} ${e.to}${e.label ? ' ' + quote(e.label) : ''}${e.id ? ' =' + e.id : ''}`);
  return lines.join('\n');
}

/** shapes matching every given filter: text (in id, label, body, data values), kind, tag, data ({key: value} or key), in */
export function findShapes(model, q = {}) {
  const t = q.text?.toLowerCase();
  const kids = (id) => { const out = new Set(); const walk = (p) => { for (const n of model.nodes) if (n.parent === p && !out.has(n.id)) { out.add(n.id); walk(n.id); } }; walk(id); return out; };
  const within = q.in ? kids(q.in) : null;
  return model.nodes.filter((n) => {
    if (t && ![n.id, n.label, ...(n.body || []), ...Object.values(n.data || {}).map(String)].some((s) => String(s).toLowerCase().includes(t))) return false;
    if (q.kind && n.shape !== q.kind) return false;
    if (q.tag && !(n.tags || []).includes(String(q.tag).replace(/^#/, ''))) return false;
    if (q.data) {
      if (typeof q.data === 'string') { if (!(q.data in (n.data || {}))) return false; }
      else for (const [k, v] of Object.entries(q.data)) if (String(n.data?.[k] ?? '') !== String(v)) return false;
    }
    if (within && !within.has(n.id)) return false;
    return true;
  });
}
