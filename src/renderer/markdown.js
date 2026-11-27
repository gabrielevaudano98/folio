// Folio — Markdown to safe HTML, with source-line anchors for scroll sync and AI-edit marks.
import MarkdownIt from 'markdown-it';
import { FIELD, statusClass, DAY } from './page-mentions.js';
import { formatDay, fullDay, datePrefs, dayTense } from './page-dates.js';
import { tailLength, parseMention, whenLabel, startOf } from './page-when.js';
import { parseButton } from './page-templates.js';
import { parseComment } from './page-critic.js';
import { refsPlugin } from './refs-syntax.js';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import anchor from 'markdown-it-anchor';
import katex from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { icons } from './icons.js';
import { owns, coverOf } from './page-appearance.js';
import { parseCallout, CALLOUT_TYPES } from './callouts.js';
import { mediaKind, webProvider } from './page-syntax.js';
import container from 'markdown-it-container';

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const slugify = (s) => s.toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

const md = new MarkdownIt({
  html: true, linkify: true, typographer: true, breaks: false,
  highlight(code, lang) {
    if (lang === 'mermaid') return `<pre class="mermaid-src" hidden>${escape(code)}</pre>`;
    if (lang && hljs.getLanguage(lang)) {
      try { return `<pre><code class="hljs language-${escape(lang)}">${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`; } catch {}
    }
    return `<pre><code class="hljs">${escape(code)}</code></pre>`;
  },
})
  .use(taskLists, { enabled: true, label: true, labelAfter: false })
  .use(footnote)
  .use(mark)
  .use(anchor, { slugify, tabIndex: false })
  .use(katex.default || katex, { throwOnError: false });

// source line on every block opener -> scroll sync, AI marks, task toggles
for (const rule of ['paragraph_open', 'heading_open', 'blockquote_open', 'bullet_list_open', 'ordered_list_open', 'list_item_open', 'table_open', 'hr', 'tr_open']) {
  const prev = md.renderer.rules[rule];
  md.renderer.rules[rule] = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    if (t.map) { t.attrSet('data-line', String(t.map[0])); t.attrSet('data-line-end', String(t.map[1])); }
    return prev ? prev(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };
}
const fence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  const html = fence(tokens, idx, opts, env, self);
  const lang = (t.info || '').trim().split(/\s+/)[0];
  const attrs = t.map ? ` data-line="${t.map[0]}" data-line-end="${t.map[1]}"` : '';
  if (lang === 'mermaid') return `<div class="mermaid"${attrs}>${html}</div>`;
  if (lang === 'template-button') { const b = parseButton(t.content); return `<div class="template-button"${attrs} data-spec="${escape(encodeURIComponent(JSON.stringify(b)))}"><button type="button" class="btn">${escape(b.label)}</button></div>`; }
  if (lang === 'chart') return `<div class="chart-block"${attrs} data-spec="${escape(encodeURIComponent(t.content))}"><p class="chart-wait">Drawing chart…</p></div>`;
  return html.replace('<pre>', `<pre${attrs}>`);
};

