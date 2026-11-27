// Folio — blocks you can grab, as in Notion: a ⋮⋮ handle to drag a block or open its menu, a + to insert below,
// and the keyboard commands that go with them (duplicate, move, turn into, copy link, select block, delete).
// A "block" is the list item under the pointer or cursor, otherwise the top-level block.
import { t as tr, tl } from './i18n.js';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { INSERTS, remember, turnIdOfNode } from './inserts.js';

const ITEM = new Set(['listItem', 'taskItem']);

/* the block that contains $pos */
export function blockAt($pos) {
  for (let d = $pos.depth; d > 0; d--) if (ITEM.has($pos.node(d).type.name)) return { pos: $pos.before(d), node: $pos.node(d), depth: d };
  if ($pos.depth >= 1) return { pos: $pos.before(1), node: $pos.node(1), depth: 1 };
  const node = $pos.nodeAfter; return node ? { pos: $pos.pos, node, depth: 1 } : null;
}
export function currentBlock(state) {
  const sel = state.selection;
  if (sel instanceof NodeSelection) return { pos: sel.from, node: sel.node, depth: sel.$from.depth + 1 };
  return blockAt(sel.$from);
}

/*
 * Several blocks selected at once (Notion: Esc, then Shift+↑/↓): siblings a..h in the container whose content starts
 * at `start`. The editor selection spans their text, so copy works; Duplicate, Move and Delete act on all of them.
 */
export const RANGE = new PluginKey('blockRange');
export function blockRange(state) {
  const r = RANGE.getState(state); if (!r) return null;
  const parent = state.doc.resolve(r.start).parent; const lo = Math.min(r.a, r.h), hi = Math.max(r.a, r.h);
  if (hi >= parent.childCount) return null;
  let from = r.start, to = r.start;
  parent.forEach((n, off, i) => { if (i === lo) from = r.start + off; if (i === hi) to = r.start + off + n.nodeSize; });
  return { ...r, lo, hi, from, to, n: hi - lo + 1, parent };
}
const setRange = (tr, r) => {
  tr.setMeta(RANGE, r);
  if (!r) return tr;
  const parent = tr.doc.resolve(r.start).parent; const lo = Math.min(r.a, r.h), hi = Math.max(r.a, r.h);
  let from = r.start, to = r.start; parent.forEach((n, off, i) => { if (i === lo) from = r.start + off; if (i === hi) to = r.start + off + n.nodeSize; });
  return tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to), -1));
};

