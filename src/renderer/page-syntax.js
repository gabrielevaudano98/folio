// Folio — page syntax beyond CommonMark: how each piece reads from and writes to Markdown.
// Pure (no DOM at import). Node views are added by the editor (rich.js); the format tests use these as they are.
//   <sup>x</sup> <sub>x</sub>           superscript, subscript (HTML, readable everywhere)
//   $x^2$  and  $$ … $$                  maths (KaTeX), Pandoc rules for $: no space inside, no digit after
//   [^1]  ^[inline note]  [^1]: text     footnotes (Pandoc, Obsidian, GitHub)
//   %%hidden%%                           comment only the author sees (Obsidian)
//   [text]{color=red bg=yellow}          Folio colour (Pandoc span syntax; removed by portable export)
//   paragraph line + {align=center}      Folio alignment (Pandoc attribute; heading: "## Title {align=center}")
import { Node, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin as PmPlugin } from '@tiptap/pm/state';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { Details as BaseDetails, DetailsSummary as BaseSummary, DetailsContent as BaseContent } from '@tiptap/extension-details';

export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
export const ALIGNS = ['left', 'center', 'right', 'justify'];

/* an inline HTML tag as a mark: <tag>…</tag>, skipping code spans (same approach as TipTap's underline) */
function tagTokenizer(name, tag) {
  const open = `<${tag}>`;
  return {
    name, level: 'inline',
    start: (src) => src.toLowerCase().indexOf(open),
    tokenize(src, _t, lexer) {
      if (!src.toLowerCase().startsWith(open)) return undefined;
      const re = new RegExp(`\\\\[\\s\\S]|\`+|</${tag}>`, 'gi'); re.lastIndex = open.length;
      for (let m = re.exec(src); m; m = re.exec(src)) {
        if (m[0].startsWith('`')) { const span = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.exec(src.slice(m.index)); if (span) re.lastIndex = m.index + span[0].length; continue; }
        if (m[0].startsWith('\\')) continue;
        const text = src.slice(open.length, m.index);
        if (!text) return undefined;
        return { type: name, raw: src.slice(0, re.lastIndex), text, tokens: lexer.inlineTokens(text) };
      }
      return undefined;
    },
  };
}
const tagMarkdown = (name, tag) => ({
  parseMarkdown: (token, h) => h.applyMark(name, h.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `<${tag}>${h.renderChildren(node)}</${tag}>`,
  markdownTokenizer: tagTokenizer(name, tag),
});
export const SuperscriptMd = Superscript.extend(tagMarkdown('superscript', 'sup'));
export const SubscriptMd = Subscript.extend(tagMarkdown('subscript', 'sub'));

/* maths */
export const INLINE_MATH = /^\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?!\d)/;
export const InlineMath = Node.create({
  name: 'inlineMath', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { latex: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-type="inline-math"]', getAttrs: (el) => ({ latex: el.getAttribute('data-latex') || '' }) }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math', 'data-latex': node.attrs.latex })]; },
  parseMarkdown: (token, h) => h.createNode('inlineMath', { latex: token.latex }),
  renderMarkdown: (node) => `$${node.attrs?.latex || ''}$`,
  markdownTokenizer: {
    name: 'inlineMath', level: 'inline',
    start: (src) => src.indexOf('$'),
    tokenize(src) { const m = INLINE_MATH.exec(src); return m ? { type: 'inlineMath', raw: m[0], latex: m[1] } : undefined; },
  },
});
export const BlockMath = Node.create({
  name: 'blockMath', group: 'block', atom: true, selectable: true,
  addAttributes() { return { latex: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-type="block-math"]', getAttrs: (el) => ({ latex: el.getAttribute('data-latex') || '' }) }]; },
  renderHTML({ node, HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math', 'data-latex': node.attrs.latex })]; },
  parseMarkdown: (token, h) => h.createNode('blockMath', { latex: token.latex }),
  renderMarkdown: (node) => `$$\n${node.attrs?.latex || ''}\n$$`,
  markdownTokenizer: {
    name: 'blockMath', level: 'block',
    start: (src) => src.indexOf('$$'),
    tokenize(src) {
      const m = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n[ \t]*\$\$[ \t]*(?:\n|$)/.exec(src) || /^ {0,3}\$\$([^$\n]+)\$\$[ \t]*(?:\n|$)/.exec(src);
      return m ? { type: 'blockMath', raw: m[0], latex: m[1] } : undefined;
    },
  },
});

/* footnotes */
export const FootnoteRef = Node.create({
  name: 'footnoteRef', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { label: { default: '1' } }; },
  parseHTML() { return [{ tag: 'sup[data-footnote]', getAttrs: (el) => ({ label: el.getAttribute('data-footnote') }) }]; },
  renderHTML({ node }) { return ['sup', { 'data-footnote': node.attrs.label }, node.attrs.label]; },
  parseMarkdown: (token, h) => h.createNode('footnoteRef', { label: token.label }),
  renderMarkdown: (node) => `[^${node.attrs?.label}]`,
  markdownTokenizer: {
    name: 'footnoteRef', level: 'inline',
    start: (src) => src.indexOf('[^'),
    tokenize(src) { const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src); return m ? { type: 'footnoteRef', raw: m[0], label: m[1] } : undefined; },
  },
});
export const FootnoteInline = Node.create({
  name: 'footnoteInline', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { text: { default: '' } }; },
  parseHTML() { return [{ tag: 'sup[data-inline-note]', getAttrs: (el) => ({ text: el.getAttribute('data-inline-note') }) }]; },
  renderHTML({ node }) { return ['sup', { 'data-inline-note': node.attrs.text }, '*']; },
  parseMarkdown: (token, h) => h.createNode('footnoteInline', { text: token.text }),
  renderMarkdown: (node) => `^[${node.attrs?.text || ''}]`,
  markdownTokenizer: {
    name: 'footnoteInline', level: 'inline',
    start: (src) => src.indexOf('^['),
    tokenize(src) { const m = /^\^\[((?:[^[\]\n]|\[[^\]\n]*\])+)\]/.exec(src); return m ? { type: 'footnoteInline', raw: m[0], text: m[1] } : undefined; },
  },
});
export const FOOTNOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?![ \t]*\n)(?! {0,3}\[\^[^\]\s]+\]:)[^\n]*)*)(?:\n|$)/;
export const FootnoteDef = Node.create({
  name: 'footnoteDef', group: 'block', content: 'inline*', defining: true,
  addAttributes() { return { label: { default: '1' } }; },
  parseHTML() { return [{ tag: 'div[data-footnote-def]', getAttrs: (el) => ({ label: el.getAttribute('data-footnote-def') }) }]; },
  renderHTML({ node, HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-footnote-def': node.attrs.label }), 0]; },
  parseMarkdown: (token, h) => h.createNode('footnoteDef', { label: token.label }, h.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `[^${node.attrs?.label}]: ${node.content ? h.renderChildren(node.content) : ''}`,
  markdownTokenizer: {
    name: 'footnoteDef', level: 'block',
    start: (src) => { const m = /(^|\n) {0,3}\[\^[^\]\s]+\]:/.exec(src); return m ? m.index + m[1].length : -1; },
    tokenize(src, _t, lexer) { const m = FOOTNOTE_DEF.exec(src); return m ? { type: 'footnoteDef', raw: m[0], label: m[1], text: m[2], tokens: lexer.inlineTokens(m[2]) } : undefined; },
  },
});

/* %%hidden comment%% */
export const HiddenComment = Mark.create({
  name: 'hiddenComment', inclusive: false,
  parseHTML() { return [{ tag: 'span[data-hidden-comment]' }]; },
  renderHTML() { return ['span', { 'data-hidden-comment': '', class: 'rich-hidden-comment', title: 'Hidden comment: only in the file, not in the preview or exports' }, 0]; },
  parseMarkdown: (token, h) => h.applyMark('hiddenComment', h.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `%%${h.renderChildren(node)}%%`,
  markdownTokenizer: {
    name: 'hiddenComment', level: 'inline',
    start: (src) => src.indexOf('%%'),
    tokenize(src, _t, lexer) { const m = /^%%([^%\n](?:[^\n]*?[^%\n])?)%%/.exec(src); return m ? { type: 'hiddenComment', raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]) } : undefined; },
  },
});

/* [text]{color=red bg=yellow} */
const COLOR_SPAN = new RegExp(`^\\[((?:\\\\.|[^\\[\\]\\\\\\n])+)\\]\\{((?:\\s*(?:color|bg)=(?:${COLORS.join('|')}))+)\\s*\\}`);
export function parseColorAttrs(s) { const a = { color: null, bg: null }; for (const m of s.matchAll(/(color|bg)=(\w+)/g)) a[m[1]] = m[2]; return a; }
export const FolioColor = Mark.create({
  name: 'folioColor', inclusive: true,
  addAttributes() { return { color: { default: null }, bg: { default: null } }; },
  parseHTML() { return [{ tag: 'span[data-folio-color]', getAttrs: (el) => ({ color: el.getAttribute('data-color') || null, bg: el.getAttribute('data-bg') || null }) }]; },
  renderHTML({ mark }) { return ['span', { 'data-folio-color': '', 'data-color': mark.attrs.color || undefined, 'data-bg': mark.attrs.bg || undefined }, 0]; },
  parseMarkdown: (token, h) => h.applyMark('folioColor', h.parseInline(token.tokens || []), parseColorAttrs(token.attrs)),
  renderMarkdown: (node, h) => {
    const a = node.attrs || {}; const attrs = [a.color && `color=${a.color}`, a.bg && `bg=${a.bg}`].filter(Boolean).join(' ');
    const inner = h.renderChildren(node);
    return attrs ? `[${inner}]{${attrs}}` : inner;
  },
  markdownTokenizer: {
    name: 'folioColor', level: 'inline',
    start: (src) => { const i = src.search(/\[[^\]\n]+\]\{\s*(?:color|bg)=/); return i; },
    tokenize(src, _t, lexer) { const m = COLOR_SPAN.exec(src); return m ? { type: 'folioColor', raw: m[0], text: m[1], attrs: m[2], tokens: lexer.inlineTokens(m[1]) } : undefined; },
  },
});

/* alignment: TipTap's TextAlign attribute, written as a Pandoc-style attribute */
const ALIGN_ALT = ALIGNS.join('|');
function stripTrailing(tokens, re) {
  const toks = tokens.slice(); const last = toks.at(-1);
  if (!last || last.type !== 'text') return null;
  const m = re.exec(last.text); if (!m) return null;
  const text = last.text.slice(0, m.index);
  if (text) toks[toks.length - 1] = { ...last, text, raw: text, tokens: last.tokens ? undefined : last.tokens };
  else toks.pop();
  while (toks.length && toks.at(-1).type === 'br') toks.pop();
  return { toks, align: m[1] };
}
export const AlignedParagraph = Paragraph.extend({
  parseMarkdown(token, h) {
    const s = stripTrailing(token.tokens || [], new RegExp(`\\n\\{align=(${ALIGN_ALT})\\}[ \\t]*$`));
    if (!s) return this.parent(token, h);
    const node = this.parent({ ...token, tokens: s.toks }, h);
    return { ...node, attrs: { ...(node.attrs || {}), textAlign: s.align } };
  },
  renderMarkdown(node, h, ctx) {
    const out = this.parent(node, h, ctx); const a = node.attrs?.textAlign;
    return a && out ? `${out}\n{align=${a}}` : out;
  },
});
export const AlignedHeading = Heading.extend({
  parseMarkdown(token, h) {
    const s = stripTrailing(token.tokens || [], new RegExp(`[ \\t]+\\{align=(${ALIGN_ALT})\\}[ \\t]*$`));
    if (!s) return this.parent(token, h);
    const node = this.parent({ ...token, tokens: s.toks }, h);
    return { ...node, attrs: { ...(node.attrs || {}), textAlign: s.align } };
  },
  renderMarkdown(node, h, ctx) {
    const out = this.parent(node, h, ctx); const a = node.attrs?.textAlign;
    return a && out ? `${out} {align=${a}}` : out;
  },
});
export const Align = TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ALIGNS, defaultAlignment: null });