// Callouts: GitHub alerts and Obsidian callouts (title, fold) with Notion's icon and colour (callouts.js)
md.core.ruler.after('block', 'callouts', (state) => {
  const tk = state.tokens;
  for (let i = 0; i < tk.length; i++) {
    if (tk[i].type !== 'blockquote_open') continue;
    const inline = tk[i + 2];
    if (!inline || inline.type !== 'inline') continue;
    const c = parseCallout(inline.content.split('\n')[0]);
    if (!c) continue;
    let depth = 0, j = i;
    for (; j < tk.length; j++) { if (tk[j].type === 'blockquote_open') depth++; else if (tk[j].type === 'blockquote_close' && --depth === 0) break; }
    inline.content = inline.content.split('\n').slice(1).join('\n');
    if (inline.children) { const k = inline.children.findIndex((t) => t.type === 'softbreak' || t.type === 'hardbreak'); inline.children = k >= 0 ? inline.children.slice(k + 1) : []; }
    if (!inline.content.trim()) { tk[i + 1].hidden = true; tk[i + 3].hidden = true; }
    const icon = c.emoji ? `<span class="callout-emoji" aria-hidden="true">${escape(c.emoji)}</span>` : (icons[CALLOUT_TYPES[c.type].icon] || '');
    // Notion: an untitled callout shows only its icon, beside the text; the type's name stays for screen readers
    const iconOnly = !c.title && !c.fold;
    const head = iconOnly ? `${icon}<span class="visually-hidden">${escape(c.label)}</span>` : `${icon}<span>${escape(c.title || c.label)}</span>`;
    const cls = `callout callout-${c.type} callout-c-${c.color}${iconOnly ? ' callout-iconic' : ''}`;
    const html = (content) => { const t = new state.Token('html_block', '', 0); t.content = content; return t; };
    if (c.fold) {
      tk[j] = html('</details>\n');
      tk[i] = html(`<details class="${cls}"${c.fold === '+' ? ' open' : ''}><summary class="callout-title">${head}</summary>\n`);
    } else {
      tk[i].attrJoin('class', cls);
      tk.splice(i + 1, 0, html(`<div class="callout-title${iconOnly ? ' callout-icon-only' : ''}">${head}</div>`));
    }
  }
});

