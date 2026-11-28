// Folio — page structure in the Write view: callouts (type menu, fold), collapsible headings, live table of contents,
// breadcrumb and page break. Folding headings and opening folded callouts are view state; the file is not changed.
import { t as tr, tl } from './i18n.js';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { parseCallout, calloutMarker, CALLOUT_TYPES } from './callouts.js';
import { Toc, Breadcrumb, PageBreak } from './page-syntax.js';
import { openEmojiPicker } from './page-icon.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* where the first line of a textblock ends (a soft line break in a text node, or a hard break), relative to its content */
function firstLineEnd(block) {
  let at = -1, off = 0;
  block.forEach((n) => {
    if (at >= 0) return;
    if (n.isText) { const i = n.text.indexOf('\n'); if (i >= 0) at = off + i; }
    else if (n.type.name === 'hardBreak' || n.type.name === 'softBreak') at = off;
    off += n.nodeSize;
  });
  return at;
}

/* ---- callouts: drawn from blockquotes; fold (view state) and a menu to change the type ---- */
const CALLOUTS = new PluginKey('calloutUI');
export const CalloutUI = Extension.create({
  name: 'calloutUI',
  addOptions() { return { icons: {} }; },
  addProseMirrorPlugins() {
    const opts = this.options; const editor = this.editor;
    const build = (doc, toggled) => {
      const deco = [];
      doc.descendants((n, pos) => {
        if (n.type.name !== 'blockquote') return;
        const first = n.firstChild; if (!first?.isTextblock) return;
        const c = parseCallout(first.textContent.split('\n')[0]); if (!c) return;
        const folded = c.fold === '-' ? !toggled.has(pos) : c.fold === '+' ? toggled.has(pos) : false;
        deco.push(Decoration.node(pos, pos + n.nodeSize, { class: `rich-callout callout-${c.type} callout-c-${c.color}${folded ? ' is-folded' : ''}`, 'data-fold': c.fold || '' }));
        const start = pos + 2;
        /* Notion: only the icon, beside the text. The type's name is not written on the page (it stays in the
           marker, for screen readers and the menu); a title the author wrote is shown. */
        deco.push(Decoration.inline(start, start + c.markerLength, { class: 'rich-callout-marker', 'data-label': '', 'data-pos': String(pos), 'aria-label': `${c.label} callout` }));
        deco.push(Decoration.widget(start, () => {
          const s = document.createElement('span'); s.className = 'rich-callout-icon'; s.contentEditable = 'false';
          s.dataset.pos = String(pos); s.setAttribute('role', 'button'); s.setAttribute('aria-keyshortcuts', 'Alt+Enter'); s.setAttribute('aria-label', `${c.label}. ${tr('pui.change-the-callout-type')}`); s.title = `${c.label} · ${tr('pui.change-the-callout-type')}`;
          s.innerHTML = c.emoji ? `<span class="rich-callout-emoji">${esc(c.emoji)}</span>` : (opts.icons[CALLOUT_TYPES[c.type].icon] || '');
          return s;
        }, { side: -1, key: `ci:${pos}:${c.type}:${c.emoji}` }));
        const lineEnd = firstLineEnd(first);
        if (c.title) deco.push(Decoration.inline(start + c.markerLength, lineEnd >= 0 ? start + lineEnd : start + first.content.size, { class: 'rich-callout-title' }));
        /* no title: the line break after the marker is not drawn, so the text starts beside the icon */
        else if (lineEnd >= 0 && !folded && first.textBetween(c.markerLength, lineEnd, '', '').trim() === '') deco.push(Decoration.inline(start + lineEnd, start + lineEnd + 1, { class: 'rich-callout-joint' }));
        if (c.fold) {
          deco.push(Decoration.widget(start, () => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'rich-callout-fold'; b.contentEditable = 'false';
            b.dataset.pos = String(pos); b.setAttribute('aria-expanded', String(!folded)); b.setAttribute('aria-label', folded ? tl('pui', 'Show the callout') : tl('pui', 'Fold the callout'));
            b.innerHTML = opts.icons.chevron || '›';
            return b;
          }, { side: -2, key: `cf:${pos}:${folded}` }));
        }
        if (folded) {
          if (lineEnd >= 0) deco.push(Decoration.inline(start + lineEnd, start + first.content.size, { class: 'rich-fold-hidden' }));
          let p = pos + 1 + first.nodeSize;
          for (let i = 1; i < n.childCount; i++) { const ch = n.child(i); deco.push(Decoration.node(p, p + ch.nodeSize, { class: 'rich-fold-hidden' })); p += ch.nodeSize; }
        }
      });
      return DecorationSet.create(doc, deco);
    };
    let menu = null;
    const closeMenu = () => { menu?.remove(); menu = null; };
    const openMenu = (view, pos, anchor) => {
      closeMenu();
      const node = view.state.doc.nodeAt(pos); const first = node?.firstChild; if (!first) return;
      const c = parseCallout(first.textContent.split('\n')[0]); if (!c) return;
      menu = document.createElement('div'); menu.className = 'block-menu callout-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', tl('pui', 'Callout'));
      const types = Object.entries(CALLOUT_TYPES).map(([k, t]) => `<button type="button" role="menuitemradio" aria-checked="${k === c.type}" class="block-mi block-turn callout-c-${t.color}" data-kind="${k}"><span class="block-mi-ic callout-ic" aria-hidden="true">${opts.icons[t.icon] || ''}</span>${t.label}</button>`).join('');
      const folds = [['', tl('pui', 'Not foldable')], ['+', tl('pui', 'Foldable, open')], ['-', 'Folded']].map(([f, l]) => `<button type="button" role="menuitemradio" aria-checked="${c.fold === f}" class="block-mi" data-fold="${f}"><span>${l}</span></button>`).join('');
      const PAL = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
      const swatches = `<div class="callout-swatches" role="group" aria-label="${tr('icon.colour')}"><button type="button" class="callout-sw is-default" data-color="" aria-pressed="${!c.metaColor}" aria-label="${tr('icon.colour-default')}"></button>${PAL.map((k) => `<button type="button" class="callout-sw callout-c-${k}" data-color="${k}" aria-pressed="${c.metaColor === k}" aria-label="${k}"></button>`).join('')}</div>`;
      const emo = `<button type="button" class="block-mi" data-emoji="pick"><span class="block-mi-ic" aria-hidden="true">${c.emoji ? esc(c.emoji) : (opts.icons.smile || '')}</span><span>${tr('icon.emoji')}</span></button>${c.emoji ? `<button type="button" class="block-mi" data-emoji="none"><span class="block-mi-ic" aria-hidden="true"></span><span>${tr('icon.use-type-icon')}</span></button>` : ''}`;
      menu.innerHTML = `<div class="block-mh">${tr('pui.type')}</div><div class="block-turns" role="group" aria-label="${tr('pui.type')}">${types}</div><div class="block-sep" role="separator"></div>${emo}<div class="block-mh">${tr('icon.colour')}</div>${swatches}<div class="block-sep" role="separator"></div><div class="block-mh">${tr('pui.fold')}</div>${folds}`;
      document.body.append(menu);
      const r = anchor.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${r.bottom + 6 + menu.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - menu.offsetHeight - 6) : r.bottom + 6}px`;
      menu.querySelector('[aria-checked="true"]')?.focus();
      const apply = (patch) => {
        const cur = view.state.doc.nodeAt(pos); const f = cur?.firstChild; if (!f) return closeMenu();
        const now = parseCallout(f.textContent.split('\n')[0]); if (!now) return closeMenu();
        const rawKind = /^\[!([A-Za-z][\w-]*)/.exec(f.textContent)?.[1] || now.kind; // a colour or emoji edit keeps the type as written ([!TIP] stays [!TIP])
        const marker = calloutMarker({ kind: patch.kind ?? rawKind, emoji: patch.emoji !== undefined ? patch.emoji : now.emoji, color: patch.color !== undefined ? patch.color : now.metaColor, fold: patch.fold ?? now.fold });
        const tail = /[ \t]+$/.exec(f.textContent.slice(0, now.markerLength))?.[0] || '';
        view.dispatch(view.state.tr.insertText(marker + tail, pos + 2, pos + 2 + now.markerLength));
        closeMenu(); view.focus();
      };
      menu.addEventListener('mousedown', (e) => e.preventDefault());
      menu.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.kind) return apply({ kind: b.dataset.kind });
        if (b.dataset.color != null) return apply({ color: b.dataset.color || null });
        if (b.dataset.emoji === 'none') return apply({ emoji: null });
        if (b.dataset.emoji === 'pick') { const at = anchor; closeMenu(); openEmojiPicker(at, { onPick: (em) => apply({ emoji: em }) }); return; }
        apply({ fold: b.dataset.fold });
      });
      menu.addEventListener('keydown', (e) => {
        const all = [...menu.querySelectorAll('button')]; const i = all.indexOf(document.activeElement);
        if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); view.focus(); }
        const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (step) { e.preventDefault(); all[(i + step + all.length) % all.length].focus(); }
      });
      setTimeout(() => document.addEventListener('mousedown', function off(e) { if (menu && !menu.contains(e.target)) { closeMenu(); } document.removeEventListener('mousedown', off); }), 0);
    };
    return [new Plugin({
      key: CALLOUTS,
      state: {
        init: (_, st) => ({ toggled: new Set(), deco: build(st.doc, new Set()) }),
        apply(tr, prev) {
          let toggled = prev.toggled;
          if (tr.docChanged) toggled = new Set([...toggled].map((p) => tr.mapping.map(p)));
          const t = tr.getMeta(CALLOUTS);
          if (t != null) { toggled = new Set(toggled); toggled.has(t) ? toggled.delete(t) : toggled.add(t); }
          return tr.docChanged || t != null ? { toggled, deco: build(tr.doc, toggled) } : prev;
        },
      },
      props: {
        decorations: (st) => CALLOUTS.getState(st).deco,
        handleDOMEvents: {
          mousedown(view, e) {
            const fold = e.target.closest?.('.rich-callout-fold');
            if (fold) { e.preventDefault(); view.dispatch(view.state.tr.setMeta(CALLOUTS, +fold.dataset.pos)); return true; }
            const marker = e.target.closest?.('.rich-callout-icon, .rich-callout-marker');
            if (marker && editor.isEditable) { e.preventDefault(); openMenu(view, +marker.dataset.pos, marker); return true; }
            return false;
          },
        },
        /* from the keyboard: Alt+Enter with the caret in a callout opens the same menu as its icon */
        handleKeyDown(view, e) {
          if (e.key !== 'Enter' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !editor.isEditable) return false;
          const $f = view.state.selection.$from;
          for (let d = $f.depth; d > 0; d--) {
            if ($f.node(d).type.name !== 'blockquote') continue;
            const pos = $f.before(d); const icon = view.dom.querySelector(`.rich-callout-icon[data-pos="${pos}"]`); if (!icon) return false;
            e.preventDefault(); openMenu(view, pos, icon); return true;
          }
          return false;
        },
      },
      view: () => ({ destroy: closeMenu }),
    })];
  },
});

/* ---- collapsible headings (Word, Notion): a chevron before each heading folds its section; view state only ---- */
export const HFOLD = new PluginKey('headingFold');
export const HeadingFold = Extension.create({
  name: 'headingFold',
  addOptions() { return { icons: {} }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    const build = (doc, folded) => {
      const deco = []; let hideUntil = 0, ordinal = 0;
      doc.forEach((n, pos) => {
        if (n.type.name === 'heading') {
          const nth = ordinal++;
          if (hideUntil && n.attrs.level <= hideUntil) hideUntil = 0;
          if (!hideUntil) {
            const isFolded = folded.has(pos);
            deco.push(Decoration.widget(pos + 1, () => {
              const b = document.createElement('button'); b.type = 'button'; b.className = 'rich-hfold'; b.contentEditable = 'false';
              b.setAttribute('aria-expanded', String(!isFolded)); b.setAttribute('aria-label', isFolded ? tl('pui', 'Show this section') : tl('pui', 'Fold this section'));
              b.innerHTML = opts.icons.chevron || '›'; return b;
            }, { side: -1, key: `hf:${nth}:${isFolded}` })); // keyed by order, not position: typing above does not rebuild every chevron
            if (isFolded) { deco.push(Decoration.node(pos, pos + n.nodeSize, { class: 'is-section-folded' })); hideUntil = n.attrs.level; return; }
          }
        }
        if (hideUntil) deco.push(Decoration.node(pos, pos + n.nodeSize, { class: 'rich-fold-hidden' }));
      });
      return DecorationSet.create(doc, deco);
    };
    /* which top-level blocks are headings: while it is unchanged and nothing is folded, the decorations only need moving */
    const sig = (doc) => { let o = ''; doc.forEach((n, _p, i) => { if (n.type.name === 'heading') o += i + ','; }); return o; };
    return [new Plugin({
      key: HFOLD,
      state: {
        init: (_, st) => ({ folded: new Set(), deco: build(st.doc, new Set()), sig: sig(st.doc) }),
        apply(tr, prev) {
          let folded = prev.folded;
          if (tr.docChanged) folded = new Set([...folded].map((p) => tr.mapping.map(p)).filter((p) => tr.doc.nodeAt(p)?.type.name === 'heading'));
          const t = tr.getMeta(HFOLD);
          if (t === 'all') { folded = new Set(); tr.doc.forEach((n, pos) => { if (n.type.name === 'heading') folded.add(pos); }); }
          else if (t === 'none') folded = new Set();
          else if (t != null) { folded = new Set(folded); folded.has(t) ? folded.delete(t) : folded.add(t); }
          if (t == null && tr.docChanged && !folded.size && !prev.folded.size) { const g = sig(tr.doc); if (g === prev.sig) return { folded, deco: prev.deco.map(tr.mapping, tr.doc), sig: g }; return { folded, deco: build(tr.doc, folded), sig: g }; }
          return tr.docChanged || t != null ? { folded, deco: build(tr.doc, folded), sig: sig(tr.doc) } : prev;
        },
      },
      props: {
        decorations: (st) => HFOLD.getState(st).deco,
        handleDOMEvents: {
          mousedown(view, e) { const b = e.target.closest?.('.rich-hfold'); if (!b) return false; e.preventDefault(); view.dispatch(view.state.tr.setMeta(HFOLD, view.posAtDOM(b.parentNode, 0) - 1)); return true; },
        },
      },
    })];
  },
});

/* ---- [TOC]: the headings of this page, live; [BREADCRUMB]; page break ---- */
export const TocView = Toc.extend({
  addNodeView() {
    return ({ editor, getPos }) => {
      const dom = document.createElement('nav'); dom.className = 'rich-toc md-toc'; dom.contentEditable = 'false'; dom.setAttribute('aria-label', tl('pui', 'Contents'));
      const paint = () => {
        const heads = []; editor.state.doc.descendants((n, pos) => { if (n.type.name === 'heading') heads.push({ level: n.attrs.level, text: n.textContent.replace(/\s\^[\w-]+$/, '').replace(/\s+\{align=\w+\}$/, ''), pos }); });
        const top = Math.min(6, ...heads.map((h) => h.level));
        dom.innerHTML = `<p class="md-toc-title">${tr('pui.contents')}</p>${heads.length ? `<ul>${heads.map((h) => `<li class="md-toc-l${h.level - top}"><a href="#" data-pos="${h.pos}">${esc(h.text || 'Untitled')}</a></li>`).join('')}</ul>` : '<p class="md-toc-empty">' + tr('pui.add-headings-to-see-them-here') + '</p>'}`;
      };
      dom.addEventListener('mousedown', (e) => {
        const a = e.target.closest('a[data-pos]'); if (!a) return;
        e.preventDefault(); const pos = +a.dataset.pos;
        editor.chain().focus().setTextSelection(pos + 1).run();
        editor.view.nodeDOM(pos)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      });
      editor.on('update', paint); paint();
      return { dom, ignoreMutation: () => true, stopEvent: (e) => e.type === 'mousedown' && !!e.target.closest?.('a'), destroy: () => editor.off('update', paint), update: (n) => n.type.name === 'toc' };
    };
  },
});
export const BreadcrumbView = Breadcrumb.extend({
  addOptions() { return { html: () => '' }; },
  addNodeView() {
    return () => { const dom = document.createElement('nav'); dom.className = 'rich-breadcrumb md-breadcrumb'; dom.contentEditable = 'false'; dom.setAttribute('aria-label', tl('pui', 'Breadcrumb')); dom.innerHTML = this.options.html(); return { dom, ignoreMutation: () => true }; };
  },
});
export const PageBreakView = PageBreak.extend({
  addNodeView() {
    return () => { const dom = document.createElement('div'); dom.className = 'rich-page-break'; dom.contentEditable = 'false'; dom.innerHTML = '<span>' + tr('pui.page-break') + '</span>'; return { dom }; };
  },
});