export const blockCmd = {
  /* Shift+↓ / Shift+↑ from a selected block (or an existing range): grow or shrink the range */
  extend(editor, dir) {
    const { state } = editor; let r = RANGE.getState(state);
    if (!r) {
      const sel = state.selection; if (!(sel instanceof NodeSelection) || sel.node.isInline) return false;
      const $s = state.doc.resolve(sel.from); r = { start: $s.start(), a: $s.index(), h: $s.index() };
    }
    const parent = state.doc.resolve(r.start).parent;
    const h = Math.max(0, Math.min(parent.childCount - 1, r.h + dir));
    editor.view.dispatch(setRange(state.tr, { ...r, h }).scrollIntoView()); return true;
  },
  clearRange(editor) { if (!RANGE.getState(editor.state)) return false; editor.view.dispatch(editor.state.tr.setMeta(RANGE, null)); return true; },
  select(editor, b = currentBlock(editor.state)) {
    if (!b) return false;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, b.pos)));
    return true;
  },
  duplicate(editor, b = currentBlock(editor.state)) {
    const R = blockRange(editor.state);
    if (R) { // the copies go right under the selection, and become the selection (Notion)
      const slice = editor.state.doc.slice(R.from, R.to); const tr = editor.state.tr.insert(R.to, slice.content);
      editor.view.dispatch(setRange(tr, { start: R.start, a: R.hi + 1, h: R.hi + R.n }).scrollIntoView()); return true;
    }
    if (!b) return false;
    const end = b.pos + b.node.nodeSize;
    const tr = editor.state.tr.insert(end, b.node.copy(b.node.content));
    tr.setSelection(NodeSelection.create(tr.doc, end)).scrollIntoView();
    editor.view.dispatch(tr); editor.view.focus(); return true;
  },
  move(editor, dir, b = currentBlock(editor.state)) {
    const R = blockRange(editor.state);
    if (R) {
      const sib = dir < 0 ? R.lo - 1 : R.hi + 1; if (sib < 0 || sib >= R.parent.childCount) return true;
      const node = R.parent.child(sib); const content = editor.state.doc.slice(R.from, R.to).content;
      const tr = editor.state.tr.delete(R.from, R.to);
      const at = dir < 0 ? R.from - node.nodeSize : R.from + node.nodeSize;
      tr.insert(at, content);
      editor.view.dispatch(setRange(tr, { start: R.start, a: R.a + dir, h: R.h + dir }).scrollIntoView()); return true;
    }
    if (!b) return false;
    const { state } = editor; const $b = state.doc.resolve(b.pos);
    const parent = $b.parent, index = $b.index();
    const to = index + dir;
    if (to < 0 || to >= parent.childCount) return true; // already first or last: nothing to do, but swallow the key
    const sibling = parent.child(to);
    const wasNode = state.selection instanceof NodeSelection;
    const offset = state.selection.from - b.pos;
    let tr = state.tr.delete(b.pos, b.pos + b.node.nodeSize);
    const insertAt = dir < 0 ? b.pos - sibling.nodeSize : b.pos + sibling.nodeSize;
    tr = tr.insert(insertAt, b.node);
    tr.setSelection(wasNode ? NodeSelection.create(tr.doc, insertAt) : TextSelection.near(tr.doc.resolve(Math.min(insertAt + offset, tr.doc.content.size)))).scrollIntoView();
    editor.view.dispatch(tr); editor.view.focus(); return true;
  },
  remove(editor, b = currentBlock(editor.state)) {
    const R = blockRange(editor.state);
    if (R) b = { pos: R.from, node: { nodeSize: R.to - R.from }, n: R.n };
    if (!b) return false;
    const tr = editor.state.tr.setMeta(RANGE, null).delete(b.pos, b.pos + b.node.nodeSize);
    if (!tr.doc.childCount) tr.insert(0, editor.state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(b.pos, tr.doc.content.size)))).scrollIntoView();
    editor.view.dispatch(tr); editor.view.focus();
    editor.storage.blockHandles?.onDelete?.(b.n || 1); // Notion says nothing; Folio offers Undo
    return true;
  },
  turn(editor, id, b = currentBlock(editor.state)) {
    const item = INSERTS.find((i) => i.id === id && i.turn); if (!item || !b) return false;
    const inside = b.node.isTextblock ? b.pos + 1 : b.pos + 2;
    editor.chain().focus().setTextSelection(Math.min(inside, editor.state.doc.content.size)).run();
    remember(id); return item.turn(editor);
  },
  /* colour the whole block, as Notion does from / red or Colour ›: patch is { color } or { bg }; nulls clear */
  colour(editor, patch, b = currentBlock(editor.state)) {
    if (!b) return false;
    const { state } = editor; const type = state.schema.marks.folioColor; if (!type) return false;
    const tr = state.tr; const from = b.pos, to = b.pos + b.node.nodeSize;
    state.doc.nodesBetween(from, to, (n, pos) => {
      if (!n.isText) return;
      const cur = type.isInSet(n.marks)?.attrs || {};
      const next = { color: null, bg: null, ...cur, ...patch };
      const a = Math.max(pos, from), z = Math.min(pos + n.nodeSize, to);
      tr.removeMark(a, z, type);
      if (next.color || next.bg) tr.addMark(a, z, type.create({ color: next.color, bg: next.bg }));
    });
    if (!tr.docChanged) { // an empty line: what is typed next takes the colour
      const cur = type.isInSet(state.storedMarks || state.selection.$from.marks())?.attrs || {}; const next = { color: null, bg: null, ...cur, ...patch };
      tr.removeStoredMark(type); if (next.color || next.bg) tr.addStoredMark(type.create(next));
    }
    editor.view.dispatch(tr); editor.view.focus(); return true;
  },
  /* give the block an Obsidian block id (^abc123) if it has none, and return it */
  ensureId(editor, b = currentBlock(editor.state)) {
    if (!b) return null;
    const text = b.node.isTextblock ? b.node : b.node.firstChild?.isTextblock ? b.node.firstChild : null;
    const found = (text?.textContent || '').match(/\s\^([A-Za-z0-9-]+)\s*$/);
    if (found) return found[1];
    const id = Math.random().toString(36).slice(2, 8);
    const { state } = editor; let tr = state.tr;
    if (text) { const end = (b.node.isTextblock ? b.pos + 1 : b.pos + 2) + text.content.size; tr = tr.insertText(` ^${id}`, end); }
    else tr = tr.insert(b.pos + b.node.nodeSize, state.schema.nodes.paragraph.create(null, state.schema.text(`^${id}`)));
    editor.view.dispatch(tr); return id;
  },
};

