// Folio — what you can insert in a page, in one list. The / menu, the @ menu (D5) and the command palette all read it.
// Each item: id, label, desc, cat, aliases, icon (icons.js key) or badge (short text), key (shortcut), md (what the
// source view inserts), and either `turn` (change the current block, keeping its text) or `run` (insert something).
// Pure: functions receive the TipTap editor and a context from the host ({ pickImage, pickRef }).
import { fuzzyItem } from './fuzzy.js';
import { softBreaks } from './page-syntax.js';
import { ymd } from './page-mentions.js';

const CHART = 'type: column\ntitle: Chart\ndata:\n| Month | Value |\n| --- | --- |\n| Jan | 10 |\n| Feb | 14 |\n| Mar | 9 |';
const MERMAID = 'flowchart LR\n  A[Idea] --> B[Draft] --> C[Shipped]';

/* put a block at the cursor: replace an empty paragraph, otherwise go after the current block */
export function placeBlock(editor, content) {
  const { $from } = editor.state.selection;
  const para = $from.parent;
  const empty = para.type.name === 'paragraph' && !para.content.size;
  const at = empty ? $from.before() : $from.after();
  const ok = editor.chain().focus().insertContentAt(empty ? { from: at, to: $from.after() } : at, content).run();
  placeBlock.at = at;
  // after a block you cannot type in (divider, image, maths), carry on in a paragraph below it, as in Notion
  const sel = editor.state.selection;
  const node = sel.node || null;
  if (ok && node && !node.isTextblock) {
    const after = sel.to; const next = editor.state.doc.resolve(after).nodeAfter;
    if (next?.type.name === 'paragraph') editor.commands.setTextSelection(after + 1);
    else editor.chain().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).run();
  }
  return ok;
}
/* a link to a daily note (Journal/), n days from today */
const dayLink = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `[[${ymd(d)}]]`; };
const putText = (e, text) => e.chain().focus().insertContent({ type: 'text', text }).run();
const fromMd = (editor, md) => softBreaks(editor.markdown.parse(md)).content || [];
/* select the n characters before the cursor, so typing replaces a placeholder */
const selectBack = (editor, n) => { const to = editor.state.selection.from; editor.commands.setTextSelection({ from: Math.max(0, to - n), to }); return true; };
const callout = (type, label) => ({
  id: `callout-${type}`, label: `${label} callout`, cat: 'Callouts', badge: '!', desc: `> [!${type}]`, aliases: ['callout', 'admonition', 'aside', type],
  md: `\n> [!${type}]\n> \n`,
  run: (e) => { placeBlock(e, fromMd(e, `> [!${type}]\n> Text`)); const { $from } = e.state.selection; const end = $from.pos; let at = null;
    e.state.doc.nodesBetween(Math.max(0, end - 40), end, (n, pos) => { if (n.isText && n.text.endsWith('Text')) at = pos + n.text.length; });
    return at == null ? true : e.commands.setTextSelection({ from: at - 4, to: at }); },
});
const heading = (l) => ({
  id: `h${l}`, label: `Heading ${l}`, cat: 'Basic', badge: `H${l}`, key: `Mod+Alt+${l}`, aliases: [`h${l}`, '#'.repeat(l), l === 1 ? 'title' : l === 2 ? 'section' : 'subheading'],
  desc: l === 1 ? 'Page title size' : l === 2 ? 'Section heading' : 'Smaller heading', md: `${'#'.repeat(l)} `,
  turn: (e) => e.chain().focus().setHeading({ level: l }).run(),
});

