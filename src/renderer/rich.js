// Folio — "mini Word" rich editor for Markdown. TipTap 3 (ProseMirror) with Markdown in and out.
import { t as tr, tl, locale } from './i18n.js';
import { formatDay, fullDay, dayTense } from './page-dates.js';
import { tailLength, parseMention, mentionText, whenLabel, remindAt, startOf } from './page-when.js';
import { Editor, Extension, InputRule } from '@tiptap/core';
import katex from 'katex';
import Typography from '@tiptap/extension-typography';
import Suggestion, { exitSuggestion } from '@tiptap/suggestion';
import { filterInserts, runInsert, INSERTS, turnIdAtSelection } from './inserts.js';
import { mentionEntries, TAG, FIELD, statusClass } from './page-mentions.js';
import { highlight } from './fuzzy.js';
import { BlockHandles, blockCmd, currentBlock } from './page-blocks.js';
import { CalloutUI, HeadingFold, HFOLD, TocView, BreadcrumbView, PageBreakView } from './page-ui.js';
import { buildRibbon, wireRibbon, COMPACT_INSERTS } from './page-ribbon.js';
import { TableHandles, tableCmd, tableAt, popupMenu, tableMenuItems, sheetFromTable } from './page-table.js';
import { FindReplace, mountFindBar } from './page-find.js';
import { mountProps } from './page-props-ui.js';
import { readAppearance } from './page-appearance.js';
import { mountToc } from './page-appearance-ui.js';
import { mountReview } from './page-review.js';
import { SuggestMode } from './page-critic.js';
import { SmartPaste, insertMarkdown, insertPlainText } from './page-paste.js';
import { parseButton, splitTemplate, mergeProps, intoPage, CURSOR } from './page-templates.js';
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import { icons } from './icons.js';
import CodeBlock from '@tiptap/extension-code-block';
import { Plugin, PluginKey, NodeSelection, TextSelection, EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { renderMermaid, hydrateCharts, render } from './markdown.js';
import { parseChartSpec, setSpecKey, CHART_TYPES } from './chart.js';
import hljs from 'highlight.js/lib/common';
import { pageExtensions, FolioRaw } from './page-schema.js';
import { InlineMath, BlockMath, FootnoteRef, FootnoteInline, FootnoteDef, COLORS, Align, PageImage, mediaKind, webProvider } from './page-syntax.js';
import { createPageCodec } from './page-core.js';

/* code blocks: mermaid and chart blocks show the drawing, the source opens on demand */
const VISUAL = ['mermaid', 'chart', 'template-button'];
/* languages offered in a code block's menu (any other name typed in the file is kept) */
const LANGS = [['', tl('rich', 'Plain text')], ['js', tl('rich', 'JavaScript')], ['ts', tl('rich', 'TypeScript')], ['json', 'JSON'], ['python', tl('rich', 'Python')], ['bash', tl('rich', 'Shell')], ['html', 'HTML'], ['css', 'CSS'], ['sql', 'SQL'], ['yaml', 'YAML'], ['markdown', tl('rich', 'Markdown')], ['java', tl('rich', 'Java')], ['kotlin', tl('rich', 'Kotlin')], ['swift', tl('rich', 'Swift')], ['go', tl('rich', 'Go')], ['rust', tl('rich', 'Rust')], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['php', 'PHP'], ['ruby', tl('rich', 'Ruby')], ['xml', 'XML'], ['diff', tl('rich', 'Diff')], ['ini', 'INI / TOML'], ['mermaid', tl('rich', 'Diagram (Mermaid)')], ['chart', tl('rich', 'Chart')]];

/* syntax colours in code blocks: highlight.js (as the Read view) turned into decorations; the text is never touched */
const HL = new PluginKey('codeHighlight');
const hlCache = new Map();
function highlightRanges(code, lang) {
  const key = lang + '\u0000' + code; if (hlCache.has(key)) return hlCache.get(key);
  let ranges = [];
  try {
    const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    let off = 0;
    const walk = (node, cls) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) { const len = ch.nodeValue.length; if (cls) ranges.push([off, off + len, cls]); off += len; }
        else if (ch.nodeType === 1) walk(ch, [cls, ch.className].filter(Boolean).join(' '));
      }
    };
    walk(tpl.content, '');
  } catch { ranges = []; }
  if (hlCache.size > 400) hlCache.clear();
  hlCache.set(key, ranges); return ranges;
}
const CodeHighlight = Extension.create({
  name: 'codeHighlight',
  addProseMirrorPlugins() {
    const build = (doc) => {
      const deco = [];
      doc.descendants((n, pos) => {
        if (n.type.name !== 'codeBlock') return true;
        const lang = (n.attrs.language || '').toLowerCase();
        if (!lang || VISUAL.includes(lang) || !hljs.getLanguage(lang) || n.content.size > 60000) return false;
        for (const [a, b, cls] of highlightRanges(n.textContent, lang)) deco.push(Decoration.inline(pos + 1 + a, pos + 1 + b, { class: cls }));
        return false;
      });
      return DecorationSet.create(doc, deco);
    };
    return [new Plugin({
      key: HL,
      state: { init: (_, st) => build(st.doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
      props: { decorations: (st) => HL.getState(st) },
    })];
  },
});
/* X3: a locked page takes no edit from any path (keys, input rules, paste, drop); loading the file (setContent without update) still works */
const PageLockGuard = Extension.create({
  name: 'pageLockGuard',
  addProseMirrorPlugins() {
    const ed = this.editor;
    return [new Plugin({ key: new PluginKey('pageLockGuard'), filterTransaction: (tr) => !(ed.storage.pageLock?.on && tr.docChanged && !tr.getMeta('preventUpdate')) })];
  },
});
const FolioCodeBlock = CodeBlock.extend({
  addOptions() { return { ...this.parent?.(), readNote: null, isDark: () => false, onTemplateButton: null, onCopy: null }; },
  /* Mod+Alt+C is the Format painter; TipTap's default would also toggle a code block. Code stays on the / menu, the ribbon and ``` */
  addKeyboardShortcuts() { const k = { ...this.parent?.() }; delete k['Mod-Alt-c']; return k; },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div'); dom.className = 'rich-code';
      const pre = document.createElement('pre'); const code = document.createElement('code'); pre.appendChild(code);
      const preview = document.createElement('div'); preview.className = 'rich-code-preview'; preview.contentEditable = 'false';
      const bar = document.createElement('div'); bar.className = 'rich-code-bar'; bar.contentEditable = 'false';
      dom.append(bar, preview, pre);
      let lang = node.attrs.language || '', timer, editing = false, wrapped = false;
      const opts = this.options;
      const draw = (text) => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          if (lang === 'mermaid') { preview.innerHTML = '<div class="mermaid"><pre class="mermaid-src" hidden></pre></div>'; preview.querySelector('.mermaid-src').textContent = text; await renderMermaid(preview, opts.isDark()); }
          if (lang === 'template-button') {
            const b = parseButton(text);
            preview.innerHTML = `<button type="button" class="btn template-btn" data-tip="Inserts the template “${escHtml(b.template || '?')}” ${b.where === 'above' ? 'above' : 'below'} this button">${opts.plusIcon || ''}<span>${escHtml(b.label)}</span></button>`;
            return;
          }
          if (lang === 'chart') { preview.innerHTML = `<div class="chart-block" data-spec="${encodeURIComponent(text)}"></div>`; await hydrateCharts(preview, opts.readNote); }
        }, 250);
      };
      const sync = (n) => {
        lang = n.attrs.language || '';
        const visual = VISUAL.includes(lang);
        dom.classList.toggle('is-visual', visual); dom.classList.toggle('is-editing', !visual || editing);
        const known = LANGS.some(([v]) => v === lang);
        const select = `<select class="rich-code-lang" aria-label="${tr('rich.code-language')}">${(known ? LANGS : [[lang, lang], ...LANGS]).map(([v, l]) => `<option value="${v}"${v === lang ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
        const tools = `<span class="rich-code-tools"><button type="button" class="rich-code-tool" data-tool="copy" aria-label="${tr('rich.copy-code')}">${tr('rich.copy-code')}</button><button type="button" class="rich-code-tool" data-tool="wrap" aria-pressed="${wrapped}" aria-label="${tr('rich.wrap-code')}">${tr('rich.wrap-code')}</button></span>`;
        dom.classList.toggle('is-wrapped', wrapped);
        // a chart's bar also changes its type and value labels; each rewrites one line of the block (setSpecKey)
        let chartTools = '';
        if (lang === 'chart') {
          const spec = parseChartSpec(n.textContent);
          chartTools = `<span class="rich-code-tools"><select class="rich-chart-type" aria-label="${tr('rich.chart-type')}">${CHART_TYPES.map(([v, l]) => `<option value="${v}"${spec.type === v ? ' selected' : ''}>${tl('chart', l)}</option>`).join('')}</select><button type="button" class="rich-code-tool" data-tool="labels" aria-pressed="${!!spec.labels}">${tr('rich.value-labels')}</button></span>`;
        }
        bar.innerHTML = visual ? `<span>${lang === 'chart' ? 'Chart' : lang === 'template-button' ? 'Template button' : 'Diagram'}</span>${chartTools}<button type="button" class="btn btn-quiet">${editing ? 'Done' : 'Edit source'}</button>` : select + tools;
        if (visual) draw(n.textContent); else preview.innerHTML = '';
      };
      const setChartKey = (key, value) => {
        if (typeof getPos !== 'function') return;
        const text = setSpecKey(node.textContent, key, value); if (text === node.textContent) return;
        const pos = getPos(); editor.view.dispatch(editor.state.tr.replaceWith(pos + 1, pos + node.nodeSize - 1, editor.schema.text(text)));
      };
      bar.addEventListener('change', (e) => {
        if (e.target.closest('.rich-chart-type')) { setChartKey('type', e.target.value); return; }
        const sel = e.target.closest('select'); if (!sel || typeof getPos !== 'function') return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, language: sel.value || null }));
        editor.commands.focus();
      });
      bar.addEventListener('click', (e) => { // Copy puts the code on the clipboard; Wrap only changes how it is drawn (never saved)
        const tool = e.target.closest('.rich-code-tool'); if (!tool) return;
        if (tool.dataset.tool === 'labels') setChartKey('labels', tool.getAttribute('aria-pressed') !== 'true');
        else if (tool.dataset.tool === 'copy') opts.onCopy?.(node.textContent); else { wrapped = !wrapped; dom.classList.toggle('is-wrapped', wrapped); tool.setAttribute('aria-pressed', String(wrapped)); }
      });
      bar.addEventListener('mousedown', (e) => {
        const tool = e.target.closest('.rich-code-tool');
        if (tool) { e.preventDefault(); return; } // keep the caret; the action runs on click, so Enter and Space work too
        if (!e.target.closest('button')) return;
        e.preventDefault(); editing = !editing; sync(node);
        if (editing && typeof getPos === 'function') editor.chain().focus().setTextSelection(getPos() + 1).run();
      });
      preview.addEventListener('dblclick', (e) => { if (e.target.closest('.template-btn')) return; editing = true; sync(node); });
      preview.addEventListener('click', (e) => { if (!e.target.closest('.template-btn') || typeof getPos !== 'function') return; const b = parseButton(node.textContent); opts.onTemplateButton?.(b, b.where === 'above' ? getPos() : getPos() + node.nodeSize); });
      sync(node);
      return { dom, contentDOM: code, update(n) { if (n.type !== node.type) return false; node = n; sync(n); return true; }, stopEvent: (e) => bar.contains(e.target) || preview.contains(e.target), ignoreMutation: (m) => !code.contains(m.target) };
    };
  },
});

/** `![[Note#Heading]]` alone on a line is shown live under the line (read-only; the text stays as written) */
function embedCard(target, opts) {
  const box = document.createElement('div'); box.className = 'rich-embed'; box.contentEditable = 'false'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', `Embedded ${target}`);
  box.innerHTML = '<div class="rich-embed-bar"><span></span><button type="button" class="btn btn-quiet">' + tr('rich.open') + '</button></div><div class="rich-embed-body prose">' + tr('rich.loading') + '</div>';
  box.querySelector('span').textContent = target; box.querySelector('button').onclick = () => opts.onWikiLink?.(target);
  Promise.resolve(opts.preview(target)).then((html) => { box.querySelector('.rich-embed-body').innerHTML = html || '<p class="rich-embed-missing">' + tr('rich.this-target-does-not-exist-yet') + '</p>'; }, () => { box.querySelector('.rich-embed-body').textContent = tl('rich', 'Could not load this embed.'); });
  return box;
}

/* callouts and [[wiki links]] are drawn, the Markdown text stays as written.
   Chips (Notion style): a [[link]], a day, a person, a status or an inline field is drawn as a small label in place of its
   source; the source text stays in the document (hidden, font-size 0) and shows again while the caret is inside it, as in
   Obsidian's Live Preview. Backspace after a chip removes it whole. */
