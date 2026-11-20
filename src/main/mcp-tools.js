// Folio — MCP tool definitions. One table, two hosts: the in-app HTTP server and the stdio bridge.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import FORMATS from '../../docs/FORMATS.md';
import TEMPLATES from '../../docs/TEMPLATES.md';
import { parseWorkbook, evaluator, colName } from '../renderer/sheet-core.js';
import { resolveRef, loadExternals } from '../renderer/refs.js';
import { SLIDE_TOOLS, runSlideTool } from './mcp-slides.js';

export const SERVER_INFO = { name: 'folio', version: '1.2.0' };

export const INSTRUCTIONS = `Folio is the user's Markdown workspace. Paths are relative to the open folder and use forward slashes.
Read a note before editing it. Prefer edit_note (exact find-and-replace) over write_note for small changes so the user's formatting survives.
Every change you make is shown live to the user in Folio with a one-click undo. Use get_open_note to see what the user is looking at right now.
Besides pages (.md) Folio has slides (name.slides.md, Marp compatible), boards (name.board.md, diagrams as text) and sheets (name.sheet.md, Markdown tables with Excel formulas). Call get_format_guide before creating or editing those, and get_sheet_values to read computed sheet values. Documents can reference each other: [[Doc#part]] links, {{Doc#part}} shows a live value (e.g. {{Budget.sheet#Summary!B7}}), ![[Doc#part]] embeds a sheet range, slide, board or page section. Use resolve_ref to see what a reference shows. Slide decks can use a template (template: Templates/Name.slides); get_format_guide with type template explains how to build one.`;

const ro = { readOnlyHint: true, openWorldHint: false };
const rw = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const TOOLS = [
  { name: 'list_notes', title: 'List notes', write: false, annotations: ro,
    description: 'List Markdown notes in the workspace, most recently modified first.',
    input: { folder: z.string().optional().describe('Sub-folder to list, relative to the workspace'), limit: z.number().int().min(1).max(2000).optional() } },
  { name: 'read_note', title: 'Read note', write: false, annotations: ro,
    description: 'Read the full Markdown of a note, or a line range.',
    input: { path: z.string().describe('e.g. "projects/roadmap.md"'), fromLine: z.number().int().min(1).optional(), toLine: z.number().int().min(1).optional() } },
  { name: 'search_notes', title: 'Search notes', write: false, annotations: ro,
    description: 'Full-text search across every note. Returns paths and matching lines with line numbers.',
    input: { query: z.string(), regex: z.boolean().optional(), caseSensitive: z.boolean().optional(), folder: z.string().optional(), limit: z.number().int().min(1).max(500).optional() } },
  { name: 'get_outline', title: 'Get outline', write: false, annotations: ro,
    description: 'Return the heading structure of a note with line numbers.',
    input: { path: z.string() } },
  { name: 'get_format_guide', title: 'Get format guide', write: false, annotations: ro,
    description: 'Return the syntax of Folio document types: slides-md (.slides.md, Marp compatible), board-md (.board.md diagrams), sheet-md (.sheet.md spreadsheets), or the guide to building slide templates (type template: colours, fonts, masters with placeholders, variants; templates live in Templates/).',
    input: { type: z.enum(['slides', 'board', 'sheet', 'template', 'all']).optional() } },
  { name: 'get_sheet_values', title: 'Get sheet values', write: false, annotations: ro,
    description: 'Evaluate every formula in a .sheet.md note and return each sheet as a grid of computed values, with cell addresses.',
    input: { path: z.string(), sheet: z.string().optional().describe('Sheet name; all sheets when omitted') } },
  { name: 'get_open_note', title: 'Get open note', write: false, annotations: ro, appOnly: true,
    description: 'Return the note the user has open in Folio right now, its unsaved text and the current selection.',
    input: {} },
  { name: 'create_note', title: 'Create note', write: true, annotations: rw,
    description: 'Create a new note. Fails if the path already exists.',
    input: { path: z.string().describe('Relative path ending in .md'), content: z.string() } },
  { name: 'write_note', title: 'Write note', write: true, annotations: { ...rw, destructiveHint: true },
    description: 'Replace the entire content of a note (creates it if missing). Prefer edit_note for small changes.',
    input: { path: z.string(), content: z.string() } },
  { name: 'edit_note', title: 'Edit note', write: true, annotations: rw,
    description: 'Apply exact find-and-replace edits to a note. Each oldText must match exactly once unless replaceAll is set.',
    input: { path: z.string(), edits: z.array(z.object({ oldText: z.string().min(1), newText: z.string(), replaceAll: z.boolean().optional() })).min(1) } },
  { name: 'append_to_note', title: 'Append to note', write: true, annotations: rw,
    description: 'Append Markdown to the end of a note, or to the end of the section under a given heading.',
    input: { path: z.string(), content: z.string(), underHeading: z.string().optional() } },
  { name: 'resolve_ref', title: 'Resolve reference', write: false, annotations: ro,
    description: 'Compute what a Folio reference points at, as Folio would show it: a sheet cell value or range, a slide title, a board shape label, or a page section. Reference syntax: "Doc#part", e.g. "Budget.sheet#Summary!B7", "Pitch.slides#3", "System.board#api", "Roadmap#Goals".',
    input: { ref: z.string(), from: z.string().optional().describe('Path of the document containing the reference, for relative names') } },
  { name: 'get_backlinks', title: 'Get backlinks', write: false, annotations: ro,
    description: 'List every link ([[..]]), live value ({{..}}) and embed (![[..]]) in the workspace that points at a document.',
    input: { path: z.string() } },
  { name: 'find_broken_links', title: 'Find broken links', write: false, annotations: ro,
    description: 'List references whose target document does not exist, in one document or the whole workspace.',
    input: { path: z.string().optional() } },
  { name: 'move_note', title: 'Move or rename note', write: true, annotations: rw,
    description: 'Move or rename a note inside the workspace. References to it in other documents are updated.',
    input: { from: z.string(), to: z.string() } },
  { name: 'open_note', title: 'Show note to user', write: false, annotations: ro, appOnly: true,
    description: 'Open a note in Folio so the user sees it, optionally scrolled to a line.',
    input: { path: z.string(), line: z.number().int().min(1).optional() } },
  ...SLIDE_TOOLS,
];

