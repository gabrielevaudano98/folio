// Folio — board-md: a whiteboard you can read. One ```board block of plain lines, AI-friendly, draw.io-grade shapes.
//
//   id: shape "Label" @x,y WxH {fill: #eee; stroke: dashed}
//   Order: class "Order" @600,80 [
//     + id: UUID
//     --
//     + pay(): void
//   ]
//   a -> b "label" {route: curved}
//
// Connectors:  ->  -->  --  ..  <->  -|>  ..|>  *--  o--  ..>   (UML: inheritance, realization, composition, aggregation, dependency)
import dagre from '@dagrejs/dagre';

export const LIBRARY = [
  ['General', [
    ['rect', 'Rectangle'], ['rounded', 'Rounded rectangle'], ['ellipse', 'Ellipse'], ['circle', 'Circle'], ['diamond', 'Diamond'],
    ['triangle', 'Triangle'], ['hexagon', 'Hexagon'], ['parallelogram', 'Parallelogram'], ['trapezoid', 'Trapezoid'], ['star', 'Star'],
    ['cloud', 'Cloud'], ['cylinder', 'Cylinder'], ['document', 'Document'], ['note', 'Sticky note'], ['callout', 'Callout'],
    ['step', 'Step'], ['cube', 'Cube'], ['cross', 'Cross'], ['text', 'Text'],
  ]],
  ['Flowchart', [
    ['terminator', 'Start or end'], ['rect', 'Process'], ['diamond', 'Decision'], ['parallelogram', 'Input or output'],
    ['predefined', 'Predefined process'], ['document', 'Document'], ['manual', 'Manual input'], ['delay', 'Delay'],
    ['cylinder', 'Stored data'], ['connector', 'Connector'], ['offpage', 'Off-page'],
  ]],
  ['UML', [
    ['class', 'Class'], ['interface', 'Interface'], ['actor', 'Actor'], ['usecase', 'Use case'], ['package', 'Package'],
    ['component', 'Component'], ['lifeline', 'Lifeline'], ['state', 'State'], ['initial', 'Initial state'], ['final', 'Final state'],
    ['activity', 'Activity'], ['fork', 'Fork or join'], ['note', 'Note'], ['frame', 'Frame'], ['cube', 'Node'],
  ]],
  ['Entity relation', [['table', 'Entity'], ['diamond', 'Relationship'], ['ellipse', 'Attribute']]],
  ['Architecture', [
    ['server', 'Server'], ['cylinder', 'Database'], ['queue', 'Queue'], ['cloud', 'Cloud'], ['browser', 'Browser'],
    ['mobile', 'Phone'], ['actor', 'User'], ['component', 'Service'], ['cube', 'Container'],
  ]],
  ['Containers', [['group', 'Group'], ['swimlane', 'Swimlane'], ['frame', 'Frame']]],
];
export const SHAPES = [...new Set(LIBRARY.flatMap(([, l]) => l.map(([s]) => s)))];
const SIZE = {
  rect: [120, 60], rounded: [120, 60], ellipse: [120, 70], circle: [64, 64], diamond: [120, 80], triangle: [90, 80], hexagon: [120, 70],
  parallelogram: [130, 60], trapezoid: [130, 60], star: [80, 80], cloud: [150, 90], cylinder: [90, 100], document: [120, 80], note: [150, 110],
  callout: [150, 90], step: [120, 50], cube: [120, 90], cross: [70, 70], text: [120, 40], terminator: [130, 50], predefined: [140, 60],
  manual: [130, 60], delay: [110, 60], connector: [40, 40], offpage: [70, 70], class: [190, 0], interface: [190, 0], actor: [40, 80],
  usecase: [150, 70], package: [180, 120], component: [150, 70], lifeline: [130, 320], state: [130, 56], initial: [26, 26], final: [30, 30],
  activity: [140, 56], fork: [140, 8], frame: [300, 200], table: [210, 0], server: [70, 96], queue: [140, 54], browser: [180, 120],
  mobile: [74, 130], group: [340, 230], swimlane: [520, 200],
};
export const CONTAINERS = ['group', 'swimlane', 'frame', 'package'];
export const ARROWS = {
  '->': { line: 'solid', end: 'arrow' }, '-->': { line: 'dashed', end: 'arrow' }, '--': { line: 'solid' }, '..': { line: 'dashed' },
  '<->': { line: 'solid', start: 'arrow', end: 'arrow' }, '-|>': { line: 'solid', end: 'triangle' }, '..|>': { line: 'dashed', end: 'triangle' },
  '*--': { line: 'solid', start: 'diamond' }, 'o--': { line: 'solid', start: 'diamondOpen' }, '..>': { line: 'dashed', end: 'open' },
};
const ARROW_RE = /^([\w.-]+?)(?:\.(top|right|bottom|left))?\s*(<->|\.\.\|>|-\|>|\*--|o--|-->|\.\.>|->|--|\.\.)\s*([\w.-]+?)(?:\.(top|right|bottom|left))?(?:\s+"((?:[^"\\]|\\.)*)")?(?:\s*\{([^}]*)\})?\s*$/;
const NODE_RE = /^([A-Za-z_][\w-]*)\s*:\s*([a-z-]+)?\s*(?:"((?:[^"\\]|\\.)*)")?\s*(?:@\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?\s*(?:(\d+)\s*[x×]\s*(\d+))?\s*(?:\{([^}]*)\})?\s*(\[)?\s*$/;

