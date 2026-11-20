// Folio — "mini Word" rich editor for Markdown. TipTap 3 (ProseMirror) with Markdown in and out.
import { Editor, Extension, InputRule } from '@tiptap/core';
import katex from 'katex';
import Typography from '@tiptap/extension-typography';
import Suggestion, { exitSuggestion } from '@tiptap/suggestion';
import { filterInserts, runInsert, INSERTS } from './inserts.js';
import { mentionEntries, TAG, FIELD, statusClass } from './page-mentions.js';
import { highlight } from './fuzzy.js';
import { BlockHandles } from './page-blocks.js';
import { CalloutUI, HeadingFold, TocView, BreadcrumbView, PageBreakView } from './page-ui.js';
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
const VISUAL = ['mermaid', 'chart'];
/* languages offered in a code block's menu (any other name typed in the file is kept) */
const LANGS = [['', 'Plain text'], ['js', 'JavaScript'], ['ts', 'TypeScript'], ['json', 'JSON'], ['python', 'Python'], ['bash', 'Shell'], ['html', 'HTML'], ['css', 'CSS'], ['sql', 'SQL'], ['yaml', 'YAML'], ['markdown', 'Markdown'], ['java', 'Java'], ['kotlin', 'Kotlin'], ['swift', 'Swift'], ['go', 'Go'], ['rust', 'Rust'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['php', 'PHP'], ['ruby', 'Ruby'], ['xml', 'XML'], ['diff', 'Diff'], ['ini', 'INI / TOML'], ['mermaid', 'Diagram (Mermaid)'], ['chart', 'Chart']];

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
  addOptions() { return { ...this.parent?.(), readNote: null, isDark: () => false }; },
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
          if (lang === 'chart') { preview.innerHTML = `<div class="chart-block" data-spec="${encodeURIComponent(text)}"></div>`; await hydrateCharts(preview, opts.readNote); }
        }, 250);
      };
      const sync = (n) => {
        lang = n.attrs.language || '';
        const visual = VISUAL.includes(lang);
        dom.classList.toggle('is-visual', visual); dom.classList.toggle('is-editing', !visual || editing);
        const known = LANGS.some(([v]) => v === lang);
        const select = `<select class="rich-code-lang" aria-label="Code language">${(known ? LANGS : [[lang, lang], ...LANGS]).map(([v, l]) => `<option value="${v}"${v === lang ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
        bar.innerHTML = visual ? `<span>${lang === 'chart' ? 'Chart' : 'Diagram'}</span><button type="button" class="btn btn-quiet">${editing ? 'Done' : 'Edit source'}</button>` : select;
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
      preview.addEventListener('dblclick', () => { editing = true; sync(node); });
      sync(node);
      return { dom, contentDOM: code, update(n) { if (n.type !== node.type) return false; node = n; sync(n); return true; }, stopEvent: (e) => bar.contains(e.target) || preview.contains(e.target), ignoreMutation: (m) => !code.contains(m.target) };
    };
  },
});

