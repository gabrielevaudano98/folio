// Folio MCP — structured tools for boards and sheets, so an assistant changes one shape or one cell
// instead of rewriting the file. Boards are addressed by shape id, sheets by sheet name and A1 address.
import { z } from 'zod';
import { splitBoardDoc, joinBoardDoc, parseBoard, serializeBoard, autoLayout, defaultSize, fitAuto, SHAPES, ARROWS } from '../renderer/board-core.js';
import { parseWorkbook, serializeWorkbook, parseAddr, addr } from '../renderer/sheet-core.js';

const MAX_ROWS = 5000, MAX_COLS = 200; // a stray address like XFD1048576 must not allocate a million rows
const ro = { readOnlyHint: true, openWorldHint: false };
const rw = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const bpath = z.string().describe('Path of a .board.md note');
const spath = z.string().describe('Path of a .sheet.md note');
const sid = z.string().regex(/^[A-Za-z_][\w-]*$/).describe('Shape id (letters, digits, _ and -; starts with a letter or _)');
const style = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional();
const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const BOARD_SHEET_TOOLS = [
  { name: 'get_board', title: 'Get board', write: false, annotations: ro,
    description: 'List the shapes (id, shape, label, position, size, style) and connectors (from, to, operator, label) of a .board.md note, plus lines that could not be read.',
    input: { path: bpath } },
  { name: 'add_shape', title: 'Add board shape', write: true, annotations: rw,
    description: `Add a shape to a board. shape: ${SHAPES.join(', ')}. Leave x and y out to have the shape placed by auto layout. body lines are used by class, interface, table and note shapes.`,
    input: { path: bpath, id: sid, shape: z.string().optional().describe('Defaults to rect'), label: z.string().optional(), x: z.number().optional(), y: z.number().optional(), w: z.number().positive().optional(), h: z.number().positive().optional(), style, body: z.array(z.string().max(500)).max(200).optional() } },
  { name: 'update_shape', title: 'Update board shape', write: true, annotations: rw,
    description: 'Change a shape: label, position, size, shape type, body, or style (a value sets a style key, null removes it). Give only what changes.',
    input: { path: bpath, id: sid, label: z.string().optional(), shape: z.string().optional(), x: z.number().optional(), y: z.number().optional(), w: z.number().positive().optional(), h: z.number().positive().optional(), style, body: z.array(z.string()).optional() } },
  { name: 'remove_shape', title: 'Remove board shape', write: true, annotations: { ...rw, destructiveHint: true },
    description: 'Remove a shape and every connector attached to it.',
    input: { path: bpath, id: sid } },
  { name: 'connect', title: 'Connect board shapes', write: true, annotations: rw,
    description: `Add a connector between two shapes that exist on the board. op: ${Object.keys(ARROWS).join('  ')}. fromPort and toPort pick a side (top, right, bottom, left).`,
    input: { path: bpath, from: sid, to: sid, op: z.enum(Object.keys(ARROWS)).optional().describe('Defaults to ->'), label: z.string().optional(), fromPort: z.enum(['top', 'right', 'bottom', 'left']).optional(), toPort: z.enum(['top', 'right', 'bottom', 'left']).optional(), style } },
  { name: 'disconnect', title: 'Remove board connector', write: true, annotations: { ...rw, destructiveHint: true },
    description: 'Remove the connector(s) from one shape to another.',
    input: { path: bpath, from: sid, to: sid } },
  { name: 'auto_layout_board', title: 'Auto-layout board', write: true, annotations: rw,
    description: 'Place shapes with the dagre layout. By default only shapes without a position are placed (to the right of the rest); all: true re-lays out everything.',
    input: { path: bpath, dir: z.enum(['LR', 'TB', 'RL', 'BT']).optional(), all: z.boolean().optional() } },
  { name: 'set_cells', title: 'Set sheet cells', write: true, annotations: rw,
    description: 'Set cells of a .sheet.md sheet by A1 address, e.g. {"A1": "Name", "B2": 12.5, "C2": "=B2*2"}. Text starting with = is a formula; null or "" clears a cell. The grid grows as needed. Other cells and other sheets are untouched.',
    input: { path: spath, sheet: z.string().optional().describe('Sheet name; the first sheet when omitted'), cells: z.record(z.string(), cellValue) } },
  { name: 'add_sheet', title: 'Add sheet', write: true, annotations: rw,
    description: 'Add a sheet (a table under a ## heading) to a .sheet.md note, creating the note when it does not exist. rows[0] is the header row.',
    input: { path: spath, name: z.string().min(1).max(60), rows: z.array(z.array(cellValue).max(MAX_COLS)).max(MAX_ROWS).optional() } },
];

const NAMES = new Set(BOARD_SHEET_TOOLS.map((t) => t.name));
export const isBoardSheetTool = (name) => NAMES.has(name);

