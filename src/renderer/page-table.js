// Folio — tables in pages (D6). GFM tables stay GFM: alignment is the `:---:` row, the first row is the header.
// Pure helpers (parse pasted cells, table → sheet) run in Node tests; the commands work on the TipTap editor;
// TableHandles draws the Notion/Docs handles: a grip over the column and beside the row under the pointer, and
// + bars under and to the right of the table.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';

/* ---------- pure ---------- */

/** cells copied from Excel, Google Sheets or Numbers arrive as tab-separated lines; anything else is not a table */
export function parseTSV(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!s.includes('\t')) return null;
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; continue; }
    if (c === '"' && cell === '') { quoted = true; continue; }
    if (c === '\t') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  row.push(cell); rows.push(row);
  const width = Math.max(...rows.map((r) => r.length));
  if (width < 2 || rows.length > 500 || width > 50) return null;
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')].map((c) => c.replace(/\n/g, ' ').trim()));
}

const cellText = (c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
/** a GFM table from rows of text; the first row is the header */
export function gfmTable(rows, aligns = []) {
  const w = Math.max(...rows.map((r) => r.length));
  const line = (r) => `| ${Array.from({ length: w }, (_, i) => cellText(r[i])).join(' | ')} |`;
  const rule = `| ${Array.from({ length: w }, (_, i) => ({ left: ':---', center: ':---:', right: '---:' }[aligns[i]] || '---')).join(' | ')} |`;
  return [line(rows[0]), rule, ...rows.slice(1).map(line)].join('\n');
}
/** the body of a new sheet that holds the table (sheet-md: one ## section per sheet) */
export const sheetFromTable = (title, rows, aligns) => `# ${title}\n\n## Sheet1\n\n${gfmTable(rows, aligns)}\n`;

/** compare two cell texts as Excel does: numbers by value, then text, empty cells last */
export function compareCells(a, b) {
  const ea = !String(a).trim(), eb = !String(b).trim();
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = Number(String(a).replace(/[\s,%€$£]/g, '')), nb = Number(String(b).replace(/[\s,%€$£]/g, ''));
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/* ---------- editor ---------- */

/** the table around the cursor: node, position, map, and the row and column of the cell */
export function tableAt(state) {
  const $p = state.selection.$from;
  for (let d = $p.depth; d > 0; d--) {
    if ($p.node(d).type.name !== 'table') continue;
    const table = $p.node(d), pos = $p.before(d), map = TableMap.get(table);
    let row = 0, col = 0;
    for (let k = d + 1; k <= $p.depth; k++) {
      const n = $p.node(k);
      if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') { const rect = map.findCell($p.before(k) - pos - 1); row = rect.top; col = rect.left; break; }
    }
    return { table, pos, map, row, col };
  }
  return null;
}
const grid = (table) => { const rows = []; table.forEach((r) => { const cells = []; r.forEach((c) => cells.push(c)); rows.push(cells); }); return rows; };
/* rebuild the table from a grid of cells, keeping the first row as header cells, then put the cursor in [row, col] */
function rebuild(editor, t, cells, row, col) {
  const { schema } = editor.state; const { tableRow, tableCell, tableHeader } = schema.nodes;
  const rows = cells.map((r, i) => tableRow.create(null, r.map((c) => {
    const type = i === 0 ? tableHeader : tableCell;
    return c.type === type ? c : type.create(c.attrs, c.content);
  })));
  const next = t.table.type.create(t.table.attrs, rows);
  const tr = editor.state.tr.replaceWith(t.pos, t.pos + t.table.nodeSize, next);
  const map = TableMap.get(next);
  const r = Math.max(0, Math.min(row, map.height - 1)), c = Math.max(0, Math.min(col, map.width - 1));
  const cellPos = t.pos + 1 + map.map[r * map.width + c];
  tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
  editor.view.dispatch(tr.scrollIntoView()); editor.view.focus();
  return true;
}
const textOf = (cell) => cell.textContent;
const textCell = (schema, text, attrs = null) => schema.nodes.tableCell.create(attrs, schema.nodes.paragraph.create(null, text ? schema.text(text) : null));

export const tableCmd = {
  /* rows below the header move; the header stays the first row, as GFM needs */
  moveRow(editor, dir) {
    const t = tableAt(editor.state); if (!t || t.row === 0) return false;
    const to = t.row + dir; if (to < 1 || to >= t.map.height) return false;
    const cells = grid(t.table); [cells[t.row], cells[to]] = [cells[to], cells[t.row]];
    return rebuild(editor, t, cells, to, t.col);
  },
  moveCol(editor, dir) {
    const t = tableAt(editor.state); if (!t) return false;
    const to = t.col + dir; if (to < 0 || to >= t.map.width) return false;
    const cells = grid(t.table).map((r) => { const x = r.slice(); [x[t.col], x[to]] = [x[to], x[t.col]]; return x; });
    return rebuild(editor, t, cells, t.row, to);
  },
  /* the whole column takes the alignment: GFM stores it once, in the rule under the header */
  alignCol(editor, align) {
    const t = tableAt(editor.state); if (!t) return false;
    const cur = t.table.child(0).child(t.col).attrs.align || null;
    const next = cur === align ? null : align;
    const cells = grid(t.table).map((r) => r.map((c, i) => (i === t.col ? c.type.create({ ...c.attrs, align: next }, c.content) : c)));
    return rebuild(editor, t, cells, t.row, t.col);
  },
  colAlign(state) { const t = tableAt(state); return t ? t.table.child(0).child(t.col).attrs.align || null : null; },
  sort(editor, desc = false) {
    const t = tableAt(editor.state); if (!t) return false;
    const cells = grid(t.table); const head = cells.shift();
    cells.sort((a, b) => compareCells(textOf(a[t.col]), textOf(b[t.col])) * (desc ? -1 : 1));
    return rebuild(editor, t, [head, ...cells], t.row, t.col);
  },
  /** rows of text and the column alignments, for "Open as sheet" */
  rows(state) {
    const t = tableAt(state); if (!t) return null;
    return { rows: grid(t.table).map((r) => r.map(textOf)), aligns: t.table.child(0).content.content.map((c) => c.attrs.align || null), t };
  },
  /* pasted cells: a new table, or written into this table from the current cell, growing it as needed */
  paste(editor, rows) {
    const { schema } = editor.state;
    const t = tableAt(editor.state);
    if (!t) {
      const table = schema.nodes.table.create(null, rows.map((r, i) => schema.nodes.tableRow.create(null, r.map((c) => (i === 0 ? schema.nodes.tableHeader : schema.nodes.tableCell).create(null, schema.nodes.paragraph.create(null, c ? schema.text(c) : null))))));
      return editor.chain().focus().insertContent(table.toJSON()).run();
    }
    const cells = grid(t.table);
    const width = Math.max(t.map.width, t.col + rows[0].length);
    for (const r of cells) while (r.length < width) r.push(textCell(schema, ''));
    while (cells.length < t.row + rows.length) cells.push(Array.from({ length: width }, () => textCell(schema, '')));
    rows.forEach((r, i) => r.forEach((text, j) => { const old = cells[t.row + i][t.col + j]; cells[t.row + i][t.col + j] = textCell(schema, text, old.attrs); }));
    return rebuild(editor, t, cells, t.row + rows.length - 1, t.col + rows[0].length - 1);
  },
  /* select the whole row or column under a cell (so Delete, colour or bold apply to it) */
  select(editor, t, kind) {
    const map = t.map; const { pos } = t;
    const a = kind === 'row' ? map.map[t.row * map.width] : map.map[t.col];
    const b = kind === 'row' ? map.map[t.row * map.width + map.width - 1] : map.map[(map.height - 1) * map.width + t.col];
    const doc = editor.state.doc;
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(doc, pos + 1 + a, pos + 1 + b)));
  },
};