const asText = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

/**
 * backend.call(name, args, ctx) -> result value (string | object). Throws on error.
 * backend.capabilities() -> { app: boolean, write: boolean }
 */
export function buildServer(backend, { clientLabel } = {}) {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const caps = backend.capabilities();
  for (const t of TOOLS) {
    if (t.appOnly && !caps.app) continue;
    if (t.write && !caps.write) continue;
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: t.annotations }, async (args) => {
      try {
        const client = clientLabel?.() || server.server.getClientVersion()?.name || 'AI assistant';
        return asText(await backend.call(t.name, args ?? {}, { client }));
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: e?.message || String(e) }] };
      }
    });
  }
  return server;
}

/** Runs a tool against the notes core. `hooks` lets the app observe writes and answer app-only tools. */
export async function runTool(notes, name, a, hooks = {}) {
  const wrote = async (r, verb) => { await hooks.onWrite?.({ ...r, verb }); return r.created ? `Created ${r.path}` : `${verb} ${r.path}`; };
  switch (name) {
    case 'list_notes': return notes.list(a);
    case 'read_note': return notes.read(a.path, a);
    case 'search_notes': return notes.search(a.query, a);
    case 'get_outline': return notes.outline(a.path);
    case 'get_format_guide': {
      if (a.type === 'template') return TEMPLATES;
      if (!a.type || a.type === 'all') return FORMATS + '\n\n' + TEMPLATES;
      const title = { slides: '## slides-md', board: '## board-md', sheet: '## sheet-md' }[a.type];
      const start = FORMATS.indexOf(title); const next = FORMATS.indexOf('\n## ', start + 4);
      return FORMATS.slice(start, next < 0 ? undefined : next);
    }
    case 'get_sheet_values': {
      const src = await notes.read(a.path);
      const external = await loadExternals(src, { files: await notes.allFiles(), from: notes.relOf(notes.resolve(a.path)), read: (p) => notes.read(p), seen: [notes.relOf(notes.resolve(a.path))] });
      const sheets = parseWorkbook(src).filter((b) => b.type === 'sheet' && (!a.sheet || b.name.toLowerCase() === a.sheet.toLowerCase()));
      if (!sheets.length) throw new Error(a.sheet ? `No sheet named ${a.sheet}` : 'No tables found in this note.');
      return sheets.map((s) => {
        const ev = evaluator(s, { external }); const cols = Math.max(...s.rows.map((r) => r.length));
        return { sheet: s.name, columns: Array.from({ length: cols }, (_, c) => colName(c)), rows: s.rows.map((row, r) => ({ row: r + 1, values: Array.from({ length: cols }, (_, c) => { const v = ev.value(r, c); return v instanceof Date ? v.toISOString().slice(0, 10) : v ?? ''; }) })) };
      });
    }
    case 'create_note': return wrote(await notes.write(a.path, a.content, { overwrite: false }), 'Created');
    case 'write_note': return wrote(await notes.write(a.path, a.content), 'Rewrote');
    case 'edit_note': return wrote(await notes.edit(a.path, a.edits), 'Edited');
    case 'append_to_note': return wrote(await notes.append(a.path, a.content, a), 'Appended to');
    case 'move_note': { const r = await notes.move(a.from, a.to); const changed = await notes.rewriteAfterMove(r.from, r.to).catch(() => []); await hooks.onMove?.(r); return `Moved ${r.from} to ${r.to}` + (changed.length ? `. Updated references in ${changed.join(', ')}` : ''); }
    case 'resolve_ref': {
      const files = await notes.allFiles();
      const r = await resolveRef(a.ref, { files, from: a.from || '', read: (p) => notes.read(p) });
      return { ref: a.ref, path: r.open.path, kind: r.kind, value: r.value };
    }
    case 'get_backlinks': return notes.backlinks(a.path);
    case 'find_broken_links': return notes.brokenLinks(a.path);
    case 'get_open_note': if (!hooks.openNote) throw new Error('Folio is not running.'); return hooks.openNote();
    case 'open_note': if (!hooks.showNote) throw new Error('Folio is not running.'); await hooks.showNote(a); return `Opened ${a.path}`;
    default:
      if (SLIDE_TOOLS.some((t) => t.name === name)) return runSlideTool(notes, name, a, wrote);
      throw new Error(`Unknown tool ${name}`);
  }
}