// Images and media (page-syntax.js): ![Alt|400](src "Caption"), video, audio, PDF, web embeds; a lone link is a card
const fileName = (src) => decodeURI(src.split(/[?#]/)[0].split('/').pop() || 'file').replace(/^(?=[a-z]*\d)[a-z0-9]{8}-/, '');
md.renderer.rules.image = (tk, i) => {
  const t = tk[i]; const src = t.attrGet('src') || ''; const title = t.attrGet('title') || '';
  const m = /^([\s\S]*?)\|(\d+)(?:x(\d+))?$/.exec(t.content || '');
  const alt = m ? m[1] : t.content || '';
  const kind = mediaKind(src);
  let out;
  if (kind === 'video' || kind === 'audio') out = `<${kind} class="md-media" controls preload="metadata" data-src="${escape(src)}"${kind === 'video' && alt ? ` aria-label="${escape(alt)}"` : ''}></${kind}>`;
  else if (kind === 'pdf' || kind === 'file') out = `<a class="md-card md-file" href="${escape(src)}"><span class="md-card-title">${escape(alt || fileName(src))}</span><span class="md-card-sub">${kind === 'pdf' ? 'PDF' : 'File'} · ${escape(fileName(src))}</span></a>`;
  else if (kind === 'web') { const w = webProvider(src); out = `<a class="md-card md-embed" href="${escape(src)}">${w.thumb ? `<img class="md-card-thumb" src="${escape(w.thumb)}" alt="">` : ''}<span class="md-card-title">${escape(alt || w.name)}</span><span class="md-card-sub">${escape(w.name)} · ${escape(w.host)}</span></a>`; }
  else out = `<img src="${escape(src)}" alt="${escape(alt)}"${title ? ` title="${escape(title)}"` : ''}${m ? ` style="width:${+m[2]}px${m[3] ? `;height:${+m[3]}px` : ''}"` : ''}>`;
  return t.meta?.figure && title ? `<figure class="md-figure">${out}<figcaption>${escape(title)}</figcaption></figure>` : out;
};
md.core.ruler.push('folio_cards', (state) => {
  const tk = state.tokens;
  for (let i = 1; i < tk.length - 1; i++) {
    if (tk[i].type !== 'inline' || tk[i - 1].type !== 'paragraph_open') continue;
    const kids = tk[i].children || [];
    if (kids.length === 1 && kids[0].type === 'image') { kids[0].meta = { ...(kids[0].meta || {}), figure: true }; if (kids[0].attrGet('title') || mediaKind(kids[0].attrGet('src') || '') !== 'image') { tk[i - 1].hidden = true; tk[i + 1].hidden = true; } continue; }
    if (kids.length === 3 && kids[0].type === 'link_open' && kids[1].type === 'text' && kids[2].type === 'link_close') {
      const href = kids[0].attrGet('href') || '';
      if (/\.(md|markdown)(#.*)?$/i.test(href) || href.startsWith('#') || /^mailto:/i.test(href)) continue;
      const web = /^https?:/i.test(href);
      tk[i - 1].attrJoin('class', web ? 'md-bookmark' : 'md-filecard');
      tk[i - 1].attrSet('data-host', web ? href.replace(/^https?:\/\/(?:www\.)?([^/]+).*$/i, '$1') : fileName(href));
    }
  }
});

// Page structure: ::: columns / ::: column, [TOC], [BREADCRUMB]
md.use(container, 'columns', { render: (t, i) => (t[i].nesting === 1 ? '<div class="md-columns">\n' : '</div>\n') });
md.use(container, 'column', { render: (t, i) => (t[i].nesting === 1 ? '<div class="md-column">\n' : '</div>\n') });
const soloLine = (tk, i, re) => tk[i].type === 'paragraph_open' && tk[i + 1]?.type === 'inline' && re.test(tk[i + 1].content.trim()) && tk[i + 2]?.type === 'paragraph_close';
md.core.ruler.push('folio_toc', (state) => {
  const tk = state.tokens;
  const heads = [];
  for (let i = 0; i < tk.length; i++) if (tk[i].type === 'heading_open') heads.push({ level: +tk[i].tag.slice(1), id: tk[i].attrGet('id'), text: tk[i + 1].children.filter((c) => c.type === 'text' || c.type === 'code_inline' || c.type === 'folio_tag' || c.type === 'folio_field').map((c) => c.content).join('') });
  for (let i = 0; i < tk.length; i++) {
    let content = null;
    if (soloLine(tk, i, /^\[TOC\]$/i)) {
      const top = Math.min(...heads.map((h) => h.level), 6);
      content = heads.length ? `<nav class="md-toc" aria-label="Contents"><p class="md-toc-title">Contents</p><ul>${heads.map((h) => `<li class="md-toc-l${h.level - top}"><a href="#${escape(h.id || '')}">${escape(h.text)}</a></li>`).join('')}</ul></nav>\n` : '<nav class="md-toc" aria-label="Contents"><p class="md-toc-title">Contents</p><p class="md-toc-empty">Add headings to see them here.</p></nav>\n';
    } else if (soloLine(tk, i, /^\[BREADCRUMB\]$/i)) content = '<nav class="md-breadcrumb" aria-label="Breadcrumb"></nav>\n';
    if (content == null) continue;
    const t = new state.Token('html_block', '', 0); t.content = content; t.map = tk[i].map;
    tk.splice(i, 3, t);
  }
});

// Folio page syntax: [text]{color=red bg=yellow}, %%hidden comments%%, {align=center} after a paragraph or heading
const PALETTE = 'gray|brown|orange|yellow|green|blue|purple|pink|red';
md.inline.ruler.before('link', 'folio_color', (state, silent) => {
  const m = state.src.slice(state.pos).match(new RegExp(`^\\[((?:\\\\.|[^\\[\\]\\\\\\n])+)\\]\\{((?:\\s*(?:color|bg)=(?:${PALETTE}))+)\\s*\\}`));
  if (!m) return false;
  if (!silent) {
    const a = {}; for (const x of m[2].matchAll(/(color|bg)=(\w+)/g)) a[x[1]] = x[2];
    const open = state.push('folio_color_open', 'span', 1);
    if (a.color) open.attrSet('data-color', a.color); if (a.bg) open.attrSet('data-bg', a.bg);
    const max = state.posMax; state.pos += 1; state.posMax = state.pos + m[1].length;
    state.md.inline.tokenize(state); state.posMax = max;
    state.push('folio_color_close', 'span', -1);
  }
  state.pos += m[0].length - (silent ? 0 : 1 + m[1].length);
  return true;
});
md.inline.ruler.before('emphasis', 'folio_hidden', (state, silent) => {
  const m = state.src.slice(state.pos).match(/^%%([^%\n](?:[^\n]*?[^%\n])?)%%/);
  if (!m) return false;
  state.pos += m[0].length; // hidden: nothing is drawn
  return true;
});
md.core.ruler.after('inline', 'folio_align', (state) => {
  const tk = state.tokens;
  for (let i = 0; i < tk.length - 1; i++) {
    const t = tk[i], inline = tk[i + 1];
    if (inline.type !== 'inline' || !inline.children?.length) continue;
    const kids = inline.children, last = kids.at(-1);
    if (last.type !== 'text') continue;
    if (t.type === 'paragraph_open' && kids.length >= 2 && kids.at(-2).type === 'softbreak') {
      const m = last.content.match(/^\{align=(left|center|right|justify)\}\s*$/);
      if (m) { kids.splice(-2, 2); t.attrSet('data-align', m[1]); }
    } else if (t.type === 'heading_open') {
      const m = last.content.match(/\s+\{align=(left|center|right|justify)\}\s*$/);
      if (m) { last.content = last.content.slice(0, m.index); inline.content = inline.content.replace(/\s+\{align=\w+\}\s*$/, ''); t.attrSet('data-align', m[1]); }
    }
  }
});

// [[Wiki links]] and [[Note|label]]: a link reads as its label, else the page's name ("Plan › Goals"), never the path
const linkText = (target) => { const [doc, part] = target.split('#'); const name = doc.trim().split('/').pop().replace(/\.(md|markdown|mdx|txt)$/i, ''); return part && !part.startsWith('^') ? (name ? `${name} › ${part.trim()}` : part.trim()) : name || target; };
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const src = state.src.slice(state.pos);
  const m = src.match(/^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/);
  if (!m) return false;
  if (!silent) {
    const t = state.push('html_inline', '', 0);
    const target = m[1].trim();
    const day = DAY.test(target) && !m[2];
    const tail = day ? tailLength(src.slice(m[0].length)) : 0; const w = tail ? parseMention(src.slice(0, m[0].length + tail)) : null; // [[2026-12-01]]{09:00 remind}
    const due = w?.remind != null && (startOf(w) <= new Date() || dayTense(w.day) === 'today');
    const label = w ? whenLabel(w, (d) => formatDay(d, datePrefs)) : day ? formatDay(target, datePrefs) : (m[2] || linkText(target)).trim();
    t.content = `<a class="wikilink${day ? ' wikilink-date' : ''}${w?.remind != null ? ' is-remind' : ''}${due ? ' is-due' : ''}" href="#" data-wikilink="${escape(target)}"${day ? ` title="${escape(fullDay(target, datePrefs.lang))}"` : ''}>${escape(label)}</a>`;
  }
  state.pos += m[0].length + (DAY.test(m[1].trim()) && !m[2] ? tailLength(src.slice(m[0].length)) : 0);
  return true;
});

// #tags and [status:: Done] chips: the same text the Write view decorates
md.inline.ruler.before('link', 'folio_tag', (state, silent) => {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== 0x23 || (pos > 0 && !/[\s(]/.test(src[pos - 1]))) return false;
  const m = /^#((?=[\p{L}\p{N}_\-/]*[\p{L}_])[\p{L}\p{N}_\-/]+)/u.exec(src.slice(pos));
  if (!m) return false;
  if (!silent) state.push('folio_tag', 'span', 0).content = m[0];
  state.pos += m[0].length;
  return true;
});
const FIELD_AT = new RegExp('^' + FIELD.source);
md.inline.ruler.before('link', 'folio_field', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b) return false;
  const m = FIELD_AT.exec(state.src.slice(state.pos));
  if (!m || state.src[state.pos + m[0].length] === '(') return false;
  if (!silent) { const t = state.push('folio_field', 'span', 0); t.content = m[0]; t.meta = [m[1].trim(), m[2]]; }
  state.pos += m[0].length;
  return true;
});
// CriticMarkup (D10): {++added++} {--deleted--} {~~old~>new~~} {==highlight==} {>>comment<<}
md.inline.ruler.before('emphasis', 'critic', (state, silent) => {
  const src = state.src.slice(state.pos);
  if (src.charCodeAt(0) !== 0x7b) return false;
  const m = /^\{(\+\+|--|==)((?:(?!\1\})[^\n])+)\1\}|^\{~~([^\n]*?)~>([^\n]*?)~~\}|^\{>>([^\n]*?)<<\}/.exec(src);
  if (!m) return false;
  if (!silent) {
    if (m[1]) {
      const tag = { '++': 'ins', '--': 'del', '==': 'mark' }[m[1]];
      const o = state.push('critic_open', tag, 1); o.attrSet('class', `critic-${tag === 'mark' ? 'hl' : tag}`);
      const old = state.posMax; state.pos += 3; state.posMax = state.pos + m[2].length; state.md.inline.tokenize(state); state.posMax = old;
      state.push('critic_close', tag, -1);
      state.pos += 3; return true;
    }
    if (m[3] != null) { const t = state.push('critic_sub', 'span', 0); t.meta = [m[3], m[4]]; }
    else { const t = state.push('critic_comment', 'span', 0); t.meta = parseComment(m[5]); }
  }
  state.pos += m[0].length;
  return true;
});
md.renderer.rules.critic_sub = (tk, i) => `<span class="critic-sub"><del class="critic-del">${escape(tk[i].meta[0])}</del><ins class="critic-ins">${escape(tk[i].meta[1])}</ins></span>`;
md.renderer.rules.critic_comment = (tk, i) => { const c = tk[i].meta; return `<span class="critic-comment" tabindex="0" role="note" aria-label="Comment${c.author ? ' by ' + escape(c.author) : ''}: ${escape(c.text)}" data-tip="${escape((c.author ? c.author + ': ' : '') + c.text)}" data-author="${escape(c.author)}" data-date="${escape(c.date)}" data-text="${escape(c.text)}"></span>`; };
md.renderer.rules.folio_tag = (tk, i) => `<span class="md-tag">${escape(tk[i].content)}</span>`;
md.renderer.rules.folio_field = (tk, i) => {
  const [key, val] = tk[i].meta;
  return key.toLowerCase() === 'status'
    ? `<span class="md-field md-status is-${statusClass(val)}" data-key="status">${escape(val)}</span>`
    : `<span class="md-field" data-key="${escape(key.toLowerCase())}"><b>${escape(key)}</b> ${escape(val)}</span>`;
};