const need = (p, re, what) => { if (!re.test(p)) throw new Error(`This tool works on ${what}.`); };
const bad = /[{};\r\n]/;
const cleanStyle = (target, patch) => { for (const [k, v] of Object.entries(patch || {})) if (bad.test(k) || (typeof v === 'string' && bad.test(v))) throw new Error(`Style "${k}" contains a character that is not allowed ({ } ; or a line break).`); const s = { ...target }; for (const [k, v] of Object.entries(patch || {})) { if (v === null || v === false) delete s[k]; else s[k] = v; } return s; };
const shapeOf = (m, id) => { const n = m.nodes.find((x) => x.id === id); if (!n) throw new Error(`No shape "${id}". Use get_board to see the ids.`); return n; };
// a CRLF file is edited as LF and written back as CRLF, so untouched lines keep their endings
const lf = (t) => ({ text: t.replace(/\r\n/g, '\n'), back: (x) => (t.includes('\r\n') ? x.replace(/\r?\n/g, '\r\n') : x) });
const safeLabel = (s) => { if (s != null && (/\\/.test(s) || /\r/.test(s))) throw new Error('A label cannot contain a backslash or a carriage return (board-md cannot store them reliably; a line break is fine).'); return s; };
const safeBody = (lines) => { if ((lines || []).length > 200) throw new Error('A body is limited to 200 lines.'); for (const l of lines || []) if (l.trim() === ']' || /[\r\n]/.test(l) || l.length > 500) throw new Error('A body line cannot be "]", longer than 500 characters, or contain a line break.'); return lines || []; };
const cellText = (v) => (v === null || v === undefined ? '' : String(v));

async function editBoard(notes, a, wrote, verb, fn) {
  need(a.path, /\.board\.md$/i, '.board.md notes');
  const { text, back } = lf(await notes.read(a.path));
  const parts = splitBoardDoc(text);
  const m = parseBoard(parts.code);
  if (m.errors.length) throw new Error(`The board has lines Folio cannot read (line ${m.errors[0].line}: ${m.errors[0].msg}). Fix them first, or edit the note with edit_note: a structured edit would drop them.`);
  const out = await fn(m);
  return wrote(await notes.write(a.path, back(joinBoardDoc(parts, serializeBoard(m)))), verb) + (out ? ` ${out}` : '');
}

export async function runBoardSheetTool(notes, name, a, wrote) {
  switch (name) {
    case 'get_board': {
      need(a.path, /\.board\.md$/i, '.board.md notes');
      const m = parseBoard(splitBoardDoc(await notes.read(a.path)).code);
      return { shapes: m.nodes.map((n) => ({ id: n.id, shape: n.shape, label: n.label, x: n.x, y: n.y, w: n.w, h: n.h, style: n.style, body: n.body })), connectors: m.edges.map((e) => ({ from: e.from, fromPort: e.fromPort, to: e.to, toPort: e.toPort, op: e.op, label: e.label })), unreadable: m.errors };
    }
    case 'add_shape': return editBoard(notes, a, wrote, 'Added a shape to', (m) => {
      if ((a.x == null) !== (a.y == null)) throw new Error('Give x and y together, or neither to let auto layout place the shape.');
      a.shape ??= 'rect';
      if (m.nodes.some((n) => n.id === a.id && !n.implicit)) throw new Error(`A shape "${a.id}" already exists. Use update_shape.`);
      if (!SHAPES.includes(a.shape)) throw new Error(`Unknown shape "${a.shape}". Use one of: ${SHAPES.join(', ')}.`);
      m.nodes = m.nodes.filter((n) => n.id !== a.id); // an id only used by a connector becomes a real shape
      const [dw, dh] = defaultSize(a.shape);
      const n = { pre: [], id: a.id, shape: a.shape, label: safeLabel(a.label) ?? a.id, x: a.x ?? null, y: a.y ?? null, w: a.w ?? dw, h: a.h ?? dh, sized: a.w != null || a.h != null, style: cleanStyle({}, a.style), body: safeBody(a.body) };
      fitAuto(n); m.nodes.push(n);
      if (n.x == null || n.y == null) autoLayout(m);
    });
    case 'update_shape': return editBoard(notes, a, wrote, 'Updated a shape in', (m) => {
      const n = shapeOf(m, a.id);
      if (a.shape) { if (!SHAPES.includes(a.shape)) throw new Error(`Unknown shape "${a.shape}".`); n.shape = a.shape; }
      safeLabel(a.label); if (a.body) safeBody(a.body);
      for (const k of ['label', 'x', 'y', 'w', 'h', 'body']) if (a[k] != null) n[k] = a[k];
      if (a.w != null || a.h != null) n.sized = true;
      if (a.style) n.style = cleanStyle(n.style, a.style);
      n.implicit = false; fitAuto(n);
    });
    case 'remove_shape': return editBoard(notes, a, wrote, 'Removed a shape from', (m) => {
      shapeOf(m, a.id);
      const before = m.edges.length;
      m.nodes = m.nodes.filter((n) => n.id !== a.id); m.edges = m.edges.filter((e) => e.from !== a.id && e.to !== a.id);
      return `(${before - m.edges.length} connector${before - m.edges.length === 1 ? '' : 's'} removed)`;
    });
    case 'connect': return editBoard(notes, a, wrote, 'Connected shapes in', (m) => {
      shapeOf(m, a.from); shapeOf(m, a.to); a.op ??= '->';
      m.edges.push({ pre: [], from: a.from, fromPort: a.fromPort || null, to: a.to, toPort: a.toPort || null, op: a.op, label: safeLabel(a.label) || '', style: cleanStyle({}, a.style), ...ARROWS[a.op] });
    });
    case 'disconnect': return editBoard(notes, a, wrote, 'Removed a connector from', (m) => {
      const before = m.edges.length;
      m.edges = m.edges.filter((e) => !(e.from === a.from && e.to === a.to));
      if (m.edges.length === before) throw new Error(`There is no connector from ${a.from} to ${a.to}.`);
      return `(${before - m.edges.length} removed)`;
    });
    case 'auto_layout_board': return editBoard(notes, a, wrote, 'Laid out', (m) => { if (!autoLayout(m, { dir: a.dir || 'LR', all: !!a.all })) return '(nothing needed placing)'; });
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
