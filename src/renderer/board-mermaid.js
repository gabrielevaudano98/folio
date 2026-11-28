// Folio — Mermaid flowcharts in and out of board-md. Import reads `flowchart`/`graph` text into board code (shapes arrive
// auto, the layout places them) and reports, one line each, every construct it could not map. Export writes the code
// only; positions and styles (the view) are dropped, and the caller says so.
import { CONTAINERS, ARROWS } from './board-core.js';
import { parseBoardDoc, boardModel, writeBoardDoc } from './board-doc.js';

const DIRS = { LR: 'LR', RL: 'RL', TB: 'TB', TD: 'TB', BT: 'BT' };
// opening bracket → [closing, kind, lossy note]
const SHAPES_IN = [
  ['(((', ')))', 'circle', 'double circle drawn as a circle'],
  ['([', '])', 'terminator'], ['[[', ']]', 'predefined'], ['[(', ')]', 'cylinder'], ['((', '))', 'circle'],
  ['{{', '}}', 'hexagon'], ['[/', '/]', 'parallelogram'], ['[\\', '\\]', 'parallelogram', 'alternate parallelogram drawn as a parallelogram'],
  ['[/', '\\]', 'trapezoid'], ['[\\', '/]', 'trapezoid', 'inverted trapezoid drawn as a trapezoid'],
  ['[', ']', 'rect'], ['(', ')', 'rounded'], ['{', '}', 'diamond'], ['>', ']', 'step', 'asymmetric shape drawn as a step'],
];
const SHAPES_OUT = { rect: ['[', ']'], rounded: ['(', ')'], terminator: ['([', '])'], predefined: ['[[', ']]'], cylinder: ['[(', ')]'], circle: ['((', '))'], connector: ['((', '))'], hexagon: ['{{', '}}'], parallelogram: ['[/', '/]'], trapezoid: ['[/', '\\]'], diamond: ['{', '}'], step: ['>', ']'], state: ['(', ')'], activity: ['(', ')'], usecase: ['([', '])'], ellipse: ['([', '])'] };
const unlabel = (s) => s.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/#quot;/g, '"').replace(/\\/g, '/');
const mid = (raw) => { const m = /^[A-Za-z_][\w-]*$/.test(raw) ? raw : 'n_' + raw.replace(/[^\w-]/g, '_'); return m === 'end' ? 'end_' : m; };

/** split a Mermaid source into statements with their line numbers (newlines and ; separate, %% starts a comment) */
function statements(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    let s = line.replace(/%%.*$/, '');
    // ; separates statements outside brackets and quotes
    let depth = 0, q = false, cur = '';
    for (const ch of s) {
      if (ch === '"') q = !q;
      if (!q && '[({'.includes(ch)) depth++;
      if (!q && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ';' && !q && !depth) { if (cur.trim()) out.push({ s: cur.trim(), line: i + 1 }); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push({ s: cur.trim(), line: i + 1 });
  });
  return out;
}

/** does this text look like a Mermaid flowchart (for paste detection)? */
export const isMermaidFlowchart = (text) => /^\s*(%%[^\n]*\n\s*)*(flowchart|graph)(\s+(LR|RL|TB|TD|BT))?\s*(;|\n|$)/i.test(String(text));

/**
 * Parse a Mermaid flowchart. Returns { direction, title, description, nodes: [{id, shape, label, parent}],
 * edges: [{from, to, op, label, end?}], report: [{line, text, reason}] }.
 */