md.use(refsPlugin, { escape });

export function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: text, meta: null, offset: 0 };
  const meta = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta.push([kv[1], kv[2].replace(/^["']|["']$/g, '')]);
  }
  return { body: text.slice(m[0].length), meta, offset: m[0].split('\n').length - 1 };
}

/* the markdown-it instance, unsanitized: for tests */
export const markdownIt = md;

export function render(text) {
  const { body, meta, offset } = splitFrontmatter(text);
  let html = md.render(body);
  if (offset) html = html.replace(/data-line(-end)?="(\d+)"/g, (_, e, n) => `data-line${e || ''}="${+n + offset}"`);
  // the page icon (front matter `icon:`) is drawn large above the page, as in the Write view, not listed with the properties
  const oneEmoji = (v) => { const s = String(v).trim(); return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s); };
  const icon = meta?.find(([k, v]) => k === 'icon' && oneEmoji(v));
  const coverKv = meta?.find(([k, v]) => k === 'cover' && coverOf(v)); const hasCover = !!coverKv; const cover = coverKv ? coverOf(coverKv[1]) : null;
  const coverY = Math.min(100, Math.max(0, Number(meta?.find(([k, v]) => k === 'cover-y' && Number.isFinite(Number(v)) && v !== '')?.[1] ?? 50)));
  const rest = (meta || []).filter((x) => x !== icon && !owns(x[0], x[1], hasCover)); // appearance keys (font, cover…) are not listed
  if (rest.length) html = `<dl class="frontmatter" data-line="0">${rest.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>` + html;
  if (icon) html = `<div class="page-icon-read" aria-hidden="true">${escape(icon[1].trim())}</div>` + html;
  if (cover) html = `<div class="page-cover-read" data-cover="${escape(cover.value)}" data-cover-y="${coverY}" aria-hidden="true"></div>` + html;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-line', 'data-line-end', 'data-wikilink', 'data-ref', 'data-label', 'data-spec', 'target', 'aria-hidden', 'data-color', 'data-bg', 'data-align', 'data-host', 'controls', 'preload', 'data-author', 'data-date', 'data-text'],
    ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'annotation', 'mspace', 'mtext', 'msqrt', 'mover', 'munder', 'mtable', 'mtr', 'mtd'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
  });
}

