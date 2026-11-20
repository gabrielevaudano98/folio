// Folio — "mini Word" rich editor for Markdown. TipTap 3 (ProseMirror) with Markdown in and out.
import { t as tr, tl } from './i18n.js';
import { Editor, Extension, InputRule } from '@tiptap/core';
import katex from 'katex';
import Typography from '@tiptap/extension-typography';
import Suggestion, { exitSuggestion } from '@tiptap/suggestion';
import { filterInserts, runInsert, INSERTS } from './inserts.js';
import { mentionEntries, TAG, FIELD, statusClass } from './page-mentions.js';
import { highlight } from './fuzzy.js';
import { BlockHandles } from './page-blocks.js';
import { CalloutUI, HeadingFold, HFOLD, TocView, BreadcrumbView, PageBreakView } from './page-ui.js';
import { buildRibbon, wireRibbon, COMPACT_INSERTS } from './page-ribbon.js';
import { TableHandles, tableCmd, tableAt, popupMenu, tableMenuItems, sheetFromTable } from './page-table.js';
import { FindReplace, mountFindBar } from './page-find.js';
import { mountProps } from './page-props-ui.js';
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
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { renderMermaid, hydrateCharts, render } from './markdown.js';
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
const FolioCodeBlock = CodeBlock.extend({
  addOptions() { return { ...this.parent?.(), readNote: null, isDark: () => false, onTemplateButton: null }; },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div'); dom.className = 'rich-code';
      const pre = document.createElement('pre'); const code = document.createElement('code'); pre.appendChild(code);
      const preview = document.createElement('div'); preview.className = 'rich-code-preview'; preview.contentEditable = 'false';
      const bar = document.createElement('div'); bar.className = 'rich-code-bar'; bar.contentEditable = 'false';
      dom.append(bar, preview, pre);
      let lang = node.attrs.language || '', timer, editing = false;
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
        bar.innerHTML = visual ? `<span>${lang === 'chart' ? 'Chart' : lang === 'template-button' ? 'Template button' : 'Diagram'}</span><button type="button" class="btn btn-quiet">${editing ? 'Done' : 'Edit source'}</button>` : select;
        if (visual) draw(n.textContent); else preview.innerHTML = '';
      };
      bar.addEventListener('change', (e) => {
        const sel = e.target.closest('select'); if (!sel || typeof getPos !== 'function') return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, language: sel.value || null }));
        editor.commands.focus();
      });
      bar.addEventListener('mousedown', (e) => {
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

/* callouts and [[wiki links]] are drawn, the Markdown text stays as written */
const Decorate = Extension.create({
  name: 'folioDecorate',
  addOptions() { return { onWikiLink: null, resolveValue: null, linkKind: null, preview: null, onTag: null, onStatus: null }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    const hover = { el: null, card: null, timer: 0, seq: 0, hide() { clearTimeout(this.timer); this.seq++; this.card?.remove(); this.card = null; this.el = null; } };
    const build = (doc) => {
      const deco = [];
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
          const bid = /\s\^[A-Za-z0-9-]+\s*$/.exec(n.text);
          if (bid && pos + n.nodeSize === doc.resolve(pos).end()) deco.push(Decoration.inline(pos + bid.index, pos + n.text.length, { class: 'rich-block-id', title: tr('rich.block-id-links-like-note-id-point-here') }));
          const re = /\[\[([^\]\n]+)\]\]/g; let m;
          while ((m = re.exec(n.text))) {
            const embed = n.text[m.index - 1] === '!';
            const target = m[1].replace(/\|.*$/, ''); const kind = embed ? null : opts.linkKind?.(target);
            deco.push(Decoration.inline(pos + m.index - (embed ? 1 : 0), pos + m.index + m[0].length, { class: embed ? 'rich-ref' : `rich-wikilink${kind && kind !== 'doc' ? ' is-' + kind : ''}`, 'data-target': target, title: embed ? tl('rich', 'Embedded in the Read view and on slides. Ctrl or ⌘ click to open') : kind === 'missing' ? tl('rich', 'No page with this name yet. Ctrl or ⌘ click to create it') : tl('rich', 'Ctrl or ⌘ click to open') }));
          }
          if (!n.marks.some((mk) => mk.type.name === 'code')) {
            TAG.lastIndex = 0; let t;
            while ((t = TAG.exec(n.text))) { const from = pos + t.index + t[1].length; deco.push(Decoration.inline(from, from + t[2].length + 1, { class: 'rich-tag', title: tr('rich.tag-ctrl-or-click-to-see-every-page-wi') })); }
            FIELD.lastIndex = 0; let f;
            while ((f = FIELD.exec(n.text))) { const key = f[1].trim().toLowerCase(); deco.push(Decoration.inline(pos + f.index, pos + f.index + f[0].length, { class: key === 'status' ? `rich-field rich-status is-${statusClass(f[2])}` : 'rich-field', 'data-key': key, title: key === 'status' ? tl('rich', 'Status') : f[1] })); }
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
    return [new Plugin({
      key: new PluginKey('folioDecorate'),
      state: { init: (_, s) => DecorationSet.create(s.doc, build(s.doc)), apply: (tr, old) => (tr.docChanged ? DecorationSet.create(tr.doc, build(tr.doc)) : old) },
      props: {
        decorations(state) { return this.getState(state); },
        handleDOMEvents: {
          mouseover(view, e) {
            const el = e.target.closest?.('.rich-wikilink:not(.is-missing)');
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
          },
          mouseout(view, e) { const el = e.target.closest?.('.rich-wikilink'); if (el && el === hover.el && !el.contains(e.relatedTarget)) hover.hide(); return false; },
          keydown() { hover.hide(); return false; },
          scroll() { hover.hide(); return false; },
        },
        /* from the keyboard: Alt+Enter with the caret in a status, tag or link does what clicking it does */
        handleKeyDown(view, e) {
          if (e.key !== 'Enter' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
          let node = view.root.getSelection?.()?.anchorNode; if (!node || !view.dom.contains(node)) { try { node = view.domAtPos(view.state.selection.from).node; } catch { return false; } }
          const el = (node.nodeType === 3 ? node.parentElement : node)?.closest?.('.rich-status, .rich-tag, .rich-wikilink, .rich-ref'); if (!el) return false;
          e.preventDefault();
          if (el.classList.contains('rich-status') && opts.onStatus) { const from = view.posAtDOM(el, 0); const m = /^\[status::[ \t]*([^\]\n]*?)[ \t]*\]/.exec(view.state.doc.textBetween(from, Math.min(view.state.doc.resolve(from).end(), from + 100), '\n', '\0')); if (m) opts.onStatus(el, m[1], (v) => { view.dispatch(view.state.tr.insertText(`[status:: ${v}]`, from, from + m[0].length)); view.focus(); }); return true; }
          if (el.classList.contains('rich-tag')) { const { $from } = view.state.selection; const at = $from.parentOffset, txt = $from.parent.textContent; let tag = el.textContent; for (const m of txt.matchAll(/#[\p{L}\p{N}_\/-]+/gu)) if (at >= m.index && at <= m.index + m[0].length) tag = m[0]; opts.onTag?.(tag.replace(/^#/, '')); return true; } // the chip can be split in two by an open suggestion: read the whole tag from the text
          if (el.dataset.target) { opts.onWikiLink?.(el.dataset.target); return true; }
          return false;
        },
        handleClick(view, pos, event) {
          const tag = event.target.closest?.('.rich-tag');
          if (tag && (event.metaKey || event.ctrlKey)) { opts.onTag?.(tag.textContent.replace(/^#/, '')); return true; }
          const st = event.target.closest?.('.rich-status');
          if (st && opts.onStatus && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            const from = view.posAtDOM(st, 0); const end = view.state.doc.resolve(from).end();
            const m = /^\[status::[ \t]*([^\]\n]*?)[ \t]*\]/.exec(view.state.doc.textBetween(from, Math.min(end, from + 100), '\n', '\0'));
            if (m) { opts.onStatus(st, m[1], (v) => { const tr = view.state.tr.insertText(`[status:: ${v}]`, from, from + m[0].length); view.dispatch(tr); view.focus(); }); return true; }
          }
          const el = event.target.closest?.('.rich-wikilink, .rich-ref');
          if (el && (event.metaKey || event.ctrlKey)) { opts.onWikiLink?.(el.dataset.target); return true; }
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
  addOptions() { return { ...this.parent?.(), resolve: null, openFile: null, openUrl: null }; },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const opts = this.options;
      const kind = mediaKind(node.attrs.src || '');
      const dom = document.createElement('figure'); dom.className = `rich-figure rich-media-${kind}`; dom.contentEditable = 'false';
      const setSrc = (el, src) => { if (/^(https?:|data:|file:|blob:)/.test(src)) el.src = src; else Promise.resolve(opts.resolve?.(src)).then((u) => { if (u) el.src = u; }); };
      const commit = (attrs) => { const pos = typeof getPos === 'function' ? getPos() : null; if (pos != null) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })); };
      const name = (node.attrs.src || '').split(/[/?#]/).filter(Boolean).pop()?.replace(/^(?=[a-z]*\d)[a-z0-9]{8}-/, '') || 'file';
      let body;
      if (kind === 'video' || kind === 'audio') {
        body = document.createElement(kind); body.controls = true; body.preload = 'metadata'; body.className = 'rich-media-el'; setSrc(body, node.attrs.src || '');
      } else if (kind === 'image') {
        body = document.createElement('div'); body.className = 'rich-img-wrap';
        const img = document.createElement('img'); img.alt = node.attrs.alt || ''; img.decoding = 'async'; setSrc(img, node.attrs.src || '');
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
        body.innerHTML = `${web?.thumb ? `<img class="rich-card-thumb" alt="" src="${web.thumb}">` : `<span class="rich-card-ic" aria-hidden="true">${kind === 'web' ? icons.link : icons.doc}</span>`}<span class="rich-card-text"><span class="rich-card-title"></span><span class="rich-card-sub"></span></span>`;
        body.querySelector('.rich-card-title').textContent = label;
        body.querySelector('.rich-card-sub').textContent = web ? `${web.name} · ${web.host} · Ctrl or ⌘ click to open` : `${kind === 'pdf' ? 'PDF' : 'File'} · ${name} · Ctrl or ⌘ click to open`;
        body.setAttribute('aria-label', `${label}. Open`);
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
/* The / menu: everything you can insert or turn a block into (inserts.js), Notion style */
const SLASH = new PluginKey('slashMenu');
const SlashMenu = Extension.create({
  name: 'slashMenu',
  addOptions() { return { ctx: () => ({}), keyLabel: (k) => k }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [Suggestion({
      editor: this.editor, char: '/', pluginKey: SLASH, allowSpaces: false, startOfLine: false,
      allow: ({ state, range }) => {
        const $f = state.doc.resolve(range.from);
        if ($f.parent.type.spec.code || $f.parent.type.name === 'detailsSummary') return false;
        return !state.doc.rangeHasMark(range.from, range.to, state.schema.marks.code);
      },
      items: ({ query }) => (query.length > 24 ? [] : filterInserts(query)),
      command: ({ editor, range, props }) => {
        editor.chain().focus().deleteRange(range).run();
        Promise.resolve(runInsert(editor, props, opts.ctx())).catch((e) => console.error(e));
      },
      render: () => slashRenderer(opts),
    })];
  },
});
function slashRenderer(opts, key = SLASH, label = 'Insert or turn into') {
  let el, list, items = [], sel = 0, props = null, view = null;
  const iconOf = (it) => (it.badge ? `<span class="slash-badge">${it.badge}</span>` : icons[it.icon] || icons.plus);
  const paint = () => {
    let html = '', group = null;
    items.forEach((x, i) => {
      if (x.group !== group) { if (group !== null) html += '</div>'; group = x.group; html += `<div class="slash-group" role="group" aria-label="${tl('grp', group)}"><div class="slash-head" aria-hidden="true">${tl('grp', group)}</div>`; }
      const k = x.item.key ? `<kbd>${opts.keyLabel(x.item.key)}</kbd>` : '';
      html += `<div class="slash-item" role="option" id="slash-${i}" data-i="${i}" aria-selected="${i === sel}"><span class="slash-ic" aria-hidden="true">${iconOf(x.item)}</span><span class="slash-text"><span class="slash-label">${highlight(x.item.label, x.marks || [])}</span>${x.item.desc ? `<span class="slash-desc">${x.item.desc.replace(/</g, '&lt;')}</span>` : ''}</span>${k}</div>`;
    });
    if (group !== null) html += '</div>';
    list.innerHTML = html || (props?.loading ? '' : '<div class="slash-empty">' + tr('rich.no-matches-keep-typing-or-press-esc') + '</div>');
    view?.dom.setAttribute('aria-activedescendant', items.length ? `slash-${sel}` : '');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
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
      el = document.createElement('div'); el.className = 'slash-menu';
      el.innerHTML = '<div class="slash-list" role="listbox" id="slash-list" aria-label="${label}"></div><div class="slash-foot" aria-hidden="true">' + tr('rich.to-move-enter-to-choose-esc-to-close') + '</div>';
      list = el.firstChild; document.body.append(el);
      view.dom.setAttribute('aria-controls', 'slash-list'); // aria-expanded is not allowed on a textbox: the list is announced through aria-activedescendant
      list.addEventListener('mousedown', (e) => { e.preventDefault(); const it = e.target.closest('.slash-item'); if (it) choose(+it.dataset.i); });
      list.addEventListener('mousemove', (e) => { const it = e.target.closest('.slash-item'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; list.querySelectorAll('.slash-item').forEach((n) => n.setAttribute('aria-selected', String(+n.dataset.i === sel))); view.dom.setAttribute('aria-activedescendant', `slash-${sel}`); } });
      paint(); place();
    },
    onUpdate(p) { props = p; items = p.items; sel = Math.min(sel, Math.max(0, items.length - 1)); if (!p.query) sel = Math.min(sel, items.length - 1); paint(); place(); },
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
      el?.remove(); el = null;
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

export function createRich(host, { onStatus, onPropType, onChange, resolveImage, onPickImage, onLink, onWikiLink, resolveValue, readNote, isDark = () => false, keyLabel = (k) => k, smartTypography = () => true, pickRef = null, onCopyBlockLink = null, breadcrumb = () => '', createDoc = null, openMedia = null, pickMedia = null, askUrl = null, mentions = null, linkKind = null, preview = null, onCommand = null, isOn = () => false, onStats = null, onTag = null, onTemplate = null, author = () => '', saveImage = null, onError = null, reviewDock = null, onReviewCount = null }) {
  host.innerHTML = `
    ${buildRibbon({ icons, keyLabel, styleOptions: STYLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') })}
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

  const insertCtx = () => ({ appCommand: (id) => onCommand?.(id), addProperty: () => props.add(), pickImage: onPickImage, pickRef, createDoc, pickMedia, askUrl, footnote: (e) => pageCmd.footnote(e) });
  const editor = new Editor({
    element: page,
    extensions: [
      ...pageExtensions({
        codeBlock: FolioCodeBlock.configure({ readNote, isDark, onTemplateButton: (b, pos) => onTemplate?.(b, pos), plusIcon: icons.plus, HTMLAttributes: { spellcheck: 'false' } }),
        image: FolioImage.configure({ resolve: resolveImage, inline: false, allowBase64: true, openFile: (src) => openMedia?.(src), openUrl: (u) => openMedia?.(u) }),
        raw: RawBlock,
        views: [InlineMathView, BlockMathView, FootnoteRefView, FootnoteInlineView, FootnoteDefView, NoAlignKeys, TocView, BreadcrumbView.configure({ html: breadcrumb }), PageBreakView],
      }),
      SmartTypography.configure({ enabled: smartTypography }),
      SlashMenu.configure({ keyLabel, ctx: insertCtx }),
      TableHandles.configure({ icons, toSheet: (e) => tableToSheet(e) }),
      FindReplace,
      SuggestMode,
      SmartPaste.configure({ toNodes: (md) => codec.load(md).json.content, saveImage, onError }),
      Mentions.configure({ ctx: () => (mentions ? mentions() : null), keyLabel }),
      CodeHighlight,
      CalloutUI.configure({ icons }),
      HeadingFold.configure({ icons }),
      BlockHandles.configure({ keyLabel, onCopyLink: (id) => onCopyBlockLink?.(id), icons: { plus: icons.plus, grip: icons.grip, quote: icons.quote, listBullet: icons.listBullet, listOrdered: icons.listOrdered, listTask: icons.listTask, codeBlock: icons.codeBlock } }),
      MarkdownLinkInput,
      Decorate.configure({ onWikiLink, resolveValue, linkKind, preview, onTag: (t) => onTag?.(t), onStatus: (el, cur, apply) => onStatus?.(el, cur, apply) }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : tl('rich', 'Write, or select text to format it')) }),
      BubbleMenu.configure({ element: bubble, shouldShow: ({ editor: e, state }) => !state.selection.empty && !e.isActive('codeBlock') && !e.isActive('image') && !(state.selection instanceof NodeSelection) }),
      WordKeys,
    ],
    editorProps: { attributes: { class: 'prose rich-prose', spellcheck: 'true', 'aria-label': 'Document' } },
    onUpdate: () => { if (!silent) emit(); },
    onSelectionUpdate: () => syncToolbar(),
    onTransaction: () => syncToolbar(),
  });

  const codec = createPageCodec(editor.markdown);
  let emitTimer;
  function emit() {
    clearTimeout(emitTimer);
    emitTimer = setTimeout(() => onChange?.(api.getMarkdown()), 220);
  }

  const run = (id, btn) => {
    if (!id) return false;
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
    set: (fm) => { if (!model) model = codec.load(''); const old = model.fm; model.fm = fm; model.text = fm + model.text.slice(old.length); emit(); },
  });
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
    editor,
    setMarkdown(md) {
      silent = true;
      try {
        model = codec.load(md);
        editor.commands.setContent(model.json, { emitUpdate: false });
        codec.bind(model, editor.state.doc);
      } finally { silent = false; }
      host.querySelector('.rich-scroll').scrollTop = 0;
      props.render(); review.render();
      syncToolbar();
    },
    getMarkdown() {
      if (!model) model = codec.load('');
      return codec.save(model, editor.state.doc);
    },
    focus(where) { editor.commands.focus(where); },
    run,
    insert(id) { const item = INSERTS.find((i) => i.id === id); return item ? runInsert(editor, { item }, insertCtx()) : false; },
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