export function parseMermaid(text) {
  const report = [], nodes = new Map(), edges = [], stack = [];
  let direction = 'TB', title = '', description = '', started = false;
  const add = (id, shape, label, line) => {
    const n = nodes.get(id);
    if (n) { if (shape) { n.shape = shape; n.label = label; } return n; }
    const fresh = { id, shape: shape || 'rect', label: label ?? id, parent: stack.at(-1)?.id || null, line };
    nodes.set(id, fresh); return fresh;
  };
  const sts = statements(text);
  for (let i = 0; i < sts.length; i++) {
    const { s, line } = sts[i];
    let m;
    if (!started) {
      if ((m = s.match(/^(flowchart|graph)(?:\s+(LR|RL|TB|TD|BT))?\s*$/i))) { started = true; direction = DIRS[(m[2] || 'TB').toUpperCase()]; continue; }
      report.push({ line, text: s, reason: 'only flowcharts (flowchart or graph) can be imported' });
      if (/^(sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph)/.test(s)) return { direction, title, description, nodes: [], edges: [], report };
      continue;
    }
    if ((m = s.match(/^accTitle\s*:\s*(.*)$/))) { title = m[1].trim(); continue; }
    if ((m = s.match(/^accDescr\s*:\s*(.*)$/))) { description = m[1].trim(); continue; }
    if (/^accDescr\s*\{/.test(s)) { const parts = [s.replace(/^accDescr\s*\{/, '')]; while (!parts.at(-1).includes('}') && i + 1 < sts.length) parts.push(sts[++i].s); description = parts.join(' ').replace(/\}.*$/, '').trim(); continue; }
    if ((m = s.match(/^subgraph\s+(.+)$/))) {
      const sm = m[1].match(/^([^\s[]+)\s*\[\s*(.*?)\s*\]\s*$/) || m[1].match(/^"(.*)"$/);
      let id, label;
      if (sm && sm.length === 3) { id = mid(sm[1]); label = unlabel(sm[2]); }
      else if (sm) { label = sm[1]; id = mid(label.replace(/\s+/g, '_')); }
      else if (/^[\w-]+$/.test(m[1].trim())) { id = mid(m[1].trim()); label = m[1].trim(); }
      else { label = m[1].trim(); id = mid(label.replace(/\s+/g, '_')); }
      const g = add(id, 'group', label, line); g.shape = 'group'; g.label = label;
      stack.push(g); continue;
    }
    if (/^end$/.test(s)) { if (!stack.length) report.push({ line, text: s, reason: '“end” without a subgraph' }); stack.pop(); continue; }
    if ((m = s.match(/^direction\s+(\w+)/))) { if (stack.length) report.push({ line, text: s, reason: 'a direction inside a subgraph is not kept (the board has one direction)' }); else direction = DIRS[m[1].toUpperCase()] || direction; continue; }
    if (/^(classDef|class|style|linkStyle|click|callback)\b/.test(s)) { report.push({ line, text: s, reason: `${s.split(/\s/)[0]} is styling or interaction; not imported` }); continue; }
    // a chain of node groups and links
    if (!chain(s, line)) report.push({ line, text: s, reason: 'not understood' });
  }
  if (stack.length) report.push({ line: sts.at(-1)?.line || 1, text: 'subgraph', reason: 'a subgraph was not closed with end' });
  return { direction, title, description, nodes: [...nodes.values()], edges, report };

  function chain(s, line) {
    let p = 0; const groups = [], links = [];
    const ws = () => { while (p < s.length && /\s/.test(s[p])) p++; };
    const node = () => {
      ws();
      const im = /^([A-Za-z0-9_](?:\w|-(?![-.>]))*)/.exec(s.slice(p));
      if (!im) return null;
      const raw = im[1]; p += raw.length;
      let shape = null, label = null;
      if (s.slice(p).startsWith('@{')) { const close = s.indexOf('}', p); report.push({ line, text: s.slice(p, close + 1), reason: 'the @{ shape: … } syntax is not imported; drawn as a rectangle' }); p = close < 0 ? s.length : close + 1; }
      for (const [open, cl, kind, note] of SHAPES_IN) {
        if (!s.startsWith(open, p)) continue;
        // the text up to the matching close (quotes protect brackets)
        let q = p + open.length, inq = false;
        for (; q < s.length; q++) { if (s[q] === '"') inq = !inq; if (!inq && s.startsWith(cl, q)) break; }
        if (q >= s.length) continue;
        // [/x\] versus [/x/]: pick the shape whose close sits at the first possible end
        label = unlabel(s.slice(p + open.length, q)); shape = kind; p = q + cl.length;
        if (note) report.push({ line, text: `${raw}${open}…${cl}`, reason: note });
        break;
      }
      if (s.startsWith(':::', p)) { const cm = /^:::([\w-]+)/.exec(s.slice(p)); report.push({ line, text: cm[0], reason: 'class names are not imported' }); p += cm[0].length; }
      const id = mid(raw);
      if (id !== raw && !nodes.has(id)) report.push({ line, text: raw, reason: `id renamed to ${id} (board ids start with a letter or _)` });
      return add(id, shape, label, line);
    };
    const group = () => { const g = []; for (;;) { const n = node(); if (!n) return g.length ? g : null; g.push(n); ws(); if (s[p] === '&') { p++; continue; } return g; } };
    const link = () => {
      ws(); const rest = s.slice(p); let m;
      // a -- text --> b, a == text ==> b, a -. text .-> b
      if ((m = /^(<?)(--|==|-\.)\s+(.+?)\s+(-{2,}|={2,}|\.-+)([>ox]?)/.exec(rest)) && !/^[-=.]/.test(m[3])) { p += m[0].length; return { kind: m[2] === '-.' ? 'dotted' : m[2] === '==' ? 'thick' : 'solid', start: m[1], end: m[5], label: unlabel(m[3]), raw: m[0] }; }
      if ((m = /^(<?)(-{2,}|={2,}|-\.+-|~{3,})([>ox]?)(?:\|([^|]*)\|)?/.exec(rest))) { p += m[0].length; return { kind: m[2].startsWith('~') ? 'invisible' : m[2].includes('.') ? 'dotted' : m[2].startsWith('=') ? 'thick' : 'solid', start: m[1], end: m[3], label: m[4] != null ? unlabel(m[4]) : '', raw: m[0] }; }
      return null;
    };
    const g0 = group(); if (!g0) return false;
    groups.push(g0);
    for (;;) { const l = link(); if (!l) break; const g = group(); if (!g) return false; links.push(l); groups.push(g); }
    ws(); if (p < s.length) return false;
    links.forEach((l, k) => {
      for (const a of groups[k]) for (const b of groups[k + 1]) {
        const e = { from: a.id, to: b.id, label: l.label, line };
        const both = l.start === '<' && l.end === '>';
        if (l.kind === 'invisible') { report.push({ line, text: l.raw, reason: 'an invisible link is drawn as a dashed line' }); e.op = '..'; }
        else if (both) e.op = '<->';
        else if (l.kind === 'dotted') e.op = l.end === '>' ? '-->' : '..';
        else e.op = l.end === '>' ? '->' : '--';
        if (l.kind === 'thick') report.push({ line, text: l.raw, reason: 'a thick link is drawn with a normal line' });
        if (l.end === 'o') e.end = 'circle';
        if (l.end === 'x') report.push({ line, text: l.raw, reason: 'a cross end is drawn without an arrowhead' });
        if (l.start === '<' && !both) report.push({ line, text: l.raw, reason: 'a start arrowhead without an end one is drawn as both ends' });
        if (l.start === '<' && !both) e.op = '<->';
        edges.push(e);
      }
    });
    return true;
  }
}

/** a board model (code only, every shape auto) from a parsed Mermaid flowchart */
export function mermaidToModel(parsed) {
  const nodes = parsed.nodes.map((n) => ({ id: n.id, kind: n.shape, shape: n.shape, label: n.label, parent: n.parent, tags: [], data: {}, body: [], x: null, y: null, w: 0, h: 0, sized: false, auto: true, style: {}, locked: false, codeStyle: {}, src: { code: null, view: null } }));
  let k = 0;
  const edges = parsed.edges.map((e) => { const kind = ARROWS[e.op]; return { key: `#mm${++k}`, id: null, from: e.from, fromPort: null, to: e.to, toPort: null, op: e.op, label: e.label || '', tags: [], data: {}, line: kind.line, start: kind.start || null, end: e.end || kind.end || null, style: {}, codeStyle: {}, via: null, src: { code: null, view: null } }; });
  return { nodes, edges };
}

/** a new .board.md text from Mermaid source: { text, report } */
export function boardFromMermaid(source, { title = '' } = {}) {
  const parsed = parseMermaid(source);
  const fm = `---\nboard: { version: 1, direction: ${parsed.direction} }\n---\n\n`;
  const head = `${fm}# ${title || parsed.title || 'Imported diagram'}\n\n${parsed.description ? parsed.description + '\n\n' : ''}`;
  const doc = parseBoardDoc(head + '```board\n```\n');
  const model = { ...boardModel(doc), ...mermaidToModel(parsed), mode: 'split' };
  return { text: writeBoardDoc(doc, model), report: parsed.report, parsed };
}

/**
 * Operations that make an existing board's code match an imported Mermaid diagram, merging by id: shapes with the same
 * id keep their position and style, new ones arrive auto. With replace: true, code elements missing from the import go.
 */
export function mergeOpsFromMermaid(model, parsed, { replace = false } = {}) {
  const ops = [];
  const have = new Map(model.nodes.map((n) => [n.id, n]));
  // parents first, so `in` can point at them
  const order = [...parsed.nodes].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
  for (const n of order) {
    const h = have.get(n.id);
    if (!h) ops.push({ op: 'add', id: n.id, kind: n.shape, label: n.label, ...(n.parent ? { in: n.parent } : {}) });
    else if (h.shape !== n.shape || h.label !== n.label || (h.parent || null) !== (n.parent || null)) ops.push({ op: 'update', id: n.id, ...(h.shape !== n.shape ? { kind: n.shape } : {}), ...(h.label !== n.label ? { label: n.label } : {}), ...((h.parent || null) !== (n.parent || null) ? { in: n.parent } : {}) });
  }
  const sig = (e) => `${e.from} ${e.to}`;
  const pool = new Map(); for (const e of model.edges) (pool.get(sig(e)) || pool.set(sig(e), []).get(sig(e))).push(e);
  for (const e of parsed.edges) {
    const list = pool.get(sig(e)); const ex = list?.shift();
    if (!ex) ops.push({ op: 'connect', from: e.from, to: e.to, arrow: e.op, ...(e.label ? { label: e.label } : {}) });
    else if (ex.op !== e.op || (ex.label || '') !== (e.label || '')) ops.push({ op: 'update_connector', id: ex.id || ex.key, ...(ex.op !== e.op ? { arrow: e.op } : {}), ...((ex.label || '') !== (e.label || '') ? { label: e.label || '' } : {}) });
  }
  if (replace) {
    for (const list of pool.values()) for (const e of list) ops.push({ op: 'disconnect', id: e.id || e.key });
    const keep = new Set(parsed.nodes.map((n) => n.id));
    const gone = model.nodes.filter((n) => !keep.has(n.id) && !n.implicit).map((n) => n.id);
    if (gone.length) ops.push({ op: 'remove', ids: gone });
  }
  return ops;
}

/* ---------- export ---------- */
const OPS_OUT = { '->': ['-->'], '-->': ['-.->'], '--': ['---'], '..': ['-.-'], '<->': ['<-->'], '-|>': ['-->', 'inheritance drawn as a plain arrow'], '..|>': ['-.->', 'realization drawn as a dotted arrow'], '*--': ['---', 'composition drawn as a plain line'], 'o--': ['---', 'aggregation drawn as a plain line'], '..>': ['-.->'] };
const outLabel = (s) => `"${String(s).replace(/"/g, '#quot;').replace(/\n/g, '<br>')}"`;
const outId = (id) => { const s = id.replace(/-/g, '_'); return s === 'end' ? 'end_' : s; };
/** Mermaid flowchart text from a board model: { text, warnings } (the view is never part of it) */
export function boardToMermaid(model, { direction } = {}) {
  const warnings = [];
  const dir = direction || model.settings?.direction || 'LR';
  const lines = [`flowchart ${dir === 'TB' ? 'TB' : dir}`];
  if (model.title) lines.push(`  accTitle: ${model.title.replace(/\n/g, ' ')}`);
  if (model.description) lines.push(`  accDescr: ${model.description.replace(/\n/g, ' ')}`);
  const ids = new Map(); const taken = new Set();
  for (const n of model.nodes) { let o = outId(n.id); while (taken.has(o) && o !== n.id) o += '_'; taken.add(o); ids.set(n.id, o); if (o !== n.id) warnings.push(`id ${n.id} written as ${o}`); }
  const kids = new Map(); for (const n of model.nodes) { const p = n.parent && model.nodes.some((q) => q.id === n.parent) ? n.parent : null; (kids.get(p) || kids.set(p, []).get(p)).push(n); }
  const write = (n, ind) => {
    if (CONTAINERS.includes(n.shape) || kids.has(n.id)) {
      lines.push(`${ind}subgraph ${ids.get(n.id)} [${outLabel(n.label)}]`);
      for (const c of kids.get(n.id) || []) write(c, ind + '  ');
      lines.push(`${ind}end`);
      return;
    }
    const sh = SHAPES_OUT[n.shape];
    if (!sh) warnings.push(`${n.id}: ${n.shape} drawn as a rectangle`);
    const [o, c] = sh || ['[', ']'];
    lines.push(`${ind}${ids.get(n.id)}${o}${outLabel(n.label)}${c}`);
    if (n.body?.length) warnings.push(`${n.id}: the members of a ${n.shape} are not exported`);
  };
  for (const n of kids.get(null) || []) write(n, '  ');
  for (const e of model.edges) {
    let [arrow, note] = OPS_OUT[e.op] || ['---', `${e.op} drawn as a line`];
    const k = ARROWS[e.op] || {};
    if (e.line !== k.line || (e.start || null) !== (k.start || null) || (e.end || null) !== (k.end || null)) { arrow = e.line === 'solid' ? (e.end ? '-->' : '---') : (e.end ? '-.->' : '-.-'); if (e.end === 'circle') arrow = arrow.replace(/>$/, 'o'); note = note || 'custom line ends simplified'; }
    if (note) warnings.push(`${e.from} ${e.op} ${e.to}: ${note}`);
    lines.push(`  ${ids.get(e.from) || outId(e.from)} ${arrow}${e.label ? `|${outLabel(e.label)}|` : ''} ${ids.get(e.to) || outId(e.to)}`);
  }
  if (model.nodes.some((n) => !n.auto) || model.edges.some((e) => Object.keys(e.style || {}).length)) warnings.unshift('positions and styles (the view) are not part of Mermaid and were dropped');
  return { text: lines.join('\n') + '\n', warnings };
}