/* Remove Folio-only syntax for a portable .md (colour, alignment). Used by "Export → Markdown". */
export function portableMarkdown(md) {
  return md
    .replace(new RegExp(`\\[((?:\\\\.|[^\\[\\]\\\\\\n])+)\\]\\{(?:\\s*(?:color|bg)=(?:${COLORS.join('|')}))+\\s*\\}`, 'g'), '$1')
    .replace(new RegExp(`\\n\\{align=(?:${ALIGN_ALT})\\}[ \\t]*(?=\\n|$)`, 'g'), '')
    .replace(new RegExp(`^(#{1,6} .*?)[ \\t]+\\{align=(?:${ALIGN_ALT})\\}[ \\t]*$`, 'gm'), '$1');
}

/* toggle (Notion) = <details>; a toggle heading puts the heading in the summary: <summary><h2>Title</h2></summary> */
function closeOf(src, open, close, from) {
  const re = new RegExp(`${open}|${close}`, 'gi'); re.lastIndex = from; let depth = 1;
  for (let m = re.exec(src); m; m = re.exec(src)) { depth += m[0].toLowerCase().startsWith(close.replace(/\\/g, '').slice(0, 3)) ? -1 : 1; if (!depth) return m; }
  return null;
}
export const Details = BaseDetails.extend({
  addAttributes() { return { ...this.parent?.(), heading: { default: 0, parseHTML: (el) => +el.getAttribute('data-heading') || 0, renderHTML: (a) => (a.heading ? { 'data-heading': a.heading } : {}) } }; },
  parseMarkdown: (token, h) => h.createNode('details', { open: token.open, heading: token.heading }, [
    h.createNode('detailsSummary', null, token.summary ? [{ type: 'text', text: token.summary }] : []),
    h.createNode('detailsContent', null, token.tokens?.length ? h.parseChildren(token.tokens) : [{ type: 'paragraph' }]),
  ]),
  renderMarkdown: (node, h) => {
    const [summary, content] = node.content || [];
    const level = node.attrs?.heading || 0;
    const title = (summary?.content || []).map((t) => t.text || '').join('');
    const body = content ? h.renderChildren(content.content || [], '\n\n') : '';
    return `<details${node.attrs?.open ? ' open' : ''}>\n<summary>${level ? `<h${level}>${title}</h${level}>` : title}</summary>\n\n${body.trim()}\n\n</details>`;
  },
  markdownTokenizer: {
    name: 'details', level: 'block',
    start: (src) => { const m = /(^|\n) {0,3}<details[\s>]/i.exec(src); return m ? m.index + m[1].length : -1; },
    tokenize(src, _t, lexer) {
      const open = /^ {0,3}<details(\s+open)?\s*>[ \t]*\n?/i.exec(src);
      if (!open) return undefined;
      const end = closeOf(src, '<details[\\s>]', '</details>', open[0].length);
      if (!end) return undefined;
      let inner = src.slice(open[0].length, end.index);
      const sm = /^\s*<summary>\s*(?:<h([1-6])>([\s\S]*?)<\/h\1>|([\s\S]*?))\s*<\/summary>[ \t]*\n?/i.exec(inner);
      if (!sm || /\n\s*\n/.test(sm[0])) return undefined;
      inner = inner.slice(sm[0].length);
      const after = /^[ \t]*(?:\n|$)/.exec(src.slice(end.index + end[0].length));
      return { type: 'details', raw: src.slice(0, end.index + end[0].length + (after ? after[0].length : 0)), open: !!open[1], heading: sm[1] ? +sm[1] : 0, summary: (sm[2] ?? sm[3] ?? '').trim(), tokens: lexer.blockTokens(inner.replace(/^\n+|\s+$/g, '')) };
    },
  },
});
export const DetailsSummary = BaseSummary.extend({ parseMarkdown: undefined, renderMarkdown: undefined, markdownTokenizer: undefined });
export const DetailsContent = BaseContent.extend({ parseMarkdown: undefined, renderMarkdown: undefined, markdownTokenizer: undefined });

