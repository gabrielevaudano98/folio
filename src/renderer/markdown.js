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

// GitHub alerts: > [!NOTE] … labelled by word and icon
const ALERTS = { note: ['Note', icons.info], tip: ['Tip', icons.bulb], important: ['Important', icons.alert], warning: ['Warning', icons.alert], caution: ['Caution', icons.stop] };
md.core.ruler.after('block', 'callouts', (state) => {
  const tk = state.tokens;
  for (let i = 0; i < tk.length; i++) {
    if (tk[i].type !== 'blockquote_open') continue;
    const inline = tk[i + 2];
    if (!inline || inline.type !== 'inline') continue;
    const m = inline.content.match(/^\[!(note|tip|important|warning|caution)\]\s*/i);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    tk[i].attrJoin('class', `callout callout-${kind}`);
    inline.content = inline.content.slice(m[0].length);
    if (inline.children?.length) {
      inline.children[0].content = inline.children[0].content.replace(/^\[!\w+\]\s*/i, '');
      if (inline.children[1]?.type === 'softbreak') inline.children.splice(1, 1);
    }
    const title = new state.Token('html_block', '', 0);
    title.content = `<div class="callout-title">${ALERTS[kind][1]}${ALERTS[kind][0]}</div>`;
    tk.splice(i + 1, 0, title);
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

export function render(text) {
  const { body, meta, offset } = splitFrontmatter(text);
  let html = md.render(body);
  if (offset) html = html.replace(/data-line(-end)?="(\d+)"/g, (_, e, n) => `data-line${e || ''}="${+n + offset}"`);
  if (meta?.length) html = `<dl class="frontmatter" data-line="0">${meta.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>` + html;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-line', 'data-line-end', 'data-wikilink', 'data-ref', 'data-label', 'data-spec', 'target', 'aria-hidden'],
    ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'annotation', 'mspace', 'mtext', 'msqrt', 'mover', 'munder', 'mtable', 'mtr', 'mtd'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
  });
}

export function headings(text) {
  const out = []; let fence = false;
  text.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, ''), line: i });
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
