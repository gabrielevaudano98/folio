// Folio — what you can insert in a page, in one list. The / menu, the @ menu (D5) and the command palette all read it.
// Each item: id, label, desc, cat, aliases, icon (icons.js key) or badge (short text), key (shortcut), md (what the
// source view inserts), and either `turn` (change the current block, keeping its text) or `run` (insert something).
// Pure: functions receive the TipTap editor and a context from the host ({ pickImage, pickRef }).
import { fuzzyItem } from './fuzzy.js';

const CHART = 'type: column\ntitle: Chart\ndata:\n| Month | Value |\n| --- | --- |\n| Jan | 10 |\n| Feb | 14 |\n| Mar | 9 |';
const MERMAID = 'flowchart LR\n  A[Idea] --> B[Draft] --> C[Shipped]';

/* put a block at the cursor: replace an empty paragraph, otherwise go after the current block */
export function placeBlock(editor, content) {
  const { $from } = editor.state.selection;
  const para = $from.parent;
  const empty = para.type.name === 'paragraph' && !para.content.size;
  const at = empty ? $from.before() : $from.after();
  const ok = editor.chain().focus().insertContentAt(empty ? { from: at, to: $from.after() } : at, content).run();
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
const fromMd = (editor, md) => editor.markdown.parse(md).content || [];
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

export const INSERTS = [
  { id: 'text', label: 'Text', cat: 'Basic', badge: 'T', key: 'Mod+Alt+0', desc: 'Plain paragraph', aliases: ['paragraph', 'p', 'plain', 'normal'], md: '', turn: (e) => e.chain().focus().setParagraph().run() },
  heading(1), heading(2), heading(3), heading(4), heading(5), heading(6),
  { id: 'quote', label: 'Quote', cat: 'Basic', icon: 'quote', desc: 'Quoted text', aliases: ['blockquote', '>', 'citation'], md: '> ', turn: (e) => e.chain().focus().setParagraph().toggleBlockquote().run() },
  { id: 'divider', label: 'Divider', cat: 'Basic', icon: 'divider', desc: 'A line between sections', aliases: ['hr', 'line', 'separator', 'rule', '---'], md: '\n---\n', run: (e) => placeBlock(e, { type: 'horizontalRule' }) },

  { id: 'bullet', label: 'Bulleted list', cat: 'Lists', icon: 'listBullet', key: 'Mod+Shift+8', desc: 'A simple list', aliases: ['ul', 'bullets', 'unordered', '-'], md: '- ', turn: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: 'Numbered list', cat: 'Lists', icon: 'listOrdered', key: 'Mod+Shift+7', desc: 'A list with numbers', aliases: ['ol', 'numbers', 'ordered', '1.'], md: '1. ', turn: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'task', label: 'Checklist', cat: 'Lists', icon: 'listTask', key: 'Mod+L', desc: 'Tasks with checkboxes', aliases: ['todo', 'to-do', 'tasks', 'checkbox', '[]'], md: '- [ ] ', turn: (e) => e.chain().focus().toggleTaskList().run() },

  { id: 'table', label: 'Table', cat: 'Media and data', icon: 'table', desc: 'Type /3x4 for a size', aliases: ['grid', 'rows', 'columns'], md: '\n| Column | Column |\n| --- | --- |\n|  |  |\n',
    run: (e, _c, a = {}) => {
      if (!e.state.selection.$from.parent.content.size) placeBlock(e, { type: 'paragraph' });
      return e.chain().focus().insertTable({ rows: a.rows || 3, cols: a.cols || 3, withHeaderRow: true }).run();
    } },
  { id: 'image', label: 'Image', cat: 'Media and data', icon: 'image', desc: 'From a file, saved in assets', aliases: ['picture', 'photo', 'img', 'figure'],
    run: async (e, c) => { const src = await c.pickImage?.(); if (src) placeBlock(e, { type: 'image', attrs: { src, alt: src.split('/').pop().replace(/^[a-z0-9]+-/, '').replace(/\.\w+$/, '') } }); } },
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

  callout('note', 'Note'), callout('tip', 'Tip'), callout('important', 'Important'), callout('warning', 'Warning'), callout('caution', 'Caution'),

  { id: 'link', label: 'Link to a document', cat: 'Links and embeds', icon: 'link', key: 'Mod+Shift+K', desc: '[[Document]], a heading, a cell', aliases: ['[[', 'wiki', 'page', 'mention', 'reference'],
    run: async (e, c) => { const t = await c.pickRef?.({ kind: 'link' }); if (t) e.chain().focus().insertContent({ type: 'text', text: t }).run(); } },
  { id: 'value', label: 'Live value', cat: 'Links and embeds', icon: 'sheet', desc: '{{Budget.sheet#Costs!H6}}', aliases: ['{{', 'cell', 'number', 'formula result'],
    run: async (e, c) => { const t = await c.pickRef?.({ kind: 'value' }); if (t) e.chain().focus().insertContent({ type: 'text', text: t }).run(); } },
  { id: 'embed', label: 'Embed', cat: 'Links and embeds', icon: 'doc', desc: 'Show part of another document', aliases: ['![[', 'transclude', 'synced block', 'include'],
    run: async (e, c) => { const t = await c.pickRef?.({ kind: 'embed' }); if (t) placeBlock(e, { type: 'paragraph', content: [{ type: 'text', text: t }] }); } },
];
export const CATEGORIES = ['Basic', 'Lists', 'Media and data', 'Advanced', 'Callouts', 'Links and embeds'];

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