/* :::: columns / ::: column (markdown-it-container, as in slides; the outer fence has four colons so it can hold the inner ones) */
function containerTokenizer(name, parse) {
  return {
    name, level: 'block',
    start: (src) => { const m = new RegExp(`(^|\\n) {0,3}:{3,}[ \\t]*${name}[ \\t]*\\n`).exec(src); return m ? m.index + m[1].length : -1; },
    tokenize(src, _t, lexer) {
      const open = new RegExp(`^ {0,3}:{3,}[ \\t]*${name}[ \\t]*\\n`).exec(src);
      if (!open) return undefined;
      const re = /^ {0,3}:{3,}[ \t]*([\w-]*)[ \t]*$/gm; re.lastIndex = 0;
      const rest = src.slice(open[0].length); let depth = 1;
      for (let m = re.exec(rest); m; m = re.exec(rest)) {
        depth += m[1] ? 1 : -1;
        if (!depth) { const end = open[0].length + m.index + m[0].length; const nl = src[end] === '\n' ? 1 : 0; return parse(src.slice(0, end + nl), rest.slice(0, m.index), lexer); }
      }
      return undefined;
    },
  };
}
export const Column = Node.create({
  name: 'column', content: 'block+', isolating: true, defining: true,
  parseHTML() { return [{ tag: 'div[data-column]' }]; },
  renderHTML() { return ['div', { 'data-column': '', class: 'rich-column' }, 0]; },
  parseMarkdown: (token, h) => h.createNode('column', null, token.tokens?.length ? h.parseChildren(token.tokens) : [{ type: 'paragraph' }]),
  renderMarkdown: (node, h) => `::: column\n${h.renderChildren(node.content || [], '\n\n').trim()}\n:::`,
  markdownTokenizer: containerTokenizer('column', (raw, inner, lexer) => ({ type: 'column', raw, tokens: lexer.blockTokens(inner.replace(/^\n+|\s+$/g, '')) })),
});
export const Columns = Node.create({
  name: 'columns', group: 'block', content: 'column{2,5}', isolating: true,
  parseHTML() { return [{ tag: 'div[data-columns]' }]; },
  renderHTML() { return ['div', { 'data-columns': '', class: 'rich-columns' }, 0]; },
  parseMarkdown: (token, h) => h.createNode('columns', null, h.parseChildren(token.tokens || [])),
  renderMarkdown: (node, h) => `:::: columns\n${h.renderChildren(node.content || [], '\n').trim()}\n::::`,
  markdownTokenizer: containerTokenizer('columns', (raw, inner, lexer) => {
    const tokens = lexer.blockTokens(inner.trim());
    return tokens.filter((t) => t.type !== 'space').every((t) => t.type === 'column') && tokens.filter((t) => t.type === 'column').length >= 2 ? { type: 'columns', raw, tokens: tokens.filter((t) => t.type === 'column') } : undefined;
  }),
});

