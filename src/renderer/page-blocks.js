// Folio — blocks you can grab, as in Notion: a ⋮⋮ handle to drag a block or open its menu, a + to insert below,
// and the keyboard commands that go with them (duplicate, move, turn into, copy link, select block, delete).
// A "block" is the list item under the pointer or cursor, otherwise the top-level block.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { INSERTS, remember } from './inserts.js';

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

export const blockCmd = {
  select(editor, b = currentBlock(editor.state)) {
    if (!b) return false;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, b.pos)));
    return true;
  },
  duplicate(editor, b = currentBlock(editor.state)) {
    if (!b) return false;
    const end = b.pos + b.node.nodeSize;
    const tr = editor.state.tr.insert(end, b.node.copy(b.node.content));
    tr.setSelection(NodeSelection.create(tr.doc, end)).scrollIntoView();
    editor.view.dispatch(tr); editor.view.focus(); return true;
  },
  move(editor, dir, b = currentBlock(editor.state)) {
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
    if (!b) return false;
    const tr = editor.state.tr.delete(b.pos, b.pos + b.node.nodeSize);
    if (!tr.doc.childCount) tr.insert(0, editor.state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(b.pos, tr.doc.content.size)))).scrollIntoView();
    editor.view.dispatch(tr); editor.view.focus(); return true;
  },
  turn(editor, id, b = currentBlock(editor.state)) {
    const item = INSERTS.find((i) => i.id === id && i.turn); if (!item || !b) return false;
    const inside = b.node.isTextblock ? b.pos + 1 : b.pos + 2;
    editor.chain().focus().setTextSelection(Math.min(inside, editor.state.doc.content.size)).run();
    remember(id); return item.turn(editor);
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
const SHORT = { text: 'Text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', bullet: 'Bullets', ordered: 'Numbers', task: 'Checklist', quote: 'Quote', code: 'Code' };

/*
 * The handle. Options: onCopyLink(id), keyLabel(key), icons (grip, plus).
 */
export const BlockHandles = Extension.create({
  name: 'blockHandles',
  addOptions() { return { onCopyLink: null, keyLabel: (k) => k, icons: {} }; },
  addKeyboardShortcuts() {
    const e = () => this.editor;
    return {
      'Mod-d': () => blockCmd.duplicate(e()),
      'Mod-Shift-ArrowUp': () => blockCmd.move(e(), -1),
      'Mod-Shift-ArrowDown': () => blockCmd.move(e(), 1),
      'Mod-Alt-l': () => { const id = blockCmd.ensureId(e()); if (id) this.options.onCopyLink?.(id); return true; },
      'Mod-/': () => { e().storage.blockHandles.openMenu?.(currentBlock(e().state), { focusTurn: true }); return true; },
      Escape: () => {
        const s = e().state.selection;
        if (s instanceof NodeSelection || !s.empty) return false;
        return blockCmd.select(e());
      },
    };
  },
  addStorage() { return { openMenu: null }; },
  addProseMirrorPlugins() {
    const ext = this; const editor = this.editor; const opts = this.options;
    return [new Plugin({
      key: new PluginKey('blockHandles'),
      view(view) {
        const page = view.dom.closest('.rich-page') || view.dom.parentElement;
        const bar = document.createElement('div'); bar.className = 'block-handle'; bar.hidden = true;
        bar.innerHTML = `<button type="button" class="block-plus" aria-label="Insert below" data-tip="Insert below (type / anywhere)">${opts.icons.plus || '+'}</button><button type="button" class="block-grip" draggable="true" aria-label="Drag to move, click for options" aria-haspopup="menu" data-tip="Drag to move · Click for options">${opts.icons.grip || '⋮⋮'}</button>`;
        page.append(bar);
        const menu = document.createElement('div'); menu.className = 'block-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Block'); menu.hidden = true;
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

        // drag: hand the block to ProseMirror's own drop handling (moves it, with the drop cursor and undo)
        const grip = bar.querySelector('.block-grip');
        grip.addEventListener('dragstart', (ev) => {
          if (!target) return;
          const sel = NodeSelection.create(view.state.doc, target.pos);
          view.dispatch(view.state.tr.setSelection(sel));
          const slice = sel.content();
          view.dragging = { slice, move: true };
          ev.dataTransfer.effectAllowed = 'copyMove';
          ev.dataTransfer.setData('text/plain', target.node.textContent);
          const dom = view.nodeDOM(target.pos); if (dom instanceof HTMLElement) ev.dataTransfer.setDragImage(dom, 0, 0);
          page.classList.add('is-dragging-block');
        });
        grip.addEventListener('dragend', () => { page.classList.remove('is-dragging-block'); view.dragging = null; });

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
          const turns = TURN_IDS.map((id) => INSERTS.find((i) => i.id === id)).map((i) => `<button type="button" role="menuitem" class="block-mi block-turn" data-turn="${i.id}" aria-label="${i.label}"><span class="block-mi-ic" aria-hidden="true">${i.badge ? `<b>${i.badge}</b>` : opts.icons[i.icon] || ''}</span>${SHORT[i.id]}</button>`).join('');
          return `<div class="block-mh">Turn into</div><div class="block-turns" role="group" aria-label="Turn into">${turns}</div><div class="block-sep" role="separator"></div>
            <button type="button" role="menuitem" class="block-mi" data-act="duplicate"><span>Duplicate</span>${key('Mod+D')}</button>
            <button type="button" role="menuitem" class="block-mi" data-act="up"><span>Move up</span>${key('Mod+Shift+Up')}</button>
            <button type="button" role="menuitem" class="block-mi" data-act="down"><span>Move down</span>${key('Mod+Shift+Down')}</button>
            <button type="button" role="menuitem" class="block-mi" data-act="link"><span>Copy link to block</span>${key('Mod+Alt+L')}</button>
            <div class="block-sep" role="separator"></div>
            <button type="button" role="menuitem" class="block-mi is-danger" data-act="delete"><span>Delete</span>${key('Delete')}</button>`;
        };
        const closeMenu = (refocus = true) => { if (menu.hidden) return; menu.hidden = true; grip.setAttribute('aria-expanded', 'false'); menuFor = null; if (refocus) view.focus(); };
        const openMenu = (b, { focusTurn = false } = {}) => {
          if (!b) return;
          target = b; menuFor = b; place(b);
          blockCmd.select(editor, b);
          menu.innerHTML = items(); menu.hidden = false; grip.setAttribute('aria-expanded', 'true');
          const anchor = bar.hidden ? (view.nodeDOM(b.pos)?.getBoundingClientRect?.() || view.dom.getBoundingClientRect()) : grip.getBoundingClientRect();
          const h = menu.offsetHeight;
          menu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - menu.offsetWidth - 8))}px`;
          menu.style.top = `${anchor.bottom + 6 + h > innerHeight - 8 ? Math.max(8, anchor.top - h - 6) : anchor.bottom + 6}px`;
          const cur = b.node.type.name === 'heading' ? 'h' + b.node.attrs.level : { paragraph: 'text', blockquote: 'quote', codeBlock: 'code', bulletList: 'bullet', orderedList: 'ordered', taskList: 'task' }[b.node.type.name];
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
          destroy() { page.removeEventListener('mousemove', onMove); page.removeEventListener('mouseleave', onLeave); document.removeEventListener('mousedown', outside); bar.remove(); menu.remove(); ext.storage.openMenu = null; },
        };
      },
    })];
  },
});