const CHIP_RE = /\[\[\d{4}-\d{2}-\d{2}\]\]\{[^{}\n]{1,60}\}|!?\[\[[^\]\n]+\]\]|\[[A-Za-z][\w ]{0,29}?::[ \t]*[^\]\n]{0,80}?[ \t]*\]/g;
/** chips of the textblock around `pos`: [{from, to}] in document positions */
function chipsNear(doc, pos) {
  const $p = doc.resolve(pos); const parent = $p.parent; if (!parent.isTextblock || parent.type.spec.code) return { list: [], off: 0, start: 0 };
  const start = $p.start(); let text = '';
  parent.forEach((ch) => { text += ch.isText ? (ch.marks.some((m) => m.type.name === 'code') ? '\0'.repeat(ch.text.length) : ch.text) : '\0'.repeat(ch.nodeSize); }); // inline code is literal text, never a chip
  const list = []; CHIP_RE.lastIndex = 0; let m;
  while ((m = CHIP_RE.exec(text))) {
    if (m[0][0] === '!') continue;
    let len = m[0].length; const end = m[0].indexOf(']]{');
    if (end > 0 && !tailLength(m[0].slice(end + 2))) { len = end + 2; CHIP_RE.lastIndex = m.index + len; } // braces that are not a date tail are ordinary text
    list.push({ from: start + m.index, to: start + m.index + len });
  }
  return { list, off: $p.parentOffset, start };
}
/** the chip the caret is strictly inside (its source is shown), or null */
function chipUnderCaret(state) {
  const head = state.selection.head; const { list } = chipsNear(state.doc, head);
  return list.find((c) => head > c.from && head < c.to) || null;
}
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/; // the same days linkKind() and link health accept
/** what a [[link]] reads as: its alias, else "Name" or "Name › Heading" (folders and .md dropped) */
function linkLabel(inner) {
  const [target, alias] = inner.split('|'); if (alias && alias.trim()) return alias.trim().replace(/^@/, '');
  const [doc, part] = target.split('#'); const name = doc.trim().split('/').pop().replace(/\.(md|markdown|mdx|txt)$/i, '');
  return part && !part.startsWith('^') ? `${name || ''} › ${part.trim()}`.replace(/^ › /, '') : name || target;
}
function chipEl(cls, label, data) {
  const s = document.createElement('span'); s.className = cls; s.contentEditable = 'false'; s.textContent = label;
  for (const [k, v] of Object.entries(data)) if (v != null) s.setAttribute(k, String(v));
  return s;
}

const Decorate = Extension.create({
  name: 'folioDecorate',
  addOptions() { return { onWikiLink: null, resolveValue: null, linkKind: null, preview: null, onTag: null, onStatus: null, onDate: null, dayLabel: null, dayTitle: null, dayTense: null }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    const hover = { el: null, card: null, timer: 0, seq: 0, hide() { clearTimeout(this.timer); this.seq++; this.card?.remove(); this.card = null; this.el = null; } };
    /* open a page preview after a short rest on a link */
    const onOver = (view, e) => {
          const el = e.target.closest?.('.rich-wikilink:not(.is-missing):not(.is-date)');
          if (!el || !opts.preview || el === hover.el) return false;
          hover.hide(); hover.el = el;
          hover.timer = setTimeout(async () => {
            const n = ++hover.seq; const html = await Promise.resolve(opts.preview(el.dataset.target)).catch(() => null);
            if (!html || n !== hover.seq || hover.el !== el || !el.isConnected) return;
            const card = document.createElement('div'); card.className = 'rich-hover prose'; card.setAttribute('role', 'tooltip'); card.innerHTML = html;
            document.body.append(card); hover.card = card;
            const r = el.getBoundingClientRect(), h = card.offsetHeight;
            card.style.left = Math.max(8, Math.min(r.left, innerWidth - card.offsetWidth - 8)) + 'px';
            card.style.top = (innerHeight - r.bottom - 8 >= h ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
          }, 450);
          return false;
        };
    const build = (doc, reveal) => {
      const deco = [];
      const chip = (from, to, cls, label, data) => {
        if (reveal && reveal.from === from) return false;
        deco.push(Decoration.inline(from, to, { class: 'rich-chip-src', 'aria-hidden': 'true' }));
        deco.push(Decoration.widget(from, () => chipEl(`rich-chip ${cls}`, label, { ...data, 'data-from': from, 'data-to': to }), { side: 1, key: `chip:${from}:${to}:${cls}:${label}`, ignoreSelection: true }));
        return true;
      };
      doc.descendants((n, pos) => {
        if (n.type.name === 'paragraph' && n.childCount === 1 && n.firstChild.isText && opts.preview) {
          const em = /^!\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]$/.exec(n.firstChild.text.trim());
          if (em) deco.push(Decoration.widget(pos + n.nodeSize, () => embedCard(em[1], opts), { side: -1, key: 'embed:' + em[1] + ':' + opts.version?.() }));
        }
        if (n.type.name === 'paragraph' && n.childCount === 1 && n.firstChild.isText) {
          const link = n.firstChild.marks.find((m) => m.type.name === 'link'); const href = link?.attrs.href || '';
          if (link && href && !/\.(md|markdown)(#.*)?$/i.test(href)) {
            const web = /^https?:/i.test(href);
            deco.push(Decoration.node(pos, pos + n.nodeSize, { class: web ? 'rich-bookmark' : 'rich-filecard', 'data-host': web ? href.replace(/^https?:\/\/(?:www\.)?([^/]+).*$/i, '$1') : href.split('/').pop() }));
          }
        }
        if (n.isText) {
          const code = n.marks.some((mk) => mk.type.name === 'code') || doc.resolve(pos).parent.type.spec.code; // inline code and code blocks stay literal
          const bid = /\s\^[A-Za-z0-9-]+\s*$/.exec(n.text);
          if (bid && pos + n.nodeSize === doc.resolve(pos).end()) deco.push(Decoration.inline(pos + bid.index, pos + n.text.length, { class: 'rich-block-id', title: tr('rich.block-id-links-like-note-id-point-here') }));
          const re = /\[\[([^\]\n]+)\]\]/g; let m;
          while ((m = re.exec(n.text))) {
            const embed = n.text[m.index - 1] === '!';
            const target = m[1].replace(/\|.*$/, ''); const kind = embed ? null : opts.linkKind?.(target);
            const from = pos + m.index - (embed ? 1 : 0), to = pos + m.index + m[0].length;
            const title = embed ? tl('rich', 'Embedded in the Read view and on slides. Ctrl or ⌘ click to open') : kind === 'missing' ? tl('rich', 'No page with this name yet. Ctrl or ⌘ click to create it') : tl('rich', 'Ctrl or ⌘ click to open');
            if (!embed && !code) {
              const day = kind === 'date' && DAY_ONLY.test(target.trim()) && !m[1].includes('|');
              let bs = 0; while (m.index - 1 - bs >= 0 && n.text[m.index - 1 - bs] === '\\') bs++; // an escaped bracket is literal text, as in the Read view and the scanner
              const tail = day && !(bs % 2) ? tailLength(n.text.slice(m.index + m[0].length)) : 0; // [[2026-12-01]]{09:00 remind}: one chip
              const w = tail ? parseMention(n.text.slice(m.index, m.index + m[0].length + tail)) : null;
              let cls = `rich-wikilink${kind && kind !== 'doc' ? ' is-' + kind : ''}${day ? ' is-' + (opts.dayTense?.(target.trim()) || 'future') : ''}`;
              if (w?.remind != null) { cls += ' is-remind'; if ((startOf(w) || remindAt(w)) <= (opts.now?.() || new Date()) || opts.dayTense?.(w.day) === 'today') cls += ' is-due'; } // Notion: red on the day and after
              const dl = (d) => opts.dayLabel?.(d) || d;
              const label = w ? whenLabel(w, dl) : day ? dl(target.trim()) : linkLabel(m[1]);
              if (chip(from, to + tail, cls, label, { 'data-target': target, 'data-day': day ? target.trim() : null, 'data-when': w ? n.text.slice(m.index + m[0].length, m.index + m[0].length + tail) : null, title: day ? (opts.dayTitle?.(target.trim()) || title) : title, role: 'link', tabindex: '-1' })) { re.lastIndex = m.index + m[0].length + tail; continue; }
            }
            deco.push(Decoration.inline(from, to, { class: embed ? 'rich-ref' : `rich-wikilink${kind && kind !== 'doc' ? ' is-' + kind : ''}`, 'data-target': target, title }));
          }
          if (!code) {
            TAG.lastIndex = 0; let t;
            while ((t = TAG.exec(n.text))) { const from = pos + t.index + t[1].length; deco.push(Decoration.inline(from, from + t[2].length + 1, { class: 'rich-tag', title: tr('rich.tag-ctrl-or-click-to-see-every-page-wi') })); }
            FIELD.lastIndex = 0; let f;
            while ((f = FIELD.exec(n.text))) {
              const key = f[1].trim().toLowerCase(); const from = pos + f.index, to = from + f[0].length;
              const cls = key === 'status' ? `rich-field rich-status is-${statusClass(f[2])}` : 'rich-field';
              if (!chip(from, to, cls, f[2].trim() || '—', { 'data-key': key, 'data-name': key === 'status' ? null : f[1].trim(), title: key === 'status' ? tl('rich', 'Status') : f[1], role: key === 'status' ? 'button' : null, tabindex: '-1' }))
                deco.push(Decoration.inline(from, to, { class: cls, 'data-key': key }));
            }
          }
          const rv = /\{\{([^}\n]+?)\}\}/g;
          while ((m = rv.exec(n.text))) {
            const raw = m[1].trim(); const end = pos + m.index + m[0].length;
            deco.push(Decoration.inline(pos + m.index, end, { class: 'rich-ref', 'data-target': raw.replace(/\|.*$/, ''), title: tr('rich.live-value-ctrl-or-click-to-open-the-s') }));
            if (opts.resolveValue) deco.push(Decoration.widget(end, () => { const sp = document.createElement('span'); sp.className = 'rich-ref-out'; sp.contentEditable = 'false'; sp.textContent = '…'; opts.resolveValue(raw).then((v) => { sp.textContent = '= ' + v; }, (e) => { sp.textContent = '= ?'; sp.title = e.message; sp.classList.add('is-broken'); }); return sp; }, { side: 1, key: 'ref:' + raw + ':' + end }));
          }
        }
      });
      return deco;
    };
    const KEY = new PluginKey('folioDecorate');
    /* a chip's text, from its document range */
    const chipText = (state, from, to) => state.doc.textBetween(from, to, '\0', '\0');
    /* a menu or the date popover can stay open while the page changes (typing, an AI edit, a reload): only write if the chip is still there */
    const replaceChip = (view, from, to, text, was, { focus = true } = {}) => {
      const doc = view.state.doc; if (to > doc.content.size || (was != null && doc.textBetween(from, to, '\0', '\0') !== was)) return false;
      if (text === was) return true;
      const tr = text ? view.state.tr.insertText(text, from, to) : view.state.tr.delete(from, to); view.dispatch(tr); if (focus) view.focus();
      return true;
    };
    /* what clicking a chip (or Alt+Enter beside it) does */
    const activate = (view, from, to, el, { modifier = false } = {}) => {
      const src = chipText(view.state, from, to);
      const st = /^\[(status)::[ \t]*([^\]\n]*?)[ \t]*\]$/i.exec(src);
      if (st && opts.onStatus) { opts.onStatus(el, st[2], (v) => replaceChip(view, from, to, `[${st[1]}:: ${v}]`, src)); return true; }
      if (/^\[[A-Za-z][\w ]{0,29}?::/.test(src)) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + src.indexOf('::') + 2)).scrollIntoView()); view.focus(); return true; }
      const when = parseMention(src);
      if (when && opts.onDate && !modifier) {
        // the popover writes as you change it (time, end, reminder) and stays open; each write checks the chip is still there
        let cur = src;
        const apply = (v, { live = false } = {}) => { const text = v == null ? '' : typeof v === 'string' ? `[[${v}]]` : mentionText(v); if (replaceChip(view, from, from + cur.length, text, cur, { focus: !live })) cur = text; };
        opts.onDate(el, when, apply, () => opts.onWikiLink?.(when.day)); return true;
      }
      const lk = /^\[\[([^\]\n]+)\]\]/.exec(src); if (!lk) return false;
      const target = lk[1].replace(/\|.*$/, '').trim();
      opts.onWikiLink?.(target); return true;
    };
    return [new Plugin({
      key: KEY,
      state: {
        init: (_, s) => { const reveal = chipUnderCaret(s); return { set: DecorationSet.create(s.doc, build(s.doc, reveal)), reveal }; },
        apply: (tr, old, _o, s) => {
          const reveal = tr.selectionSet || tr.docChanged ? chipUnderCaret(s) : old.reveal;
          const same = (reveal?.from ?? -1) === (old.reveal?.from ?? -1) && (reveal?.to ?? -1) === (old.reveal?.to ?? -1);
          if (tr.docChanged || !same || tr.getMeta('folioRedecorate')) return { set: DecorationSet.create(tr.doc, build(tr.doc, reveal)), reveal };
          return old;
        },
      },
      /* the link preview card belongs to a chip: when the page changes and the chip is redrawn, the card goes with it */
      view: () => ({ update(v, prev) { if (v.state.doc !== prev.doc) { hover.hide(); hover.typing = true; } else if (hover.el && !hover.el.isConnected) hover.hide(); }, destroy() { hover.hide(); } }), // while typing no card opens until the pointer really moves (Notion)
      props: {
        decorations(state) { return KEY.getState(state).set; },
        handleDOMEvents: {
          mousemove(view, e) { if (!hover.typing) return false; hover.typing = false; return onOver(view, e); }, // the first real move counts as the hover
          mouseover(view, e) { return hover.typing ? false : onOver(view, e); },
          mouseout(view, e) { const el = e.target.closest?.('.rich-wikilink'); if (el && el === hover.el && !el.contains(e.relatedTarget)) hover.hide(); return false; },
          keydown() { hover.hide(); return false; },
          scroll() { hover.hide(); return false; },
          /* a chip is one thing: a press never puts the caret into its hidden source */
          mousedown(view, e) {
            const el = e.target.closest?.('.rich-chip'); if (!el || e.button !== 0) return false;
            e.preventDefault(); hover.hide();
            const from = +el.dataset.from, to = +el.dataset.to; if (!(to > from)) return true;
            if (e.altKey) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 1))); view.focus(); return true; } // Alt-click: edit the source
            activate(view, from, to, el, { modifier: e.ctrlKey || e.metaKey });
            return true;
          },
        },
        /* from the keyboard: Alt+Enter with the caret in or right beside a chip does what clicking it does;
           Backspace right after a chip (Delete right before it) removes the whole chip */
        handleKeyDown(view, e) {
          const { state } = view; const sel = state.selection;
          if ((e.key === 'Backspace' || e.key === 'Delete') && sel.empty && !e.altKey && !e.ctrlKey && !e.metaKey) {
            const at = sel.head; const { list } = chipsNear(state.doc, at);
            const c = list.find((x) => (e.key === 'Backspace' ? x.to === at : x.from === at));
            if (c && !chipUnderCaret(state)) { e.preventDefault(); view.dispatch(state.tr.delete(c.from, c.to)); return true; }
            return false;
          }
          if (e.key !== 'Enter' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
          const at = sel.head; const { list } = chipsNear(state.doc, at);
          const c = list.find((x) => at >= x.from && at <= x.to);
          if (c) {
            e.preventDefault();
            const el = view.dom.querySelector(`.rich-chip[data-from="${c.from}"]`) || view.domAtPos(c.from).node.parentElement || view.dom;
            activate(view, c.from, c.to, el); return true;
          }
          let node = view.root.getSelection?.()?.anchorNode; if (!node || !view.dom.contains(node)) { try { node = view.domAtPos(sel.from).node; } catch { return false; } }
          const tag = (node.nodeType === 3 ? node.parentElement : node)?.closest?.('.rich-tag, .rich-ref'); if (!tag) return false;
          e.preventDefault();
          if (tag.classList.contains('rich-tag')) { const { $from } = sel; const off = $from.parentOffset, txt = $from.parent.textContent; let t = tag.textContent; for (const m of txt.matchAll(/#[\p{L}\p{N}_\/-]+/gu)) if (off >= m.index && off <= m.index + m[0].length) t = m[0]; opts.onTag?.(t.replace(/^#/, '')); return true; } // the chip can be split in two by an open suggestion: read the whole tag from the text
          if (tag.dataset.target) { opts.onWikiLink?.(tag.dataset.target); return true; }
          return false;
        },
        handleClick(view, pos, event) {
          const tag = event.target.closest?.('.rich-tag');
          if (tag && (event.metaKey || event.ctrlKey)) { opts.onTag?.(tag.textContent.replace(/^#/, '')); return true; }
          const el = event.target.closest?.('.rich-wikilink, .rich-ref');
          if (el && !el.classList.contains('rich-chip') && (event.metaKey || event.ctrlKey)) { opts.onWikiLink?.(el.dataset.target); return true; }
          return false;
        },
      },
    })];
  },
});