const TURN_IDS = ['text', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'task', 'quote', 'code'];
const SHORT = { text: tr('blk.text'), h1: tl('blk', 'Heading 1'), h2: tl('blk', 'Heading 2'), h3: tl('blk', 'Heading 3'), bullet: 'Bullets', ordered: 'Numbers', task: 'Checklist', quote: 'Quote', code: 'Code' };

/*
 * The handle. Options: onCopyLink(id), keyLabel(key), icons (grip, plus).
 */
export const BlockHandles = Extension.create({
  name: 'blockHandles',
  addOptions() { return { onCopyLink: null, onDelete: null, keyLabel: (k) => k, icons: {} }; },
  addKeyboardShortcuts() {
    const e = () => this.editor;
    return {
      'Mod-d': () => blockCmd.duplicate(e()),
      'Mod-Shift-ArrowUp': () => blockCmd.move(e(), -1),
      'Mod-Shift-ArrowDown': () => blockCmd.move(e(), 1),
      'Mod-Alt-l': () => { const id = blockCmd.ensureId(e()); if (id) this.options.onCopyLink?.(id); return true; },
      'Mod-/': () => { e().storage.blockHandles.openMenu?.(currentBlock(e().state), { focusTurn: true }); return true; },
      'Shift-ArrowDown': () => blockCmd.extend(e(), 1),
      'Shift-ArrowUp': () => blockCmd.extend(e(), -1),
      Backspace: () => (blockRange(e().state) ? blockCmd.remove(e()) : false),
      Delete: () => (blockRange(e().state) ? blockCmd.remove(e()) : false),
      Escape: () => {
        if (blockCmd.clearRange(e())) return true;
        const s = e().state.selection;
        if (s instanceof NodeSelection || !s.empty) return false;
        return blockCmd.select(e());
      },
    };
  },
  addStorage() { return { openMenu: null, onDelete: this.options.onDelete }; },
  addProseMirrorPlugins() {
    const ext = this; const editor = this.editor; const opts = this.options;
    const dnd = { from: null, to: null, over: () => false, drop: () => false };
    const rangePlugin = new Plugin({
      key: RANGE,
      state: {
        init: () => null,
        apply(tr, r) { const m = tr.getMeta(RANGE); if (m !== undefined) return m; return tr.docChanged || tr.selectionSet ? null : r; },
      },
      props: {
        decorations(state) {
          const R = blockRange(state); if (!R) return null;
          const decos = []; R.parent.forEach((n, off, i) => { if (i >= R.lo && i <= R.hi) decos.push(Decoration.node(R.start + off, R.start + off + n.nodeSize, { class: 'is-block-selected' })); });
          return DecorationSet.create(state.doc, decos);
        },
        handleTextInput: () => false, // typing replaces the selected blocks, like any selection
      },
    });
    return [rangePlugin, new Plugin({
      key: new PluginKey('blockHandles'),

      view(view) {
        const page = view.dom.closest('.rich-page') || view.dom.parentElement;
        const bar = document.createElement('div'); bar.className = 'block-handle'; bar.hidden = true;
        bar.innerHTML = `<button type="button" class="block-plus" aria-label="${tr('blk.insert-below')}" data-tip="${tr('blk.insert-below-type-anywhere')}">${opts.icons.plus || '+'}</button><button type="button" class="block-grip" draggable="true" aria-label="${tr('blk.drag-to-move-click-for-options')}" aria-haspopup="menu" data-tip="${tr('blk.drag-to-move-click-for-options-2')}">${opts.icons.grip || '⋮⋮'}</button>`;
        page.append(bar);
        const menu = document.createElement('div'); menu.className = 'block-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', tl('blk', 'Block')); menu.hidden = true;
        document.body.append(menu);
        let target = null, raf = 0, menuFor = null;

        const place = (b) => {
          const dom = view.nodeDOM(b.pos);
          if (!(dom instanceof HTMLElement)) { bar.hidden = true; return; }
          const pr = page.getBoundingClientRect(), r = dom.getBoundingClientRect();
          const lh = parseFloat(getComputedStyle(dom.querySelector('p, h1, h2, h3, h4, h5, h6') || dom).lineHeight) || 24;
          bar.hidden = false;
          bar.style.top = `${r.top - pr.top + Math.max(0, (Math.min(lh, r.height) - 24) / 2)}px`;
          bar.style.left = `${r.left - pr.left - 52}px`;
        };
        const fromPoint = (x, y) => {
          const pr = view.dom.getBoundingClientRect();
          const hit = view.posAtCoords({ left: Math.min(Math.max(x, pr.left + 24), pr.right - 4), top: y });
          if (!hit) return null;
          const $p = view.state.doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos);
          if (hit.inside >= 0) { const n = view.state.doc.nodeAt(hit.inside); if (n && !n.isInline && $p.depth === 0) return { pos: hit.inside, node: n, depth: 1 }; }
          return blockAt(view.state.doc.resolve(hit.pos));
        };
        const onMove = (ev) => {
          if (!editor.isEditable || !menu.hidden) return;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            if (bar.contains(ev.target)) return;
            const b = fromPoint(ev.clientX, ev.clientY);
            if (!b) return;
            target = b; place(b);
          });
        };
        const onLeave = (ev) => { if (!page.contains(ev.relatedTarget) && menu.hidden) bar.hidden = true; };
        page.addEventListener('mousemove', onMove);
        page.addEventListener('mouseleave', onLeave);

        // drag, as in Notion: a faint ghost follows the pointer, a 3 px line shows where the block lands (a bar on the
        // right edge puts it in a new column beside the target), and the moved block stays selected. One undo step.
        const grip = bar.querySelector('.block-grip');
        const line = document.createElement('div'); line.className = 'block-drop'; line.hidden = true; page.append(line);
        let tinted = null;
        const clearDrop = () => { line.hidden = true; tinted?.classList.remove('is-drop-target'); tinted = null; dnd.to = null; };
        dnd.over = (ev) => {
          const from = dnd.from; if (!from) return false;
          let b = fromPoint(ev.clientX, ev.clientY); if (!b) return true;
          const item = ITEM.has(from.node.type.name);
          if (item && b.node.type !== from.node.type) { clearDrop(); return true; } // a list item only lands among items of its own kind
          if (!item || !ITEM.has(b.node.type.name)) { const $b = view.state.doc.resolve(Math.min(b.pos + 1, view.state.doc.content.size)); if ($b.depth >= 1) { const p = $b.before(1); b = { pos: p, node: view.state.doc.nodeAt(p), depth: 1 }; } }
          if (!b.node || (b.pos >= from.pos && b.pos < from.pos + from.node.nodeSize)) { clearDrop(); return true; }
          const dom = view.nodeDOM(b.pos); if (!(dom instanceof HTMLElement)) return true;
          const pr = page.getBoundingClientRect(), r = dom.getBoundingClientRect();
          const cols = b.node.type.name === 'columns';
          const side = !item && b.depth === 1 && ev.clientX > r.right - 24 && (!cols || b.node.childCount < 5) && view.state.schema.nodes.columns ? 'right' : ev.clientY < r.top + r.height / 2 ? 'before' : 'after';
          dnd.to = { ...b, side };
          line.hidden = false; line.classList.toggle('is-vertical', side === 'right');
          if (side === 'right') Object.assign(line.style, { left: `${r.right - pr.left + 4}px`, top: `${r.top - pr.top}px`, width: '3px', height: `${r.height}px` });
          else Object.assign(line.style, { left: `${r.left - pr.left}px`, top: `${(side === 'before' ? r.top : r.bottom) - pr.top - 2}px`, width: `${r.width}px`, height: '3px' });
          if (tinted !== dom) { tinted?.classList.remove('is-drop-target'); tinted = dom; dom.classList.add('is-drop-target'); }
          return true;
        };
        dnd.drop = () => {
          const { from, to } = dnd; clearDrop(); dnd.from = null; page.classList.remove('is-dragging-block');
          if (!from || !to) return false;
          const { state } = view; const node = state.doc.nodeAt(from.pos); if (!node) return true;
          const tr = state.tr;
          try {
            tr.delete(from.pos, from.pos + node.nodeSize);
            const at = tr.mapping.map(to.pos); const tnode = tr.doc.nodeAt(at);
            if (to.side === 'right' && tnode) {
              const { columns, column } = state.schema.nodes;
              const next = tnode.type === columns ? tnode.copy(tnode.content.addToEnd(column.create(null, node))) : columns.create(null, [column.create(null, tnode), column.create(null, node)]);
              tr.replaceWith(at, at + tnode.nodeSize, next);
              const colPos = at + next.nodeSize - 1 - next.lastChild.nodeSize; tr.setSelection(NodeSelection.create(tr.doc, colPos + 1));
            } else {
              const ins = to.side === 'before' ? at : at + (tnode ? tnode.nodeSize : 0);
              tr.insert(ins, node); tr.setSelection(NodeSelection.create(tr.doc, ins));
            }
          } catch (e) { console.warn('block drop', e); return true; }
          view.dispatch(tr.scrollIntoView()); view.focus(); return true;
        };
        grip.addEventListener('dragstart', (ev) => {
          if (!target) return;
          dnd.from = target;
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, target.pos)));
          ev.dataTransfer.effectAllowed = 'move';
          ev.dataTransfer.setData('text/plain', target.node.textContent);
          const dom = view.nodeDOM(target.pos);
          if (dom instanceof HTMLElement) {
            const ghost = dom.cloneNode(true); ghost.classList.add('block-ghost'); ghost.style.width = `${dom.offsetWidth}px`;
            document.body.append(ghost); ev.dataTransfer.setDragImage(ghost, 12, 12); setTimeout(() => ghost.remove(), 0);
          }
          page.classList.add('is-dragging-block');
        });
        grip.addEventListener('dragend', () => { page.classList.remove('is-dragging-block'); clearDrop(); dnd.from = null; });
        page.addEventListener('dragleave', (ev) => { if (!page.contains(ev.relatedTarget)) clearDrop(); });
        // ours, in the capture phase, so neither ProseMirror's drop nor the app's file drop sees a block being moved
        const onDragOver = (ev) => { if (!dnd.from) return; ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'move'; dnd.over(ev); };
        const onDrop = (ev) => { if (!dnd.from) return; ev.preventDefault(); ev.stopPropagation(); dnd.drop(ev); };
        page.addEventListener('dragover', onDragOver, true); page.addEventListener('drop', onDrop, true);

        // +: a new line below (or this one, if empty) with / typed, so the / menu opens
        bar.querySelector('.block-plus').addEventListener('mousedown', (ev) => ev.preventDefault());
        bar.querySelector('.block-plus').addEventListener('click', () => {
          if (!target) return;
          const { state } = view; const n = target.node;
          let tr = state.tr, at;
          if (n.type.name === 'paragraph' && !n.content.size) at = target.pos + 1;
          else { const end = target.pos + n.nodeSize; tr = tr.insert(end, state.schema.nodes.paragraph.create()); at = end + 1; }
          tr = tr.setSelection(TextSelection.create(tr.doc, at)).insertText('/');
          view.dispatch(tr.scrollIntoView()); view.focus();
        });

        // the block menu
        const items = () => {
          const key = (k) => (k ? `<kbd>${opts.keyLabel(k)}</kbd>` : '');
          const turns = TURN_IDS.map((id) => INSERTS.find((i) => i.id === id)).map((i) => `<button type="button" role="menuitem" class="block-mi block-turn" data-turn="${i.id}" aria-label="${i.label}"><span class="block-mi-ic" aria-hidden="true">${i.badge ? `<b>${i.badge}</b>` : opts.icons[i.icon] || ''}</span>${SHORT[i.id]}<span class="block-mi-check" aria-hidden="true">${opts.icons.check || ''}</span></button>`).join('');
          const R = blockRange(view.state);
          return (R ? `<div class="block-mh block-mh-count">${tr('blk.n-blocks', { n: R.n })}</div>` : `<div class="block-mh">${tr('blk.turn-into')}</div><div class="block-turns" role="group" aria-label="${tr('blk.turn-into')}">${turns}</div>`) + `<div class="block-sep" role="separator"></div>
            <button type="button" role="menuitem" class="block-mi" data-act="duplicate"><span>${tr('blk.duplicate')}</span>${key('Mod+D')}</button>
            <button type="button" role="menuitem" class="block-mi" data-act="up"><span>${tr('blk.move-up')}</span>${key('Mod+Shift+Up')}</button>
            <button type="button" role="menuitem" class="block-mi" data-act="down"><span>${tr('blk.move-down')}</span>${key('Mod+Shift+Down')}</button>
            <button type="button" role="menuitem" class="block-mi" data-act="link"><span>${tr('blk.copy-link-to-block')}</span>${key('Mod+Alt+L')}</button>
            <div class="block-sep" role="separator"></div>
            <button type="button" role="menuitem" class="block-mi is-danger" data-act="delete"><span>${tr('blk.delete')}</span>${key('Delete')}</button>
            <div class="block-foot">${counts()}</div>`;
        };
        /* the footer of the menu (Notion): how long this block is */
        const counts = () => { const R = blockRange(view.state); const t = R ? view.state.doc.textBetween(R.from, R.to, ' ') : (menuFor || target)?.node.textContent || ''; const w = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length; return `${tr('app.words', { n: w })} · ${tr('app.chars', { n: [...t].length })}`; };
        const closeMenu = (refocus = true) => { if (menu.hidden) return; menu.hidden = true; grip.setAttribute('aria-expanded', 'false'); menuFor = null; if (refocus) view.focus(); };
        const openMenu = (b, { focusTurn = false } = {}) => {
          if (!b) return;
          target = b; menuFor = b; place(b);
          const R = blockRange(view.state);
          if (!R || b.pos < R.from || b.pos >= R.to) blockCmd.select(editor, b); // a click on a handle inside the selection keeps it
          menu.innerHTML = items(); menu.hidden = false; grip.setAttribute('aria-expanded', 'true');
          const anchor = bar.hidden ? (view.nodeDOM(b.pos)?.getBoundingClientRect?.() || view.dom.getBoundingClientRect()) : grip.getBoundingClientRect();
          const h = menu.offsetHeight;
          menu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - menu.offsetWidth - 8))}px`;
          menu.style.top = `${anchor.bottom + 6 + h > innerHeight - 8 ? Math.max(8, anchor.top - h - 6) : anchor.bottom + 6}px`;
          const cur = turnIdOfNode(b.node);
          menu.querySelector(`[data-turn="${cur}"]`)?.setAttribute('aria-current', 'true');
          (focusTurn ? menu.querySelector('.block-turn') : menu.querySelector('[data-act="duplicate"]'))?.focus();
        };
        ext.storage.openMenu = openMenu;
        grip.addEventListener('click', () => (menu.hidden ? openMenu(target) : closeMenu()));
        menu.addEventListener('mousedown', (ev) => ev.preventDefault());
        menu.addEventListener('click', (ev) => {
          const btn = ev.target.closest('button'); if (!btn || !menuFor) return;
          const b = menuFor; closeMenu(false);
          if (btn.dataset.turn) blockCmd.turn(editor, btn.dataset.turn, b);
          else if (btn.dataset.act === 'duplicate') blockCmd.duplicate(editor, b);
          else if (btn.dataset.act === 'up') blockCmd.move(editor, -1, b);
          else if (btn.dataset.act === 'down') blockCmd.move(editor, 1, b);
          else if (btn.dataset.act === 'delete') blockCmd.remove(editor, b);
          else if (btn.dataset.act === 'link') { const id = blockCmd.ensureId(editor, b); if (id) opts.onCopyLink?.(id); view.focus(); }
        });
        menu.addEventListener('keydown', (ev) => {
          const all = [...menu.querySelectorAll('button')]; const i = all.indexOf(document.activeElement);
          if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(); return; }
          const step = { ArrowDown: 1, ArrowUp: -1 }[ev.key];
          if (step) { ev.preventDefault(); all[(i + step + all.length) % all.length].focus(); }
          if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); all[ev.key === 'Home' ? 0 : all.length - 1].focus(); }
          if (ev.key === 'Tab') { ev.preventDefault(); closeMenu(); }
        });
        const outside = (ev) => { if (!menu.hidden && !menu.contains(ev.target) && !grip.contains(ev.target)) closeMenu(false); };
        document.addEventListener('mousedown', outside);

        return {
          update() { if (target && !bar.hidden) { const n = view.state.doc.nodeAt(target.pos); if (!n) bar.hidden = true; else { target = { ...target, node: n }; place(target); } } },
          destroy() { line.remove(); page.removeEventListener('dragover', onDragOver, true); page.removeEventListener('drop', onDrop, true); page.removeEventListener('mousemove', onMove); page.removeEventListener('mouseleave', onLeave); document.removeEventListener('mousedown', outside); bar.remove(); menu.remove(); ext.storage.openMenu = null; },
        };
      },
    })];
  },
});
