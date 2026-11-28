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
/* formatting in a toggle title: <summary> is HTML, so marks are written as inline HTML tags, which GitHub and the Read
   view show formatted. Only these exact tags are read, nested in this order; anything else in a title stays literal
   text, and a title is only read as formatted when writing it back gives exactly the same characters (lossless).
   Colour and comments use the page's own text syntax, as in a paragraph: `[text]{color=red}` and CriticMarkup
   (`{==quote==}{>>comment<<}`, `{++…++}`, `{--…--}`, `{~~old~>new~~}`); other Markdown tools show those as text there
   too. Outermost first: suggestions and highlights, colour, then the HTML marks. */
const SUMMARY_MARKS = [['criticIns', '{++', '++}'], ['criticDel', '{--', '--}'], ['criticHl', '{==', '==}'], ['folioColor', '[', ']'],
  ['link', 'a'], ['bold', 'strong'], ['italic', 'em'], ['strike', 's'], ['underline', 'u'], ['highlight', 'mark'], ['superscript', 'sup'], ['subscript', 'sub'], ['code', 'code']];
const SUMMARY_RANK = new Map(SUMMARY_MARKS.map(([m], i) => [m, i]));
const SUMMARY_TAG = new Map(SUMMARY_MARKS.filter((x) => x.length === 2).map(([m, t]) => [t, m]));
const CRITIC_OPEN = new Map(SUMMARY_MARKS.filter((x) => x[1].startsWith('{')).map(([m, o, c]) => [o, [m, c]]));
const SUMMARY_ATOMS = new Set(['criticComment', 'criticSub']);
const CRITIC_STARTS = ['==', '>>', '++', '--', '~~'];
const COLOR_CLOSE = new RegExp(`^\\]\\{((?:\\s*(?:color|bg)=(?:${COLORS.join('|')}))+)\\s*\\}`);
const colorAttrs = (a) => [a?.color && `color=${a.color}`, a?.bg && `bg=${a.bg}`].filter(Boolean).join(' ');
const ENT = { '&lt;': '<', '&#91;': '[', '&#93;': ']', '&#123;': '{', '&#125;': '}' };
const unescSummary = (s) => s.replace(/&lt;|&#91;|&#93;|&#123;|&#125;/g, (e) => ENT[e]).replace(/&amp;/g, '&');
/* text as it may stand in a formatted title: `<` and an entity-looking `&` always (a tag, a comment or <? stays text in the
   Read view); a brace only where it would start or end colour or CriticMarkup; a bracket only inside a colour span, whose
   text cannot hold one. `before` is what was written just before, so a run split across marks is judged as one. */
function escSummary(t, before, inColor) {
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i]; const prev = (before.slice(-2) + out).slice(-2);
    if (c === '<') out += '&lt;';
    else if (c === '&' && /^&#?\w+;/.test(t.slice(i))) out += '&amp;';
    // (a `{` near the end of a run is judged with what may follow: `{=` and then the closing `==}` would open a highlight)
    else if (c === '{' && (CRITIC_STARTS.some((o) => t.startsWith(o, i + 1) || (t.length - i - 1 < 2 && o.startsWith(t.slice(i + 1)))) || prev.endsWith(']'))) out += '&#123;';
    else if (c === '}' && /(?:==|\+\+|--|~~)$/.test(prev)) out += '&#125;';
    else if (inColor && (c === '[' || c === ']')) out += c === '[' ? '&#91;' : '&#93;';
    else out += c;
  }
  return out;
}
const markKey = (m) => (m.type === 'link' ? `link ${m.attrs?.href || ''}` : m.type === 'folioColor' ? `color ${colorAttrs(m.attrs)}` : m.type);
const kept = (n) => (n.marks || []).filter((m) => SUMMARY_RANK.has(m.type) && (m.type !== 'folioColor' || colorAttrs(m.attrs))).sort((a, b) => SUMMARY_RANK.get(a.type) - SUMMARY_RANK.get(b.type));
// a link inside a colour span writes its brackets as entities, so the span's closing bracket is the first one after it
const openTag = (m, inColor) => { const d = SUMMARY_MARKS[SUMMARY_RANK.get(m.type)]; if (m.type !== 'link') return d.length === 3 ? d[1] : `<${d[1]}>`; const h = String(m.attrs?.href || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'); return `<a href="${inColor ? h.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;') : h}">`; };
const closeTag = (m) => { const d = SUMMARY_MARKS[SUMMARY_RANK.get(m.type)]; return m.type === 'folioColor' ? `]{${colorAttrs(m.attrs)}}` : d.length === 3 ? d[2] : `</${d[1]}>`; };
/* a comment's or suggestion's words inside the raw <summary> HTML: `<` and an entity-looking `&` escaped, so `</summary>`
   or a tag in a comment stays text for every HTML reader; parseSummary decodes them */