/* ---------- a small menu, shared by the table handles and the ribbon ---------- */
export function popupMenu(anchor, items, { label = 'Menu', onClose } = {}) {
  document.querySelector('.folio-popmenu')?.remove();
  const menu = document.createElement('div'); menu.className = 'block-menu folio-popmenu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label);
  menu.innerHTML = items.map((it, i) => (it === '-' ? '<div class="block-sep" role="separator"></div>'
    : it.head ? `<div class="block-mh">${it.head}</div>`
    : it.html ? it.html
    : `<button type="button" role="menuitem" class="block-mi${it.danger ? ' is-danger' : ''}" data-i="${i}"${it.checked != null ? ` aria-checked="${!!it.checked}" role="menuitemcheckbox"` : ''}${it.disabled ? ' disabled' : ''}>${it.icon || ''}<span>${it.label}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>`)).join('');
  // inside an open modal dialog, the menu must live in it (a modal makes the rest of the page inert)
  (anchor.closest?.('dialog[open]') || document.body).append(menu);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  const close = (why) => { if (!menu.isConnected) return; menu.remove(); document.removeEventListener('mousedown', outside, true); onClose?.(why); };
  const outside = (e) => { if (!menu.contains(e.target) && !(anchor.contains?.(e.target))) close('outside'); };
  document.addEventListener('mousedown', outside, true);
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menu.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b || b.disabled) return; close('pick'); items[+b.dataset.i].run(); });
  menu.addEventListener('keydown', (e) => {
    const all = [...menu.querySelectorAll('button:not([disabled])')]; const i = all.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step) { e.preventDefault(); all[(i + step + all.length) % all.length]?.focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close('escape'); }
  });
  menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  return { menu, close };
}

