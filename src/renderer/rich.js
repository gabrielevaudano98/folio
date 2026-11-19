// Folio — "mini Word" rich editor for Markdown. TipTap 3 (ProseMirror) with Markdown in and out.
import { Editor, Extension } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import { icons } from './icons.js';
import CodeBlock from '@tiptap/extension-code-block';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { renderMermaid, hydrateCharts, render } from './markdown.js';
import { pageExtensions, FolioRaw } from './page-schema.js';
import { createPageCodec } from './page-core.js';

/* code blocks: mermaid and chart blocks show the drawing, the source opens on demand */
const VISUAL = ['mermaid', 'chart'];
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
        bar.innerHTML = visual ? `<span>${lang === 'chart' ? 'Chart' : 'Diagram'}</span><button type="button" class="btn btn-quiet">${editing ? 'Done' : 'Edit source'}</button>` : (lang ? `<span>${lang}</span>` : '');
        if (visual) draw(n.textContent); else preview.innerHTML = '';
      };
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
const KINDS = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };
const Decorate = Extension.create({
  name: 'folioDecorate',
  addOptions() { return { onWikiLink: null, resolveValue: null }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    const build = (doc) => {
      const deco = [];
      doc.descendants((n, pos) => {
        if (n.type.name === 'blockquote') {
          const first = n.firstChild;
          const m = first?.textContent.match(/^\[!(note|tip|important|warning|caution)\]/i);
          if (m) {
            deco.push(Decoration.node(pos, pos + n.nodeSize, { class: `rich-callout callout-${m[1].toLowerCase()}` }));
            deco.push(Decoration.inline(pos + 2, pos + 2 + m[0].length, { class: 'rich-callout-marker', 'data-label': KINDS[m[1].toLowerCase()] }));
          }
        }
        if (n.isText) {
          const re = /\[\[([^\]\n]+)\]\]/g; let m;
          while ((m = re.exec(n.text))) {
            const embed = n.text[m.index - 1] === '!';
            deco.push(Decoration.inline(pos + m.index - (embed ? 1 : 0), pos + m.index + m[0].length, { class: embed ? 'rich-ref' : 'rich-wikilink', 'data-target': m[1], title: embed ? 'Embedded in the Read view and on slides. Ctrl or ⌘ click to open' : 'Ctrl or ⌘ click to open' }));
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
        handleClick(view, pos, event) {
          const el = event.target.closest?.('.rich-wikilink, .rich-ref');
          if (el && (event.metaKey || event.ctrlKey)) { opts.onWikiLink?.(el.dataset.target); return true; }
          return false;
        },
      },
    })];
  },
});

/* Markdown the editor cannot hold without loss: drawn, edited as source, written back exactly as typed */
const RawBlock = FolioRaw.extend({
  addKeyboardShortcuts() {
    return { Enter: () => { const s = this.editor.state.selection; if (!(s instanceof NodeSelection) || s.node.type.name !== this.name) return false; this.editor.view.nodeDOM(s.from)?.folioOpen?.(); return true; } };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div'); dom.className = 'rich-raw'; dom.contentEditable = 'false';
      const bar = document.createElement('div'); bar.className = 'rich-raw-bar';
      bar.innerHTML = '<span>Kept as written</span><button type="button" class="btn btn-quiet">Edit source</button>';
      const preview = document.createElement('div'); preview.className = 'rich-raw-preview prose';
      const area = document.createElement('textarea'); area.className = 'rich-raw-src'; area.spellcheck = false; area.setAttribute('aria-label', 'Markdown source'); area.hidden = true;
      dom.append(bar, preview, area);
      const btn = bar.querySelector('button');
      let editing = false;
      const draw = () => {
        preview.innerHTML = render(node.attrs.source);
        if (!preview.textContent.trim() && !preview.querySelector('img, svg, table, hr, math')) { preview.innerHTML = '<pre class="rich-raw-plain"></pre>'; preview.firstChild.textContent = node.attrs.source; }
      };
      const fit = () => { area.style.height = 'auto'; area.style.height = area.scrollHeight + 'px'; };
      const open = () => {
        if (editing) return; editing = true; dom.classList.add('raw-editing'); btn.textContent = 'Done';
        area.hidden = false; area.value = node.attrs.source; fit(); area.focus();
      };
      const close = () => {
        if (!editing) return; editing = false; dom.classList.remove('raw-editing'); btn.textContent = 'Edit source'; area.hidden = true;
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (area.value !== node.attrs.source && pos != null) {
          if (area.value.trim()) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { source: area.value.replace(/^\n+|\s+$/g, '') }));
          else editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
        } else draw();
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
      draw();
      return {
        dom,
        update(n) { if (n.type !== node.type) return false; node = n; if (!editing) draw(); return true; },
        selectNode() { dom.classList.add('raw-selected'); },
        deselectNode() { dom.classList.remove('raw-selected'); },
        stopEvent: (e) => area.contains(e.target) || bar.contains(e.target),
        ignoreMutation: () => true,
      };
    };
  },
});