/* A block shown drawn and edited as source in place: raw Markdown, block maths */
function sourceBlockView({ attr, label, draw, clean = (v) => v.replace(/^\n+|\s+$/g, '') }) {
  return ({ node, editor, getPos }) => {
    const dom = document.createElement('div'); dom.className = `rich-raw rich-${node.type.name}`; dom.contentEditable = 'false';
    const bar = document.createElement('div'); bar.className = 'rich-raw-bar';
    bar.innerHTML = `<span>${label}</span><button type="button" class="btn btn-quiet">${tr('rich.edit-source')}</button>`;
    const preview = document.createElement('div'); preview.className = 'rich-raw-preview prose';
    const area = document.createElement('textarea'); area.className = 'rich-raw-src'; area.spellcheck = false; area.setAttribute('aria-label', `${label}: source`); area.hidden = true;
    dom.append(bar, preview, area);
    const btn = bar.querySelector('button');
    let editing = false;
    const fit = () => { area.style.height = 'auto'; area.style.height = area.scrollHeight + 'px'; };
    const open = () => {
      if (editing) return; editing = true; dom.classList.add('raw-editing'); btn.textContent = tl('rich', 'Done');
      area.hidden = false; area.value = node.attrs[attr]; fit(); area.focus();
    };
    const close = () => {
      if (!editing) return; editing = false; dom.classList.remove('raw-editing'); btn.textContent = tl('rich', 'Edit source'); area.hidden = true;
      const pos = typeof getPos === 'function' ? getPos() : null;
      const value = clean(area.value);
      if (value !== node.attrs[attr] && pos != null) {
        if (value.trim()) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value }));
        else editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
      } else draw(preview, node.attrs[attr]);
      editor.commands.focus();
    };
    dom.folioOpen = open;
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => (editing ? close() : open()));
    preview.addEventListener('dblclick', open);
    preview.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });
    area.addEventListener('input', fit);
    area.addEventListener('blur', () => setTimeout(close, 0));
    area.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); close(); } });
    draw(preview, node.attrs[attr]);
    if (!node.attrs[attr]) requestAnimationFrame(open);
    return {
      dom,
      update(n) { if (n.type !== node.type) return false; node = n; if (!editing) draw(preview, n.attrs[attr]); return true; },
      selectNode() { dom.classList.add('raw-selected'); },
      deselectNode() { dom.classList.remove('raw-selected'); },
      stopEvent: (e) => area.contains(e.target) || bar.contains(e.target),
      ignoreMutation: () => true,
    };
  };
}

/* An inline atom shown drawn and edited as source in place: inline maths, inline footnotes */
function sourceInlineView({ attr, className, draw, title }) {
  return ({ node, editor, getPos }) => {
    const dom = document.createElement('span'); dom.className = className; dom.contentEditable = 'false';
    let editing = false;
    const paint = () => { draw(dom, node.attrs[attr]); dom.classList.toggle('is-empty', !node.attrs[attr]); if (title) dom.title = title(node.attrs[attr]); };
    const open = () => {
      if (editing) return; editing = true;
      const input = document.createElement('input'); input.className = 'rich-src-input'; input.spellcheck = false; input.value = node.attrs[attr];
      input.setAttribute('aria-label', title ? title('') : tl('rich', 'Source'));
      input.size = Math.max(4, input.value.length + 1);
      dom.replaceChildren(input); input.focus(); input.select();
      const done = (commit) => {
        if (!editing) return; editing = false;
        const pos = typeof getPos === 'function' ? getPos() : null;
        const value = input.value.trim();
        if (commit && pos != null && value !== node.attrs[attr]) {
          const tr = value ? editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value }) : editor.state.tr.delete(pos, pos + node.nodeSize);
          editor.view.dispatch(tr);
        } else if (!value && pos != null && !node.attrs[attr]) editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
        else paint();
        const at = (typeof getPos === 'function' ? getPos() : null);
        editor.chain().focus().setTextSelection(at == null ? editor.state.selection.from : Math.min(editor.state.doc.content.size, at + (value ? node.nodeSize : 0))).run();
      };
      input.addEventListener('input', () => { input.size = Math.max(4, input.value.length + 1); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); done(e.key !== 'Escape' || !!node.attrs[attr]); } });
      input.addEventListener('blur', () => done(true));
    };
    dom.folioOpen = open;
    dom.addEventListener('dblclick', open);
    paint();
    if (!node.attrs[attr]) requestAnimationFrame(open);
    return {
      dom,
      update(n) { if (n.type !== node.type) return false; node = n; if (!editing) paint(); return true; },
      stopEvent: (e) => e.target instanceof HTMLInputElement,
      ignoreMutation: () => true,
    };
  };
}

/* Enter on a selected atom opens its source */
const openOnEnter = (name) => function () {
  return { Enter: () => { const s = this.editor.state.selection; if (!(s instanceof NodeSelection) || s.node.type.name !== name) return false; this.editor.view.nodeDOM(s.from)?.folioOpen?.(); return true; } };
};

const katexHtml = (latex, display) => { try { return katex.renderToString(latex || '', { displayMode: display, throwOnError: false, strict: 'ignore' }); } catch { return ''; } };

/* Markdown the editor cannot hold without loss: drawn, edited as source, written back exactly as typed */
const RawBlock = FolioRaw.extend({
  addKeyboardShortcuts: openOnEnter('folioRaw'),
  addNodeView() {
    return sourceBlockView({
      attr: 'source', label: tr('rich.kept-as-written'),
      draw: (el, src) => {
        el.innerHTML = render(src);
        if (!el.textContent.trim() && !el.querySelector('img, svg, table, hr, math')) { el.innerHTML = '<pre class="rich-raw-plain"></pre>'; el.firstChild.textContent = src; }
      },
    });
  },
});
const BlockMathView = BlockMath.extend({
  addKeyboardShortcuts: openOnEnter('blockMath'),
  addInputRules() {
    return [new InputRule({ find: /^\$\$\s$/, handler: ({ state, range }) => {
      const $from = state.doc.resolve(range.from);
      state.tr.replaceWith($from.before(), $from.after(), this.type.create({ latex: '' }));
    } })];
  },
  addNodeView() {
    return sourceBlockView({ attr: 'latex', label: tr('rich.maths'), clean: (v) => v.replace(/^\n+|\s+$/g, ''), draw: (el, v) => { el.innerHTML = v ? katexHtml(v, true) : '<p class="rich-raw-plain">' + tr('rich.empty-formula') + '</p>'; } });
  },
});
const InlineMathView = InlineMath.extend({
  addKeyboardShortcuts: openOnEnter('inlineMath'),
  addNodeView() { return sourceInlineView({ attr: 'latex', className: 'rich-math', draw: (el, v) => { el.innerHTML = katexHtml(v, false); }, title: () => tl('rich', 'Maths (double-click or Enter to edit)') }); },
});
const FootnoteInlineView = FootnoteInline.extend({
  addKeyboardShortcuts: openOnEnter('footnoteInline'),
  addNodeView() { return sourceInlineView({ attr: 'text', className: 'rich-fn is-inline', draw: (el) => { el.textContent = '*'; }, title: (v) => (v ? `Note: ${v}` : tl('rich', 'Note text')) }); },
});
const footnoteText = (doc, label) => { let t = ''; doc.descendants((n) => { if (!t && n.type.name === 'footnoteDef' && n.attrs.label === label) t = n.textContent; return !t; }); return t; };
const FootnoteRefView = FootnoteRef.extend({
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('sup'); dom.className = 'rich-fn'; dom.contentEditable = 'false';
      const paint = () => { dom.textContent = node.attrs.label; };
      dom.addEventListener('mouseenter', () => { const t = footnoteText(editor.state.doc, node.attrs.label); dom.title = t ? `${t}\n\nCtrl or ⌘ click to go to the note` : tl('rich', 'No text for this footnote yet'); });
      dom.addEventListener('click', (e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        let at = null; editor.state.doc.descendants((n, pos) => { if (at == null && n.type.name === 'footnoteDef' && n.attrs.label === node.attrs.label) at = pos; return at == null; });
        if (at != null) { editor.chain().focus().setTextSelection(at + 1).scrollIntoView().run(); }
      });
      paint();
      return { dom, update(n) { if (n.type !== node.type) return false; node = n; paint(); return true; }, ignoreMutation: () => true };
    };
  },
});
const FootnoteDefView = FootnoteDef.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div'); dom.className = 'rich-fn-def';
      const label = document.createElement('span'); label.className = 'rich-fn-label'; label.contentEditable = 'false';
      const body = document.createElement('div'); body.className = 'rich-fn-body';
      label.textContent = `${node.attrs.label}.`; dom.append(label, body);
      return { dom, contentDOM: body, update(n) { if (n.type !== node.type) return false; node = n; label.textContent = `${n.attrs.label}.`; return true; } };
    };
  },
});
/* smart quotes and dashes, switchable in Settings */
const SmartTypography = Typography.extend({
  addOptions() { return { ...this.parent?.(), enabled: () => true }; },
  addInputRules() {
    const on = this.options.enabled;
    return (this.parent?.() || []).map((r) => new InputRule({ find: r.find, handler: (p) => (on() ? r.handler(p) : null) }));
  },
});
/* [text](url) typed becomes a link */
const MarkdownLinkInput = Extension.create({
  name: 'markdownLinkInput',
  addInputRules() {
    return [new InputRule({
      find: /(?:^|[^!\\])\[([^\][\n]+)\]\(([^()\s]+)\)$/,
      handler: ({ state, range, match }) => {
        const [full, text, href] = match; const start = range.from + (full.length - (text.length + href.length + 4));
        state.tr.replaceWith(start, range.to, state.schema.text(text, [state.schema.marks.link.create({ href })]));
      },
    })];
  },
});