/* a toggle (<details>), optionally a toggle heading; turning a line into one keeps its text as the title */
const toggleNode = (level, title = '') => ({ type: 'details', attrs: { open: true, heading: level }, content: [{ type: 'detailsSummary', content: title ? [{ type: 'text', text: title }] : [] }, { type: 'detailsContent', content: [{ type: 'paragraph' }] }] });
const toggle = (level) => ({
  id: level ? `toggle-h${level}` : 'toggle', label: level ? `Toggle heading ${level}` : 'Toggle list', cat: level ? 'Basic' : 'Lists', icon: level ? undefined : 'chevron', badge: level ? `▸${level}` : undefined,
  desc: level ? 'A heading that hides its content' : 'Show or hide what is inside', aliases: level ? [`toggle h${level}`, 'collapsible heading', 'fold'] : ['toggle', 'details', 'collapse', 'accordion', 'disclosure', '>>'],
  md: `\n<details>\n<summary>${level ? `<h${level}>Title</h${level}>` : 'Title'}</summary>\n\n\n\n</details>\n`,
  run: (e) => {
    const { $from } = e.state.selection; const para = $from.parent;
    const title = para.isTextblock && para.type.name !== 'codeBlock' ? para.textContent : '';
    if (title) e.chain().focus().insertContentAt({ from: $from.before(), to: $from.after() }, toggleNode(level, title)).run();
    else placeBlock(e, toggleNode(level));
    const at = title ? $from.before() : placeBlock.at;
    return e.commands.setTextSelection(at + 2 + title.length);
  },
});
const columns = (n) => ({
  id: `columns-${n}`, label: `${n} columns`, cat: 'Layout', icon: 'grid', desc: 'Side by side, :::: columns', aliases: ['columns', 'layout', 'side by side', `${n} col`],
  md: `\n:::: columns\n${Array.from({ length: n }, () => '::: column\n\n:::').join('\n')}\n::::\n`,
  run: (e) => { placeBlock(e, { type: 'columns', content: Array.from({ length: n }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })) }); return e.commands.setTextSelection(placeBlock.at + 3); },
});
/* Notion databases are Folio sheets: a new sheet next to this page, shown here */
const SHEET_BODY = (title, kanban) => `# ${title}\n\n## ${kanban ? 'Board' : 'Table'}\n\n| Name | Status | Owner | Due |\n| --- | --- | --- | --- |\n| First item | To do |  |  |\n| Second item | In progress |  |  |\n| Third item | Done |  |  |\n${kanban ? '\n<!-- sheet: {"view":"kanban","kanbanBy":1} -->\n' : ''}`;
const database = (kanban) => ({
  id: kanban ? 'database-board' : 'database-table', label: kanban ? 'Board database' : 'Table database', cat: 'Databases', icon: kanban ? 'kanban' : 'sheet',
  desc: kanban ? 'A sheet shown as a kanban, embedded here' : 'A sheet with rows and columns, embedded here', aliases: kanban ? ['kanban', 'board view', 'database', 'tasks board'] : ['database', 'table view', 'inline database', 'records', 'sheet'],
  run: async (e, c) => {
    const p = await c.createDoc?.({ type: 'sheet', name: kanban ? 'Board' : 'Table', content: (title) => SHEET_BODY(title, kanban) });
    if (p) placeBlock(e, { type: 'paragraph', content: [{ type: 'text', text: `![[${p.ref}]]` }] });
  },
});