/* callouts and [[wiki links]] are drawn, the Markdown text stays as written */
const Decorate = Extension.create({
  name: 'folioDecorate',
  addOptions() { return { onWikiLink: null, resolveValue: null, linkKind: null, preview: null }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    const hover = { el: null, card: null, timer: 0, seq: 0, hide() { clearTimeout(this.timer); this.seq++; this.card?.remove(); this.card = null; this.el = null; } };
    const build = (doc) => {
      const deco = [];
      doc.descendants((n, pos) => {
        if (n.type.name === 'paragraph' && n.childCount === 1 && n.firstChild.isText) {
          const link = n.firstChild.marks.find((m) => m.type.name === 'link'); const href = link?.attrs.href || '';
          if (link && href && !/\.(md|markdown)(#.*)?$/i.test(href)) {
            const web = /^https?:/i.test(href);
            deco.push(Decoration.node(pos, pos + n.nodeSize, { class: web ? 'rich-bookmark' : 'rich-filecard', 'data-host': web ? href.replace(/^https?:\/\/(?:www\.)?([^/]+).*$/i, '$1') : href.split('/').pop() }));
          }
        }
        if (n.isText) {
          const bid = /\s\^[A-Za-z0-9-]+\s*$/.exec(n.text);
          if (bid && pos + n.nodeSize === doc.resolve(pos).end()) deco.push(Decoration.inline(pos + bid.index, pos + n.text.length, { class: 'rich-block-id', title: 'Block id: links like [[Note#^id]] point here' }));
          const re = /\[\[([^\]\n]+)\]\]/g; let m;
          while ((m = re.exec(n.text))) {
            const embed = n.text[m.index - 1] === '!';
            const target = m[1].replace(/\|.*$/, ''); const kind = embed ? null : opts.linkKind?.(target);
            deco.push(Decoration.inline(pos + m.index - (embed ? 1 : 0), pos + m.index + m[0].length, { class: embed ? 'rich-ref' : `rich-wikilink${kind && kind !== 'doc' ? ' is-' + kind : ''}`, 'data-target': target, title: embed ? 'Embedded in the Read view and on slides. Ctrl or ⌘ click to open' : kind === 'missing' ? 'No page with this name yet. Ctrl or ⌘ click to create it' : 'Ctrl or ⌘ click to open' }));
          }
          if (!n.marks.some((mk) => mk.type.name === 'code')) {
            TAG.lastIndex = 0; let t;
            while ((t = TAG.exec(n.text))) { const from = pos + t.index + t[1].length; deco.push(Decoration.inline(from, from + t[2].length + 1, { class: 'rich-tag', title: 'Tag' })); }
            FIELD.lastIndex = 0; let f;
            while ((f = FIELD.exec(n.text))) { const key = f[1].trim().toLowerCase(); deco.push(Decoration.inline(pos + f.index, pos + f.index + f[0].length, { class: key === 'status' ? `rich-field rich-status is-${statusClass(f[2])}` : 'rich-field', 'data-key': key, title: key === 'status' ? 'Status' : f[1] })); }
          }
          const rv = /\{\{([^}\n]+?)\}\}/g;
          while ((m = rv.exec(n.text))) {
            const raw = m[1].trim(); const end = pos + m.index + m[0].length;
            deco.push(Decoration.inline(pos + m.index, end, { class: 'rich-ref', 'data-target': raw.replace(/\|.*$/, ''), title: 'Live value. Ctrl or ⌘ click to open the source' }));
            if (opts.resolveValue) deco.push(Decoration.widget(end, () => { const sp = document.createElement('span'); sp.className = 'rich-ref-out'; sp.contentEditable = 'false'; sp.textContent = '…'; opts.resolveValue(raw).then((v) => { sp.textContent = '= ' + v; }, (e) => { sp.textContent = '= ?'; sp.title = e.message; sp.classList.add('is-broken'); }); return sp; }, { side: 1, key: 'ref:' + raw + ':' + end }));
          }
        }
      });
      return DecorationSet.create(doc, deco);
    };
    return [new Plugin({
      key: new PluginKey('folioDecorate'),
      state: { init: (_, s) => build(s.doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
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
        handleClick(view, pos, event) {
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
    bar.innerHTML = `<span>${label}</span><button type="button" class="btn btn-quiet">Edit source</button>`;
    const preview = document.createElement('div'); preview.className = 'rich-raw-preview prose';
    const area = document.createElement('textarea'); area.className = 'rich-raw-src'; area.spellcheck = false; area.setAttribute('aria-label', `${label}: source`); area.hidden = true;
    dom.append(bar, preview, area);
    const btn = bar.querySelector('button');
    let editing = false;
    const fit = () => { area.style.height = 'auto'; area.style.height = area.scrollHeight + 'px'; };
    const open = () => {
      if (editing) return; editing = true; dom.classList.add('raw-editing'); btn.textContent = 'Done';
      area.hidden = false; area.value = node.attrs[attr]; fit(); area.focus();
    };
    const close = () => {
      if (!editing) return; editing = false; dom.classList.remove('raw-editing'); btn.textContent = 'Edit source'; area.hidden = true;
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
      input.setAttribute('aria-label', title ? title('') : 'Source');
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
      attr: 'source', label: 'Kept as written',
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
    return sourceBlockView({ attr: 'latex', label: 'Maths', clean: (v) => v.replace(/^\n+|\s+$/g, ''), draw: (el, v) => { el.innerHTML = v ? katexHtml(v, true) : '<p class="rich-raw-plain">Empty formula</p>'; } });
  },
});
const InlineMathView = InlineMath.extend({
  addKeyboardShortcuts: openOnEnter('inlineMath'),
  addNodeView() { return sourceInlineView({ attr: 'latex', className: 'rich-math', draw: (el, v) => { el.innerHTML = katexHtml(v, false); }, title: () => 'Maths (double-click or Enter to edit)' }); },
});
const FootnoteInlineView = FootnoteInline.extend({
  addKeyboardShortcuts: openOnEnter('footnoteInline'),
  addNodeView() { return sourceInlineView({ attr: 'text', className: 'rich-fn is-inline', draw: (el) => { el.textContent = '*'; }, title: (v) => (v ? `Note: ${v}` : 'Note text') }); },
});
const footnoteText = (doc, label) => { let t = ''; doc.descendants((n) => { if (!t && n.type.name === 'footnoteDef' && n.attrs.label === label) t = n.textContent; return !t; }); return t; };
const FootnoteRefView = FootnoteRef.extend({
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('sup'); dom.className = 'rich-fn'; dom.contentEditable = 'false';
      const paint = () => { dom.textContent = node.attrs.label; };
      dom.addEventListener('mouseenter', () => { const t = footnoteText(editor.state.doc, node.attrs.label); dom.title = t ? `${t}\n\nCtrl or ⌘ click to go to the note` : 'No text for this footnote yet'; });
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
        const grip = document.createElement('span'); grip.className = 'rich-img-resize'; grip.setAttribute('aria-hidden', 'true'); grip.title = 'Drag to resize';
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
        const input = document.createElement('input'); input.className = 'rich-src-input rich-caption-input'; input.value = node.attrs.title || ''; input.placeholder = 'Caption'; input.setAttribute('aria-label', 'Caption');
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
      if (x.group !== group) { if (group !== null) html += '</div>'; group = x.group; html += `<div class="slash-group" role="group" aria-label="${group}"><div class="slash-head" aria-hidden="true">${group}</div>`; }
      const k = x.item.key ? `<kbd>${opts.keyLabel(x.item.key)}</kbd>` : '';
      html += `<div class="slash-item" role="option" id="slash-${i}" data-i="${i}" aria-selected="${i === sel}"><span class="slash-ic" aria-hidden="true">${iconOf(x.item)}</span><span class="slash-text"><span class="slash-label">${highlight(x.item.label, x.marks || [])}</span>${x.item.desc ? `<span class="slash-desc">${x.item.desc.replace(/</g, '&lt;')}</span>` : ''}</span>${k}</div>`;
    });
    if (group !== null) html += '</div>';
    list.innerHTML = html || (props?.loading ? '' : '<div class="slash-empty">No matches. Keep typing, or press Esc.</div>');
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
      el.innerHTML = '<div class="slash-list" role="listbox" id="slash-list" aria-label="${label}"></div><div class="slash-foot" aria-hidden="true">↑↓ to move · Enter to choose · Esc to close</div>';
      list = el.firstChild; document.body.append(el);
      view.dom.setAttribute('aria-controls', 'slash-list'); view.dom.setAttribute('aria-expanded', 'true');
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
      if (event.key === 'Enter' || event.key === 'Tab') { choose(sel); return true; }
      return false;
    },
    onExit() {
      el?.remove(); el = null;
      view?.dom.removeAttribute('aria-controls'); view?.dom.removeAttribute('aria-activedescendant'); view?.dom.setAttribute('aria-expanded', 'false');
    },
  };
}

/* [[ @ # : — inline pickers (page-mentions.js). They only ever write plain Markdown text, so the page stays portable. */
const MENTION_KEYS = { link: new PluginKey('mentionLink'), at: new PluginKey('mentionAt'), tag: new PluginKey('mentionTag'), emoji: new PluginKey('mentionEmoji') };
const MENTION_LABEL = { link: 'Link to a page', at: 'Mention a person, page or date', tag: 'Tags', emoji: 'Emoji' };
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
  ['p', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['bullet', 'Bulleted list'], ['ordered', 'Numbered list'], ['task', 'Checklist'], ['quote', 'Quote'], ['code', 'Code block'],
];
const STYLES = [
  ['p', 'Normal text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['h5', 'Heading 5'], ['h6', 'Heading 6'],
  ['quote', 'Quote'], ['code', 'Code block'],
];

function btn(id, label, icon, key) {
  return `<button type="button" class="rb" data-cmd="${id}" aria-label="${label}" data-tip="${label}${key ? ` (${key})` : ''}">${icon}</button>`;
}

export function createRich(host, { onChange, resolveImage, onPickImage, onLink, onWikiLink, resolveValue, readNote, isDark = () => false, keyLabel = (k) => k, smartTypography = () => true, pickRef = null, onCopyBlockLink = null, breadcrumb = () => '', createDoc = null, openMedia = null, pickMedia = null, askUrl = null, mentions = null, linkKind = null, preview = null }) {
  host.innerHTML = `
    <div class="ribbon" role="toolbar" aria-label="Formatting">
      <div class="rb-group">${btn('undo', 'Undo', icons.undo, keyLabel('Mod+Z'))}${btn('redo', 'Redo', icons.redo, keyLabel('Mod+Shift+Z'))}</div>
      <div class="rb-group"><label class="visually-hidden" for="rb-style">Paragraph style</label>
        <select class="rb-select" id="rb-style" data-tip="Paragraph style">${STYLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="rb-group">
        ${btn('bold', 'Bold', icons.bold, keyLabel('Mod+B'))}${btn('italic', 'Italic', icons.italic, keyLabel('Mod+I'))}
        ${btn('underline', 'Underline', icons.underline, keyLabel('Mod+U'))}${btn('strike', 'Strikethrough', icons.strike, keyLabel('Mod+Shift+S'))}
        ${btn('highlight', 'Highlight', icons.highlighter, keyLabel('Mod+Shift+H'))}${btn('code', 'Inline code', icons.codeInline, keyLabel('Mod+E'))}
        ${btn('link', 'Link', icons.link, keyLabel('Mod+K'))}${btn('clear', 'Clear formatting', icons.clear)}
      </div>
      <div class="rb-group">
        ${btn('superscript', 'Superscript', icons.superscript, keyLabel('Mod+Shift+.'))}${btn('subscript', 'Subscript', icons.subscript, keyLabel('Mod+Shift+,'))}
        ${btn('colour', 'Text colour', icons.palette)}${btn('inlineMath', 'Maths', icons.sigma, keyLabel('Mod+Shift+M'))}
        ${btn('footnote', 'Footnote', icons.footnote, keyLabel('Mod+Alt+F'))}${btn('hiddenComment', 'Hidden comment', icons.commentHidden)}
      </div>
      <div class="rb-group" role="group" aria-label="Alignment">
        ${btn('alignLeft', 'Align left', icons.alignLeft, keyLabel('Mod+Shift+L'))}${btn('alignCenter', 'Centre', icons.alignCenter, keyLabel('Mod+Alt+E'))}
        ${btn('alignRight', 'Align right', icons.alignRight, keyLabel('Mod+Shift+R'))}${btn('alignJustify', 'Justify', icons.alignJustify, keyLabel('Mod+Shift+J'))}
      </div>
      <div class="rb-group">
        ${btn('bullet', 'Bulleted list', icons.listBullet)}${btn('ordered', 'Numbered list', icons.listOrdered)}${btn('task', 'Checklist', icons.listTask, keyLabel('Mod+L'))}
        ${btn('outdent', 'Decrease indent', icons.outdent, 'Shift+Tab')}${btn('indent', 'Increase indent', icons.indent, 'Tab')}
      </div>
      <div class="rb-group">
        ${btn('table', 'Insert table', icons.table)}${btn('image', 'Insert image', icons.image)}${btn('hr', 'Divider', icons.divider)}${btn('codeblock', 'Code block', icons.codeBlock)}${btn('blockMath', 'Maths block', icons.sigma)}
      </div>
      <div class="rb-group rb-table" hidden>
        <span class="rb-label">Table</span>
        ${btn('rowBefore', 'Row above', icons.rowAbove)}${btn('rowAfter', 'Row below', icons.rowBelow)}
        ${btn('colBefore', 'Column left', icons.colLeft)}${btn('colAfter', 'Column right', icons.colRight)}
        ${btn('delRow', 'Delete row', icons.rowDelete)}${btn('delCol', 'Delete column', icons.colDelete)}${btn('delTable', 'Delete table', icons.trash)}
      </div>
    </div>
    <div class="rich-scroll"><div class="rich-page"></div></div>
    <div class="bubble" role="toolbar" aria-label="Selection">
      <label class="visually-hidden" for="rb-turn">Turn into</label>
      <select class="bubble-select" id="rb-turn" data-tip="Turn into">${TURN.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <span class="bubble-sep"></span>
      ${btn('bold', 'Bold', icons.bold)}${btn('italic', 'Italic', icons.italic)}${btn('underline', 'Underline', icons.underline)}${btn('strike', 'Strikethrough', icons.strike)}
      ${btn('highlight', 'Highlight', icons.highlighter)}${btn('code', 'Inline code', icons.codeInline)}${btn('linkInline', 'Link', icons.link)}
      <span class="bubble-sep"></span>
      ${btn('superscript', 'Superscript', icons.superscript)}${btn('subscript', 'Subscript', icons.subscript)}${btn('colour', 'Text colour', icons.palette)}${btn('inlineMath', 'Maths', icons.sigma)}${btn('hiddenComment', 'Hidden comment', icons.commentHidden)}
      <div class="bubble-link" hidden>
        <input type="url" placeholder="Paste or type a link, Enter to apply" aria-label="Link address" spellcheck="false">
        ${btn('linkRemove', 'Remove link', icons.clear)}
      </div>
    </div>
    <div class="rb-pop" id="rb-colours" role="dialog" aria-label="Text colour" hidden>
      <span class="rb-pop-title">Text</span>
      <div class="rb-swatches">${['', ...COLORS].map((c) => `<button type="button" class="rb-swatch" data-colour="${c}" aria-label="${c ? `${c[0].toUpperCase()}${c.slice(1)} text` : 'Default text'}"><span ${c ? `data-color="${c}"` : ''}>A</span></button>`).join('')}</div>
      <span class="rb-pop-title">Background</span>
      <div class="rb-swatches">${['', ...COLORS].map((c) => `<button type="button" class="rb-swatch" data-bgc="${c}" aria-label="${c ? `${c[0].toUpperCase()}${c.slice(1)} background` : 'No background'}"><span class="sw" ${c ? `data-bg="${c}"` : ''}></span></button>`).join('')}</div>
    </div>`;

  let model = null; // what was loaded, so saving rewrites only the blocks that changed
  let silent = false;
  const page = host.querySelector('.rich-page');
  const bubble = host.querySelector('.bubble');

  const insertCtx = () => ({ pickImage: onPickImage, pickRef, createDoc, pickMedia, askUrl, footnote: (e) => pageCmd.footnote(e) });
  const editor = new Editor({
    element: page,
    extensions: [
      ...pageExtensions({
        codeBlock: FolioCodeBlock.configure({ readNote, isDark, HTMLAttributes: { spellcheck: 'false' } }),
        image: FolioImage.configure({ resolve: resolveImage, inline: false, allowBase64: true, openFile: (src) => openMedia?.(src), openUrl: (u) => openMedia?.(u) }),
        raw: RawBlock,
        views: [InlineMathView, BlockMathView, FootnoteRefView, FootnoteInlineView, FootnoteDefView, NoAlignKeys, TocView, BreadcrumbView.configure({ html: breadcrumb }), PageBreakView],
      }),
      SmartTypography.configure({ enabled: smartTypography }),
      SlashMenu.configure({ keyLabel, ctx: insertCtx }),
      Mentions.configure({ ctx: () => (mentions ? mentions() : null), keyLabel }),
      CodeHighlight,
      CalloutUI.configure({ icons }),
      HeadingFold.configure({ icons }),
      BlockHandles.configure({ keyLabel, onCopyLink: (id) => onCopyBlockLink?.(id), icons: { plus: icons.plus, grip: icons.grip, quote: icons.quote, listBullet: icons.listBullet, listOrdered: icons.listOrdered, listTask: icons.listTask, codeBlock: icons.codeBlock } }),
      MarkdownLinkInput,
      Decorate.configure({ onWikiLink, resolveValue, linkKind, preview }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Write, or select text to format it') }),
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

  const run = (id) => {
    const c = editor.chain().focus();
    switch (id) {
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

  host.addEventListener('mousedown', (e) => { if (e.target.closest('.rb')) e.preventDefault(); });
  host.addEventListener('click', (e) => { const b = e.target.closest('.rb'); if (b) run(b.dataset.cmd); });
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
    const anchor = (bubble.style.visibility === 'visible' || bubble.matches('[data-show]')) && bubble.contains(document.activeElement) ? bubble.querySelector('[data-cmd="colour"]') : host.querySelector('.ribbon [data-cmd="colour"]');
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
    for (const b of host.querySelectorAll('.rb[data-cmd]')) {
      const n = ACTIVE[b.dataset.cmd];
      if (n) b.setAttribute('aria-pressed', String(editor.isActive(n)));
      if (b.dataset.cmd in ALIGN_BTN) {
        const cur = editor.getAttributes('paragraph').textAlign ?? editor.getAttributes('heading').textAlign ?? null;
        b.setAttribute('aria-pressed', String((cur === 'left' ? null : cur) === ALIGN_BTN[b.dataset.cmd]));
      }
    }
    host.querySelector('[data-cmd="undo"]').disabled = !editor.can().undo();
    host.querySelector('[data-cmd="redo"]').disabled = !editor.can().redo();
    let v = 'p';
    for (let l = 1; l <= 6; l++) if (editor.isActive('heading', { level: l })) v = 'h' + l;
    if (editor.isActive('blockquote')) v = 'quote';
    if (editor.isActive('codeBlock')) v = 'code';
    styleSel.value = v;
    turnSel.value = editor.isActive('taskList') ? 'task' : editor.isActive('bulletList') ? 'bullet' : editor.isActive('orderedList') ? 'ordered' : (['p', 'h1', 'h2', 'h3', 'quote', 'code'].includes(v) ? v : 'p');
    host.querySelector('.rb-table').hidden = !editor.isActive('table');
  }

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
    words() {
      let text = editor.state.doc.textContent;
      editor.state.doc.descendants((n) => { if (n.type.name === 'folioRaw') text += ' ' + n.attrs.source.replace(/<[^>]+>|[#*_`>|[\]()$-]/g, ' '); });
      return (text.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
    },
    destroy() { editor.destroy(); },
  };
  return api;
}