export const defaultSize = (shape) => SIZE[shape] || [120, 60];
const unq = (s) => (s ?? '').replace(/\\(["n\\])/g, (m, c) => (c === 'n' ? '\n' : c)); // one pass, so \\n stays a backslash and an n
// a backslash is doubled only where the reader would take it for an escape (before \, " or n, or at the end), so `C:\folder` stays as written
const q = (s) => `"${String(s).replace(/\\(?=["n\\]|$)|"|\n/g, (c) => (c === '\n' ? '\\n' : '\\' + c))}"`;
function parseStyle(s) {
  const out = {};
  if (!s) return out;
  for (const part of s.split(';')) {
    const [k, ...v] = part.split(':');
    if (!k.trim()) continue;
    out[k.trim()] = v.length ? v.join(':').trim() : true;
  }
  return out;
}
function styleStr(st) {
  const e = Object.entries(st || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
  return e.length ? ` {${e.map(([k, v]) => (v === true ? k : `${k}: ${v}`)).join('; ')}}` : '';
}

/* ---------- document ---------- */
export function splitBoardDoc(text) {
  const m = text.match(/(^|\n)```board[^\n]*\n([\s\S]*?)\n```[ \t]*(\n|$)/);
  if (!m) return { before: text.replace(/\n*$/, '\n\n'), code: '', after: '' };
  const start = m.index + m[1].length;
  return { before: text.slice(0, start), code: m[2], after: text.slice(m.index + m[0].length - m[3].length) };
}
export function joinBoardDoc(parts, code) { return `${parts.before}\`\`\`board\n${code.replace(/\n+$/, '')}\n\`\`\`${parts.after || '\n'}`; }

export function parseBoard(code) {
  const nodes = [], edges = [], comments = [], errors = [];
  const lines = code.split('\n');
  let pre = [];
  const take = () => { const p = pre; pre = []; return p; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], line = raw.trim();
    if (!line) { if (nodes.length + edges.length + pre.length) pre.push(''); continue; }
    if (line.startsWith('//') || line.startsWith('%%')) { pre.push(raw); continue; }
    let m = line.match(ARROW_RE);
    if (m && !/^[\w-]+\s*:/.test(line)) {
      const kind = ARROWS[m[3]];
      edges.push({ pre: take(), from: m[1], fromPort: m[2] || null, to: m[4], toPort: m[5] || null, op: m[3], label: unq(m[6] || ''), style: parseStyle(m[7]), ...kind, srcLine: i + 1 });
      continue;
    }
    m = line.match(NODE_RE);
    if (m) {
      const shape = SHAPES.includes(m[2]) ? m[2] : m[2] ? (errors.push({ line: i + 1, msg: `Unknown shape "${m[2]}", drawn as a rectangle` }), 'rect') : 'rect';
      const [dw, dh] = defaultSize(shape);
      const n = { pre: take(), id: m[1], shape, label: unq(m[3] ?? m[1]), x: m[4] != null ? Number(m[4]) : null, y: m[5] != null ? Number(m[5]) : null, w: m[6] ? Number(m[6]) : dw, h: m[7] ? Number(m[7]) : dh, style: parseStyle(m[8]), body: [], line: i + 1, sized: !!m[6] };
      if (m[9]) { while (++i < lines.length && lines[i].trim() !== ']') n.body.push(lines[i].replace(/^\s{2}/, '')); }
      nodes.push(n);
      continue;
    }
    errors.push({ line: i + 1, msg: `Could not read: ${line.slice(0, 60)}` });
  }
  // nodes referenced only by edges become rectangles
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) for (const id of [e.from, e.to]) if (!ids.has(id)) { ids.add(id); nodes.push({ id, shape: 'rect', label: id, x: null, y: null, w: 120, h: 60, style: {}, body: [], implicit: true }); }
  for (const n of nodes) fitAuto(n);
  while (pre.length && pre.at(-1) === '') pre.pop();
  comments.push(...pre);
  return { nodes, edges, comments, errors };
}

export function fitAuto(n) {
  if (['class', 'interface', 'table'].includes(n.shape) && !n.sized) n.h = 34 + Math.max(1, n.body.filter((l) => l.trim() !== '--').length) * 22 + n.body.filter((l) => l.trim() === '--').length * 8 + 8;
  if (n.shape === 'note' && n.body.length && !n.sized) n.h = Math.max(n.h, 40 + n.body.length * 22);
}

export function serializeBoard(model) {
  const out = [];
  const fmt = (v) => Math.round(v);
  const lead = (p, i) => { if (p?.length) out.push(...(i === 0 ? p.filter((l, j) => l !== '' || j > 0) : p)); };
  for (const n of model.nodes) {
    if (n.implicit && n.x == null) continue;
    const [dw, dh] = defaultSize(n.shape);
    const auto = ['class', 'interface', 'table'].includes(n.shape) && !n.sized;
    const size = !auto && (n.w !== dw || n.h !== dh) ? ` ${fmt(n.w)}x${fmt(n.h)}` : '';
    const pos = n.x != null ? ` @${fmt(n.x)},${fmt(n.y)}` : '';
    const label = n.label !== n.id || n.shape !== 'rect' ? ` ${q(n.label)}` : '';
    lead(n.pre, out.length);
    out.push(`${n.id}: ${n.shape}${label}${pos}${size}${styleStr(n.style)}${n.body.length ? ' [' : ''}`);
    if (n.body.length) { for (const l of n.body) out.push('  ' + l); out.push(']'); }
  }
  if (model.edges.length && !model.edges[0].pre?.length) out.push('');
  for (const e of model.edges) {
    lead(e.pre, out.length);
    const op = Object.entries(ARROWS).find(([, k]) => k.line === e.line && (k.start || null) === (e.start || null) && (k.end || null) === (e.end || null))?.[0];
    const st = { ...e.style };
    if (!op) { st.line = e.line; st.start = e.start || 'none'; st.end = e.end || 'none'; }
    out.push(`${e.from}${e.fromPort ? '.' + e.fromPort : ''} ${op || '--'} ${e.to}${e.toPort ? '.' + e.toPort : ''}${e.label ? ' ' + q(e.label) : ''}${styleStr(st)}`);
  }
  if (model.comments.length) out.push(...model.comments);
  return out.join('\n');
}
export function applyEdgeStyle(e) {
  // explicit style keys override the connector token
  if (e.style.line) e.line = e.style.line;
  if (e.style.start) e.start = e.style.start === 'none' ? null : e.style.start;
  if (e.style.end) e.end = e.style.end === 'none' ? null : e.style.end;
  delete e.style.line; delete e.style.start; delete e.style.end;
  return e;
}

/* ---------- layout ---------- */
export function autoLayout(model, { dir = 'LR', all = false } = {}) {
  const need = all ? model.nodes : model.nodes.filter((n) => n.x == null || n.y == null);
  if (!need.length) return false;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep: 50, ranksep: 80, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  const free = new Set(need.map((n) => n.id));
  for (const n of model.nodes) if (free.has(n.id) && !CONTAINERS.includes(n.shape)) g.setNode(n.id, { width: n.w, height: n.h });
  for (const e of model.edges) if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to);
  dagre.layout(g);
  let ox = 0;
  if (!all) { const placed = model.nodes.filter((n) => !free.has(n.id) && n.x != null); if (placed.length) ox = Math.max(...placed.map((n) => n.x + n.w)) + 80; }
  for (const n of model.nodes) {
    if (!free.has(n.id)) continue;
    const p = g.node(n.id);
    if (p) { n.x = Math.round((p.x - n.w / 2 + ox) / 10) * 10; n.y = Math.round((p.y - n.h / 2) / 10) * 10; }
    else { n.x = ox + 40; n.y = 40; }
  }
  return true;
}

/* ---------- geometry ---------- */
export function ports(n) {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const h = n.shape === 'actor' ? n.h : n.h;
  return { top: [cx, n.y], right: [n.x + n.w, cy], bottom: [cx, n.y + h], left: [n.x, cy] };
}
function pickPorts(a, b, e) {
  const pa = ports(a), pb = ports(b);
  if (e.fromPort && e.toPort) return [e.fromPort, e.toPort];
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  let fp, tp;
  if (Math.abs(dx) * (a.h + b.h) > Math.abs(dy) * (a.w + b.w)) { fp = dx > 0 ? 'right' : 'left'; tp = dx > 0 ? 'left' : 'right'; }
  else { fp = dy > 0 ? 'bottom' : 'top'; tp = dy > 0 ? 'top' : 'bottom'; }
  return [e.fromPort || fp, e.toPort || tp, pa, pb];
}
const DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
export function edgePath(a, b, e) {
  const [fp, tp] = pickPorts(a, b, e);
  const [x1, y1] = ports(a)[fp], [x2, y2] = ports(b)[tp];
  const route = e.style.route || 'orthogonal';
  if (a === b) { const x = a.x + a.w, y = a.y + a.h / 2; return { d: `M${x},${y - 12} C${x + 60},${y - 60} ${x + 60},${y + 60} ${x},${y + 12}`, mid: [x + 45, y] }; }
  if (route === 'straight') return { d: `M${x1},${y1} L${x2},${y2}`, mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
  if (route === 'curved') {
    const k = Math.max(40, Math.hypot(x2 - x1, y2 - y1) / 3);
    const c1 = [x1 + DIR[fp][0] * k, y1 + DIR[fp][1] * k], c2 = [x2 + DIR[tp][0] * k, y2 + DIR[tp][1] * k];
    return { d: `M${x1},${y1} C${c1} ${c2} ${x2},${y2}`, mid: [(x1 + 3 * c1[0] + 3 * c2[0] + x2) / 8, (y1 + 3 * c1[1] + 3 * c2[1] + y2) / 8] };
  }
  // orthogonal with a little lead-out from each port
  const L = 20;
  const s = [x1 + DIR[fp][0] * L, y1 + DIR[fp][1] * L], t = [x2 + DIR[tp][0] * L, y2 + DIR[tp][1] * L];
  const pts = [[x1, y1], s];
  const horiz = fp === 'left' || fp === 'right';
  if (horiz && (tp === 'left' || tp === 'right')) { const mx = (s[0] + t[0]) / 2; pts.push([mx, s[1]], [mx, t[1]]); }
  else if (!horiz && (tp === 'top' || tp === 'bottom')) { const my = (s[1] + t[1]) / 2; pts.push([s[0], my], [t[0], my]); }
  else if (horiz) pts.push([t[0], s[1]]); else pts.push([s[0], t[1]]);
  pts.push(t, [x2, y2]);
  const clean = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  const r = 8; let d = `M${clean[0]}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const [px, py] = clean[i - 1], [cx, cy] = clean[i], [nx, ny] = clean[i + 1];
    const d1 = Math.min(r, Math.hypot(cx - px, cy - py) / 2), d2 = Math.min(r, Math.hypot(nx - cx, ny - cy) / 2);
    const u1 = [(cx - px) / (Math.hypot(cx - px, cy - py) || 1), (cy - py) / (Math.hypot(cx - px, cy - py) || 1)];
    const u2 = [(nx - cx) / (Math.hypot(nx - cx, ny - cy) || 1), (ny - cy) / (Math.hypot(nx - cx, ny - cy) || 1)];
    d += ` L${cx - u1[0] * d1},${cy - u1[1] * d1} Q${cx},${cy} ${cx + u2[0] * d2},${cy + u2[1] * d2}`;
  }
  d += ` L${clean[clean.length - 1]}`;
  // label at the middle of the longest segment
  let best = 0, mid = [(x1 + x2) / 2, (y1 + y2) / 2];
  for (let i = 1; i < clean.length; i++) { const l = Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]); if (l > best) { best = l; mid = [(clean[i][0] + clean[i - 1][0]) / 2, (clean[i][1] + clean[i - 1][1]) / 2]; } }
  return { d, mid };
}

/* ---------- shape outlines (SVG markup inside a group translated to x,y) ---------- */
export function shapeSvg(n, cls = 'b-shape') {
  const { w, h } = n; const s = n.style;
  const a = `class="${cls}"${s.fill ? ` style="fill:${s.fill}"` : ''}`;
  const r = (x, y, ww, hh, rx = 0) => `<rect ${a} x="${x}" y="${y}" width="${ww}" height="${hh}" rx="${rx}"/>`;
  const p = (d) => `<path ${a} d="${d}"/>`;
  const line = (d) => `<path class="b-line" d="${d}"/>`;
  switch (n.shape) {
    case 'rect': case 'predefined': case 'class': case 'interface': case 'table': case 'lifeline': {
      if (n.shape === 'predefined') return r(0, 0, w, h) + line(`M12,0 V${h} M${w - 12},0 V${h}`);
      if (n.shape === 'lifeline') return r(0, 0, w, 44, 4) + `<path class="b-line b-dash" d="M${w / 2},44 V${h}"/>`;
      return r(0, 0, w, h, s.rounded ? 10 : 0);
    }
    case 'rounded': case 'state': case 'activity': return r(0, 0, w, h, Math.min(h / 2, n.shape === 'rounded' ? 12 : 18));
    case 'terminator': return r(0, 0, w, h, h / 2);
    case 'ellipse': case 'usecase': return `<ellipse ${a} cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>`;
    case 'circle': case 'connector': return `<ellipse ${a} cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>`;
    case 'initial': return `<circle class="b-fill-ink" cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}"/>`;
    case 'final': return `<circle ${a} cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}"/><circle class="b-fill-ink" cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2 - 6}"/>`;
    case 'diamond': return p(`M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2}Z`);
    case 'triangle': return p(`M${w / 2},0 L${w},${h} L0,${h}Z`);
    case 'hexagon': return p(`M${w * 0.22},0 H${w * 0.78} L${w},${h / 2} L${w * 0.78},${h} H${w * 0.22} L0,${h / 2}Z`);
    case 'parallelogram': return p(`M${w * 0.18},0 H${w} L${w * 0.82},${h} H0Z`);
    case 'trapezoid': return p(`M${w * 0.18},0 H${w * 0.82} L${w},${h} H0Z`);
    case 'manual': return p(`M0,${h * 0.28} L${w},0 V${h} H0Z`);
    case 'delay': return p(`M0,0 H${w - h / 2} A${h / 2},${h / 2} 0 0 1 ${w - h / 2},${h} H0Z`);
    case 'offpage': return p(`M0,0 H${w} V${h * 0.6} L${w / 2},${h} L0,${h * 0.6}Z`);
    case 'step': return p(`M0,0 H${w - h / 2} L${w},${h / 2} L${w - h / 2},${h} H0 L${h / 2},${h / 2}Z`);
    case 'cross': { const t = Math.min(w, h) / 3; return p(`M${(w - t) / 2},0 h${t} v${(h - t) / 2} h${(w - t) / 2} v${t} h-${(w - t) / 2} v${(h - t) / 2} h-${t} v-${(h - t) / 2} h-${(w - t) / 2} v-${t} h${(w - t) / 2}Z`); }
    case 'star': { let d = ''; for (let i = 0; i < 10; i++) { const ang = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.4 : 1; d += `${i ? 'L' : 'M'}${w / 2 + Math.cos(ang) * w / 2 * rr},${h / 2 + Math.sin(ang) * h / 2 * rr} `; } return p(d + 'Z'); }
    case 'cloud': return p(`M${w * 0.25},${h * 0.8} C${w * 0.02},${h * 0.8} ${w * 0.02},${h * 0.42} ${w * 0.24},${h * 0.42} C${w * 0.24},${h * 0.12} ${w * 0.6},${h * 0.05} ${w * 0.66},${h * 0.32} C${w * 0.95},${h * 0.22} ${w * 1.02},${h * 0.62} ${w * 0.8},${h * 0.8}Z`);
    case 'cylinder': { const e = Math.min(14, h * 0.15); return p(`M0,${e} A${w / 2},${e} 0 0 1 ${w},${e} V${h - e} A${w / 2},${e} 0 0 1 0,${h - e}Z`) + line(`M0,${e} A${w / 2},${e} 0 0 0 ${w},${e}`); }
    case 'document': return p(`M0,0 H${w} V${h * 0.84} C${w * 0.75},${h * 0.66} ${w * 0.25},${h * 1.04} 0,${h * 0.86}Z`);
    case 'note': return p(`M0,0 H${w - 18} L${w},18 V${h} H0Z`) + line(`M${w - 18},0 V18 H${w}`);
    case 'callout': return p(`M0,0 H${w} V${h * 0.72} H${w * 0.42} L${w * 0.24},${h} L${w * 0.26},${h * 0.72} H0Z`);
    case 'cube': { const d = 14; return p(`M0,${d} L${d},0 H${w} V${h - d} L${w - d},${h} H0Z`) + line(`M0,${d} H${w - d} V${h} M${w - d},${d} L${w},0`); }
    case 'text': return `<rect class="b-hit" x="0" y="0" width="${w}" height="${h}"/>`;
    case 'actor': { const hr = Math.min(w, h) * 0.22; return `<rect class="b-hit" x="0" y="0" width="${w}" height="${h}"/><circle ${a} cx="${w / 2}" cy="${hr + 1}" r="${hr}"/>` + line(`M${w / 2},${hr * 2 + 1} V${h * 0.62} M0,${h * 0.38} H${w} M${w / 2},${h * 0.62} L${w * 0.1},${h} M${w / 2},${h * 0.62} L${w * 0.9},${h}`); }
    case 'package': return p(`M0,18 V${h} H${w} V18Z`) + `<path ${a} d="M0,0 H${Math.min(80, w * 0.45)} V18 H0Z"/>`;
    case 'component': return r(0, 0, w, h) + r(-8, h * 0.25, 16, 10) + r(-8, h * 0.6, 16, 10);
    case 'fork': return `<rect class="b-fill-ink" x="0" y="0" width="${w}" height="${h}" rx="2"/>`;
    case 'frame': return r(0, 0, w, h) + p(`M0,0 H${Math.min(110, w * 0.5)} V16 L${Math.min(110, w * 0.5) - 10},26 H0Z`);
    case 'server': return r(0, 0, w, h, 6) + line(`M0,${h / 3} H${w} M0,${h * 2 / 3} H${w}`) + `<circle class="b-fill-ink" cx="${w - 12}" cy="${h / 6}" r="2.5"/><circle class="b-fill-ink" cx="${w - 12}" cy="${h / 2}" r="2.5"/><circle class="b-fill-ink" cx="${w - 12}" cy="${h * 5 / 6}" r="2.5"/>`;
    case 'queue': { const e = Math.min(12, w * 0.12); return p(`M${e},0 H${w - e} A${e},${h / 2} 0 0 1 ${w - e},${h} H${e} A${e},${h / 2} 0 0 1 ${e},0Z`) + line(`M${w - e},0 A${e},${h / 2} 0 0 0 ${w - e},${h}`); }
    case 'browser': return r(0, 0, w, h, 6) + line(`M0,22 H${w}`) + `<circle class="b-fill-ink" cx="12" cy="11" r="3"/><circle class="b-fill-ink" cx="22" cy="11" r="3"/><circle class="b-fill-ink" cx="32" cy="11" r="3"/>`;
    case 'mobile': return r(0, 0, w, h, 12) + line(`M${w * 0.38},${h - 10} H${w * 0.62}`);
    case 'group': return `<rect class="b-container" x="0" y="0" width="${w}" height="${h}" rx="10"${s.fill ? ` style="fill:${s.fill}"` : ''}/>`;
    case 'swimlane': return `<rect class="b-container" x="0" y="0" width="${w}" height="${h}"${s.fill ? ` style="fill:${s.fill}"` : ''}/>` + `<rect ${a} x="0" y="0" width="34" height="${h}"/>`;
    default: return r(0, 0, w, h);
  }
}
/** where the label goes, relative to the shape */
export function labelBox(n) {
  const { w, h } = n;
  switch (n.shape) {
    case 'actor': return { x: -40, y: h + 4, w: w + 80, h: 40, valign: 'top' };
    case 'cylinder': return { x: 6, y: 18, w: w - 12, h: h - 24 };
    case 'queue': return { x: 14, y: 2, w: w - 34, h: h - 4 };
    case 'lifeline': return { x: 4, y: 0, w: w - 8, h: 44 };
    case 'package': return { x: 8, y: 22, w: w - 16, h: 30, valign: 'top', bold: true };
    case 'frame': return { x: 8, y: 0, w: Math.min(110, w * 0.5) - 14, h: 18, size: 12, bold: true, align: 'left' };
    case 'group': return { x: 12, y: 8, w: w - 24, h: 24, valign: 'top', align: 'left', bold: true };
    case 'swimlane': return { x: 0, y: 0, w: 34, h, vertical: true, bold: true };
    case 'initial': case 'final': case 'fork': return { x: -50, y: h + 4, w: w + 100, h: 22, valign: 'top' };
    case 'note': return { x: 10, y: 10, w: w - 28, h: h - 20, valign: n.body.length ? 'top' : 'middle', align: n.body.length ? 'left' : 'center' };
    case 'diamond': return { x: w * 0.18, y: h * 0.18, w: w * 0.64, h: h * 0.64 };
    case 'browser': return { x: 8, y: 26, w: w - 16, h: h - 30 };
    case 'callout': return { x: 6, y: 4, w: w - 12, h: h * 0.68 };
    case 'server': case 'mobile': return { x: -40, y: h + 4, w: w + 80, h: 40, valign: 'top' };
    case 'component': return { x: 14, y: 0, w: w - 20, h };
    default: return { x: 6, y: 4, w: w - 12, h: h - 8 };
  }
}
