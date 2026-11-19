// Folio — Markdown to safe HTML, with source-line anchors for scroll sync and AI-edit marks.
import MarkdownIt from 'markdown-it';
import { refsPlugin } from './refs-syntax.js';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import anchor from 'markdown-it-anchor';
import katex from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { icons } from './icons.js';
import { parseCallout, CALLOUT_TYPES } from './callouts.js';
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
    const head = `${icon}<span>${escape(c.title || c.label)}</span>`;
    const cls = `callout callout-${c.type} callout-c-${c.color}`;
    const html = (content) => { const t = new state.Token('html_block', '', 0); t.content = content; return t; };
    if (c.fold) {
      tk[j] = html('</details>\n');
      tk[i] = html(`<details class="${cls}"${c.fold === '+' ? ' open' : ''}><summary class="callout-title">${head}</summary>\n`);
    } else {
      tk[i].attrJoin('class', cls);
      tk.splice(i + 1, 0, html(`<div class="callout-title">${head}</div>`));
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
  for (let i = 0; i < tk.length; i++) if (tk[i].type === 'heading_open') heads.push({ level: +tk[i].tag.slice(1), id: tk[i].attrGet('id'), text: tk[i + 1].children.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('') });
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

// [[Wiki links]] and [[Note|label]]
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const src = state.src.slice(state.pos);
  const m = src.match(/^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/);
  if (!m) return false;
  if (!silent) {
    const t = state.push('html_inline', '', 0);
    const target = m[1].trim();
    t.content = `<a class="wikilink" href="#" data-wikilink="${escape(target)}">${escape((m[2] || target).trim())}</a>`;
  }
  state.pos += m[0].length;
  return true;
});

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
  if (meta?.length) html = `<dl class="frontmatter" data-line="0">${meta.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>` + html;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-line', 'data-line-end', 'data-wikilink', 'data-ref', 'data-label', 'data-spec', 'target', 'aria-hidden', 'data-color', 'data-bg', 'data-align'],
    ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'annotation', 'mspace', 'mtext', 'msqrt', 'mover', 'munder', 'mtable', 'mtr', 'mtd'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
  });
}

export function headings(text) {
  const out = []; let fence = false;
  text.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/\s+\{align=\w+\}$/, '').replace(/\[([^\]]+)\]\{[^}]*\}/g, '$1').replace(/%%[^%]*%%/g, '').replace(/[*_`]/g, '').trim(), line: i });
  });
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
