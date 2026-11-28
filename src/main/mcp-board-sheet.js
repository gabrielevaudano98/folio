// Folio MCP — structured tools for boards and sheets, so an assistant changes one shape or one cell instead of rewriting
// the file. Boards are addressed by shape and connector id; every board write goes through board-ops (one transactional
// batch) and the line-preserving writer, so only the lines of the elements that changed are touched. Sheets are
// addressed by sheet name and A1 address.
import { z } from 'zod';
import { createPatch } from 'diff';
import { SHAPES, ARROWS, LIBRARY, CONTAINERS, LAYOUT_ENGINE, defaultSize, autoLayout } from '../renderer/board-core.js';
import { parseBoardDoc, boardModel, writeBoardDoc, revisionOf } from '../renderer/board-doc.js';
import { applyOps, summarize, makeId, BoardOpError, OP_NAMES } from '../renderer/board-ops.js';
import { boardIssues, describeBoard, findShapes } from '../renderer/board-lint.js';
import { renderBoardSvg, sourceFromSvg } from '../renderer/board-render.js';
import { parseMermaid, boardFromMermaid, mergeOpsFromMermaid, boardToMermaid } from '../renderer/board-mermaid.js';
import { parseWorkbook, serializeWorkbook, parseAddr, addr } from '../renderer/sheet-core.js';

const MAX_ROWS = 5000, MAX_COLS = 200; // a stray address like XFD1048576 must not allocate a million rows
const ro = { readOnlyHint: true, openWorldHint: false };
const rw = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const bpath = z.string().describe('Path of a .board.md note');
const spath = z.string().describe('Path of a .sheet.md note');
const sid = z.string().regex(/^[A-Za-z_][\w-]*$/).describe('Shape id (letters, digits, _ and -; starts with a letter or _)');
const style = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional();
const data = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('Key/value data (owner, status, link…); null removes a key');
const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const port = z.enum(['top', 'right', 'bottom', 'left']);
const baseRev = z.string().optional().describe('The revision returned by your last read or write; if the board changed since, nothing is written and the changes are listed');
const force = z.boolean().optional().describe('Also move, resize or remove locked shapes');
const tags = z.array(z.string()).optional();

export const REFERENCE = `board-md (Folio .board.md) for assistants

A board is one \`\`\`board block (what the diagram says) and, after it, an optional <!-- board-view --> comment (where things sit and how they look). You never need coordinates: a shape without a position is placed by auto layout when drawn.

CODE (one element per line)
  id: kind "Label" in parent #tag {key: value; other: value}
    id: letters, digits, - and _, starting with a letter or _; unique on the board.
    kind: rect (default) rounded ellipse circle diamond terminator parallelogram cylinder document note class table actor component server queue browser group swimlane frame package … (list_shape_kinds)
    in parent: containment; the parent is usually a group, swimlane, frame or package.
    #tags and {data} are free (owner, status, link…). class, interface, table and note take body lines between [ and ].
  a -> b "label" =id          connector; =id names it (needed to style it or address it later)
  a -> b, c                   fan-out: two connectors
  a -> b -> c                 chain
  a.right -> b.left           pick the sides
  operators: -> arrow  --> dashed arrow  -- line  .. dashed line  <-> both ends  -|> inheritance  ..|> realization  *-- composition  o-- aggregation  ..> dependency
VIEW (by id, one line each, line order = drawing order)
  api @400,100 150x70 {fill: #eee} locked     e1 {route: curved} from=right to=left     #critical {stroke: #555}

TOOLS
apply_board_ops {path, ops, dry_run?, base_revision?, force?}: one batch, all or nothing; later ops may use ids made earlier. Ops:
  {"op":"add","id":"api","kind":"component","label":"Orders API","in":"backend","tags":["critical"],"data":{"owner":"payments"}}
  {"op":"update","id":"api","label":"…","kind":"…","in":"…","data":{"status":null},"style":{"fill":"#eee"},"x":10,"y":20,"locked":true}
  {"op":"remove","id":"api"}   {"op":"connect","from":"a","to":"b","arrow":"->","label":"…","id":"e1"}
  {"op":"update_connector","id":"e1","label":"…","arrow":"-->","style":{"route":"curved"}}  (or "from"+"to" instead of id)
  {"op":"disconnect","from":"a","to":"b"}   {"op":"move","id":"a","x":0,"y":0}   {"op":"move","ids":["a","b"],"dx":40,"dy":0}
  {"op":"resize","id":"a","w":160,"h":80}  {"op":"set_parent","id":"a","parent":"g"}  {"op":"lock","ids":["a"]}
  {"op":"front","ids":["a"]}  {"op":"back","ids":["a"]}  {"op":"unpin","ids":["a"]}  {"op":"layout","dir":"LR"}
create_flow: steps, lanes and transitions in, a laid-out board out.  describe_board: outline.  get_board: detail concise|full.
find_shapes, get_board_issues (lint), render_board (svg or text), import_diagram (Mermaid), export_board (mermaid, svg).
Each write returns created ids, the changes, new issues and a revision; pass it as base_revision next time.

EXAMPLE 1, a flowchart in one call
apply_board_ops {"path":"Signup.board.md","ops":[
 {"op":"add","id":"start","kind":"terminator","label":"Start"},
 {"op":"add","id":"form","label":"Fill in the form"},
 {"op":"add","id":"ok","kind":"diamond","label":"Valid?"},
 {"op":"add","id":"done","kind":"terminator","label":"Account created"},
 {"op":"connect","from":"start","to":"form"},{"op":"connect","from":"form","to":"ok"},
 {"op":"connect","from":"ok","to":"done","label":"yes"},{"op":"connect","from":"ok","to":"form","label":"no"}]}

EXAMPLE 2, containers
 {"op":"add","id":"backend","kind":"group","label":"Backend"},
 {"op":"add","id":"api","kind":"component","label":"Orders API","in":"backend"},
 {"op":"add","id":"db","kind":"cylinder","label":"Orders DB","in":"backend"},
 {"op":"connect","from":"api","to":"db","label":"SQL"}

EXAMPLE 3, what the file then holds
\`\`\`board
backend: group "Backend"
api: component "Orders API" in backend
db: cylinder "Orders DB" in backend
api -> db "SQL"
\`\`\`

EXAMPLE 4, one change, one line
{"op":"update","id":"ok","label":"Email valid?"} rewrites only the line of ok.`;