/* images keep their relative src in Markdown, the view resolves it to a file URL */
/* images and media (page-syntax.js): an image you can resize and caption; video and audio players; PDF, file and web cards */
const FolioImage = PageImage.extend({
  addOptions() { return { ...this.parent?.(), resolve: null, openFile: null, openUrl: null, blocked: null }; },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const opts = this.options;
      const kind = mediaKind(node.attrs.src || '');
      const dom = document.createElement('figure'); dom.className = `rich-figure rich-media-${kind}`; dom.contentEditable = 'false';
      // every address goes through the app's resolver (workspace boundary, web-image consent); a web image or media it holds back registers a retry
      let retry = null, gone = false; const isWeb = (src) => /^https?:\/\//i.test(src);
      const setSrc = (el, src, miss) => {
        if (/^(data:|blob:)/i.test(src)) { el.src = src; return; }
        let r; try { r = opts.resolve?.(src); } catch { r = null; }
        Promise.resolve(r).then((u) => {
          if (gone) return; // the view was destroyed while the address was being checked
          if (u) { el.src = u; if (retry) { opts.blocked?.delete(retry); retry = null; } el.classList.remove('remote-blocked'); return; }
          miss?.();
          if (isWeb(src) && !retry) { retry = () => setSrc(el, src, miss); opts.blocked?.add(retry); }
        });
      };
      const commit = (attrs) => { const pos = typeof getPos === 'function' ? getPos() : null; if (pos != null) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })); };
      const name = (node.attrs.src || '').split(/[/?#]/).filter(Boolean).pop()?.replace(/^(?=[a-z]*\d)[a-z0-9]{8}-/, '') || 'file';
      let body;
      if (kind === 'video' || kind === 'audio') {
        body = document.createElement(kind); body.controls = true; body.preload = 'metadata'; body.className = 'rich-media-el'; setSrc(body, node.attrs.src || '', () => body.classList.add('remote-blocked'));
      } else if (kind === 'image') {
        body = document.createElement('div'); body.className = 'rich-img-wrap';
        const img = document.createElement('img'); img.alt = node.attrs.alt || ''; img.decoding = 'async'; setSrc(img, node.attrs.src || '', () => { img.classList.add('remote-blocked'); img.alt = img.alt || tl('rich', 'Image not loaded'); });
        const w = parseInt(node.attrs.size, 10); if (w) img.style.width = `${w}px`;
        const grip = document.createElement('span'); grip.className = 'rich-img-resize'; grip.setAttribute('aria-hidden', 'true'); grip.title = tl('rich', 'Drag to resize');
        grip.addEventListener('pointerdown', (e) => {
          e.preventDefault(); grip.setPointerCapture(e.pointerId);
          const start = e.clientX, from = img.getBoundingClientRect().width, max = dom.parentElement?.getBoundingClientRect().width || 2000;
          const move = (ev) => { img.style.width = `${Math.round(Math.min(max, Math.max(60, from + ev.clientX - start)))}px`; };
          const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); const nw = Math.round(img.getBoundingClientRect().width); commit({ size: nw >= max - 2 ? null : String(nw) }); };
          grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
        });
        body.append(img, grip);
      } else {
        const web = kind === 'web' ? webProvider(node.attrs.src) : null;
        body = document.createElement('div'); body.className = `rich-card rich-card-${kind}`; body.tabIndex = 0; body.setAttribute('role', 'link');
        const label = web ? (node.attrs.alt || web.name) : (node.attrs.alt || name);
        body.innerHTML = `<span class="rich-card-ic" aria-hidden="true">${kind === 'web' ? icons.link : icons.doc}</span><span class="rich-card-text"><span class="rich-card-title"></span><span class="rich-card-sub"></span></span>`;
        body.querySelector('.rich-card-title').textContent = label;
        body.querySelector('.rich-card-sub').textContent = web ? `${web.name} · ${web.host} · Ctrl or ⌘ click to open` : `${kind === 'pdf' ? 'PDF' : 'File'} · ${name} · Ctrl or ⌘ click to open`;
        body.setAttribute('aria-label', `${label}. Open`);
        if (web?.thumb) Promise.resolve(opts.resolve?.(web.thumb)).then((u) => { if (!u) return; const th = document.createElement('img'); th.className = 'rich-card-thumb'; th.alt = ''; th.src = u; body.querySelector('.rich-card-ic')?.replaceWith(th); });
        const open = () => (kind === 'web' ? opts.openUrl?.(node.attrs.src) : opts.openFile?.(node.attrs.src));
        body.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey) open(); });
        body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) open(); });
      }
      const cap = document.createElement('figcaption'); cap.className = 'rich-caption';
      const paintCap = () => { cap.textContent = node.attrs.title || ''; cap.dataset.empty = node.attrs.title ? '' : 'Add a caption'; };
      cap.addEventListener('dblclick', () => {
        const input = document.createElement('input'); input.className = 'rich-src-input rich-caption-input'; input.value = node.attrs.title || ''; input.placeholder = tl('rich', 'Caption'); input.setAttribute('aria-label', tl('rich', 'Caption'));
        cap.replaceChildren(input); input.focus();
        const done = (save) => { if (save) commit({ title: input.value.trim() || null }); else paintCap(); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } });
        input.addEventListener('blur', () => done(true));
      });
      paintCap();
      dom.append(body, cap);
      return {
        dom,
        selectNode() { dom.classList.add('media-selected'); }, deselectNode() { dom.classList.remove('media-selected'); },
        stopEvent: (e) => !!e.target.closest?.('.rich-img-resize, .rich-caption input, video, audio'),
        ignoreMutation: () => true,
        destroy() { gone = true; if (retry) opts.blocked?.delete(retry); retry = null; },
      };
    };
  },
});

/* page commands shared by the ribbon, the bubble, the keyboard and the command palette */
export const pageCmd = {
  footnote(editor) {
    const { state, view } = editor; const labels = [];
    state.doc.descendants((n) => { if (n.type.name === 'footnoteRef' || n.type.name === 'footnoteDef') labels.push(n.attrs.label); });
    const nums = labels.map(Number).filter(Number.isInteger);
    const label = String((nums.length ? Math.max(...nums) : 0) + 1);
    const tr = state.tr.replaceSelectionWith(state.schema.nodes.footnoteRef.create({ label }), false);
    let end = tr.doc.content.size; const last = tr.doc.lastChild;
    if (last?.type.name === 'paragraph' && !last.content.size) end -= last.nodeSize;
    tr.insert(end, state.schema.nodes.footnoteDef.create({ label }));
    tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView();
    view.dispatch(tr); view.focus(); return true;
  },
  inlineMath(editor) {
    const { state } = editor; const { from, to, empty } = state.selection;
    const latex = empty ? '' : state.doc.textBetween(from, to, ' ');
    editor.chain().focus().insertContentAt({ from, to }, { type: 'inlineMath', attrs: { latex } }).run();
    return true;
  },
  blockMath(editor) { return editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: '' } }).run(); },
  toggleChecked(editor) {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type.name === 'taskItem') { editor.view.dispatch(editor.state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, checked: !n.attrs.checked })); return true; }
    }
    return false;
  },
  align(editor, a) { const c = editor.chain().focus(); return (a === 'left' ? c.unsetTextAlign() : c.setTextAlign(a)).run(); },
  color(editor, patch) {
    const next = { color: null, bg: null, ...editor.getAttributes('folioColor'), ...patch };
    const c = editor.chain().focus();
    return (next.color || next.bg ? c.setMark('folioColor', next) : c.unsetMark('folioColor')).run();
  },
  hiddenComment(editor) { return editor.chain().focus().toggleMark('hiddenComment').run(); },
};
/* the block actions of the / menu (inserts.js BLOCK_ITEMS), on the block the caret is in */
function blockAction(editor, a, arg, opts) {
  const b = currentBlock(editor.state); if (!b) return false;
  switch (a) {
    case 'duplicate': return blockCmd.duplicate(editor, b);
    case 'up': return blockCmd.move(editor, -1, b);
    case 'down': return blockCmd.move(editor, 1, b);
    case 'delete': return blockCmd.remove(editor, b);
    case 'link': { const id = blockCmd.ensureId(editor, b); if (id) opts.onCopyLink?.(id); return true; }
    case 'colour': return blockCmd.colour(editor, arg, b);
    case 'below': { // under a list item, the new block goes below the whole list (a paragraph cannot sit in a list)
      let blk = b; const $b = editor.state.doc.resolve(b.pos + 1);
      if (/^(listItem|taskItem)$/.test(b.node.type.name)) { const top = $b.before(1); blk = { pos: top, node: editor.state.doc.nodeAt(top) }; }
      const end = blk.pos + blk.node.nodeSize; const tr = editor.state.tr.insert(end, editor.state.schema.nodes.paragraph.create()); tr.setSelection(TextSelection.create(tr.doc, end + 1)); editor.view.dispatch(tr); return true; }
    default: return false;
  }
}
/* The / menu: everything you can insert or turn a block into (inserts.js), Notion style */
const SLASH = new PluginKey('slashMenu');
const SlashMenu = Extension.create({
  name: 'slashMenu',
  addOptions() { return { ctx: () => ({}), keyLabel: (k) => k, onCopyLink: null }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [Suggestion({
      editor: this.editor, char: '/', pluginKey: SLASH, allowSpaces: true, startOfLine: false,
      allow: ({ state, range }) => {
        const $f = state.doc.resolve(range.from);
        if ($f.parent.type.spec.code || $f.parent.type.name === 'detailsSummary') return false;
        if (state.doc.rangeHasMark(range.from, range.to, state.schema.marks.code)) return false;
        /* a space may be part of the query ("2 col", "move up"), but a space with nothing matching ends it, as in Notion */
        const q = state.doc.textBetween(range.from + 1, range.to, ' ', ' ');
        const hasText = $f.parent.isTextblock && $f.parent.textContent.length > q.length + 1;
        return !/\s/.test(q) || (!/^\s|\s{2}/.test(q) && filterInserts(q, { recent: [], hasText }).length > 0);
      },
      items: ({ query, editor }) => {
        if (query.length > 24) return [];
        const $f = editor.state.selection.$from;
        const hasText = $f.parent.isTextblock && $f.parent.textContent.length > query.length + 1;
        return filterInserts(query, { hasText });
      },
      command: ({ editor, range, props }) => {
        // "Alpha /h2": the space typed to open the menu goes too, when nothing follows it
        const $to = editor.state.doc.resolve(range.to);
        const from = range.from > $to.start() && $to.parentOffset === $to.parent.content.size && editor.state.doc.textBetween(range.from - 1, range.from) === ' ' ? range.from - 1 : range.from;
        editor.chain().focus().deleteRange({ from, to: range.to }).run();
        Promise.resolve(runInsert(editor, props, { ...opts.ctx(), block: (a, arg) => blockAction(editor, a, arg, opts) })).catch((e) => console.error(e));
      },
      render: () => slashRenderer(opts),
    })];
  },
});
function slashRenderer(opts, key = SLASH, label = 'Insert or turn into') {
  let el, list, items = [], sel = 0, props = null, view = null; const insertMenu = key === SLASH;
  const iconOf = (it) => (it.swatch !== undefined ? `<span class="slash-swatch${it.bg ? ' is-bg' : ''}" data-c="${it.swatch}">A</span>` : it.badge ? `<span class="slash-badge">${it.badge}</span>` : icons[it.icon] || icons.plus);
  const paint = () => {
    let html = '', group = null;
    const curTurn = insertMenu && props?.editor ? turnIdAtSelection(props.editor.state) : null;
    items.forEach((x, i) => {
      if (x.group !== group) { if (group !== null) html += '</div>'; group = x.group; html += `<div class="slash-group" role="group" aria-label="${tl('grp', group)}"><div class="slash-head" aria-hidden="true">${tl('grp', group)}</div>`; }
      /* the hint on the right: the Markdown you could type instead (Notion: "#", "##", "-", "[]"), else the shortcut */
      const mdh = typeof x.item.md === 'string' && /^(#{1,6}|-|1\.|>|- \[ \]|\$\$|```) ?$/.test(x.item.md) ? x.item.md.trim().replace('- [ ]', '[]') : '';
      const k = mdh ? `<kbd class="slash-md">${mdh.replace(/</g, '&lt;')}</kbd>` : x.item.key ? `<kbd>${opts.keyLabel(x.item.key)}</kbd>` : '';
      const turnTag = x.mode === 'turn' && x.group !== 'Turn into' ? `<span class="slash-turn"> · ${tr('blk.turn-into')}</span>` : '';
      const isCur = x.mode === 'turn' && curTurn && x.item.id === curTurn;
      html += `<div class="slash-item${x.item.danger ? ' is-danger' : ''}${isCur ? ' is-current' : ''}" role="option" id="slash-${i}" data-i="${i}" aria-selected="${i === sel}"${isCur ? ' aria-current="true"' : ''}><span class="slash-ic" aria-hidden="true">${iconOf(x.item)}</span><span class="slash-text"><span class="slash-label">${highlight(x.item.label, x.marks || [])}${turnTag}</span>${x.item.desc ? `<span class="slash-desc">${x.item.desc.replace(/</g, '&lt;')}</span>` : ''}</span>${isCur ? `<span class="slash-check" aria-hidden="true">${icons.check}</span>` : ''}${k}</div>`;
    });
    if (group !== null) html += '</div>';
    list.innerHTML = html || (props?.loading ? '' : '<div class="slash-empty">' + tr('rich.no-matches-keep-typing-or-press-esc') + '</div>');
    view?.dom.setAttribute('aria-activedescendant', items.length ? `slash-${sel}` : '');
    const foot = el?.querySelector('.slash-foot'); if (foot) foot.textContent = (insertMenu && items[sel]?.item.desc) || tr('rich.to-move-enter-to-choose-esc-to-close');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    ghostPaint();
  };
  /* @dom → "ani" in faint text after the caret, as Notion does; Tab or Enter takes it */
  let ghost = null;
  const ghostPaint = () => {
    const q = props?.query || '', label = items[sel]?.item.label || '';
    const show = key === MENTION_KEYS.at && q.length >= 2 && label.length > q.length && label.toLowerCase().startsWith(q.toLowerCase());
    if (!show) { ghost?.remove(); ghost = null; return; }
    const r = props.clientRect?.(); if (!r) return;
    if (!ghost) { ghost = document.createElement('span'); ghost.className = 'mention-ghost'; ghost.setAttribute('aria-hidden', 'true'); document.body.append(ghost); }
    const at = view.domAtPos(view.state.selection.from).node; const cs = getComputedStyle(at.nodeType === 1 ? at : at.parentElement);
    Object.assign(ghost.style, { left: `${r.right}px`, top: `${r.top}px`, height: `${r.height}px`, lineHeight: `${r.height}px`, font: cs.font });
    ghost.textContent = label.slice(q.length);
  };
  const place = () => {
    const r = props?.clientRect?.(); if (!r || !el) return;
    const h = Math.min(el.offsetHeight || 360, 360), below = innerHeight - r.bottom - 8;
    el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px';
    el.style.top = (below >= h || below >= r.top ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
  };
  const choose = (i) => { const x = items[i]; if (x && !x.disabled) props.command(x); };
  return {
    onStart(p) {
      props = p; view = p.editor.view; items = p.items; sel = 0;
      el = document.createElement('div'); el.className = `slash-menu${insertMenu ? ' is-insert' : ''}`;
      el.innerHTML = '<div class="slash-list" role="listbox" id="slash-list" aria-label="${label}"></div><div class="slash-foot" aria-hidden="true">' + tr('rich.to-move-enter-to-choose-esc-to-close') + '</div>';
      list = el.firstChild; document.body.append(el);
      view.dom.setAttribute('aria-controls', 'slash-list'); // aria-expanded is not allowed on a textbox: the list is announced through aria-activedescendant
      list.addEventListener('mousedown', (e) => { e.preventDefault(); const it = e.target.closest('.slash-item'); if (it) choose(+it.dataset.i); });
      list.addEventListener('mousemove', (e) => { const it = e.target.closest('.slash-item'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; list.querySelectorAll('.slash-item').forEach((n) => n.setAttribute('aria-selected', String(+n.dataset.i === sel))); view.dom.setAttribute('aria-activedescendant', `slash-${sel}`); const foot = el.querySelector('.slash-foot'); if (foot && insertMenu) foot.textContent = items[sel]?.item.desc || ''; } });
      paint(); place();
    },
    onUpdate(p) { const typed = p.query !== props?.query; props = p; items = p.items; sel = typed ? 0 : Math.max(0, Math.min(sel, items.length - 1)); paint(); place(); }, // a new query starts at its best match
    onKeyDown({ event }) {
      if (event.key === 'Escape') { exitSuggestion(view, key); return true; }
      if (!items.length) return false;
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step) { sel = (sel + step + items.length) % items.length; paint(); return true; }
      if (event.key === 'Home' || event.key === 'End') { sel = event.key === 'Home' ? 0 : items.length - 1; paint(); return true; }
      if ((event.key === 'Enter' && !event.altKey) || event.key === 'Tab') { choose(sel); return true; } // Alt+Enter is "open it" (Decorate), not "pick"
      return false;
    },
    onExit() {
      el?.remove(); el = null; ghost?.remove(); ghost = null;
      view?.dom.removeAttribute('aria-controls'); view?.dom.removeAttribute('aria-activedescendant'); view?.dom.removeAttribute('aria-expanded');
    },
  };
}

/* [[ @ # : — inline pickers (page-mentions.js). They only ever write plain Markdown text, so the page stays portable. */
const MENTION_KEYS = { link: new PluginKey('mentionLink'), at: new PluginKey('mentionAt'), tag: new PluginKey('mentionTag'), emoji: new PluginKey('mentionEmoji') };
const MENTION_LABEL = { link: tl('rich', 'Link to a page'), at: tl('rich', 'Mention a person, page or date'), tag: 'Tags', emoji: 'Emoji' };
const Mentions = Extension.create({
  name: 'folioMentions',
  addOptions() { return { ctx: () => null, keyLabel: (k) => k }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    const make = (kind, char, { spaces = false, min = 0, anywhere = false }) => Suggestion({
      editor: this.editor, char, pluginKey: MENTION_KEYS[kind], allowSpaces: spaces, startOfLine: false,
      ...(anywhere ? { allowedPrefixes: null } : {}),
      allow: ({ state, range }) => {
        if (!opts.ctx()) return false;
        const $f = state.doc.resolve(range.from);
        if ($f.parent.type.spec.code || state.doc.rangeHasMark(range.from, range.to, state.schema.marks.code)) return false;
        const q = state.doc.textBetween(range.from + char.length, range.to, ' ', ' ');
        return q.length >= min && q.length <= 48 && !/[\]\n]/.test(q) && !(spaces && /^\s/.test(q)) && (kind !== 'emoji' || /^[\w+\-]*$/.test(q));
      },
      items: async ({ query }) => { const c = opts.ctx(); return c ? mentionEntries(kind, query, c) : []; },
      command: async ({ editor, range, props: entry }) => {
        if (entry.disabled) return;
        if (entry.create) {
          editor.chain().focus().deleteRange(range).run();
          const made = await opts.ctx()?.createDoc?.({ type: 'md', name: entry.create });
          if (made) editor.chain().focus().insertContent({ type: 'text', text: `[[${made.ref}]]` }).run();
          return;
        }
        // a trailing space after a tag is for typing on; at the end of a block it would only leave a stray space in the file
        const $to = editor.state.doc.resolve(range.to);
        const text = $to.parentOffset >= $to.parent.content.size ? entry.insert.replace(/ +$/, '') : entry.insert;
        editor.chain().focus().insertContentAt(range, { type: 'text', text }).run();
      },
      render: () => slashRenderer(opts, MENTION_KEYS[kind], MENTION_LABEL[kind]),
    });
    return [make('link', '[[', { spaces: true, anywhere: true }), make('at', '@', { spaces: true }), make('tag', '#', { min: 1 }), make('emoji', ':', { min: 2 })];
  },
});

