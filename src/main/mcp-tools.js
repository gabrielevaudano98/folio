// Folio — MCP tool definitions. One table, two hosts: the in-app HTTP server and the stdio bridge.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import FORMATS from '../../docs/FORMATS.md';
import TEMPLATES from '../../docs/TEMPLATES.md';
import { parseWorkbook, evaluator, colName } from '../renderer/sheet-core.js';
import { resolveRef, loadExternals } from '../renderer/refs.js';
import { createAssets } from './assets.js';
import { parseRef, resolveTarget, docKind } from '../renderer/refs-syntax.js';
import { createPatch, diffWords } from 'diff';
import { sections, findSection, findBlock, readSection, replaceSection, insertAfter, addComment, suggestEdit } from './page-tools.js';
import { SLIDE_TOOLS, runSlideTool } from './mcp-slides.js';

export const SERVER_INFO = { name: 'folio', version: '1.2.3' };

export const INSTRUCTIONS = `Folio is the user's Markdown workspace. Paths are relative to the open folder and use forward slashes.
Read a note before editing it. Prefer edit_note (exact find-and-replace) over write_note for small changes so the user's formatting survives.
Every change you make is shown live to the user in Folio with a one-click undo. Use get_open_note to see what the user is looking at right now.
Besides pages (.md) Folio has slides (name.slides.md, Marp compatible), boards (name.board.md, diagrams as text) and sheets (name.sheet.md, Markdown tables with Excel formulas). Call get_format_guide before creating or editing those, and get_sheet_values to read computed sheet values. Documents can reference each other: [[Doc#part]] links, {{Doc#part}} shows a live value (e.g. {{Budget.sheet#Summary!B7}}), ![[Doc#part]] embeds a sheet range, slide, board or page section. Use resolve_ref to see what a reference shows.
For long pages work by section: get_outline, read_section, replace_section, insert_after (after a heading or a ^block-id). To propose rather than apply, use suggest_edit (tracked change) and add_comment (comment on a passage); the user accepts or rejects them in Folio. Every write is kept in the page's version history: list_versions, get_version, diff_versions, restore_version. resolve_link tells you where a [[link]] points. Slide decks can use a template (template: Templates/Name.slides); get_format_guide with type template explains how to build one.`;

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
    description: 'Return the heading structure of a note: level, text, first line and last line of each section (sub-sections included).',
    input: { path: z.string() } },
  { name: 'get_format_guide', title: 'Get format guide', write: false, annotations: ro,
    description: 'Return the syntax of Folio document types: pages (.md: footnotes, maths, colour, alignment, hidden comments), slides-md (.slides.md, Marp compatible), board-md (.board.md diagrams), sheet-md (.sheet.md spreadsheets), or the guide to building slide templates (type template: colours, fonts, masters with placeholders, variants; templates live in Templates/).',
    input: { type: z.enum(['page', 'slides', 'board', 'sheet', 'template', 'all']).optional() } },
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
  { name: 'find_unused_assets', title: 'Find unused files', write: false, annotations: ro,
    description: 'List pictures, media and attachments in the hidden .asset folders that no page references (candidates for clean-up; Folio asks the user before removing anything), with their size.',
    input: {} },
  { name: 'find_missing_assets', title: 'Find missing files', write: false, annotations: ro,
    description: 'List asset references (images, media, attachments) whose file does not exist, with the page and line.',
    input: {} },
  { name: 'read_section', title: 'Read section', write: false, annotations: ro,
    description: 'Read one section of a page: a heading and everything under it. Name the heading ("Goals"), give a path to tell twins apart ("Plan > Goals"), or pass its line from get_outline.',
    input: { path: z.string(), heading: z.string().optional(), line: z.number().int().min(1).optional(), includeChildren: z.boolean().optional().describe('Include sub-sections (default true)') } },
  { name: 'replace_section', title: 'Replace section', write: true, annotations: { ...rw, destructiveHint: true },
    description: 'Replace what is under a heading (sub-sections included) with new Markdown. The heading line stays unless includeHeading is true, in which case content must start with its own heading. The rest of the page is untouched.',
    input: { path: z.string(), heading: z.string().optional(), line: z.number().int().min(1).optional(), content: z.string(), includeHeading: z.boolean().optional() } },
  { name: 'insert_after', title: 'Insert after', write: true, annotations: rw,
    description: 'Insert Markdown as new blocks after a heading\'s section (sub-sections included) or after the block that ends with a block id, e.g. "^a1b2c3".',
    input: { path: z.string(), after: z.string().describe('A heading ("Goals", "Plan > Goals") or a block id ("^a1b2c3")'), line: z.number().int().min(1).optional().describe('Line of the heading, when its text is not unique'), content: z.string() } },
  { name: 'add_comment', title: 'Add comment', write: true, annotations: rw,
    description: 'Comment on a passage of a page. The passage is highlighted and the comment written as CriticMarkup ({==passage==}{>>You, date: comment<<}), which Folio shows in its Review tab and other editors show as plain text.',
    input: { path: z.string(), quote: z.string().describe('The exact passage to comment on'), comment: z.string(), occurrence: z.number().int().min(1).optional().describe('Which match, when the passage appears more than once'), author: z.string().optional() } },
  { name: 'suggest_edit', title: 'Suggest edit', write: true, annotations: rw,
    description: 'Propose a change as a tracked suggestion the user can accept or reject, instead of editing the text: oldText → newText, or delete oldText (newText empty), or add newText after insertAfter. Optional comment explains why.',
    input: { path: z.string(), oldText: z.string().optional(), newText: z.string().optional(), insertAfter: z.string().optional(), comment: z.string().optional(), occurrence: z.number().int().min(1).optional(), author: z.string().optional() } },
  { name: 'resolve_link', title: 'Resolve link', write: false, annotations: ro,
    description: 'Say where a link points: pass "[[Note#Heading|label]]" or "Note#^id". Returns the document path (or that it does not exist, with similar names), its type, and the heading or block it targets with line numbers.',
    input: { link: z.string(), from: z.string().optional().describe('Path of the page containing the link, for relative names') } },
  { name: 'list_versions', title: 'List versions', write: false, annotations: ro,
    description: 'List the saved versions of a document, newest first: id, time, who made it (you or an AI client), why, words added or removed, and the name if the user named it.',
    input: { path: z.string(), limit: z.number().int().min(1).max(200).optional() } },
  { name: 'get_version', title: 'Get version', write: false, annotations: ro,
    description: 'Read the full text of a saved version (id from list_versions; a prefix is enough, or "latest").',
    input: { path: z.string(), id: z.string() } },
  { name: 'diff_versions', title: 'Diff versions', write: false, annotations: ro,
    description: 'Show what changed between two versions as a unified diff, with the number of words added and removed. "to" defaults to the current text of the file; "current" and "latest" are accepted.',
    input: { path: z.string(), from: z.string(), to: z.string().optional() } },
  { name: 'restore_version', title: 'Restore version', write: true, annotations: rw,
    description: 'Put a saved version back as the document\'s text. The current text is saved as a version first, so the restore itself can be undone.',
    input: { path: z.string(), id: z.string() } },
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
  const hist = () => { if (!hooks.history) throw new Error('Version history is not available.'); return hooks.history; };
  const brief = (v) => ({ id: v.id.slice(0, 12), time: new Date(v.t).toISOString(), by: v.by, reason: v.reason, words: v.words, wordsChanged: v.delta, ...(v.name ? { name: v.name } : {}), ...(v.note ? { note: v.note } : {}) });
  const pick = async (path, id) => {
    const vs = await hist().list(path); if (!vs.length) throw new Error(`No saved versions of ${path}.`);
    if (!id || id === 'latest') return vs[0];
    const m = vs.filter((v) => v.id.startsWith(id)); if (m.length !== 1) throw new Error(m.length ? `Version id ${id} is ambiguous; use more characters.` : `No version ${id} of ${path}. Call list_versions.`);
    return m[0];
  };
  const wrote = async (r, verb) => { await hooks.onWrite?.({ ...r, verb }); return r.created ? `Created ${r.path}` : `${verb} ${r.path}`; };
  switch (name) {
    case 'list_notes': return notes.list(a);
    case 'read_note': return notes.read(a.path, a);
    case 'search_notes': return notes.search(a.query, a);
    case 'get_outline': { const text = await notes.read(a.path); return sections(text).map((h) => ({ level: h.level, text: h.text, line: h.line, endLine: h.end })); }
    case 'read_section': return readSection(await notes.read(a.path), a.heading, { line: a.line, includeChildren: a.includeChildren !== false });
    case 'replace_section': return wrote(await notes.write(a.path, replaceSection(await notes.read(a.path), a.heading, a.content, { line: a.line, includeHeading: a.includeHeading })), 'Replaced a section of');
    case 'insert_after': return wrote(await notes.write(a.path, insertAfter(await notes.read(a.path), a.after, a.content, { line: a.line })), 'Inserted into');
    case 'add_comment': return wrote(await notes.write(a.path, addComment(await notes.read(a.path), a.quote, a.comment, { author: a.author || hooks.client || 'AI', occurrence: a.occurrence })), 'Commented on');
    case 'suggest_edit': return wrote(await notes.write(a.path, suggestEdit(await notes.read(a.path), { ...a, author: a.author || hooks.client || 'AI' })), 'Suggested a change in');
    case 'resolve_link': {
      const raw = String(a.link).trim().replace(/^!?\[\[|\]\]$/g, ''); const bar = raw.indexOf('|'); const alias = bar < 0 ? null : raw.slice(bar + 1); const { target, part } = parseRef(bar < 0 ? raw : raw.slice(0, bar));
      const files = await notes.allFiles(); const path = resolveTarget(target, files, a.from || '');
      if (!path) { const t = target.toLowerCase(); return { link: a.link, exists: false, target, candidates: files.filter((f) => f.toLowerCase().includes(t)).slice(0, 5) }; }
      const out = { link: a.link, exists: true, path, kind: docKind(path), target, part: part || null, alias };
      if (part && out.kind === 'page') {
        const text = await notes.read(path);
        try { if (part.startsWith('^')) { const b = findBlock(text, part); out.block = { id: part, fromLine: b.from, toLine: b.to, text: text.split('\n').slice(b.from - 1, b.to).join('\n') }; } else { const h = findSection(text, part); out.heading = { text: h.text, level: h.level, line: h.line, endLine: h.end }; } } catch (e) { out.partFound = false; out.note = e.message; }
      } else if (part) { try { const r = await resolveRef(raw.split('|')[0], { files, from: a.from || '', read: (p) => notes.read(p) }); out.value = r.value; } catch (e) { out.partFound = false; out.note = e.message; } }
      return out;
    }
    case 'list_versions': { const vs = await hist().list(a.path); return vs.slice(0, a.limit || 50).map(brief); }
    case 'get_version': return hist().get(a.path, (await pick(a.path, a.id)).id);
    case 'diff_versions': {
      const from = a.from === 'current' ? await notes.read(a.path) : await hist().get(a.path, (await pick(a.path, a.from)).id);
      const to = !a.to || a.to === 'current' ? await notes.read(a.path) : await hist().get(a.path, (await pick(a.path, a.to)).id);
      let added = 0, removed = 0; for (const p of diffWords(from, to)) { const n = (p.value.match(/[\p{L}\p{N}]+/gu) || []).length; if (p.added) added += n; else if (p.removed) removed += n; }
      return { path: a.path, wordsAdded: added, wordsRemoved: removed, identical: from === to, patch: from === to ? '' : createPatch(a.path, from, to, a.from, a.to || 'current', { context: 3 }) };
    }
    case 'restore_version': { const v = await pick(a.path, a.id); const text = await hist().get(a.path, v.id); return wrote(await notes.write(a.path, text), `Restored the ${new Date(v.t).toISOString().slice(0, 16).replace('T', ' ')} version of`); }
    case 'get_format_guide': {
      if (a.type === 'template') return TEMPLATES;
      if (!a.type || a.type === 'all') return FORMATS + '\n\n' + TEMPLATES;
      const title = { page: '## Pages', slides: '## slides-md', board: '## board-md', sheet: '## sheet-md' }[a.type];
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
    case 'move_note': { const r = await notes.move(a.from, a.to); const changed = await notes.rewriteAfterMove(r.from, r.to).catch(() => []); await hooks.onMove?.(r); return `Moved ${r.from} to ${r.to}` + (changed.length ? `. Updated references in ${changed.join(', ')}` : '') + (changed.failed?.length ? `. Could not update references in ${changed.failed.join(', ')}; fix them by hand` : ''); }
    case 'resolve_ref': {
      const files = await notes.allFiles();
      const r = await resolveRef(a.ref, { files, from: a.from || '', read: (p) => notes.read(p) });
      return { ref: a.ref, path: r.open.path, kind: r.kind, value: r.value };
    }
    case 'get_backlinks': return notes.backlinks(a.path);
    case 'find_broken_links': return notes.brokenLinks(a.path);
    case 'find_unused_assets': { const u = await createAssets(notes).usage(); return { count: u.unused.length, bytes: u.unusedBytes, files: u.unused.map((f) => ({ path: f.path, bytes: f.bytes })) }; }
    case 'find_missing_assets': return (await createAssets(notes).usage()).missing;
    case 'get_open_note': if (!hooks.openNote) throw new Error('Folio is not running.'); return hooks.openNote();
    case 'open_note': if (!hooks.showNote) throw new Error('Folio is not running.'); await hooks.showNote(a); return `Opened ${a.path}`;
    default:
      if (SLIDE_TOOLS.some((t) => t.name === name)) return runSlideTool(notes, name, a, wrote);
      throw new Error(`Unknown tool ${name}`);
  }
}