export const BOARD_TOOLS = [
  { name: 'get_board_reference', title: 'Board reference', write: false, annotations: ro,
    description: 'The board-md grammar, the apply_board_ops operations and four worked examples, in under 1,500 tokens. Read it once before building or editing boards.',
    input: {} },
  { name: 'get_board', title: 'Get board', write: false, annotations: ro,
    description: 'Read a .board.md note. detail "full" (default): shapes with id, kind, label, container, tags, data, position, size, style, lock; connectors with id, ends, operator, label, style; plus unreadable lines, warnings and the revision. detail "concise": the same without positions and styles. Scope it with ids, tag, or around (an id and its neighbours, depth hops).',
    input: { path: bpath, detail: z.enum(['concise', 'full']).optional(), ids: z.array(z.string()).optional(), tag: z.string().optional(), around: z.string().optional(), depth: z.number().int().min(1).max(5).optional() } },
  { name: 'describe_board', title: 'Describe board', write: false, annotations: ro,
    description: 'A compact outline of a board: ids, kinds, labels, containment, tags, data and connectors, without positions or styling. Much smaller than get_board on large boards.',
    input: { path: bpath } },
  { name: 'find_shapes', title: 'Find shapes', write: false, annotations: ro,
    description: 'Shapes matching every filter given: text (in id, label, body or data values), kind, tag, data (a key, or {key: value}), in (inside a container, at any depth).',
    input: { path: bpath, text: z.string().optional(), kind: z.string().optional(), tag: z.string().optional(), data: z.union([z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))]).optional(), in: z.string().optional() } },
  { name: 'list_shape_kinds', title: 'List shape kinds', write: false, annotations: ro,
    description: 'The shape kinds a board can use, by library (general, flowchart, UML, entity relation, architecture, containers), and the connector operators. query filters by name.',
    input: { query: z.string().optional() } },
  { name: 'get_board_issues', title: 'Board issues', write: false, annotations: ro,
    description: 'Lint a board: unreadable lines, unknown kinds, view lines for missing ids, duplicate or self connectors, shapes named only by connectors, unconnected shapes, decisions with fewer than two exits, shapes outside their container; layout checks (overlaps, labels that do not fit, crossings, shapes no path from the start reaches); review basics (missing title, unlabeled connectors).',
    input: { path: bpath, layout: z.boolean().optional().describe('Include layout checks (default true)') } },
  { name: 'render_board', title: 'Render board', write: false, annotations: ro,
    description: 'Draw a board to check your work: format "svg" returns an SVG image as text (light or dark theme; the whole board, some ids, or a region; scale; capped at maxSize pixels); format "text" returns every shape with its drawn box and every connector, for checking a layout without an image.',
    input: { path: bpath, format: z.enum(['svg', 'text']).optional(), ids: z.array(z.string()).optional(), region: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).optional(), scale: z.number().min(0.1).max(4).optional(), maxSize: z.number().int().min(64).max(4096).optional(), theme: z.enum(['light', 'dark']).optional() } },
  { name: 'export_board', title: 'Export board', write: false, annotations: ro,
    description: 'Export a board as text: "mermaid" (a flowchart; only the code, positions and styles are dropped and listed in warnings) or "svg" (a standalone image with the board source embedded, so opening it in Folio gives the board back).',
    input: { path: bpath, format: z.enum(['mermaid', 'svg']), theme: z.enum(['light', 'dark']).optional() } },
  { name: 'apply_board_ops', title: 'Apply board operations', write: true, annotations: { ...rw, destructiveHint: true },
    description: 'Change a board with a batch of operations on ids (add, update, remove, connect, update_connector, disconnect, move, resize, set_parent, lock, set_data, front, back, unpin, layout); see get_board_reference. All or nothing: if any op fails nothing is written and the error names the op and the nearest valid ids. Later ops can refer to ids created earlier in the batch. dry_run returns the diff and issues without writing. One batch is one change, one undo step and one entry in the review. The board file is created when it does not exist.',
    input: { path: bpath, ops: z.array(z.object({ op: z.enum(OP_NAMES.filter((o) => o !== 'restore')) }).passthrough()).min(1).max(1000), dry_run: z.boolean().optional(), base_revision: baseRev, force, title: z.string().max(200).optional().describe('Title for a new board') } },
  { name: 'create_flow', title: 'Create flow', write: true, annotations: rw,
    description: 'Create a laid-out flowchart from steps, optional lanes and transitions; you give no coordinates. steps: [{id?, label, kind? (start, end, process, decision, io, document, data, subprocess, or any shape kind), lane?}]; lanes: names, drawn as swimlanes in order; transitions: [{from, to, label?}]. Writes a new board (replace: true to overwrite an existing one).',
    input: { path: bpath, title: z.string().max(200).optional(), direction: z.enum(['LR', 'TB']).optional(), steps: z.array(z.object({ id: z.string().regex(/^[A-Za-z_][\w-]*$/).optional(), label: z.string().max(500), kind: z.string().optional(), lane: z.string().optional() })).min(1).max(500), lanes: z.array(z.string().max(100)).max(30).optional(), transitions: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().max(200).optional() })).max(2000).optional(), replace: z.boolean().optional() } },
  { name: 'import_diagram', title: 'Import diagram', write: true, annotations: rw,
    description: 'Import a Mermaid flowchart (or an SVG exported by Folio, which carries its board) into a board. mode "new" writes a new board; "merge" (default when the board exists) updates shapes and connectors with the same ids and adds the rest, keeping positions and styles; "replace" also removes code elements missing from the import. Returns a fidelity report with one line per construct that could not be mapped.',
    input: { path: bpath, source: z.string().max(500000), format: z.enum(['mermaid', 'svg']).optional(), mode: z.enum(['new', 'merge', 'replace']).optional(), base_revision: baseRev } },
  { name: 'add_shape', title: 'Add board shape', write: true, annotations: rw,
    description: `Add a shape to a board. shape: ${SHAPES.join(', ')}. Leave x and y out to have the shape placed by auto layout. body lines are used by class, interface, table and note shapes. in puts it inside a container.`,
    input: { path: bpath, id: sid, shape: z.string().optional().describe('Defaults to rect'), label: z.string().optional(), in: z.string().optional(), tags, data, x: z.number().optional(), y: z.number().optional(), w: z.number().positive().optional(), h: z.number().positive().optional(), style, body: z.array(z.string().max(500)).max(200).optional(), base_revision: baseRev } },
  { name: 'update_shape', title: 'Update board shape', write: true, annotations: rw,
    description: 'Change a shape: label, position, size, shape type, container, tags, data, body, lock, or style (a value sets a style key, null removes it). Give only what changes. A locked shape does not move unless force is true.',
    input: { path: bpath, id: sid, label: z.string().optional(), shape: z.string().optional(), in: z.string().nullable().optional(), tags, data, x: z.number().optional(), y: z.number().optional(), w: z.number().positive().optional(), h: z.number().positive().optional(), style, body: z.array(z.string()).optional(), locked: z.boolean().optional(), base_revision: baseRev, force } },
  { name: 'remove_shape', title: 'Remove board shape', write: true, annotations: { ...rw, destructiveHint: true },
    description: 'Remove a shape and every connector attached to it. Shapes inside it stay, outside any container.',
    input: { path: bpath, id: sid, base_revision: baseRev, force } },
  { name: 'connect', title: 'Connect board shapes', write: true, annotations: rw,
    description: `Add a connector between two shapes that exist on the board. op: ${Object.keys(ARROWS).join('  ')}. fromPort and toPort pick a side (top, right, bottom, left). id names the connector (=id in the file).`,
    input: { path: bpath, from: sid, to: sid, op: z.enum(Object.keys(ARROWS)).optional().describe('Defaults to ->'), label: z.string().optional(), id: sid.optional(), fromPort: port.optional(), toPort: port.optional(), style, base_revision: baseRev } },
  { name: 'update_connector', title: 'Update board connector', write: true, annotations: rw,
    description: 'Change a connector, named by id or by from and to (index picks one of several): label, operator, ports, style (route, stroke, width), data, reverse, or give it an id.',
    input: { path: bpath, id: z.string().optional(), from: z.string().optional(), to: z.string().optional(), index: z.number().int().min(0).optional(), label: z.string().optional(), op: z.enum(Object.keys(ARROWS)).optional(), fromPort: port.nullable().optional(), toPort: port.nullable().optional(), style, data, reverse: z.boolean().optional(), new_id: z.string().optional(), base_revision: baseRev } },
  { name: 'disconnect', title: 'Remove board connector', write: true, annotations: { ...rw, destructiveHint: true },
    description: 'Remove the connector(s) from one shape to another, or one connector by id.',
    input: { path: bpath, from: sid.optional(), to: sid.optional(), id: z.string().optional(), base_revision: baseRev } },
  { name: 'auto_layout_board', title: 'Auto-layout board', write: true, annotations: rw,
    description: 'Lay out a board with dagre and pin the result, so a later library upgrade never moves it. By default only the shapes that have no position yet are placed (to the right of the rest) and pinned; all: true lays out everything and records the engine and its version. Locked shapes stay unless force is true.',
    input: { path: bpath, dir: z.enum(['LR', 'TB', 'RL', 'BT']).optional(), all: z.boolean().optional(), base_revision: baseRev, force } },
];
export const SHEET_TOOLS = [
  { name: 'set_cells', title: 'Set sheet cells', write: true, annotations: rw,
    description: 'Set cells of a .sheet.md sheet by A1 address, e.g. {"A1": "Name", "B2": 12.5, "C2": "=B2*2"}. Text starting with = is a formula; null or "" clears a cell. The grid grows as needed. Other cells and other sheets are untouched.',
    input: { path: spath, sheet: z.string().optional().describe('Sheet name; the first sheet when omitted'), cells: z.record(z.string(), cellValue) } },
  { name: 'add_sheet', title: 'Add sheet', write: true, annotations: rw,
    description: 'Add a sheet (a table under a ## heading) to a .sheet.md note, creating the note when it does not exist. rows[0] is the header row.',
    input: { path: spath, name: z.string().min(1).max(60), rows: z.array(z.array(cellValue).max(MAX_COLS)).max(MAX_ROWS).optional() } },
];
export const BOARD_SHEET_TOOLS = [...BOARD_TOOLS, ...SHEET_TOOLS];