export const INSERTS = [
  { id: 'text', label: 'Text', cat: 'Basic', badge: 'T', key: 'Mod+Alt+0', desc: 'Plain paragraph', aliases: ['paragraph', 'p', 'plain', 'normal'], md: '', turn: (e) => e.chain().focus().setParagraph().run() },
  heading(1), heading(2), heading(3), heading(4), heading(5), heading(6),
  { id: 'quote', label: 'Quote', cat: 'Basic', icon: 'quote', desc: 'Quoted text', aliases: ['blockquote', '>', 'citation'], md: '> ', turn: (e) => e.chain().focus().setParagraph().toggleBlockquote().run() },
  { id: 'divider', label: 'Divider', cat: 'Basic', icon: 'divider', desc: 'A line between sections', aliases: ['hr', 'line', 'separator', 'rule', '---'], md: '\n---\n', run: (e) => placeBlock(e, { type: 'horizontalRule' }) },

  { id: 'bullet', label: 'Bulleted list', cat: 'Lists', icon: 'listBullet', key: 'Mod+Shift+8', desc: 'A simple list', aliases: ['ul', 'bullets', 'unordered', '-'], md: '- ', turn: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: 'Numbered list', cat: 'Lists', icon: 'listOrdered', key: 'Mod+Shift+7', desc: 'A list with numbers', aliases: ['ol', 'numbers', 'ordered', '1.'], md: '1. ', turn: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'task', label: 'Checklist', cat: 'Lists', icon: 'listTask', key: 'Mod+L', desc: 'Tasks with checkboxes', aliases: ['todo', 'to-do', 'tasks', 'checkbox', '[]'], md: '- [ ] ', turn: (e) => e.chain().focus().toggleTaskList().run() },

  { id: 'table', label: 'Table', cat: 'Media and data', icon: 'table', desc: 'Type /3x4 for a size', aliases: ['grid', 'rows', 'spreadsheet', 'cells'], md: '\n| Column | Column |\n| --- | --- |\n|  |  |\n',
    run: (e, _c, a = {}) => {
      if (!e.state.selection.$from.parent.content.size) placeBlock(e, { type: 'paragraph' });
      return e.chain().focus().insertTable({ rows: a.rows || 3, cols: a.cols || 3, withHeaderRow: true }).run();
    } },
  { id: 'image', label: 'Image', cat: 'Media and data', icon: 'image', desc: 'From a file, saved in assets', aliases: ['picture', 'photo', 'img', 'figure'],
    run: async (e, c) => { const src = await c.pickImage?.(); if (src) placeBlock(e, { type: 'image', attrs: { src, alt: src.split('/').pop().replace(/^[a-z0-9]+-/, '').replace(/\.\w+$/, '') } }); } },
  { id: 'video', label: 'Video', cat: 'Media and data', icon: 'play', desc: 'A video file, saved in assets', aliases: ['movie', 'mp4', 'clip', 'film'],
    run: async (e, c) => { const src = await c.pickMedia?.('video'); if (src) placeBlock(e, { type: 'image', attrs: { src, alt: '' } }); } },
  { id: 'audio', label: 'Audio', cat: 'Media and data', icon: 'play', desc: 'A sound file, saved in assets', aliases: ['sound', 'mp3', 'podcast', 'music', 'recording'],
    run: async (e, c) => { const src = await c.pickMedia?.('audio'); if (src) placeBlock(e, { type: 'image', attrs: { src, alt: '' } }); } },
  { id: 'pdf', label: 'PDF', cat: 'Media and data', icon: 'doc', desc: 'A PDF card that opens it', aliases: ['pdf', 'document file'],
    run: async (e, c) => { const src = await c.pickMedia?.('pdf'); if (src) placeBlock(e, { type: 'image', attrs: { src, alt: src.split('/').pop().replace(/^(?=[a-z]*\d)[a-z0-9]{8}-/, '') } }); } },
  { id: 'file', label: 'File', cat: 'Media and data', icon: 'folder', desc: 'Attach any file, saved in assets', aliases: ['attachment', 'upload', 'attach', 'zip'],
    run: async (e, c) => { const src = await c.pickMedia?.('file'); if (src) { const name = src.split('/').pop().replace(/^(?=[a-z]*\d)[a-z0-9]{8}-/, ''); placeBlock(e, { type: 'paragraph', content: [{ type: 'text', text: name, marks: [{ type: 'link', attrs: { href: src } }] }] }); } } },
  { id: 'bookmark', label: 'Web bookmark', cat: 'Media and data', icon: 'link', desc: 'A link shown as a card', aliases: ['bookmark', 'url', 'website', 'link preview'],
    run: async (e, c) => { const url = await c.askUrl?.('Web bookmark'); if (url) placeBlock(e, { type: 'paragraph', content: [{ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }] }); } },
  { id: 'web-embed', label: 'Embed from the web', cat: 'Media and data', icon: 'play', desc: 'YouTube, Vimeo, Loom, Figma, Maps…', aliases: ['embed', 'youtube', 'vimeo', 'loom', 'figma', 'maps', 'iframe', 'tweet'],
    run: async (e, c) => { const url = await c.askUrl?.('Embed from the web'); if (url) placeBlock(e, { type: 'image', attrs: { src: url, alt: '' } }); } },
  { id: 'code', label: 'Code block', cat: 'Media and data', icon: 'codeBlock', desc: 'Code with highlighting', aliases: ['code', 'snippet', 'pre', '```'], md: '\n```\n\n```\n', turn: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'mermaid', label: 'Diagram', cat: 'Media and data', icon: 'board', desc: 'Mermaid flowchart, sequence…', aliases: ['mermaid', 'flowchart', 'sequence', 'gantt'], md: `\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n`,
    run: (e) => placeBlock(e, { type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: MERMAID }] }) },
  { id: 'chart', label: 'Chart', cat: 'Media and data', icon: 'chart', desc: 'From a table or a sheet', aliases: ['graph', 'plot', 'bar', 'line', 'pie'], md: `\n\`\`\`chart\n${CHART}\n\`\`\`\n`,
    run: (e) => placeBlock(e, { type: 'codeBlock', attrs: { language: 'chart' }, content: [{ type: 'text', text: CHART }] }) },

  { id: 'math', label: 'Maths', cat: 'Advanced', icon: 'sigma', key: 'Mod+Shift+M', desc: 'Inline formula, $…$', aliases: ['equation', 'formula', 'latex', 'katex', '$', 'math'], md: '$x$',
    run: (e) => e.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex: '' } }).run() },
  { id: 'math-block', label: 'Maths block', cat: 'Advanced', icon: 'sigma', desc: 'Formula on its own line, $$', aliases: ['equation block', 'display maths', '$$', 'latex block'], md: '\n$$\n\n$$\n',
    run: (e) => placeBlock(e, { type: 'blockMath', attrs: { latex: '' } }) },
  { id: 'footnote', label: 'Footnote', cat: 'Advanced', icon: 'footnote', key: 'Mod+Alt+F', desc: 'Numbered note at the end', aliases: ['note', 'cite', 'citation', 'fn', '[^'], md: '[^1]', run: (e, c) => c.footnote?.(e) },
  { id: 'hidden-comment', label: 'Hidden comment', cat: 'Advanced', icon: 'commentHidden', desc: 'Only in the file, %%…%%', aliases: ['%%', 'private', 'comment', 'aside note'], md: '%%%%',
    run: (e) => e.chain().focus().insertContent({ type: 'text', text: 'Comment', marks: [{ type: 'hiddenComment' }] }).run() && selectBack(e, 7) },

  { id: 'callout', label: 'Callout', cat: 'Callouts', badge: '💡', desc: 'Notion style, with an icon', aliases: ['callout', 'aside', 'highlight box', 'notion callout'], md: '\n> [!callout|💡]\n> \n',
    run: (e) => placeBlock(e, fromMd(e, '> [!callout|💡]\n> Text')) },
  callout('note', 'Note'), callout('tip', 'Tip'), callout('important', 'Important'), callout('warning', 'Warning'), callout('caution', 'Caution'),

  { id: 'page', label: 'Page', cat: 'Basic', icon: 'doc', desc: 'A new page inside this one, linked here', aliases: ['subpage', 'sub-page', 'new page', 'child page', 'document'],
    run: async (e, c) => { const p = await c.createDoc?.({ type: 'md', name: 'Untitled' }); if (p) placeBlock(e, { type: 'paragraph', content: [{ type: 'text', text: `[[${p.ref}]]` }] }); } },
  toggle(0), toggle(1), toggle(2), toggle(3),
  columns(2), columns(3), columns(4), columns(5),
  { id: 'toc', label: 'Table of contents', cat: 'Layout', icon: 'outline', desc: 'The headings of this page, live', aliases: ['toc', 'contents', 'outline', 'index', '[toc]'], md: '\n[TOC]\n', run: (e) => placeBlock(e, { type: 'toc' }) },
  { id: 'breadcrumb', label: 'Breadcrumb', cat: 'Layout', icon: 'folder', desc: 'Where this page sits in the workspace', aliases: ['breadcrumb', 'path', 'location'], md: '\n[BREADCRUMB]\n', run: (e) => placeBlock(e, { type: 'breadcrumb' }) },
  { id: 'page-break', label: 'Page break', cat: 'Layout', icon: 'divider', key: 'Mod+Alt+Enter', desc: 'Starts a new page when printed or exported', aliases: ['page break', 'new page', 'break', 'pagebreak'], md: '\n<div class="page-break"></div>\n', run: (e) => placeBlock(e, { type: 'pageBreak' }) },
  database(false), database(true),
  { id: 'synced', label: 'Synced block', cat: 'Links and embeds', icon: 'copy', desc: 'Show a block from another page; edit it there', aliases: ['synced', 'mirror', 'transclusion', 'reuse block'],
    run: async (e, c) => { const t = await c.pickRef?.({ kind: 'embed' }); if (t) placeBlock(e, { type: 'paragraph', content: [{ type: 'text', text: t }] }); } },
  { id: 'link', label: 'Link to a document', cat: 'Links and embeds', icon: 'link', key: 'Mod+Shift+K', desc: '[[Document]], a heading, a cell', aliases: ['[[', 'wiki', 'page', 'mention', 'reference'],
    run: async (e, c) => { const t = await c.pickRef?.({ kind: 'link' }); if (t) e.chain().focus().insertContent({ type: 'text', text: t }).run(); } },
  { id: 'value', label: 'Live value', cat: 'Links and embeds', icon: 'sheet', desc: '{{Budget.sheet#Costs!H6}}', aliases: ['{{', 'cell', 'number', 'formula result'],
    run: async (e, c) => { const t = await c.pickRef?.({ kind: 'value' }); if (t) e.chain().focus().insertContent({ type: 'text', text: t }).run(); } },
  { id: 'template', label: 'Template', cat: 'Advanced', icon: 'doc', desc: 'Insert a page from Templates/', aliases: ['template', 'meeting notes', 'decision', 'brief', 'status report', 'boilerplate', 'snippet'], md: '', run: (e, c) => c.appCommand?.('template') },
  { id: 'help', label: 'Help', cat: 'Advanced', icon: 'doc', desc: 'Shortcuts and syntax cheat sheet', aliases: ['help', 'shortcuts', 'cheat sheet', 'syntax', 'keyboard'], md: '', run: (e, c) => c.appCommand?.('help') },
  { id: 'template-button', label: 'Template button', cat: 'Advanced', icon: 'plus', desc: 'A button that inserts a template (Notion)', aliases: ['button', 'template button', 'repeat'], md: '```template-button\nlabel: New meeting\ntemplate: Meeting notes\n```', run: (e, c) => c.appCommand?.('template-button') },
  { id: 'property', label: 'Property', cat: 'Advanced', icon: 'tag', desc: 'A field above the title (front matter)', aliases: ['property', 'properties', 'front matter', 'yaml', 'metadata', 'field', 'tags'], md: '', run: (e, c) => c.addProperty?.() },
  { id: 'today', label: 'Today', cat: 'Links and embeds', icon: 'calendar', desc: 'A link to today’s daily note', aliases: ['date', 'now', 'daily note', 'journal', 'day'], get md() { return dayLink(0); }, run: (e) => putText(e, dayLink(0)) },
  { id: 'tomorrow', label: 'Tomorrow', cat: 'Links and embeds', icon: 'calendar', desc: 'A link to tomorrow’s daily note', aliases: ['date', 'next day', 'daily note', 'journal'], get md() { return dayLink(1); }, run: (e) => putText(e, dayLink(1)) },
  { id: 'status', label: 'Status chip', cat: 'Links and embeds', icon: 'status', desc: '[status:: In progress], or type @status', aliases: ['status', 'chip', 'badge', 'label', 'progress', 'done', 'inline field'], md: '[status:: In progress]', run: (e) => putText(e, '[status:: In progress]') },
  { id: 'embed', label: 'Embed', cat: 'Links and embeds', icon: 'doc', desc: 'Show part of another document', aliases: ['![[', 'transclude', 'synced block', 'include'],
    run: async (e, c) => { const t = await c.pickRef?.({ kind: 'embed' }); if (t) placeBlock(e, { type: 'paragraph', content: [{ type: 'text', text: t }] }); } },
];
export const CATEGORIES = ['Basic', 'Lists', 'Layout', 'Media and data', 'Databases', 'Advanced', 'Callouts', 'Links and embeds'];