/* a line of text that a following === or --- line makes a heading (setext); not a list item, quote, table or heading */
export const setextText = (l) => !!l.trim() && !/^\s{0,3}([-*+]\s|\d+[.)]\s|>|#|\||```|~~~)/.test(l) && !/^ {4}/.test(l) && !/^ {0,3}([-*_=])( *\1){2,} *$/.test(l);
export function headings(text) {
  const out = []; let fence = null; // the open fence: its character and length
  const lines = text.split('\n');
  let start = 0;
  if (/^---\s*$/.test(lines[0] || '')) { const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l)); if (end > 0) start = end + 1; }
  const clean = (t) => t.replace(/\s+\{align=\w+\}$/, '').replace(/\[([^\]]+)\]\{[^}]*\}/g, '$1').replace(/%%[^%]*%%/g, '').replace(/[*_`]/g, '').trim();
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    const fm = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(l);
    if (fence) { if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.len && !fm[2].trim()) fence = null; continue; }
    if (fm && !(fm[1][0] === '`' && fm[2].includes('`'))) { fence = { ch: fm[1][0], len: fm[1].length }; continue; }
    const m = l.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/);
    if (m) { out.push({ level: m[1].length, text: clean(m[2] || ''), line: i }); continue; }
    const u = /^ {0,3}(=+|-+)\s*$/.exec(lines[i + 1] || '');
    // a paragraph (one or more lines) underlined with === or --- is a heading; it starts at the paragraph's first line
    if (u && setextText(l)) {
      let first = i; while (first > start && setextText(lines[first - 1]) && !out.some((h) => h.line === first - 1)) first--;
      if (out.at(-1)?.line >= first) first = i;
      out.push({ level: u[1][0] === '=' ? 1 : 2, text: clean(lines.slice(first, i + 1).map((x) => x.trim()).join(' ')), line: first, setext: true }); i++;
    }
  }
  return out;
}

let mermaidMod = null, mermaidId = 0;
export async function renderMermaid(root, dark) {
  const blocks = root.querySelectorAll('.mermaid');
  if (!blocks.length) return;
  mermaidMod ||= (await import('mermaid')).default;
  mermaidMod.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict', fontFamily: getComputedStyle(document.body).fontFamily });
  for (const el of blocks) {
    const src = el.querySelector('.mermaid-src')?.textContent;
    if (!src) continue;
    try { const { svg } = await mermaidMod.render(`mmd-${++mermaidId}`, src); el.innerHTML = svg; }
    catch (e) { el.innerHTML = `<p class="mermaid-error">Diagram error: ${escape(e.message?.split('\n')[0] || 'invalid syntax')}</p>`; }
  }
}

import { parseChartSpec, resolveChart, chartHtml } from './chart.js';
export async function hydrateCharts(root, readNote) {
  for (const el of root.querySelectorAll('.chart-block[data-spec]')) {
    const spec = parseChartSpec(decodeURIComponent(el.dataset.spec));
    try { el.innerHTML = chartHtml(await resolveChart(spec, readNote), spec); }
    catch (e) { el.innerHTML = `<p class="chart-error">Chart: ${escape(e.message)}</p>`; }
  }
}
export function exportDocument(title, bodyHtml, css) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${css}</style></head><body><article class="prose">${bodyHtml}</article></body></html>`;
}