/* the commands offered on a row or column grip */
export function tableMenuItems(editor, { icons = {}, kind = 'both', toSheet } = {}) {
  const c = () => editor.chain().focus();
  const t = tableAt(editor.state); const align = tableCmd.colAlign(editor.state);
  const row = [{ head: 'Row' },
    { label: 'Insert above', icon: icons.rowAbove, run: () => c().addRowBefore().run(), disabled: t?.row === 0 },
    { label: 'Insert below', icon: icons.rowBelow, run: () => c().addRowAfter().run() },
    { label: 'Move up', icon: icons.arrowUp, run: () => tableCmd.moveRow(editor, -1), disabled: !t || t.row <= 1 },
    { label: 'Move down', icon: icons.arrowDown, run: () => tableCmd.moveRow(editor, 1), disabled: !t || t.row === 0 || t.row >= t.map.height - 1 },
    { label: 'Delete row', icon: icons.rowDelete, run: () => c().deleteRow().run(), danger: true, disabled: t?.row === 0 }];
  const col = [{ head: 'Column' },
    { label: 'Insert left', icon: icons.colLeft, run: () => c().addColumnBefore().run() },
    { label: 'Insert right', icon: icons.colRight, run: () => c().addColumnAfter().run() },
    { label: 'Move left', icon: icons.arrowLeft, run: () => tableCmd.moveCol(editor, -1), disabled: !t || t.col === 0 },
    { label: 'Move right', icon: icons.arrowRight, run: () => tableCmd.moveCol(editor, 1), disabled: !t || t.col >= t.map.width - 1 },
    { label: 'Align left', icon: icons.alignLeft, checked: align === 'left', run: () => tableCmd.alignCol(editor, 'left') },
    { label: 'Align centre', icon: icons.alignCenter, checked: align === 'center', run: () => tableCmd.alignCol(editor, 'center') },
    { label: 'Align right', icon: icons.alignRight, checked: align === 'right', run: () => tableCmd.alignCol(editor, 'right') },
    { label: 'Sort A to Z', icon: icons.sortAsc, run: () => tableCmd.sort(editor, false) },
    { label: 'Sort Z to A', icon: icons.sortDesc, run: () => tableCmd.sort(editor, true) },
    { label: 'Delete column', icon: icons.colDelete, run: () => c().deleteColumn().run(), danger: true }];
  const tail = ['-', ...(toSheet ? [{ label: 'Open as sheet', icon: icons.sheet, run: toSheet }] : []), { label: 'Delete table', icon: icons.trash, run: () => c().deleteTable().run(), danger: true }];
  return kind === 'row' ? [...row, ...tail] : kind === 'col' ? [...col, ...tail] : [...row, '-', ...col, ...tail];
}