/* [TOC], [BREADCRUMB], page break: one-line blocks */
function lineBlock(name, re, md, extra = {}) {
  return Node.create({
    name, group: 'block', atom: true, selectable: true, draggable: false, ...extra,
    parseHTML() { return [{ tag: `div[data-${name}]` }]; },
    renderHTML() { return ['div', { [`data-${name}`]: '' }]; },
    parseMarkdown: (_t, h) => h.createNode(name),
    renderMarkdown: () => md,
    markdownTokenizer: { name, level: 'block', start: (src) => { const m = new RegExp(`(^|\\n)${re.source.slice(1)}`, 'i').exec(src); return m ? m.index + m[1].length : -1; }, tokenize(src) { const m = re.exec(src); return m ? { type: name, raw: m[0] } : undefined; } },
  });
}
export const Toc = lineBlock('toc', /^ {0,3}\[TOC\][ \t]*(?:\n|$)/i, '[TOC]');
export const Breadcrumb = lineBlock('breadcrumb', /^ {0,3}\[BREADCRUMB\][ \t]*(?:\n|$)/i, '[BREADCRUMB]');
export const PageBreak = lineBlock('pageBreak', /^ {0,3}<div class="page-break"><\/div>[ \t]*(?:\n|$)/i, '<div class="page-break"></div>');