const NAMES = new Set(BOARD_SHEET_TOOLS.map((t) => t.name));
export const isBoardSheetTool = (name) => NAMES.has(name);

const need = (p, re, what) => { if (!re.test(p)) throw new Error(`This tool works on ${what}.`); };
// a CRLF sheet is edited as LF and written back as CRLF, so untouched lines keep their endings (boards keep them natively)
const lf = (t) => ({ text: t.replace(/\r\n/g, '\n'), back: (x) => (t.includes('\r\n') ? x.replace(/\r?\n/g, '\r\n') : x) });
const cellText = (v) => (v === null || v === undefined ? '' : String(v));

/* ---------- boards ---------- */
// texts this process has seen, by revision, so a stale write can list what changed since the client read the board
const seen = new Map();
function remember(text) { const r = revisionOf(text); seen.delete(r); seen.set(r, text); while (seen.size > 64) seen.delete(seen.keys().next().value); return r; }
async function readBoard(notes, path, { create = false } = {}) {
  need(path, /\.board\.md$/i, '.board.md notes');
  let text;
  try { text = await notes.read(path); } catch (e) { if (!create) throw e; text = null; }
  return text;
}
const issueKey = (i) => `${i.code}|${i.message}`;
function lineStats(a, b) {
  const x = a.split('\n'), y = b.split('\n'); let s = 0; while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0; while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  return { removed: x.length - s - e, added: y.length - s - e };
}
function hint(after, created, issues) {
  const auto = after.nodes.filter((n) => n.auto && created.includes(n.id)).length;
  const parts = [];
  if (issues.length) parts.push(`${issues.length} new issue${issues.length === 1 ? '' : 's'} listed in issues; get_board_issues shows them all`);
  if (auto) parts.push(`${auto} new shape${auto === 1 ? ' is' : 's are'} placed by auto layout when drawn; render_board shows the picture, auto_layout_board pins a layout`);
  return parts.join('. ') || 'render_board shows the result';
}