const NoAlignKeys = Align.extend({ addKeyboardShortcuts() { return {}; } });

/* shortcuts from Word, Google Docs and Notion that ProseMirror does not ship (menu accelerators keep theirs) */
const WordKeys = Extension.create({
  name: 'wordKeys',
  priority: 110,
  addKeyboardShortcuts() {
    const e = () => this.editor;
    return {
      'Mod-Alt-0': () => e().commands.setParagraph(),
      'Mod-Alt-1': () => e().commands.toggleHeading({ level: 1 }),
      'Mod-Alt-2': () => e().commands.toggleHeading({ level: 2 }),
      'Mod-Alt-3': () => e().commands.toggleHeading({ level: 3 }),
      'Mod-Alt-4': () => e().commands.toggleHeading({ level: 4 }),
      'Mod-Alt-5': () => e().commands.toggleHeading({ level: 5 }),
      'Mod-Alt-6': () => e().commands.toggleHeading({ level: 6 }),
      'Mod-Shift-h': () => e().commands.toggleHighlight(),
      'Mod-l': () => e().commands.toggleTaskList(),
      'Mod-e': () => e().commands.toggleCode(),
      'Mod-Shift-.': () => e().commands.toggleSuperscript(),
      'Mod-Shift-,': () => e().commands.toggleSubscript(),
      'Mod-Shift->': () => e().commands.toggleSuperscript(),
      'Mod-Shift-<': () => e().commands.toggleSubscript(),
      'Mod-Shift-m': () => pageCmd.inlineMath(e()),
      'Mod-Alt-f': () => pageCmd.footnote(e()),
      'Mod-Alt-Enter': () => e().chain().focus().insertContent({ type: 'pageBreak' }).run(),
      'Mod-Enter': () => pageCmd.toggleChecked(e()),
      'Mod-Shift-l': () => pageCmd.align(e(), 'left'),
      'Mod-Alt-e': () => pageCmd.align(e(), 'center'),
      'Mod-Shift-r': () => pageCmd.align(e(), 'right'),
      'Mod-Shift-j': () => pageCmd.align(e(), 'justify'),
    };
  },
});

const TURN = [
  ['p', tl('rich', 'Text')], ['h1', tl('rich', 'Heading 1')], ['h2', tl('rich', 'Heading 2')], ['h3', tl('rich', 'Heading 3')], ['bullet', tl('rich', 'Bulleted list')], ['ordered', tl('rich', 'Numbered list')], ['task', tl('rich', 'Checklist')], ['quote', tl('rich', 'Quote')], ['code', tl('rich', 'Code block')],
];
const STYLES = [
  ['p', tl('rich', 'Normal text')], ['h1', tl('rich', 'Heading 1')], ['h2', tl('rich', 'Heading 2')], ['h3', tl('rich', 'Heading 3')], ['h4', tl('rich', 'Heading 4')], ['h5', tl('rich', 'Heading 5')], ['h6', tl('rich', 'Heading 6')],
  ['quote', tl('rich', 'Quote')], ['code', tl('rich', 'Code block')],
];

function btn(id, label, icon, key) {
  return `<button type="button" class="rb" data-cmd="${id}" aria-label="${label}" data-tip="${label}${key ? ` (${key})` : ''}">${icon}</button>`;
}