/* A soft line break: a line that continues the same paragraph. Text never holds "\n" in the editor (the browser can turn
   it into a hard break when it re-reads the page); it is this node, drawn as <br data-soft> and written as a plain newline. */
export const SoftBreak = Node.create({
  name: 'softBreak', group: 'inline', inline: true, selectable: false,
  extendNodeSchema: (ext) => (ext.name === 'softBreak' ? { leafText: () => '\n' } : {}),
  parseHTML() { return [{ tag: 'br[data-soft]', priority: 60 }]; },
  renderHTML() { return ['br', { 'data-soft': '' }]; },
  renderText: () => '\n',
  renderMarkdown: () => '\n',
  addProseMirrorPlugins() {
    const type = () => this.editor.schema.nodes.softBreak;
    return [new PmPlugin({
      appendTransaction(trs, _old, state) {
        if (!trs.some((t) => t.docChanged)) return null;
        const fix = []; state.doc.descendants((n, pos, parent) => { if (n.type.spec.code || n.type.name === 'detailsSummary') return false; if (n.isText && n.text.includes('\n') && !parent.type.spec.code) fix.push([n, pos]); return true; });
        if (!fix.length) return null;
        const tr = state.tr;
        for (const [n, pos] of fix.reverse()) for (let i = n.text.lastIndexOf('\n'); i >= 0; i = n.text.lastIndexOf('\n', i - 1)) tr.replaceWith(pos + i, pos + i + 1, type().create());
        return tr;
      },
    })];
  },
});
/* the same, on parsed JSON: text with "\n" becomes text + softBreak + text, outside code */
export function softBreaks(node) {
  if (!node || node.type === 'codeBlock' || node.type === 'detailsSummary') return node;
  if (!node.content) return node;
  const content = [];
  for (const c of node.content) {
    if (c.type === 'text' && c.text.includes('\n') && !(c.marks || []).some((m) => m.type === 'code')) {
      c.text.split('\n').forEach((part, i) => { if (i) content.push({ type: 'softBreak' }); if (part) content.push({ ...c, text: part }); });
    } else content.push(softBreaks(c));
  }
  return { ...node, content };
}