const escAtom = (s) => String(s ?? '').replace(/&(?=#?\w+;)/g, '&amp;').replace(/</g, '&lt;');
const atomText = (n) => (n.type === 'criticComment' ? `{>>${escAtom(n.attrs?.body)}<<}` : `{~~${escAtom(n.attrs?.old)}~>${escAtom(n.attrs?.new)}~~}`);
/* a title's nodes (JSON), read without the lossless check; null when its marks do not nest */
function parseSummary(src) {
  const out = []; const stack = []; let buf = '', i = 0;
  const marks = () => (stack.length ? { marks: stack.map((x) => ({ type: x.type, ...(x.attrs ? { attrs: { ...x.attrs } } : {}) })) } : {});
  const flush = () => { if (buf) out.push({ type: 'text', text: unescSummary(buf), ...marks() }); buf = ''; };
  while (i < src.length) {
    const rest = src.slice(i); let m;
    if ((m = /^\{>>([^\n]*?)<<\}/.exec(rest))) { flush(); out.push({ type: 'criticComment', attrs: { body: unescSummary(m[1]) }, ...marks() }); i += m[0].length; continue; }
    if ((m = /^\{~~([^\n]*?)~>([^\n]*?)~~\}/.exec(rest))) { flush(); out.push({ type: 'criticSub', attrs: { old: unescSummary(m[1]), new: unescSummary(m[2]) }, ...marks() }); i += m[0].length; continue; }
    const crit = CRITIC_OPEN.get(rest.slice(0, 3));
    if (crit) { flush(); stack.push({ type: crit[0], close: crit[1] }); i += 3; continue; }
    const top = stack.at(-1);
    if (top?.close && rest.startsWith(top.close)) { flush(); stack.pop(); i += 3; continue; }
    if (rest[0] === '[') { // a colour span: the next bracket must be its `]{color=…}`
      const j = rest.slice(1).search(/[[\]]/) + 1; const cm = j > 0 && rest[j] === ']' ? COLOR_CLOSE.exec(rest.slice(j)) : null;
      if (cm) { flush(); stack.push({ type: 'folioColor', attrs: parseColorAttrs(cm[1]), end: i + j, endLen: cm[0].length }); i++; continue; }
    }
    if (rest[0] === ']') { const c = stack.find((x) => x.end === i); if (c) { if (top !== c) return null; flush(); stack.pop(); i += c.endLen; continue; } }
    if ((m = /^<a href="([^"]*)">|^<\/?(a|strong|em|s|u|mark|sup|sub|code)>/.exec(rest))) {
      if (m[1] == null && m[2] === 'a' && m[0][1] !== '/') return null; // a bare <a> has no href: not something summaryHtml writes
      const type = m[1] != null ? 'link' : SUMMARY_TAG.get(m[2]); flush();
      if (m[0][1] === '/') { if (top?.type !== type) return null; stack.pop(); }
      else stack.push(type === 'link' ? { type, attrs: { href: unescSummary(m[1].replace(/&quot;/g, '"')) } } : { type });
      i += m[0].length; continue;
    }
    buf += rest[0]; i++;
  }
  flush();
  return stack.length ? null : out;
}
/** nodes (JSON) of a toggle title as the HTML inside <summary> */
export function summaryHtml(nodes) {
  const items = (nodes || []).filter((n) => n.text || SUMMARY_ATOMS.has(n.type));
  if (!items.some((n) => SUMMARY_ATOMS.has(n.type) || kept(n).length)) {
    // a title with no formatting is written as typed, unless summaryNodes would read that back as formatting (or with
    // entities decoded): only then is it escaped. Hand-written HTML Folio would write differently stays literal and as typed.
    // (No endless recursion: p is either formatted, or plain text shorter than raw.)
    const raw = items.map((n) => n.text).join(''); const p = parseSummary(raw);
    if (!raw || !p || (p.length === 1 && !p[0].marks && p[0].text === raw) || summaryHtml(p) !== raw) return raw;
  }
  let out = ''; const stack = [];
  for (const n of items) {
    const want = kept(n);
    let k = 0; while (k < stack.length && k < want.length && markKey(stack[k]) === markKey(want[k])) k++;
    while (stack.length > k) out += closeTag(stack.pop());
    for (const m of want.slice(k)) { out += openTag(m, stack.some((x) => x.type === 'folioColor')); stack.push(m); }
    out += SUMMARY_ATOMS.has(n.type) ? atomText(n) : escSummary(n.text, out, stack.some((m) => m.type === 'folioColor'));
  }
  while (stack.length) out += closeTag(stack.pop());
  return out;
}
/** the HTML inside <summary> as nodes (JSON) with marks; literal text when it is not exactly what summaryHtml writes */
export function summaryNodes(src) {
  if (!src) return [];
  const out = parseSummary(src);
  if (!out?.length || summaryHtml(out) !== src) return [{ type: 'text', text: src }];
  return out;
}
/** does a toggle title use colour or comments (the Read view then draws it from summaryNodes, as the Write view does) */
export const summaryNeedsDrawing = (nodes) => nodes.some((n) => SUMMARY_ATOMS.has(n.type) || (n.marks || []).some((m) => m.type === 'folioColor' || m.type.startsWith('critic')));
export const Details = BaseDetails.extend({
  addAttributes() { return { ...this.parent?.(), heading: { default: 0, parseHTML: (el) => +el.getAttribute('data-heading') || 0, renderHTML: (a) => (a.heading ? { 'data-heading': a.heading } : {}) } }; },
  parseMarkdown: (token, h) => h.createNode('details', { open: token.open, heading: token.heading }, [
    h.createNode('detailsSummary', null, summaryNodes(token.summary)),
    h.createNode('detailsContent', null, token.tokens?.length ? h.parseChildren(token.tokens) : [{ type: 'paragraph' }]),
  ]),
  renderMarkdown: (node, h) => {
    const [summary, content] = node.content || [];
    const level = node.attrs?.heading || 0;
    const title = summaryHtml(summary?.content).trim(); // space at either end of a title is not kept (the reader trims it too)
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
// a title holds text and, for comments and suggestions on it, their inline atoms
export const DetailsSummary = BaseSummary.extend({ content: '(text | criticComment | criticSub)*', parseMarkdown: undefined, renderMarkdown: undefined, markdownTokenizer: undefined });
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
    return `![${alt}](${a.src || ''}${a.title ? ` "${String(a.title).replace(/\\(?=[!-\/:-@[-`{-~]|$)|"/g, '\\$&')}"` : ''})`;
  },
});

export const pageSyntax = () => [SoftBreak, Details.configure({ persist: true, HTMLAttributes: { class: 'rich-details' } }), DetailsSummary, DetailsContent, Columns, Column, Toc, Breadcrumb, PageBreak, SuperscriptMd, SubscriptMd, InlineMath, BlockMath, FootnoteRef, FootnoteInline, FootnoteDef, HiddenComment, FolioColor, Align];
