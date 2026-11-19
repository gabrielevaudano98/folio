// Folio — page syntax beyond CommonMark: how each piece reads from and writes to Markdown.
// Pure (no DOM at import). Node views are added by the editor (rich.js); the format tests use these as they are.
//   <sup>x</sup> <sub>x</sub>           superscript, subscript (HTML, readable everywhere)
//   $x^2$  and  $$ … $$                  maths (KaTeX), Pandoc rules for $: no space inside, no digit after
//   [^1]  ^[inline note]  [^1]: text     footnotes (Pandoc, Obsidian, GitHub)
//   %%hidden%%                           comment only the author sees (Obsidian)
//   [text]{color=red bg=yellow}          Folio colour (Pandoc span syntax; removed by portable export)
//   paragraph line + {align=center}      Folio alignment (Pandoc attribute; heading: "## Title {align=center}")
import { Node, Mark, mergeAttributes } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';

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

export const pageSyntax = () => [SuperscriptMd, SubscriptMd, InlineMath, BlockMath, FootnoteRef, FootnoteInline, FootnoteDef, HiddenComment, FolioColor, Align];