/* recently used items, per person, in this browser */
const RECENT = 'folio.inserts.recent';
export function recentIds() { try { return JSON.parse(localStorage.getItem(RECENT) || '[]').filter((id) => INSERTS.some((i) => i.id === id)); } catch { return []; } }
export function remember(id) { try { localStorage.setItem(RECENT, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, 5))); } catch { /* storage unavailable */ } }

/*
 * Items for a query. Empty query: recent items, then every category. Otherwise the best matches.
 * "3x4" or "table3x4" gives a table of that size. Returns [{ item, marks, args, group }].
 */
export function filterInserts(query, { recent = recentIds() } = {}) {
  const q = query.trim();
  const size = q.match(/^(?:t(?:able)?)?\s*(\d{1,2})\s*[x×]\s*(\d{1,2})$/i);
  if (size) {
    const rows = Math.min(50, Math.max(1, +size[1])), cols = Math.min(20, Math.max(1, +size[2]));
    return [{ item: { ...INSERTS.find((i) => i.id === 'table'), label: `Table ${rows} × ${cols}`, desc: `${rows} rows, ${cols} columns` }, marks: [], args: { rows, cols }, group: 'Media and data' }];
  }
  if (!q) {
    const rec = recent.map((id) => INSERTS.find((i) => i.id === id)).filter(Boolean).map((item) => ({ item, marks: [], group: 'Recent' }));
    return [...rec, ...CATEGORIES.flatMap((cat) => INSERTS.filter((i) => i.cat === cat).map((item) => ({ item, marks: [], group: cat })))];
  }
  return INSERTS.map((item) => ({ item, f: fuzzyItem(q, item.label, item.aliases) }))
    .filter((x) => x.f)
    .sort((a, b) => b.f.score - a.f.score + (recent.includes(b.item.id) ? 5 : 0) - (recent.includes(a.item.id) ? 5 : 0))
    .slice(0, 12)
    .map(({ item, f }) => ({ item, marks: f.marks, group: 'Results' }));
}

/* run an item: change the current block or insert */
export function runInsert(editor, entry, ctx = {}) {
  const { item, args } = entry;
  remember(item.id);
  return item.turn ? item.turn(editor) : item.run(editor, ctx, args);
}