export function createRich(host, { onStatus, onPropType, onChange, resolveImage, onPickImage, onLink, onWikiLink, resolveValue, readNote, isDark = () => false, keyLabel = (k) => k, smartTypography = () => true, pickRef = null, onCopyBlockLink = null, breadcrumb = () => '', createDoc = null, openMedia = null, pickMedia = null, askUrl = null, mentions = null, linkKind = null, preview = null, onCommand = null, isOn = () => false, onStats = null, onTag = null, onTemplate = null, author = () => '', saveImage = null, onError = null, reviewDock = null, onReviewCount = null, onRemoteBlocked = null, onDate = null, dateStyle = () => 'relative', onBlockDeleted = null, onCopyCode = null, onUnlock = null }) {
  host.innerHTML = `
    ${buildRibbon({ icons, keyLabel, styleOptions: STYLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') })}
    <div class="rich-lock" hidden><span class="rich-lock-badge">${icons.lock}<span>${tr('rich.locked')}</span></span><button type="button" class="btn btn-quiet rich-unlock">${tr('rich.unlock')}</button></div>
    <div class="rich-scroll"><div class="rich-page"></div></div>
    <div class="bubble" role="toolbar" aria-label="${tr('rich.selection')}">
      <label class="visually-hidden" for="rb-turn">${tr('rich.turn-into')}</label>
      <select class="bubble-select" id="rb-turn" data-tip="${tr('rich.turn-into')}">${TURN.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <span class="bubble-sep"></span>
      ${btn('bold', tl('rich', 'Bold'), icons.bold)}${btn('italic', tl('rich', 'Italic'), icons.italic)}${btn('underline', tl('rich', 'Underline'), icons.underline)}${btn('strike', tl('rich', 'Strikethrough'), icons.strike)}
      ${btn('highlight', tl('rich', 'Highlight'), icons.highlighter)}${btn('code', tl('rich', 'Inline code'), icons.codeInline)}${btn('linkInline', tl('rich', 'Link'), icons.link)}${btn('comment', tl('rich', 'Comment'), icons.comment)}
      <span class="bubble-sep"></span>
      ${btn('superscript', tl('rich', 'Superscript'), icons.superscript)}${btn('subscript', tl('rich', 'Subscript'), icons.subscript)}${btn('colour', tl('rich', 'Text colour'), icons.palette)}${btn('inlineMath', tl('rich', 'Maths'), icons.sigma)}${btn('hiddenComment', tl('rich', 'Hidden comment'), icons.commentHidden)}
      <div class="bubble-link" hidden>
        <input type="url" placeholder="${tr('rich.paste-or-type-a-link-enter-to-apply')}" aria-label="${tr('rich.link-address')}" spellcheck="false">
        ${btn('linkRemove', tl('rich', 'Remove link'), icons.clear)}
      </div>
    </div>
    <div class="rb-pop" id="rb-colours" role="dialog" aria-label="${tr('rich.text-colour')}" hidden>
      <span class="rb-pop-title">${tr('rich.text')}</span>
      <div class="rb-swatches">${['', ...COLORS].map((c) => `<button type="button" class="rb-swatch" data-colour="${c}" aria-label="${c ? `${c[0].toUpperCase()}${c.slice(1)} text` : 'Default text'}"><span ${c ? `data-color="${c}"` : ''}>A</span></button>`).join('')}</div>
      <span class="rb-pop-title">${tr('rich.background')}</span>
      <div class="rb-swatches">${['', ...COLORS].map((c) => `<button type="button" class="rb-swatch" data-bgc="${c}" aria-label="${c ? `${c[0].toUpperCase()}${c.slice(1)} background` : 'No background'}"><span class="sw" ${c ? `data-bg="${c}"` : ''}></span></button>`).join('')}</div>
    </div>`;

  let model = null; // what was loaded, so saving rewrites only the blocks that changed
  let silent = false;
  let ready = false; // the ribbon and its state exist (transactions can run while the editor is built)
  const page = host.querySelector('.rich-page');
  const bubble = host.querySelector('.bubble');

  // web images and media held back until the person allows them; the app shows a notice with their count
  const blockedViews = new Set();
  const blocked = { add(fn) { blockedViews.add(fn); onRemoteBlocked?.(blockedViews.size); }, delete(fn) { if (blockedViews.delete(fn)) onRemoteBlocked?.(blockedViews.size); } };
  const insertCtx = () => ({ appCommand: (id) => onCommand?.(id), addProperty: () => props.add(), pickImage: onPickImage, pickRef, createDoc, pickMedia, askUrl, footnote: (e) => pageCmd.footnote(e) });
  const editor = new Editor({
    element: page,
    extensions: [
      ...pageExtensions({
        codeBlock: FolioCodeBlock.configure({ readNote, isDark, onTemplateButton: (b, pos) => onTemplate?.(b, pos), onCopy: (t) => onCopyCode?.(t), plusIcon: icons.plus, HTMLAttributes: { spellcheck: 'false' } }),
        image: FolioImage.configure({ resolve: resolveImage, blocked, inline: false, allowBase64: true, openFile: (src) => openMedia?.(src), openUrl: (u) => openMedia?.(u) }),
        raw: RawBlock,
        views: [InlineMathView, BlockMathView, FootnoteRefView, FootnoteInlineView, FootnoteDefView, NoAlignKeys, TocView, BreadcrumbView.configure({ html: breadcrumb }), PageBreakView],
      }),
      SmartTypography.configure({ enabled: smartTypography }),
      SlashMenu.configure({ keyLabel, ctx: insertCtx, onCopyLink: (id) => onCopyBlockLink?.(id) }),
      TableHandles.configure({ icons, toSheet: (e) => tableToSheet(e) }),
      FindReplace,
      SuggestMode,
      SmartPaste.configure({ toNodes: (md) => codec.load(md).json.content, saveImage, onError }),
      Mentions.configure({ ctx: () => (mentions ? mentions() : null), keyLabel }),
      CodeHighlight,
      CalloutUI.configure({ icons }),
      HeadingFold.configure({ icons }),
      PageLockGuard,
        BlockHandles.configure({ keyLabel, onCopyLink: (id) => onCopyBlockLink?.(id), onDelete: (n) => onBlockDeleted?.(() => editor.chain().focus().undo().run(), n), icons: { plus: icons.plus, grip: icons.grip, quote: icons.quote, listBullet: icons.listBullet, listOrdered: icons.listOrdered, listTask: icons.listTask, codeBlock: icons.codeBlock, check: icons.check } }),
      MarkdownLinkInput,
      Decorate.configure({ onWikiLink, resolveValue, linkKind, preview, onTag: (t) => onTag?.(t), onStatus: (el, cur, apply) => onStatus?.(el, cur, apply), onDate: onDate ? (el, day, apply, open) => onDate(el, day, apply, open) : null, dayLabel: (d) => formatDay(d, { style: dateStyle(), lang: locale() }), dayTitle: (d) => fullDay(d, locale()), dayTense: (d) => dayTense(d) }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : tl('rich', 'Write, or press / for commands')) }),
      BubbleMenu.configure({ element: bubble, shouldShow: ({ editor: e, state }) => !state.selection.empty && !e.isActive('codeBlock') && !e.isActive('image') && !(state.selection instanceof NodeSelection) }),
      WordKeys,
    ],
    editorProps: { attributes: { class: 'prose rich-prose', spellcheck: 'true', 'aria-label': 'Document' } },
    onUpdate: () => { if (!silent) emit(); },
    onSelectionUpdate: () => syncToolbar(),
    onTransaction: () => syncToolbar(),
  });

  const codec = createPageCodec(editor.markdown);
  let emitTimer = 0;
  function emit() {
    clearTimeout(emitTimer);
    emitTimer = setTimeout(() => { emitTimer = 0; onChange?.(api.getMarkdown()); toc?.refresh(readAppearance(model?.fm || '').toc); }, 220);
  }
  /** report a change still waiting for its pause now (the app calls this before the tab changes) */
  function flushEmit() { if (!emitTimer) return; clearTimeout(emitTimer); emitTimer = 0; onChange?.(api.getMarkdown()); }

  host.querySelector('.rich-unlock').addEventListener('click', () => onUnlock?.());
  const LOCK_OK = /^(find|reviewPane|prevChange|nextChange|app:(focus|outline|help|link-health|daily-note))$/;
  const run = (id, btn) => {
    if (!id) return false;
    if (editor.storage.pageLock?.on && !LOCK_OK.test(id)) return false; // a locked page changes through no command
    if (id.startsWith('ins:')) return api.insert(id.slice(4));
    if (id.startsWith('app:')) { const r = onCommand?.(id.slice(4)); setTimeout(syncToolbar, 50); return r; }
    if (id.startsWith('style:')) return setStyle(id.slice(6));
    if (id.startsWith('width:')) return setWidth(id.slice(6));
    const c = editor.chain().focus();
    switch (id) {
      case 'painter': return painter.toggle(false);
      case 'addProperty': return props.add();
      case 'comment': return review.comment();
      case 'suggest': review.suggest(); return syncToolbar();
      case 'reviewPane': review.toggle(); return syncToolbar();
      case 'prevChange': return review.step(-1);
      case 'nextChange': return review.step(1);
      case 'acceptChange': return review.settleHere(true);
      case 'rejectChange': return review.settleHere(false);
      case 'acceptAll': return review.all(true);
      case 'rejectAll': return review.all(false);
      case 'resolveAll': return review.resolveAll();
      case 'find': return findBar.open(false);
      case 'replace': return findBar.open(true);
      case 'selectAll': return c.selectAll().run();
      case 'tableGrid': return openTableGrid(btn);
      case 'insertMenu': return openInsertMenu(btn);
      case 'align': return openAlignMenu(btn);
      case 'tableMenu': return popupMenu(btn, tableMenuItems(editor, { icons, toSheet: () => tableToSheet(editor) }), { label: tr('rich.table') });
      case 'slash': return openSlash();
      case 'emoji': return typeTrigger(':');
      case 'counts': return showCounts(btn);
      case 'typewriter': pv.typewriter = !pv.typewriter; savePref('typewriter', pv.typewriter ? '1' : ''); if (pv.typewriter) centreCaret(); return syncToolbar();
      case 'foldAll': return editor.view.dispatch(editor.state.tr.setMeta(HFOLD, 'all'));
      case 'unfoldAll': return editor.view.dispatch(editor.state.tr.setMeta(HFOLD, 'none'));
      case 'zoomIn': return setZoom(pv.zoom + 0.1);
      case 'zoomOut': return setZoom(pv.zoom - 0.1);
      case 'zoomReset': return setZoom(1);
      case 'rowUp': return tableCmd.moveRow(editor, -1);
      case 'rowDown': return tableCmd.moveRow(editor, 1);
      case 'colLeft': return tableCmd.moveCol(editor, -1);
      case 'colRight': return tableCmd.moveCol(editor, 1);
      case 'cellLeft': return tableCmd.alignCol(editor, 'left');
      case 'cellCenter': return tableCmd.alignCol(editor, 'center');
      case 'cellRight': return tableCmd.alignCol(editor, 'right');
      case 'sortAsc': return tableCmd.sort(editor, false);
      case 'sortDesc': return tableCmd.sort(editor, true);
      case 'tableToSheet': return tableToSheet(editor);
      case 'undo': return c.undo().run();
      case 'redo': return c.redo().run();
      case 'bold': return c.toggleBold().run();
      case 'italic': return c.toggleItalic().run();
      case 'underline': return c.toggleUnderline().run();
      case 'strike': return c.toggleStrike().run();
      case 'highlight': return c.toggleHighlight().run();
      case 'code': return c.toggleCode().run();
      case 'clear': return c.unsetAllMarks().clearNodes().run();
      case 'bullet': return c.toggleBulletList().run();
      case 'ordered': return c.toggleOrderedList().run();
      case 'task': return c.toggleTaskList().run();
      case 'quote': return c.toggleBlockquote().run();
      case 'h2': return c.toggleHeading({ level: 2 }).run();
      case 'indent': return editor.isActive('taskItem') ? c.sinkListItem('taskItem').run() : c.sinkListItem('listItem').run();
      case 'outdent': return editor.isActive('taskItem') ? c.liftListItem('taskItem').run() : c.liftListItem('listItem').run();
      case 'table': return c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      case 'hr': return c.setHorizontalRule().run();
      case 'codeblock': return c.toggleCodeBlock().run();
      case 'rowBefore': return c.addRowBefore().run();
      case 'rowAfter': return c.addRowAfter().run();
      case 'colBefore': return c.addColumnBefore().run();
      case 'colAfter': return c.addColumnAfter().run();
      case 'delRow': return c.deleteRow().run();
      case 'delCol': return c.deleteColumn().run();
      case 'delTable': return c.deleteTable().run();
      case 'image': return Promise.resolve(onPickImage?.()).then((src) => src && editor.chain().focus().setImage({ src, alt: src.split('/').pop().replace(/^[a-z0-9]+-/, '').replace(/\.\w+$/, '') }).run());
      case 'superscript': return c.toggleSuperscript().run();
      case 'subscript': return c.toggleSubscript().run();
      case 'inlineMath': return pageCmd.inlineMath(editor);
      case 'blockMath': return pageCmd.blockMath(editor);
      case 'footnote': return pageCmd.footnote(editor);
      case 'hiddenComment': return pageCmd.hiddenComment(editor);
      case 'alignLeft': return pageCmd.align(editor, 'left');
      case 'alignCenter': return pageCmd.align(editor, 'center');
      case 'alignRight': return pageCmd.align(editor, 'right');
      case 'alignJustify': return pageCmd.align(editor, 'justify');
      case 'colour': return toggleColours();
      case 'linkInline': return openLinkEditor();
      case 'linkRemove': { c.extendMarkRange('link').unsetLink().run(); return closeLinkEditor(); }
      case 'link': {
        const prev = editor.getAttributes('link').href || '';
        return Promise.resolve(onLink?.(prev)).then((href) => {
          if (href == null) return;
          const ch = editor.chain().focus().extendMarkRange('link');
          if (!href) ch.unsetLink().run();
          else if (editor.state.selection.empty && !prev) ch.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
          else ch.setLink({ href }).run();
        });
      }
    }
  };

  host.addEventListener('mousedown', (e) => { if (e.target.closest('.bubble .rb')) e.preventDefault(); });
  host.addEventListener('click', (e) => { const b = e.target.closest('.bubble .rb'); if (b) run(b.dataset.cmd, b); });

  /* ---- the ribbon: compact or full (page-ribbon.js) ---- */
  const ribbonEl = host.querySelector('.ribbon');
  const ribbon = wireRibbon(ribbonEl, { run, onModeChange: () => requestAnimationFrame(syncToolbar) });
  ribbonEl.addEventListener('dblclick', (e) => { if (e.target.closest('[data-cmd="painter"]')) painter.toggle(true); });
  const visibleBtn = (cmd) => [...ribbonEl.querySelectorAll(`[data-cmd="${cmd}"]`)].find((b) => b.offsetParent) || null;
  const prefKey = (k) => `folio.page.${k}`;
  const pref = (k, d) => { try { return localStorage.getItem(prefKey(k)) ?? d; } catch { return d; } };
  const savePref = (k, v) => { try { localStorage.setItem(prefKey(k), v); } catch { /* storage unavailable */ } };
  const pv = { zoom: Math.min(2, Math.max(0.5, Number(pref('zoom', '1')) || 1)), width: pref('width', 'normal'), typewriter: pref('typewriter', '') === '1' };

  function setStyle(v) {
    const c = editor.chain().focus();
    if (v === 'p') return c.setParagraph().run();
    if (v === 'quote') return c.setParagraph().toggleBlockquote().run();
    if (v === 'code') return c.toggleCodeBlock().run();
    return c.setHeading({ level: Number(v.slice(1)) }).run();
  }
  function setWidth(w) { pv.width = w; savePref('width', w); host.dataset.width = w; syncToolbar(); }
  function setZoom(z) {
    pv.zoom = Math.round(Math.min(2, Math.max(0.5, z)) * 10) / 10; savePref('zoom', String(pv.zoom));
    page.style.zoom = pv.zoom === 1 ? '' : String(pv.zoom); syncToolbar(); onStats?.(api.stats());
  }
  host.dataset.width = pv.width; if (pv.zoom !== 1) page.style.zoom = String(pv.zoom);
  host.querySelector('.rich-scroll').addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return; e.preventDefault(); setZoom(pv.zoom + (e.deltaY < 0 ? 0.1 : -0.1)); }, { passive: false });

  /* typewriter scrolling: the line being typed stays in the middle of the window */
  const scroller = host.querySelector('.rich-scroll');
  function centreCaret() {
    if (!pv.typewriter || !editor.isFocused) return;
    let r; try { r = editor.view.coordsAtPos(editor.state.selection.head); } catch { return; }
    const sr = scroller.getBoundingClientRect();
    scroller.scrollTop += (r.top + r.bottom) / 2 - (sr.top + sr.height / 2);
  }

  /* the / menu from a button: on an empty line or after a space type /, otherwise open a new line below */
  function typeTrigger(ch) {
    const { $from, empty } = editor.state.selection; const before = $from.parent.textBetween(0, $from.parentOffset, ' ', ' ');
    const c = editor.chain().focus();
    if (!empty) c.setTextSelection(editor.state.selection.to);
    return c.insertContent({ type: 'text', text: (!before || /\s$/.test(before) ? '' : ' ') + ch }).run();
  }
  function openSlash() {
    const { $from } = editor.state.selection; const para = $from.parent;
    if (para.type.name === 'paragraph' && !para.content.size) return editor.chain().focus().insertContent({ type: 'text', text: '/' }).run();
    if ($from.depth >= 1) {
      const end = $from.after(1);
      return editor.chain().focus().insertContentAt(end, { type: 'paragraph', content: [{ type: 'text', text: '/' }] }).setTextSelection(end + 2).run();
    }
    return typeTrigger('/');
  }
  function openInsertMenu(btn) {
    const items = COMPACT_INSERTS.map((id) => INSERTS.find((i) => i.id === id)).filter(Boolean).map((i) => ({ label: i.label, icon: icons[i.icon] || `<span class="slash-badge">${i.badge || ''}</span>`, run: () => api.insert(i.id) }));
    btn?.setAttribute('aria-expanded', 'true');
    popupMenu(btn, [...items, '-', { label: tr('rich.all-blocks'), icon: icons.plus, key: '/', run: openSlash }], { label: tr('rich.insert'), onClose: () => btn?.setAttribute('aria-expanded', 'false') });
  }
  function openAlignMenu(btn) {
    const cur = editor.getAttributes('paragraph').textAlign ?? editor.getAttributes('heading').textAlign ?? 'left';
    const a = (v, label, icon, key) => ({ label, icon: icons[icon], key: keyLabel(key), checked: (cur || 'left') === v, run: () => pageCmd.align(editor, v) });
    popupMenu(btn, [a('left', tl('rich', 'Align left'), 'alignLeft', 'Mod+Shift+L'), a('center', 'Centre', 'alignCenter', 'Mod+Alt+E'), a('right', tl('rich', 'Align right'), 'alignRight', 'Mod+Shift+R'), a('justify', 'Justify', 'alignJustify', 'Mod+Shift+J')], { label: tr('rich.alignment') });
  }
  /* Word's table grid: point at the size, click to insert */
  function openTableGrid(btn) {
    const R = 8, C = 10; let pick = [3, 3];
    const cells = Array.from({ length: R * C }, (_, i) => `<button type="button" class="tg-cell" data-r="${Math.floor(i / C) + 1}" data-c="${(i % C) + 1}" aria-label="${Math.floor(i / C) + 1} by ${(i % C) + 1}"></button>`).join('');
    const { menu, close } = popupMenu(btn, [{ html: `<div class="tg"><div class="tg-label">${tr('rich.insert-a-3-3-table')}</div><div class="tg-grid" style="grid-template-columns:repeat(${C},16px)">${cells}</div></div>` }, '-',
      { label: tr('rich.table-from-pasted-cells-copy-them-in-e'), icon: icons.paste, disabled: true, run() {} }], { label: tr('rich.insert-table') });
    const paint = () => { menu.querySelector('.tg-label').textContent = `Insert a ${pick[0]} × ${pick[1]} table`; menu.querySelectorAll('.tg-cell').forEach((b) => b.classList.toggle('on', +b.dataset.r <= pick[0] && +b.dataset.c <= pick[1])); };
    menu.addEventListener('mouseover', (e) => { const b = e.target.closest('.tg-cell'); if (b) { pick = [+b.dataset.r, +b.dataset.c]; paint(); } });
    menu.addEventListener('focusin', (e) => { const b = e.target.closest('.tg-cell'); if (b) { pick = [+b.dataset.r, +b.dataset.c]; paint(); } });
    menu.addEventListener('click', (e) => { const b = e.target.closest('.tg-cell'); if (!b) return; close('pick'); const item = INSERTS.find((i) => i.id === 'table'); runInsert(editor, { item, args: { rows: +b.dataset.r, cols: +b.dataset.c } }, insertCtx()); });
    menu.addEventListener('keydown', (e) => {
      const step = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key]; if (!step) return;
      e.preventDefault(); e.stopPropagation(); pick = [Math.min(R, Math.max(1, pick[0] + step[0])), Math.min(C, Math.max(1, pick[1] + step[1]))];
      menu.querySelector(`.tg-cell[data-r="${pick[0]}"][data-c="${pick[1]}"]`).focus(); paint();
    }, true);
    menu.querySelector(`.tg-cell[data-r="3"][data-c="3"]`).focus(); paint();
  }
  /* "Open as sheet": the table moves to a new sheet next to the page, and an embed takes its place */
  async function tableToSheet(ed) {
    const data = tableCmd.rows(ed.state); if (!data || !createDoc) return false;
    const { t } = data; let name = 'Table';
    ed.state.doc.nodesBetween(0, t.pos, (n) => { if (n.type.name === 'heading') name = n.textContent.trim() || name; return n.type.name !== 'table'; });
    const made = await createDoc({ type: 'sheet', name, content: (title) => sheetFromTable(title, data.rows, data.aligns) });
    if (!made) return false;
    const now = tableAt(ed.state) || t; const at = now.pos;
    ed.chain().focus().insertContentAt({ from: at, to: at + now.table.nodeSize }, { type: 'paragraph', content: [{ type: 'text', text: `![[${made.ref}]]` }] }).run();
    return true;
  }

  /* format painter (Word, Docs): copy the look of the text at the cursor, paint it on the next selection */
  const painter = {
    on: false, sticky: false, marks: [], block: null,
    toggle(sticky) {
      if (this.on && !sticky) return this.off();
      const { $from } = editor.state.selection; const para = $from.parent;
      this.marks = (editor.state.storedMarks || $from.marks()).filter((m) => m.type.name !== 'link');
      this.block = { type: para.type.name, attrs: { ...para.attrs } };
      this.on = true; this.sticky = !!sticky; host.classList.add('is-painting'); syncToolbar();
    },
    off() { this.on = false; this.sticky = false; host.classList.remove('is-painting'); syncToolbar(); },
    apply() {
      let { from, to, empty, $from } = editor.state.selection;
      if (empty) { const t = $from.parent.textContent; let a = $from.parentOffset, b = a; while (a > 0 && /[\p{L}\p{N}_]/u.test(t[a - 1])) a--; while (b < t.length && /[\p{L}\p{N}_]/u.test(t[b])) b++; if (a === b) return; from = $from.start() + a; to = $from.start() + b; }
      const { state } = editor; const tr = state.tr;
      for (const name of Object.keys(state.schema.marks)) if (name !== 'link') tr.removeMark(from, to, state.schema.marks[name]);
      for (const m of this.marks) tr.addMark(from, to, m);
      const blk = this.block;
      if (blk && (blk.type === 'paragraph' || blk.type === 'heading')) {
        state.doc.nodesBetween(from, to, (n, pos) => {
          if (!n.isTextblock) return true;
          if (n.type.name === 'paragraph' || n.type.name === 'heading') tr.setNodeMarkup(pos, state.schema.nodes[blk.type], { ...n.attrs, ...(blk.type === 'heading' ? { level: blk.attrs.level } : {}), textAlign: blk.attrs.textAlign ?? null });
          return false;
        });
      }
      editor.view.dispatch(tr);
      if (!this.sticky) this.off();
    },
  };
  editor.view.dom.addEventListener('mouseup', () => { if (painter.on) setTimeout(() => painter.apply(), 0); });
  editor.view.dom.addEventListener('keydown', (e) => { if (e.key === 'Escape' && painter.on) { e.preventDefault(); painter.off(); } });
  editor.view.dom.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); painter.toggle(false); } if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); showCounts(null); } });

  /* word count (Docs: Ctrl+Shift+C) */
  function showCounts(btn) {
    const st = api.stats(); const f = new Intl.NumberFormat();
    const row = (l, a, b) => `<div class="counts-row"><span>${l}</span><b>${f.format(a)}</b>${b != null ? `<b>${f.format(b)}</b>` : '<b></b>'}</div>`;
    const sel = st.selection;
    popupMenu(btn || visibleBtn('find') || host, [{ html: `<div class="counts"><div class="counts-row counts-head"><span></span><span>${tr('rich.document')}</span><span>${sel ? 'Selection' : ''}</span></div>${row(tl('rich', 'Words'), st.words, sel?.words)}${row(tl('rich', 'Characters'), st.chars, sel?.chars)}${row(tl('rich', 'Characters without spaces'), st.charsNoSpace, sel?.charsNoSpace)}${row(tl('rich', 'Paragraphs'), st.paragraphs, sel?.paragraphs)}${row(tl('rich', 'Pages'), Math.max(1, Math.ceil(st.words / 500)))}<div class="counts-note">About ${Math.max(1, Math.round(st.words / 230))} min to read</div></div>` }], { label: tr('rich.word-count') });
  }

  /* find and replace */
  const findBar = mountFindBar(host.querySelector('.rich-scroll').parentElement === host ? host : host, editor, { icons, keyLabel });
  host.insertBefore(host.querySelector('.find-bar'), host.querySelector('.rich-scroll'));

  /* comments and suggestions (CriticMarkup) in a pane beside the page */
  const review = mountReview(host, editor, { icons, author, keyLabel, mentions: () => (mentions ? mentions() : null), onToggle: () => syncToolbar(), dock: reviewDock, onCount: onReviewCount });
  editor.view.dom.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === 'KeyM') { e.preventDefault(); review.comment(); }
  });

  /* properties: the front matter as fields above the title; only the lines of a changed property are rewritten */
  const props = mountProps(page, {
    icons, onTag: (t) => onTag?.(t), onLink: (n) => onWikiLink?.(n), onType: (k, t) => onPropType?.(k, t),
    tags: () => (mentions ? mentions()?.tags?.() : []) || [],
    get: () => model?.fm || '',
    locked: () => !!editor.storage.pageLock?.on,
    resolveImage, pickCover: () => onPickImage?.(),
    set: (fm) => setFm(fm),
  });
  /* per-page appearance (page-appearance.js): font, small text and full width as attributes of the page, the floating contents */
  function setFm(fm) { if (editor.storage.pageLock?.on) return; if (!model) model = codec.load(''); const old = model.fm; if (!old && /\r\n/.test(model.text.split('\n', 1)[0] + '\n')) fm = fm.replace(/\r?\n/g, '\r\n'); model.fm = fm; model.text = fm + model.text.slice(old.length); emit(); applyAppearance(); }
  const toc = mountToc(host.querySelector('.rich-scroll'), { root: () => editor.view.dom });
  function applyAppearance() {
    const a = readAppearance(model?.fm || '');
    for (const [k, v] of [['font', a.font], ['small-text', a.small], ['full-width', a.full]]) { if (v) page.dataset[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v === true ? 'true' : v; else delete page.dataset[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())]; }
    toc.refresh(a.toc);
  }
  const styleSel = host.querySelector('#rb-style');
  styleSel.addEventListener('change', () => {
    const v = styleSel.value, c = editor.chain().focus();
    if (v === 'p') c.setParagraph().run();
    else if (v === 'quote') c.setParagraph().toggleBlockquote().run();
    else if (v === 'code') c.toggleCodeBlock().run();
    else c.setHeading({ level: Number(v.slice(1)) }).run();
  });

  /* inline link editor in the selection bubble */
  const linkBox = bubble.querySelector('.bubble-link'), linkInput = linkBox.querySelector('input');
  function openLinkEditor() {
    bubble.classList.add('is-link'); linkBox.hidden = false;
    linkInput.value = editor.getAttributes('link').href || '';
    requestAnimationFrame(() => { linkInput.focus(); linkInput.select(); });
  }
  function closeLinkEditor(refocus = true) { bubble.classList.remove('is-link'); linkBox.hidden = true; if (refocus) editor.commands.focus(); }
  linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeLinkEditor(); }
    if (e.key === 'Enter') {
      e.preventDefault(); let href = linkInput.value.trim();
      if (href && !/^([a-z][a-z0-9+.-]*:|#|\/|\.)/i.test(href) && /\.[a-z]{2,}/i.test(href) && !/\.md$/i.test(href)) href = 'https://' + href;
      const ch = editor.chain().focus().extendMarkRange('link');
      (href ? ch.setLink({ href }) : ch.unsetLink()).run(); closeLinkEditor(false);
    }
  });
  linkInput.addEventListener('blur', () => setTimeout(() => { if (!bubble.contains(document.activeElement)) closeLinkEditor(false); }, 0));

  /* colour popover: text colour and background, Notion's nine colours */
  const colours = host.querySelector('#rb-colours'); let colourFrom = null;
  function toggleColours() {
    if (!colours.hidden) return hideColours();
    const anchor = (bubble.style.visibility === 'visible' || bubble.matches('[data-show]')) && bubble.contains(document.activeElement) ? bubble.querySelector('[data-cmd="colour"]') : visibleBtn('colour') || host.querySelector('.ribbon [data-cmd="colour"]');
    const r = (anchor || host).getBoundingClientRect();
    colourFrom = anchor; colours.hidden = false;
    const a = editor.getAttributes('folioColor');
    colours.querySelectorAll('[data-colour]').forEach((b) => b.setAttribute('aria-pressed', String((a.color || '') === b.dataset.colour)));
    colours.querySelectorAll('[data-bgc]').forEach((b) => b.setAttribute('aria-pressed', String((a.bg || '') === b.dataset.bgc)));
    colours.style.left = Math.min(r.left, innerWidth - colours.offsetWidth - 8) + 'px'; colours.style.top = r.bottom + 6 + 'px';
    colours.querySelector('[aria-pressed="true"]')?.focus() || colours.querySelector('button')?.focus();
  }
  function hideColours(refocus = true) { if (colours.hidden) return; colours.hidden = true; if (refocus) editor.commands.focus(); }
  colours.addEventListener('mousedown', (e) => e.preventDefault());
  colours.addEventListener('click', (e) => {
    const b = e.target.closest('.rb-swatch'); if (!b) return;
    if (b.dataset.colour != null) pageCmd.color(editor, { color: b.dataset.colour || null });
    else pageCmd.color(editor, { bg: b.dataset.bgc || null });
    hideColours();
  });
  colours.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); hideColours(); colourFrom?.focus?.(); }
    const all = [...colours.querySelectorAll('.rb-swatch')]; const i = all.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 10, ArrowUp: -10 }[e.key];
    if (step && i >= 0) { e.preventDefault(); all[(i + step + all.length) % all.length].focus(); }
  });
  document.addEventListener('mousedown', (e) => { if (!colours.hidden && !colours.contains(e.target) && !e.target.closest('[data-cmd="colour"]')) hideColours(false); });

  /* turn into, from the selection bubble */
  const turnSel = host.querySelector('#rb-turn');
  turnSel.addEventListener('change', () => {
    const v = turnSel.value, c = editor.chain().focus();
    if (v === 'p') c.setParagraph().run();
    else if (v === 'bullet') c.toggleBulletList().run();
    else if (v === 'ordered') c.toggleOrderedList().run();
    else if (v === 'task') c.toggleTaskList().run();
    else if (v === 'quote') c.setParagraph().toggleBlockquote().run();
    else if (v === 'code') c.toggleCodeBlock().run();
    else c.setHeading({ level: Number(v.slice(1)) }).run();
  });

  const ACTIVE = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike', highlight: 'highlight', code: 'code', link: 'link', linkInline: 'link', bullet: 'bulletList', ordered: 'orderedList', task: 'taskList', quote: 'blockquote', codeblock: 'codeBlock', superscript: 'superscript', subscript: 'subscript', hiddenComment: 'hiddenComment', colour: 'folioColor', inlineMath: 'inlineMath', blockMath: 'blockMath' };
  const ALIGN_BTN = { alignLeft: null, alignCenter: 'center', alignRight: 'right', alignJustify: 'justify' };
  function syncToolbar() {
    host.classList.toggle('rich-large', editor.state.doc.childCount > 2500); // very long pages: blocks off screen are not laid out (CSS content-visibility), which keeps typing quick
    for (const b of host.querySelectorAll('.rb[data-cmd]')) {
      const n = ACTIVE[b.dataset.cmd];
      if (n) b.setAttribute('aria-pressed', String(editor.isActive(n)));
      if (b.dataset.cmd in ALIGN_BTN) {
        const cur = editor.getAttributes('paragraph').textAlign ?? editor.getAttributes('heading').textAlign ?? null;
        b.setAttribute('aria-pressed', String((cur === 'left' ? null : cur) === ALIGN_BTN[b.dataset.cmd]));
      }
    }
    const canUndo = editor.can().undo(), canRedo = editor.can().redo();
    host.querySelectorAll('[data-cmd="undo"]').forEach((b) => { b.disabled = !canUndo; });
    host.querySelectorAll('[data-cmd="redo"]').forEach((b) => { b.disabled = !canRedo; });
    let v = 'p';
    for (let l = 1; l <= 6; l++) if (editor.isActive('heading', { level: l })) v = 'h' + l;
    if (editor.isActive('blockquote')) v = 'quote';
    if (editor.isActive('codeBlock')) v = 'code';
    styleSel.value = v;
    turnSel.value = editor.isActive('taskList') ? 'task' : editor.isActive('bulletList') ? 'bullet' : editor.isActive('orderedList') ? 'ordered' : (['p', 'h1', 'h2', 'h3', 'quote', 'code'].includes(v) ? v : 'p');
    if (!ready) return;
    ribbon.setTable(editor.isActive('table'));
    ribbonEl.querySelectorAll('.rb-style-tile').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.style === v)));
    const cur = editor.getAttributes('paragraph').textAlign ?? editor.getAttributes('heading').textAlign ?? 'left';
    const alignBtn = ribbonEl.querySelector('[data-cmd="align"]'); const ai = icons[{ left: 'alignLeft', center: 'alignCenter', right: 'alignRight', justify: 'alignJustify' }[cur || 'left']];
    if (alignBtn && alignBtn.dataset.icon !== cur) { alignBtn.dataset.icon = cur; alignBtn.innerHTML = ai + '<i class="rb-caret" aria-hidden="true"></i>'; }
    const ca = editor.isActive('table') ? tableCmd.colAlign(editor.state) : null;
    const press = (cmd, on) => ribbonEl.querySelectorAll(`[data-cmd="${cmd}"]`).forEach((b) => b.setAttribute('aria-pressed', String(!!on)));
    press('cellLeft', ca === 'left'); press('cellCenter', ca === 'center'); press('cellRight', ca === 'right');
    press('painter', painter.on); press('typewriter', pv.typewriter); press('suggest', editor.storage.suggestMode.on); press('reviewPane', review.open);
    for (const w of ['narrow', 'normal', 'wide']) press('width:' + w, pv.width === w);
    for (const a of ['focus', 'outline', 'spellcheck']) press('app:' + a, isOn(a));
    ribbonEl.querySelectorAll('.rb-zoom-val').forEach((z) => { z.textContent = `${Math.round(pv.zoom * 100)}%`; });
    cancelAnimationFrame(statsRaf); statsRaf = requestAnimationFrame(() => { onStats?.(api.stats()); centreCaret(); });
  }
  let statsRaf = 0;

  ready = true;
  const api = {
    /** the person allowed web images: try again every one that was held back */
    /** the front matter block of the page, and a way to change it (Appearance): fn gets it and returns the new one */
    getFm() { return model?.fm || ''; },
    editFm(fn) { const old = model?.fm || ''; const next = fn(old); if (next !== old) { setFm(next); props.render(); } },
    refreshImages() { for (const fn of [...blockedViews]) fn(); },
    editor,
    /** redraw chips after a setting that changes how they read (date format, language) */
    /** X3: a locked page opens read-only (state kept by the app, never in the file) and shows a Locked badge with Unlock */
    setLocked(on) {
      editor.storage.pageLock = { on: !!on };
      host.classList.toggle('is-locked', !!on); host.querySelector('.rich-lock').hidden = !on;
      editor.setEditable(!on && !host.classList.contains('is-viewing'));
      props.render(); review.render(); // their controls follow the lock
    },
    /** B8: open or close every toggle in one transaction (one undo step); returns how many changed */
    setToggles(open) {
      if (editor.storage.pageLock?.on) return 0;
      const t2 = editor.state.tr; let n = 0;
      editor.state.doc.descendants((node, pos) => { if (node.type.name === 'details' && !!node.attrs.open !== open) { t2.setNodeMarkup(pos, undefined, { ...node.attrs, open }); n++; } });
      if (n) editor.view.dispatch(t2);
      return n;
    },
    /** how many toggles are open and closed: the toggle-all command opens them all unless they all are */
    toggleCount() { let open = 0, closed = 0; editor.state.doc.descendants((node) => { if (node.type.name === 'details') (node.attrs.open ? open++ : closed++); }); return { open, closed }; },
    refreshDecorations() { editor.view.dispatch(editor.state.tr.setMeta('folioRedecorate', true).setMeta('addToHistory', false)); },
    /** load text into the editor; `keepHistory` is for an outside update of the same document (an AI edit, a change on disk) */
    setMarkdown(md, { keepHistory = false } = {}) {
      const oldFm = model ? model.fm : '';
      silent = true;
      try {
        model = codec.load(md);
        editor.commands.setContent(model.json, { emitUpdate: false });
        codec.bind(model, editor.state.doc);
      } finally { silent = false; }
      // the front matter lives outside the editor's history, so an outside change to it starts a fresh history
      if (model.fm !== oldFm) keepHistory = false;
      // a loaded document starts with a clean history, so Undo never reaches into the previous tab
      if (!keepHistory) { const st = editor.state; editor.view.updateState(EditorState.create({ schema: st.schema, doc: st.doc, plugins: st.plugins })); }
      host.querySelector('.rich-scroll').scrollTop = 0;
      props.render(); review.render(); applyAppearance();
      syncToolbar();
    },
    /** the visual editor state of this document, with its undo history; `md` says which text it matches */
    snapshot() { return { state: editor.view.state, md: api.getMarkdown(), model }; },
    flush: flushEmit,
    restore(snap) {
      model = snap.model; silent = true;
      try { editor.view.updateState(snap.state); } finally { silent = false; }
      props.render(); applyAppearance();
      syncToolbar();
    },
    undo() { return editor.commands.undo(); },
    redo() { return editor.commands.redo(); },
    canUndo() { return editor.can().undo(); },
    canRedo() { return editor.can().redo(); },
    getMarkdown() {
      if (!model) model = codec.load('');
      return codec.save(model, editor.state.doc);
    },
    focus(where) { editor.commands.focus(where); },
    run,
    insert(id) { if (editor.storage.pageLock?.on) return false; const item = INSERTS.find((i) => i.id === id); return item ? runInsert(editor, { item }, insertCtx()) : false; },
    headings() { const out = []; editor.state.doc.descendants((n, pos) => { if (n.type.name === 'heading') out.push(pos); }); return out; },
    scrollToHeading(i) {
      const pos = api.headings()[i]; if (pos == null) return;
      const dom = editor.view.nodeDOM(pos);
      dom?.scrollIntoView?.({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      editor.commands.setTextSelection(pos + 1);
    },
    currentHeading() {
      const scroller = host.querySelector('.rich-scroll'); const top = scroller.getBoundingClientRect().top + 60;
      let idx = -1; api.headings().forEach((pos, i) => { const d = editor.view.nodeDOM(pos); if (d && d.getBoundingClientRect().top <= top) idx = i; });
      return idx;
    },
    /* counts for the status bar and the Word count box: the document, and the selection when there is one */
    stats() {
      const count = (text, paragraphs) => ({ words: (text.match(/[\p{L}\p{N}’'-]+/gu) || []).length, chars: [...text].length, charsNoSpace: [...text.replace(/\s/g, '')].length, paragraphs });
      let paras = 0; editor.state.doc.descendants((n) => { if (n.isTextblock && n.content.size) paras++; return !n.isTextblock; });
      const all = count(editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' '), paras);
      all.words = api.words();
      const { from, to, empty } = editor.state.selection;
      let sp = 0; if (!empty) editor.state.doc.nodesBetween(from, to, (n) => { if (n.isTextblock && n.content.size) sp++; return !n.isTextblock; });
      return { ...all, zoom: pv.zoom, selection: empty ? null : count(editor.state.doc.textBetween(from, to, '\n', ' '), sp) };
    },
    find(replace = false) { return findBar.open(replace); },
    addProperty() { props.add(); },
    /* paste-like insertion: Markdown goes through the codec, plain text stays text */
    insertMarkdown(md) { editor.commands.focus(); return insertMarkdown(editor, md, (m) => codec.load(m).json.content); },
    insertPlain(text) { editor.commands.focus(); return insertPlainText(editor, text); },
    review: () => review,
    /* put a filled template in this page: its properties join the page's, its body goes at the cursor (or at pos) */
    insertTemplate(text, pos = null) {
      if (editor.storage.pageLock?.on) return false;
      const { fm, body: raw } = splitTemplate(text); const body = text.startsWith('```template-button') ? raw : intoPage(raw);
      if (fm) { const merged = mergeProps(model?.fm || '', fm); if (merged !== (model?.fm || '')) { const old = model.fm; model.fm = merged; model.text = merged + model.text.slice(old.length); props.render(); } }
      const nodes = body.trim() ? codec.load(body).json.content : [];
      if (nodes.length) {
        const c = editor.chain().focus();
        if (pos != null) c.insertContentAt(pos, nodes);
        else {
          const { $from } = editor.state.selection;
          if ($from.parent.type.name === 'paragraph' && !$from.parent.content.size && $from.depth >= 1) c.insertContentAt({ from: $from.before(), to: $from.after() }, nodes);
          else c.insertContentAt($from.depth >= 1 ? $from.after(1) : $from.pos, nodes);
        }
        c.run();
      }
      // the caret goes where the template said {{cursor}}; the marker never reaches the file
      let at = null;
      editor.state.doc.descendants((n, p) => { if (at == null && n.isText && n.text.includes(CURSOR)) at = p + n.text.indexOf(CURSOR); return at == null; });
      if (at != null) editor.chain().focus().deleteRange({ from: at, to: at + CURSOR.length }).setTextSelection(at).run();
      else {
        const tr = editor.state.tr; editor.state.doc.descendants((n, p) => { if (n.type.name === 'folioRaw' && n.attrs.source.includes(CURSOR)) tr.setNodeMarkup(p, undefined, { ...n.attrs, source: n.attrs.source.split(CURSOR).join('') }); });
        if (tr.docChanged) editor.view.dispatch(tr);
      }
      emit(); return true;
    },
    setRibbonMode(m) { ribbon.setMode(m); },
    zoom(step) { return step === 0 ? setZoom(1) : setZoom(pv.zoom + step * 0.1); },
    sync() { syncToolbar(); },
    /* the outline moves and re-levels sections here, so the change is one undo step */
    moveSection(from, before) {
      const tops = []; editor.state.doc.forEach((n, pos) => { if (n.type.name === 'heading') tops.push({ pos, level: n.attrs.level }); });
      const all = api.headings(); const fromPos = all[from], beforePos = before < 0 ? -1 : all[before];
      const s = tops.findIndex((h) => h.pos === fromPos); if (s < 0 || (before >= 0 && !tops.some((h) => h.pos === beforePos))) return false;
      const end = tops.slice(s + 1).find((h) => h.level <= tops[s].level)?.pos ?? editor.state.doc.content.size;
      if (beforePos >= fromPos && beforePos < end) return false;
      const slice = editor.state.doc.slice(fromPos, end);
      const tr = editor.state.tr.delete(fromPos, end);
      const at = beforePos < 0 ? tr.doc.content.size : tr.mapping.map(beforePos);
      tr.insert(at, slice.content);
      tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
      editor.view.dispatch(tr.scrollIntoView()); editor.commands.focus();
      return true;
    },
    shiftSection(index, delta) {
      const tops = []; editor.state.doc.forEach((n, pos) => { if (n.type.name === 'heading') tops.push({ pos, level: n.attrs.level }); });
      const fromPos = api.headings()[index]; const s = tops.findIndex((h) => h.pos === fromPos); if (s < 0) return false;
      const end = tops.slice(s + 1).find((h) => h.level <= tops[s].level)?.pos ?? editor.state.doc.content.size;
      const inside = tops.filter((h) => h.pos >= fromPos && h.pos < end);
      if (inside.some((h) => h.level + delta < 1 || h.level + delta > 6)) return false;
      const tr = editor.state.tr; for (const h of inside) tr.setNodeMarkup(h.pos, undefined, { ...tr.doc.nodeAt(h.pos).attrs, level: h.level + delta });
      editor.view.dispatch(tr); return true;
    },
    words() {
      let text = editor.state.doc.textContent;
      editor.state.doc.descendants((n) => { if (n.type.name === 'folioRaw') text += ' ' + n.attrs.source.replace(/<[^>]+>|[#*_`>|[\]()$-]/g, ' '); });
      return (text.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
    },
    destroy() { editor.destroy(); },
  };
  return api;
}
