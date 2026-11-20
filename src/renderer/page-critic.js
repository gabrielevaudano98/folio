// Folio — comments and suggestions (D10) in CriticMarkup, which other Markdown tools read as plain text:
//   {++added++}  {--deleted--}  {~~old~>new~~}  {==highlighted==}{>>comment<<}
// A comment may start with its author and time: {>>Ada, 2026-11-20 14:05: Looks good<<}. Comments that follow one
// another form a thread (replies). Pure helpers first (they run on any text, for the Read view and AI tools), then the
// editor's marks and nodes, then suggest mode (typing becomes {++ ++}, deleting becomes {-- --}).
import { Mark, Node, Extension, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

/* ---------- pure ---------- */
export const CRITIC = /\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{==([\s\S]*?)==\}|\{>>([\s\S]*?)<<\}/g;
const META = /^([^,:\n]{1,48}), (\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?): ([\s\S]*)$/;
/** a comment's author, time and text */
export function parseComment(body) { const m = META.exec(body); return m ? { author: m[1].trim(), date: m[2], text: m[3] } : { author: '', date: '', text: body }; }
export const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const commentBody = (author, text, date = stamp()) => (author ? `${author.replace(/[,:\n]/g, ' ').trim()}, ${date}: ${text}` : text).replace(/<</g, '‹‹');

/* code spans and fences are never markup: blank them out (same length) before matching */
function maskCode(text) {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
}
/** every change and comment in a text: { kind: ins|del|sub|hl|comment, from, to, text, old?, new?, comment? } */
export function listChanges(text) {
  const masked = maskCode(String(text)); const out = []; CRITIC.lastIndex = 0; let m;
  while ((m = CRITIC.exec(masked))) {
    const raw = text.slice(m.index, m.index + m[0].length); const r = new RegExp(CRITIC.source).exec(raw);
    const base = { from: m.index, to: m.index + m[0].length, raw };
    if (r[1] != null) out.push({ ...base, kind: 'ins', text: r[1] });
    else if (r[2] != null) out.push({ ...base, kind: 'del', text: r[2] });
    else if (r[3] != null) out.push({ ...base, kind: 'sub', old: r[3], new: r[4], text: r[4] });
    else if (r[5] != null) out.push({ ...base, kind: 'hl', text: r[5] });
    else out.push({ ...base, kind: 'comment', text: r[6], comment: parseComment(r[6]) });
  }
  return out;
}
const apply = (text, pick) => { let out = '', at = 0; for (const c of listChanges(text)) { const r = pick(c); if (r == null) continue; out += text.slice(at, c.from) + r; at = c.to; } return out + text.slice(at); };
/** accept one change (by its `from`) or all of them; comments and highlights stay */
export const accept = (text, from = null) => apply(text, (c) => (from != null && c.from !== from ? null : c.kind === 'ins' ? c.text : c.kind === 'del' ? '' : c.kind === 'sub' ? c.new : null));
export const reject = (text, from = null) => apply(text, (c) => (from != null && c.from !== from ? null : c.kind === 'ins' ? '' : c.kind === 'del' ? c.text : c.kind === 'sub' ? c.old : null));
/** remove comments and highlight markup (the text stays), as Resolve all does */
export const resolveAll = (text) => apply(text, (c) => (c.kind === 'comment' ? '' : c.kind === 'hl' ? c.text : null));
/** the text as it would read with every suggestion accepted and no comments: for exports and AI tools */
export const clean = (text) => resolveAll(accept(text));

/* ---------- editor ---------- */
const inlineMark = (name, open, close, tag, cls, re) => Mark.create({
  name, inclusive: false, excludes: '',
  parseHTML() { return [{ tag: `${tag}.${cls}` }]; },
  renderHTML() { return [tag, { class: cls }, 0]; },
  parseMarkdown: (token, h) => h.applyMark(name, h.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `${open}${h.renderChildren(node)}${close}`,
  markdownTokenizer: {
    name, level: 'inline',
    start: (src) => src.indexOf(open),
    tokenize(src, _t, lexer) { const m = re.exec(src); return m && m[1] ? { type: name, raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]) } : undefined; },
  },
});
export const CriticIns = inlineMark('criticIns', '{++', '++}', 'ins', 'critic-ins', /^\{\+\+((?:(?!\+\+\})[^\n])+)\+\+\}/);
export const CriticDel = inlineMark('criticDel', '{--', '--}', 'del', 'critic-del', /^\{--((?:(?!--\})[^\n])+)--\}/);
export const CriticHl = inlineMark('criticHl', '{==', '==}', 'mark', 'critic-hl', /^\{==((?:(?!==\})[^\n])+)==\}/);
export const CriticSub = Node.create({
  name: 'criticSub', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { old: { default: '' }, new: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-critic-sub]', getAttrs: (el) => ({ old: el.getAttribute('data-old') || '', new: el.getAttribute('data-new') || '' }) }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-critic-sub': '', 'data-old': node.attrs.old, 'data-new': node.attrs.new, class: 'critic-sub' }), ['del', { class: 'critic-del' }, node.attrs.old], ['ins', { class: 'critic-ins' }, node.attrs.new]]; },
  renderText: ({ node }) => node.attrs.new,
  parseMarkdown: (token, h) => h.createNode('criticSub', { old: token.old, new: token.new }),
  renderMarkdown: (node) => `{~~${node.attrs?.old || ''}~>${node.attrs?.new || ''}~~}`,
  markdownTokenizer: { name: 'criticSub', level: 'inline', start: (src) => src.indexOf('{~~'), tokenize(src) { const m = /^\{~~([^\n]*?)~>([^\n]*?)~~\}/.exec(src); return m ? { type: 'criticSub', raw: m[0], old: m[1], new: m[2] } : undefined; } },
});
export const CriticComment = Node.create({
  name: 'criticComment', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { body: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-critic-comment]', getAttrs: (el) => ({ body: el.getAttribute('data-body') || '' }) }]; },
  renderHTML({ node, HTMLAttributes }) { const c = parseComment(node.attrs.body); return ['span', mergeAttributes(HTMLAttributes, { 'data-critic-comment': '', 'data-body': node.attrs.body, class: 'critic-comment', title: `${c.author ? c.author + ': ' : ''}${c.text}`, contenteditable: 'false' })]; },
  renderText: () => '',
  parseMarkdown: (token, h) => h.createNode('criticComment', { body: token.body }),
  renderMarkdown: (node) => `{>>${node.attrs?.body || ''}<<}`,
  markdownTokenizer: { name: 'criticComment', level: 'inline', start: (src) => src.indexOf('{>>'), tokenize(src) { const m = /^\{>>([^\n]*?)<<\}/.exec(src); return m ? { type: 'criticComment', raw: m[0], body: m[1] } : undefined; } },
});