export const TableHandles = Extension.create({
  name: 'tableHandles',
  addOptions() { return { icons: {}, toSheet: null }; },
  addKeyboardShortcuts() {
    const e = () => this.editor;
    const inTable = () => !!tableAt(e().state);
    return {
      'Alt-Shift-ArrowUp': () => inTable() && tableCmd.moveRow(e(), -1),
      'Alt-Shift-ArrowDown': () => inTable() && tableCmd.moveRow(e(), 1),
      'Alt-Shift-ArrowLeft': () => inTable() && tableCmd.moveCol(e(), -1),
      'Alt-Shift-ArrowRight': () => inTable() && tableCmd.moveCol(e(), 1),
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor; const opts = this.options;
    return [new Plugin({
      key: new PluginKey('tableHandles'),
      props: {
        // cells copied from a spreadsheet become a table (or fill this one), not a line of tabs
        handlePaste(view, event) {
          const text = event.clipboardData?.getData('text/plain');
          if (!text || view.state.selection.$from.parent.type.spec.code) return false;
          const rows = parseTSV(text); if (!rows) return false;
          event.preventDefault(); tableCmd.paste(editor, rows); return true;
        },
      },
      view(view) {
        const page = view.dom.closest('.rich-page') || view.dom.parentElement;
        const ui = document.createElement('div'); ui.className = 'table-ui'; ui.hidden = true;
        const btn = (cls, label, icon) => `<button type="button" class="${cls}" aria-label="${label}" data-tip="${label}">${icon || ''}</button>`;
        ui.innerHTML = btn('tbl-grip tbl-col', 'Column options', opts.icons.grip) + btn('tbl-grip tbl-row', 'Row options', opts.icons.grip) + btn('tbl-add tbl-add-row', 'Add a row', opts.icons.plus) + btn('tbl-add tbl-add-col', 'Add a column', opts.icons.plus);
        page.append(ui);
        const [colGrip, rowGrip, addRow, addCol] = ui.children;
        let hover = null, raf = 0, open = false;
        const cellAt = (x, y) => {
          const el = document.elementFromPoint(x, y)?.closest?.('td, th');
          if (!el || !view.dom.contains(el)) return null;
          const tableEl = el.closest('table');
          let pos; try { pos = view.posAtDOM(el, 0); } catch { return null; }
          return { el, tableEl, pos };
        };
        const place = () => {
          if (!hover) { ui.hidden = true; return; }
          const pr = page.getBoundingClientRect(), cr = hover.el.getBoundingClientRect(), tr = hover.tableEl.getBoundingClientRect();
          const rowEl = hover.el.parentElement; const rr = rowEl.getBoundingClientRect();
          ui.hidden = false;
          Object.assign(colGrip.style, { left: `${cr.left - pr.left + cr.width / 2 - 12}px`, top: `${tr.top - pr.top - 13}px` });
          Object.assign(rowGrip.style, { left: `${tr.left - pr.left - 15}px`, top: `${rr.top - pr.top + rr.height / 2 - 12}px` });
          Object.assign(addRow.style, { left: `${tr.left - pr.left}px`, top: `${tr.bottom - pr.top + 2}px`, width: `${tr.width}px` });
          Object.assign(addCol.style, { left: `${tr.right - pr.left + 2}px`, top: `${tr.top - pr.top}px`, height: `${tr.height}px` });
          rowGrip.hidden = !rowEl.parentElement || rowEl.querySelector('th') != null;
        };
        const onMove = (ev) => {
          if (open || !editor.isEditable) return;
          if (ui.contains(ev.target)) return;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            const c = cellAt(ev.clientX, ev.clientY);
            if (c) { hover = c; place(); }
            else if (hover && !hover.tableEl.isConnected) { hover = null; place(); }
            else if (hover) { const r = hover.tableEl.getBoundingClientRect(); if (ev.clientX < r.left - 30 || ev.clientX > r.right + 30 || ev.clientY < r.top - 30 || ev.clientY > r.bottom + 30) { hover = null; place(); } }
          });
        };
        page.addEventListener('mousemove', onMove);
        const focusCell = () => { if (!hover) return null; view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hover.pos)))); return tableAt(view.state); };
        const menuFor = (grip, kind) => {
          const t = focusCell(); if (!t) return;
          tableCmd.select(editor, t, kind);
          open = true; grip.setAttribute('aria-expanded', 'true');
          // commands need the cursor in a cell, not the cell selection: put it back before running
          const items = tableMenuItems(editor, { icons: opts.icons, kind, toSheet: opts.toSheet ? () => opts.toSheet(editor) : null })
            .map((it) => (it.run ? { ...it, run: () => { view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hover?.pos ?? view.state.selection.from)))); it.run(); } } : it));
          popupMenu(grip, items, { label: kind === 'row' ? 'Row' : 'Column', onClose: () => { open = false; grip.setAttribute('aria-expanded', 'false'); } });
        };
        for (const b of ui.children) b.addEventListener('mousedown', (ev) => ev.preventDefault());
        colGrip.addEventListener('click', () => menuFor(colGrip, 'col'));
        rowGrip.addEventListener('click', () => menuFor(rowGrip, 'row'));
        // the + bars add at the end, as in Notion
        addRow.addEventListener('click', () => {
          if (!hover) return; const tablePos = view.posAtDOM(hover.tableEl, 0);
          const $t = view.state.doc.resolve(tablePos); let d = $t.depth; while (d > 0 && $t.node(d).type.name !== 'table') d--;
          const table = $t.node(d), start = $t.before(d), map = TableMap.get(table);
          const last = start + 1 + map.map[(map.height - 1) * map.width];
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(last + 1))));
          editor.chain().focus().addRowAfter().run();
          const t = tableAt(view.state); if (t) { const p = t.pos + 1 + t.map.map[(t.map.height - 1) * t.map.width]; view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(p + 1)))); }
          requestAnimationFrame(place);
        });
        addCol.addEventListener('click', () => {
          if (!hover) return; const tablePos = view.posAtDOM(hover.tableEl, 0);
          const $t = view.state.doc.resolve(tablePos); let d = $t.depth; while (d > 0 && $t.node(d).type.name !== 'table') d--;
          const table = $t.node(d), start = $t.before(d), map = TableMap.get(table);
          const lastHead = start + 1 + map.map[map.width - 1];
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(lastHead + 1))));
          editor.chain().focus().addColumnAfter().run();
          requestAnimationFrame(place);
        });
        return {
          update() { if (hover && !hover.el.isConnected) { hover = null; } place(); },
          destroy() { page.removeEventListener('mousemove', onMove); ui.remove(); },
        };
      },
    })];
  },
});