/**
 * Run a batch on a board and write it: transactional, line-preserving, guarded by base_revision.
 * `make(model, doc)` returns the ops (it may throw for input errors).
 */
async function boardWrite(notes, a, wrote, verb, make, { create = false, title = '', dryRun = false, force: forceOps = false } = {}) {
  let text = await readBoard(notes, a.path, { create });
  const fresh = text == null;
  if (fresh) text = `# ${title || a.path.split('/').pop().replace(/\.board\.md$/i, '')}\n\n\`\`\`board\n\`\`\`\n`;
  if (a.base_revision && !fresh) {
    const cur = revisionOf(text);
    if (cur !== a.base_revision) {
      const base = seen.get(a.base_revision);
      const changes = base ? summarize(boardModel(parseBoardDoc(base)), boardModel(parseBoardDoc(text))) : null;
      remember(text);
      throw new Error(`Conflict: ${a.path} changed since revision ${a.base_revision} (now ${cur}); nothing was written.${changes ? ` Changed since then: ${JSON.stringify(changes)}.` : ' Read the board again.'} Re-read it and retry with base_revision ${cur}.`);
    }
  }
  const doc = parseBoardDoc(text);
  if (doc.readOnly) throw new Error(`${a.path} was written by a newer version of Folio (format version ${doc.settings.version}); it is read-only here.`);
  if (doc.bo >= 0 && !doc.hasBlock) throw new Error(`${a.path} has a board block without its closing \`\`\`; fix it with edit_note first.`);
  const before = boardModel(doc);
  let res;
  try { res = applyOps(before, await make(before, doc), { force: forceOps || !!a.force }); }
  catch (e) { if (e instanceof BoardOpError) throw new Error(e.message); throw e; }
  const out = writeBoardDoc(doc, res.model);
  const afterDoc = parseBoardDoc(out), after = boardModel(afterDoc);
  const was = new Set(boardIssues(doc, before).map(issueKey));
  const issues = boardIssues(afterDoc, after).filter((i) => !was.has(issueKey(i)));
  const result = { changes: summarize(before, after), created: res.created, lines: lineStats(text, out), issues, next: hint(after, res.created, issues) };
  if (doc.errors.some((e) => !e.soft)) result.kept = `${doc.errors.filter((e) => !e.soft).length} unreadable line(s) were kept as they are`;
  if (dryRun) return { dry_run: true, revision: revisionOf(text), wouldWrite: out !== text, diff: out === text ? '' : createPatch(a.path, text, out, 'now', 'after', { context: 2 }), ...result };
  if (out === text && !fresh) return { message: `Nothing changed in ${a.path}.`, revision: remember(text), ...result };
  const message = await wrote(await notes.write(a.path, out, fresh ? { overwrite: false } : undefined), verb);
  return { message, revision: remember(out), ...result };
}
const single = (fn) => async (...args) => { try { return await fn(...args); } catch (e) { throw new Error(String(e.message).replace(/^op \d+ \([\w_]+\): /, '')); } };
function scopeModel(model, a) {
  let keep = null;
  if (a.ids?.length) keep = new Set(a.ids);
  if (a.tag) { const t = a.tag.replace(/^#/, ''); keep = new Set(model.nodes.filter((n) => (n.tags || []).includes(t)).map((n) => n.id)); }
  if (a.around) {
    keep = new Set([a.around]);
    for (let d = 0; d < (a.depth || 1); d++) for (const e of model.edges) { if (keep.has(e.from)) keep.add(e.to); else if (keep.has(e.to)) keep.add(e.from); }
  }
  if (!keep) return model;
  return { ...model, nodes: model.nodes.filter((n) => keep.has(n.id)), edges: model.edges.filter((e) => keep.has(e.from) || keep.has(e.to)) };
}
const KIND_ALIASES = { start: 'terminator', end: 'terminator', process: 'rect', step: 'rect', decision: 'diamond', io: 'parallelogram', input: 'parallelogram', output: 'parallelogram', data: 'cylinder', database: 'cylinder', subprocess: 'predefined' };
/** create_flow: steps placed by dagre for order, then by lane; lanes become swimlanes around their steps */
function flowOps(a) {
  const dir = a.direction || 'LR';
  const probe = { nodes: [], edges: [] };
  const ids = new Map();
  const steps = a.steps.map((s) => {
    const kind = KIND_ALIASES[s.kind] || s.kind || 'rect';
    const id = s.id || makeId(probe, s.label);
    if (ids.has(id)) throw new Error(`Two steps have the id ${id}`);
    ids.set(id, s); probe.nodes.push({ id });
    return { ...s, id, kind };
  });
  const lanes = [...(a.lanes || [])];
  for (const s of steps) if (s.lane && !lanes.includes(s.lane)) lanes.push(s.lane);
  const byLabel = new Map(steps.map((s) => [s.label.toLowerCase(), s.id]));
  const ref = (x) => { if (ids.has(x)) return x; const l = byLabel.get(String(x).toLowerCase()); if (l) return l; throw new Error(`A transition names "${x}", which is not a step id or label`); };
  const trans = (a.transitions || []).map((t) => ({ ...t, from: ref(t.from), to: ref(t.to) }));
  // order with dagre, ignoring lanes
  const model = { nodes: steps.map((s) => { const n = { id: s.id, shape: SHAPES.includes(s.kind) ? s.kind : 'rect', label: s.label, body: [], style: {}, x: null, y: null }; [n.w, n.h] = sizeOf(n.shape); return n; }), edges: trans.map((t) => ({ from: t.from, to: t.to })) };
  autoLayout(model, { dir, all: true });
  const H = dir === 'LR'; // lanes are rows when the flow runs left to right, columns when it runs top to bottom
  const ops = [];
  if (!lanes.length) {
    for (const n of model.nodes) ops.push({ op: 'add', id: n.id, kind: n.shape, label: n.label, x: n.x, y: n.y });
  } else {
    const main = (n) => (H ? n.x : n.y), cross = (n) => (H ? n.h : n.w), span = (n) => (H ? n.w : n.h);
    const laneOf = (id) => steps.find((s) => s.id === id).lane || lanes[0];
    const gap = 30, pad = 30, head = 50;
    let offset = 40;
    const minMain = Math.min(...model.nodes.map(main)), maxMain = Math.max(...model.nodes.map((n) => main(n) + span(n)));
    const laneBoxes = [];
    for (const lane of lanes) {
      const ns = model.nodes.filter((n) => laneOf(n.id) === lane).sort((p, q) => main(p) - main(q));
      // rows inside the lane: a step goes in the first row where it does not overlap along the flow
      const rows = [];
      for (const n of ns) { let r = rows.findIndex((row) => row.every((o) => main(o) + span(o) + 20 <= main(n) || main(n) + span(n) + 20 <= main(o))); if (r < 0) { rows.push([]); r = rows.length - 1; } rows[r].push(n); n._row = r; }
      const rowSize = Math.max(60, ...ns.map(cross));
      const size = pad * 2 + Math.max(1, rows.length) * rowSize + Math.max(0, rows.length - 1) * gap;
      for (const n of ns) { const c = offset + pad + n._row * (rowSize + gap) + (rowSize - cross(n)) / 2; if (H) n.y = Math.round(c / 10) * 10; else n.x = Math.round(c / 10) * 10; }
      laneBoxes.push({ lane, offset, size });
      offset += size;
    }
    laneBoxes.forEach((b, i) => {
      const id = makeId({ nodes: [...probe.nodes, ...laneBoxes.slice(0, i).map((x) => ({ id: x.id }))], edges: [] }, 'lane-' + b.lane); b.id = id;
      const box = H ? { x: minMain - head - 20, y: b.offset, w: maxMain - minMain + head + 60, h: b.size } : { x: b.offset, y: minMain - head - 20, w: b.size, h: maxMain - minMain + head + 60 };
      ops.push({ op: 'add', id, kind: 'swimlane', label: b.lane, ...box });
    });
    for (const n of model.nodes) ops.push({ op: 'add', id: n.id, kind: n.shape, label: n.label, in: laneBoxes.find((b) => b.lane === laneOf(n.id)).id, x: n.x, y: n.y });
  }
  for (const t of trans) ops.push({ op: 'connect', from: t.from, to: t.to, ...(t.label ? { label: t.label } : {}) });
  return { ops, dir };
}
const sizeOf = (shape) => defaultSize(shape).map((v, i) => v || (i ? 60 : 120));

export async function runBoardSheetTool(notes, name, a, wrote) {
  switch (name) {
    case 'get_board_reference': return REFERENCE;
    case 'list_shape_kinds': {
      const q = a.query?.toLowerCase();
      const libs = LIBRARY.map(([lib, list]) => ({ library: lib, kinds: list.filter(([k, n]) => !q || k.includes(q) || n.toLowerCase().includes(q) || lib.toLowerCase().includes(q)).map(([kind, label]) => ({ kind, label, ...(CONTAINERS.includes(kind) ? { container: true } : {}) })) })).filter((l) => l.kinds.length);
      return { libraries: libs, connectors: Object.entries(ARROWS).map(([op, k]) => ({ op, line: k.line, start: k.start || null, end: k.end || null })) };
    }
    case 'get_board': case 'describe_board': case 'find_shapes': case 'get_board_issues': case 'render_board': case 'export_board': {
      const text = await readBoard(notes, a.path);
      const doc = parseBoardDoc(text), model = boardModel(doc), revision = remember(text);
      if (name === 'describe_board') return describeBoard(model) + `\n(revision ${revision})`;
      if (name === 'find_shapes') return { revision, shapes: findShapes(model, a).map((n) => ({ id: n.id, kind: n.shape, label: n.label, in: n.parent || null, tags: n.tags, data: n.data })) };
      if (name === 'get_board_issues') { const issues = boardIssues(doc, model, { layout: a.layout !== false }); return { revision, count: issues.length, issues }; }
      if (name === 'export_board') {
        if (a.format === 'mermaid') { const r = boardToMermaid(model); return { format: 'mermaid', text: r.text, warnings: r.warnings }; }
        return { format: 'svg', svg: renderBoardSvg(model, { theme: a.theme, source: text, title: doc.title }) };
      }
      const drawn = { ...model, nodes: model.nodes.map((n) => ({ ...n })) }; autoLayout(drawn);
      if (name === 'render_board') {
        if (a.format === 'text') return { revision, shapes: drawn.nodes.filter((n) => !a.ids || a.ids.includes(n.id)).map((n) => ({ id: n.id, kind: n.shape, label: n.label, box: [n.x, n.y, n.w, n.h], auto: !!n.auto, in: n.parent || null })), connectors: model.edges.map((e) => `${e.from} ${e.op} ${e.to}${e.label ? ` "${e.label}"` : ''}`) };
        return renderBoardSvg(drawn, { theme: a.theme, ids: a.ids, region: a.region, scale: a.scale, maxSize: a.maxSize || 2048, title: doc.title });
      }
      const scoped = scopeModel(drawn, a);
      const concise = a.detail === 'concise';
      return {
        path: a.path, revision, mode: doc.mode, title: doc.title || undefined, settings: doc.settings,
        shapes: scoped.nodes.map((n) => concise ? { id: n.id, shape: n.shape, label: n.label, ...(n.parent ? { in: n.parent } : {}), ...(n.tags?.length ? { tags: n.tags } : {}), ...(Object.keys(n.data || {}).length ? { data: n.data } : {}) }
          : { id: n.id, shape: n.shape, label: n.label, in: n.parent || null, tags: n.tags, data: n.data, x: n.x, y: n.y, w: n.w, h: n.h, auto: !!n.auto, style: n.style, locked: !!n.locked, body: n.body }),
        connectors: scoped.edges.map((e) => concise ? { from: e.from, to: e.to, op: e.op, ...(e.label ? { label: e.label } : {}), ...(e.id ? { id: e.id } : {}) }
          : { id: e.id, from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort, op: e.op, label: e.label, style: e.style, data: e.data }),
        ...(concise ? {} : { rules: model.rules, notes: model.notes }),
        unreadable: doc.errors, warnings: doc.warnings,
      };
    }
    case 'apply_board_ops': return boardWrite(notes, a, wrote, 'Changed', () => a.ops, { create: true, title: a.title, dryRun: !!a.dry_run });
    case 'create_flow': {
      need(a.path, /\.board\.md$/i, '.board.md notes');
      let exists = true; try { await notes.read(a.path); } catch { exists = false; }
      if (exists && !a.replace) throw new Error(`${a.path} exists; pass replace: true to overwrite it, or use apply_board_ops to add to it.`);
      const { ops, dir } = flowOps(a);
      const fm = `---\nboard: { version: 1, direction: ${dir} }\n---\n\n# ${a.title || a.path.split('/').pop().replace(/\.board\.md$/i, '')}\n\n\`\`\`board\n\`\`\`\n`;
      const doc = parseBoardDoc(fm);
      const res = applyOps(boardModel(doc), ops);
      res.model.layout = { engine: LAYOUT_ENGINE.engine, version: LAYOUT_ENGINE.version, dir };
      const out = writeBoardDoc(doc, res.model);
      const afterDoc = parseBoardDoc(out), issues = boardIssues(afterDoc, boardModel(afterDoc));
      const message = await wrote(await notes.write(a.path, out, exists ? undefined : { overwrite: false }), exists ? 'Replaced' : 'Created');
      return { message, revision: remember(out), created: res.created, issues, next: issues.length ? 'get_board_issues lists the issues' : 'render_board shows the result' };
    }
    case 'import_diagram': {
      need(a.path, /\.board\.md$/i, '.board.md notes');
      let src = a.source, report = [];
      const fmt = a.format || (/<svg[\s>]/.test(src) ? 'svg' : 'mermaid');
      if (fmt === 'svg') { const s = sourceFromSvg(src); if (!s) throw new Error('This SVG has no Folio board inside (only SVGs exported from a Folio board do).'); src = s; }
      let exists = true; try { await notes.read(a.path); } catch { exists = false; }
      const mode = a.mode || (exists ? 'merge' : 'new');
      if (mode === 'new') {
        if (exists) throw new Error(`${a.path} exists; use mode "merge" or "replace", or another path.`);
        let text;
        if (fmt === 'svg') text = src;
        else { const r = boardFromMermaid(src, { title: a.path.split('/').pop().replace(/\.board\.md$/i, '') }); text = r.text; report = r.report; }
        const message = await wrote(await notes.write(a.path, text, { overwrite: false }), 'Imported');
        return { message, revision: remember(text), report, mode };
      }
      const parsed = fmt === 'svg' ? (() => { const m = boardModel(parseBoardDoc(src)); return { nodes: m.nodes.map((n) => ({ id: n.id, shape: n.shape, label: n.label, parent: n.parent })), edges: m.edges.map((e) => ({ from: e.from, to: e.to, op: e.op, label: e.label })), report: [] }; })() : parseMermaid(src);
      report = parsed.report;
      const r = await boardWrite(notes, a, wrote, 'Imported into', (model) => mergeOpsFromMermaid(model, parsed, { replace: mode === 'replace' }));
      return { ...r, report, mode };
    }
    case 'add_shape': return single(boardWrite)(notes, a, wrote, 'Added a shape to', () => [{ op: 'add', id: a.id, kind: a.shape, label: a.label, in: a.in, tags: a.tags, data: a.data, x: a.x, y: a.y, w: a.w, h: a.h, style: a.style, body: a.body }]);
    case 'update_shape': return single(boardWrite)(notes, a, wrote, 'Updated a shape in', (m) => {
      const n = m.nodes.find((x) => x.id === a.id);
      const op = { op: 'update', id: a.id };
      for (const k of ['label', 'tags', 'data', 'style', 'body', 'locked', 'x', 'y', 'w', 'h']) if (a[k] !== undefined) op[k] = a[k];
      if (a.shape) op.kind = a.shape;
      if (a.in !== undefined) op.in = a.in;
      // a shape placed by auto layout that gets only x or only y keeps its drawn value for the other one
      if (n && n.auto && (a.x == null) !== (a.y == null)) { const d = { ...m, nodes: m.nodes.map((q) => ({ ...q })) }; autoLayout(d); const q = d.nodes.find((x) => x.id === a.id); op.x ??= q.x; op.y ??= q.y; }
      return [op];
    });
    case 'remove_shape': return single(boardWrite)(notes, a, wrote, 'Removed a shape from', () => [{ op: 'remove', id: a.id }]);
    case 'connect': return single(boardWrite)(notes, a, wrote, 'Connected shapes in', () => [{ op: 'connect', from: a.from, to: a.to, arrow: a.op || '->', label: a.label, id: a.id, fromPort: a.fromPort, toPort: a.toPort, style: a.style }]);
    case 'update_connector': return single(boardWrite)(notes, a, wrote, 'Updated a connector in', () => [{ op: 'update_connector', id: a.id, from: a.from, to: a.to, index: a.index, label: a.label, arrow: a.op, fromPort: a.fromPort, toPort: a.toPort, style: a.style, data: a.data, reverse: a.reverse, new_id: a.new_id }]);
    case 'disconnect': return single(boardWrite)(notes, a, wrote, 'Removed a connector from', () => [{ op: 'disconnect', id: a.id, from: a.from, to: a.to }]);
    case 'auto_layout_board': return single(boardWrite)(notes, a, wrote, 'Laid out', () => [{ op: 'layout', dir: a.dir || 'LR', scope: a.all ? 'all' : 'auto' }]);
    case 'set_cells': {
      need(a.path, /\.sheet\.md$/i, '.sheet.md notes');
      const { text: src, back } = lf(await notes.read(a.path));
      const blocks = parseWorkbook(src);
      const sheets = blocks.filter((b) => b.type === 'sheet');
      const sh = a.sheet ? sheets.find((b) => b.name.toLowerCase() === a.sheet.toLowerCase()) : sheets[0];
      if (!sh) throw new Error(`No sheet named ${a.sheet}. Sheets: ${sheets.map((b) => b.name).join(', ')}.`);
      for (const [ref, v] of Object.entries(a.cells)) {
        const rc = parseAddr(ref); if (!rc) throw new Error(`"${ref}" is not a cell address like B7.`);
        const [r, c] = rc; if (r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS) throw new Error(`"${ref}" is not a usable cell address (like B7; rows 1 to ${MAX_ROWS}, columns A to ${addr(0, MAX_COLS - 1).replace(/\d+/, '')}).`);
        while (sh.rows.length <= r) sh.rows.push([]);
        const row = sh.rows[r]; while (row.length <= c) row.push('');
        row[c] = cellText(v);
      }
      const width = Math.max(...sh.rows.map((r) => r.length));
      for (const r of sh.rows) while (r.length < width) r.push('');
      return wrote(await notes.write(a.path, back(serializeWorkbook(blocks))), `Set ${Object.keys(a.cells).length} cell${Object.keys(a.cells).length === 1 ? '' : 's'} (${addr(0, 0)}…) in`);
    }
    case 'add_sheet': {
      need(a.path, /\.sheet\.md$/i, '.sheet.md notes');
      if (/[\r\n]/.test(a.name)) throw new Error('A sheet name is one line.');
      a.name = a.name.trim(); if (!a.name) throw new Error('A sheet needs a name.');
      if (a.rows && (a.rows.length > MAX_ROWS || a.rows.some((r) => r.length > MAX_COLS))) throw new Error(`A sheet is limited to ${MAX_ROWS} rows and ${MAX_COLS} columns.`);
      let existing = null; try { existing = await notes.read(a.path); } catch { /* new note */ }
      const { text: src, back } = lf(existing ?? '');
      const blocks = existing == null ? [] : parseWorkbook(src);
      const sheets = blocks.filter((b) => b.type === 'sheet' && !b.fresh);
      if (sheets.some((b) => b.name.toLowerCase() === a.name.toLowerCase())) throw new Error(`A sheet named ${a.name} already exists.`);
      const rows = (a.rows?.length ? a.rows : [['A', 'B', 'C'], ['', '', '']]).map((r) => r.map(cellText));
      const kept = blocks.filter((b) => !b.fresh);
      kept.push({ type: 'sheet', name: a.name, named: true, headingLines: [], rows, align: [], meta: {} });
      return wrote(await notes.write(a.path, back(serializeWorkbook(kept))), 'Added a sheet to');
    }
    default: throw new Error(`Unknown tool ${name}`);
  }
}