/** the changes and comment threads of a document, in order, with document positions */
export function docReview(doc) {
  const items = []; const thread = (pos) => items.findLast?.((x) => x.kind === 'thread' && x.end === pos) || [...items].reverse().find((x) => x.kind === 'thread' && x.end === pos);
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let run = null; const flush = () => { if (run) items.push(run); run = null; };
    node.forEach((child, off) => {
      const at = pos + 1 + off;
      if (child.type.name === 'criticComment') {
        flush();
        const t = thread(at);
        if (t) { t.comments.push({ pos: at, body: child.attrs.body, ...parseComment(child.attrs.body) }); t.end = at + 1; return; }
        const prev = items.at(-1); const anchor = prev && prev.kind === 'hl' && prev.to === at ? items.pop() : null;
        items.push({ kind: 'thread', from: anchor ? anchor.from : at, to: anchor ? anchor.to : at, quote: anchor ? anchor.text : '', hl: !!anchor, start: at, end: at + 1, comments: [{ pos: at, body: child.attrs.body, ...parseComment(child.attrs.body) }] });
        return;
      }
      if (child.type.name === 'criticSub') { flush(); items.push({ kind: 'sub', from: at, to: at + 1, old: child.attrs.old, new: child.attrs.new, text: child.attrs.new }); return; }
      const kind = child.isText ? (child.marks.find((m) => m.type.name === 'criticIns') ? 'ins' : child.marks.find((m) => m.type.name === 'criticDel') ? 'del' : child.marks.find((m) => m.type.name === 'criticHl') ? 'hl' : null) : null;
      if (kind && run && run.kind === kind && run.to === at) { run.to += child.nodeSize; run.text += child.text; return; }
      flush(); if (kind) run = { kind, from: at, to: at + child.nodeSize, text: child.text };
    });
    flush();
    return false;
  });
  return items;
}

/** accept or reject one change (an item of docReview) in a transaction; returns the transaction */
export function settle(state, item, ok, tr = state.tr) {
  const { schema } = state; const map = (p) => tr.mapping.map(p);
  const from = map(item.from), to = map(item.to);
  if (item.kind === 'ins') ok ? tr.removeMark(from, to, schema.marks.criticIns) : tr.delete(from, to);
  else if (item.kind === 'del') ok ? tr.delete(from, to) : tr.removeMark(from, to, schema.marks.criticDel);
  else if (item.kind === 'sub') { const t = ok ? item.new : item.old; if (t) tr.replaceWith(from, to, schema.text(t, state.doc.resolve(item.from).marks())); else tr.delete(from, to); }
  return tr;
}
/** resolve a thread: its comments go, the highlighted text stays */
export function resolveThread(state, t, tr = state.tr) {
  for (const c of [...t.comments].reverse()) tr.delete(tr.mapping.map(c.pos), tr.mapping.map(c.pos + 1));
  if (t.hl) tr.removeMark(tr.mapping.map(t.from), tr.mapping.map(t.to), state.schema.marks.criticHl);
  return tr;
}