/* images keep their relative src in Markdown, the view resolves it to a file URL */
const FolioImage = Image.extend({
  addOptions() { return { ...this.parent?.(), resolve: null }; },
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img');
      img.alt = node.attrs.alt || ''; img.title = node.attrs.title || ''; img.decoding = 'async';
      const src = node.attrs.src || '';
      if (/^(https?:|data:|file:|blob:)/.test(src)) img.src = src;
      else Promise.resolve(this.options.resolve?.(src)).then((u) => { if (u) img.src = u; });
      return { dom: img };
    };
  },
});

/* Word-style shortcuts that ProseMirror does not ship */
const WordKeys = Extension.create({
  name: 'wordKeys',
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-0': () => this.editor.commands.setParagraph(),
      'Mod-Alt-1': () => this.editor.commands.toggleHeading({ level: 1 }),
      'Mod-Alt-2': () => this.editor.commands.toggleHeading({ level: 2 }),
      'Mod-Alt-3': () => this.editor.commands.toggleHeading({ level: 3 }),
      'Mod-Shift-h': () => this.editor.commands.toggleHighlight(),
      'Mod-l': () => this.editor.commands.toggleTaskList(),
      'Mod-e': () => this.editor.commands.toggleCode(),
    };
  },
});

const STYLES = [
  ['p', 'Normal text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'],
  ['quote', 'Quote'], ['code', 'Code block'],
];

function btn(id, label, icon, key) {
  return `<button type="button" class="rb" data-cmd="${id}" aria-label="${label}" data-tip="${label}${key ? ` (${key})` : ''}">${icon}</button>`;
}

export function createRich(host, { onChange, resolveImage, onPickImage, onLink, onWikiLink, resolveValue, readNote, isDark = () => false, keyLabel = (k) => k }) {
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
        ${btn('bullet', 'Bulleted list', icons.listBullet)}${btn('ordered', 'Numbered list', icons.listOrdered)}${btn('task', 'Checklist', icons.listTask, keyLabel('Mod+L'))}
        ${btn('outdent', 'Decrease indent', icons.outdent, 'Shift+Tab')}${btn('indent', 'Increase indent', icons.indent, 'Tab')}
      </div>
      <div class="rb-group">
        ${btn('table', 'Insert table', icons.table)}${btn('image', 'Insert image', icons.image)}${btn('hr', 'Divider', icons.divider)}${btn('codeblock', 'Code block', icons.codeBlock)}
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
      ${btn('bold', 'Bold', icons.bold)}${btn('italic', 'Italic', icons.italic)}${btn('strike', 'Strikethrough', icons.strike)}
      ${btn('highlight', 'Highlight', icons.highlighter)}${btn('code', 'Inline code', icons.codeInline)}${btn('link', 'Link', icons.link)}
      <span class="bubble-sep"></span>
      <button type="button" class="rb rb-text" data-cmd="h2" aria-label="Heading">H</button>
      ${btn('bullet', 'Bulleted list', icons.listBullet)}${btn('quote', 'Quote', icons.quote)}
    </div>`;

  let model = null; // what was loaded, so saving rewrites only the blocks that changed
  let silent = false;
  const page = host.querySelector('.rich-page');
  const bubble = host.querySelector('.bubble');

  const editor = new Editor({
    element: page,
    extensions: [
      ...pageExtensions({
        codeBlock: FolioCodeBlock.configure({ readNote, isDark, HTMLAttributes: { spellcheck: 'false' } }),
        image: FolioImage.configure({ resolve: resolveImage, inline: false, allowBase64: true }),
        raw: RawBlock,
      }),
      Decorate.configure({ onWikiLink, resolveValue }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Write, or select text to format it') }),
      BubbleMenu.configure({ element: bubble, shouldShow: ({ editor: e, state }) => !state.selection.empty && !e.isActive('codeBlock') && !e.isActive('image') && !e.isActive('folioRaw') }),
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

  const ACTIVE = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike', highlight: 'highlight', code: 'code', link: 'link', bullet: 'bulletList', ordered: 'orderedList', task: 'taskList', quote: 'blockquote', codeblock: 'codeBlock' };
  function syncToolbar() {
    for (const b of host.querySelectorAll('.rb[data-cmd]')) {
      const n = ACTIVE[b.dataset.cmd];
      if (n) b.setAttribute('aria-pressed', String(editor.isActive(n)));
      if (b.dataset.cmd === 'h2') b.setAttribute('aria-pressed', String(editor.isActive('heading', { level: 2 })));
    }
    host.querySelector('[data-cmd="undo"]').disabled = !editor.can().undo();
    host.querySelector('[data-cmd="redo"]').disabled = !editor.can().redo();
    let v = 'p';
    for (let l = 1; l <= 4; l++) if (editor.isActive('heading', { level: l })) v = 'h' + l;
    if (editor.isActive('blockquote')) v = 'quote';
    if (editor.isActive('codeBlock')) v = 'code';
    styleSel.value = v;
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