/* Images and media share Markdown's image syntax, as in Obsidian:
     ![Alt|400](assets/photo.png "Caption")   width 400 px (Obsidian), caption from the title
     ![Demo](assets/clip.mp4)                 video; .mp3 .m4a .wav … audio; .pdf a PDF card
     ![](https://www.youtube.com/watch?v=…)   a web embed card (YouTube, Vimeo, Loom, Figma, Maps …) */
const IMG = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
export function mediaKind(src = '') {
  const s = src.split(/[?#]/)[0];
  if (/^data:image\//.test(src) || IMG.test(s)) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(s)) return 'video';
  if (/\.(mp3|m4a|wav|ogg|oga|aac|flac)$/i.test(s)) return 'audio';
  if (/\.pdf$/i.test(s)) return 'pdf';
  if (/^https?:/i.test(src)) return webProvider(src) ? 'web' : 'image';
  return 'file';
}
const PROVIDERS = [
  ['YouTube', /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i, (id) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`],
  ['Vimeo', /vimeo\.com\/(\d+)/i], ['Loom', /loom\.com\/(?:share|embed)\/(\w+)/i], ['Figma', /figma\.com\/(?:file|design|proto|board)\//i],
  ['Google Maps', /(?:google\.[a-z.]+\/maps|maps\.app\.goo\.gl)/i], ['Google Drive', /(?:docs|drive)\.google\.com\//i], ['Miro', /miro\.com\/app\/board/i],
  ['X', /(?:twitter|x)\.com\/\w+\/status\/\d+/i], ['CodePen', /codepen\.io\/[\w-]+\/pen\//i], ['GitHub Gist', /gist\.github\.com\//i], ['Spotify', /open\.spotify\.com\//i],
  ['SoundCloud', /soundcloud\.com\//i], ['Excalidraw', /excalidraw\.com\//i], ['Canva', /canva\.com\/design\//i],
];
export function webProvider(url = '') {
  for (const [name, re, thumb] of PROVIDERS) { const m = re.exec(url); if (m) return { name, thumb: thumb && m[1] ? thumb(m[1]) : null, host: url.replace(/^https?:\/\/(?:www\.)?([^/]+).*$/i, '$1') }; }
  return null;
}
export const PageImage = Image.extend({
  addAttributes() { return { ...this.parent?.(), size: { default: null, renderHTML: () => ({}), parseHTML: () => null } }; },
  parseMarkdown: (token, h) => {
    const m = /^([\s\S]*?)\|(\d+(?:x\d+)?)$/.exec(token.text || '');
    return h.createNode('image', { src: token.href, title: token.title || null, alt: m ? m[1] : token.text, size: m ? m[2] : null });
  },
  renderMarkdown: (node) => {
    const a = node.attrs || {};
    const alt = (a.alt || '') + (a.size ? `|${a.size}` : '');
    return `![${alt}](${a.src || ''}${a.title ? ` "${String(a.title).replace(/"/g, '\\"')}"` : ''})`;
  },
});

export const pageSyntax = () => [SoftBreak, Details.configure({ persist: true, HTMLAttributes: { class: 'rich-details' } }), DetailsSummary, DetailsContent, Columns, Column, Toc, Breadcrumb, PageBreak, SuperscriptMd, SubscriptMd, InlineMath, BlockMath, FootnoteRef, FootnoteInline, FootnoteDef, HiddenComment, FolioColor, Align];