/* suggest mode: what you type is marked as added, what you delete is marked as deleted (text you added yourself goes) */
export const SUGGEST = new PluginKey('folioSuggest');
function markDeleted(tr, from, to) {
  const { criticIns, criticDel } = tr.doc.type.schema.marks; const gone = [];
  tr.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isText) return true;
    const a = Math.max(from, pos), b = Math.min(to, pos + n.nodeSize);
    if (n.marks.some((m) => m.type === criticIns)) gone.push([a, b]); else tr.addMark(a, b, criticDel.create());
    return false;
  });
  for (const [a, b] of gone.reverse()) tr.delete(a, b);
  return gone.reduce((s, [a, b]) => s + (b - a), 0);
}
function insertSuggested(state, tr, at, text) {
  const marks = [...(state.storedMarks || state.doc.resolve(at).marks()).filter((m) => m.type.name !== 'criticDel' && m.type.name !== 'criticIns'), state.schema.marks.criticIns.create()];
  tr.insert(at, state.schema.text(text, marks)); return at + text.length;
}
export const SuggestMode = Extension.create({
  name: 'suggestMode',
  addStorage() { return { on: false }; },
  addProseMirrorPlugins() {
    const store = this.storage;
    const replace = (view, from, to, text) => {
      const { state } = view; const tr = state.tr;
      let at = to;
      if (from < to) { const removed = markDeleted(tr, from, to); at = to - removed; }
      const end = text ? insertSuggested(state, tr, at, text) : at;
      tr.setSelection(TextSelection.create(tr.doc, text ? end : Math.min(from, tr.doc.content.size))).setMeta(SUGGEST, true);
      view.dispatch(tr.scrollIntoView()); return true;
    };
    const step = (view, dir) => {
      const { state } = view; const { selection } = state;
      if (!selection.empty) return replace(view, selection.from, selection.to, '');
      const $p = selection.$from; const del = state.schema.marks.criticDel;
      let pos = selection.from;
      // step over text already marked deleted
      for (;;) {
        const n = dir < 0 ? state.doc.resolve(pos).nodeBefore : state.doc.resolve(pos).nodeAfter;
        if (!n || !n.isText || !n.marks.some((m) => m.type === del) || pos === (dir < 0 ? $p.start() : $p.end())) break;
        pos += dir * n.nodeSize;
      }
      const $at = state.doc.resolve(pos);
      if ((dir < 0 && pos <= $at.start()) || (dir > 0 && pos >= $at.end())) { view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos))); return true; }
      const chars = [...(dir < 0 ? $at.parent.textBetween(0, $at.parentOffset) : $at.parent.textBetween($at.parentOffset, $at.parent.content.size))];
      const w = (dir < 0 ? chars.at(-1) : chars[0])?.length || 1;
      const from = dir < 0 ? pos - w : pos, to = dir < 0 ? pos : pos + w;
      const tr = state.tr; const removed = markDeleted(tr, from, to);
      tr.setSelection(TextSelection.create(tr.doc, dir < 0 ? from : to - removed)).setMeta(SUGGEST, true);
      view.dispatch(tr); return true;
    };
    return [new Plugin({
      key: SUGGEST,
      props: {
        handleTextInput(view, from, to, text) { if (!store.on || view.state.selection.$from.parent.type.spec.code) return false; return replace(view, from, to, text); },
        handleKeyDown(view, e) {
          if (!store.on || view.state.selection.$from.parent.type.spec.code) return false;
          if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) return step(view, -1);
          if (e.key === 'Delete' && !e.metaKey && !e.ctrlKey && !e.altKey) return step(view, 1);
          return false;
        },
        handlePaste(view, e) {
          if (!store.on) return false; const text = e.clipboardData?.getData('text/plain'); if (!text || text.includes('\n')) return false;
          e.preventDefault(); const { from, to } = view.state.selection; return replace(view, from, to, text);
        },
        handleDOMEvents: {
          cut(view, e) {
            if (!store.on || view.state.selection.empty) return false;
            const { from, to } = view.state.selection; e.clipboardData?.setData('text/plain', view.state.doc.textBetween(from, to, '\n')); e.preventDefault();
            replace(view, from, to, ''); return true;
          },
        },
      },
    })];
  },
});

export const critic = () => [CriticIns, CriticDel, CriticHl, CriticSub, CriticComment];
