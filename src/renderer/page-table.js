// Folio — tables in pages (D6). GFM tables stay GFM: alignment is the `:---:` row, the first row is the header.
// Pure helpers (parse pasted cells, table → sheet) run in Node tests; the commands work on the TipTap editor;
// TableHandles draws the Notion/Docs handles: a grip over the column and beside the row under the pointer, and
// + bars under and to the right of the table.
import { t as tr, tl } from './i18n.js';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/* ---------- pure ---------- */

/** cells copied from Excel, Google Sheets or Numbers arrive as tab-separated lines; anything else is not a table */
export const parseTSV = (text) => parseDelimited(text, '\t');

/** comma- or semicolon-separated text is a table only when it cannot be anything else: at least 3 lines (2 with `;`),
 *  the same number of fields on every line (quotes respected), short cells, not code. Otherwise null and the text pastes as text. */
export function parseCSV(text) {
  const s = String(text || '');
  if (/[\t{}<>]/.test(s) || s.length > 200000) return null;
  for (const [d, minRows] of [[';', 2], [',', 3]]) {
    if (!s.includes(d)) continue;
    const rows = parseDelimited(s, d, { strict: true });
    if (!rows || rows.length < minRows) continue;
    if (rows.some((r) => r.some((c) => c.length > 80))) continue;
    if (rows[0].some((c) => c === '')) continue;
    return rows;
  }
  return null;
}

function parseDelimited(text, delim, { strict = false } = {}) {
  const s = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!s.includes(delim) || s.length > 2e6) return null; // a huge paste is not a table: stop before splitting it
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; continue; }
    if (c === '"' && cell === '') { quoted = true; continue; }
    if (c === delim) { row.push(cell); cell = ''; if (row.length > 50) return null; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; if (rows.length > 500) return null; } else cell += c; // past the limits: stop early
  }
  row.push(cell); rows.push(row);
  const width = Math.max(...rows.map((r) => r.length));
  if (strict && (quoted || rows.some((r) => r.length !== width))) return null;
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
export const emptyHeader = (table) => { if (!table.childCount) return false; let empty = true; table.child(0).descendants((n) => { if (n.isText || n.isLeaf) empty = false; }); return empty; };
const textCell = (schema, text, attrs = null) => schema.nodes.tableCell.create(attrs, schema.nodes.paragraph.create(null, text ? schema.text(text) : null));

export const tableCmd = {
  /* rows below the header move; the header stays the first row, as GFM needs */
  moveRow(editor, dir) { const t = tableAt(editor.state); return !!t && tableCmd.moveRowTo(editor, t.row + dir); },
  moveCol(editor, dir) { const t = tableAt(editor.state); return !!t && tableCmd.moveColTo(editor, t.col + dir); },
  /** the row with the cursor goes to index `to` (the others shift); never into or out of the header */
  moveRowTo(editor, to) {
    const t = tableAt(editor.state); if (!t || t.row === 0) return false;
    if (to < 1 || to >= t.map.height || to === t.row) return false;
    const cells = grid(t.table); const [r] = cells.splice(t.row, 1); cells.splice(to, 0, r);
    return rebuild(editor, t, cells, to, t.col);
  },
  moveColTo(editor, to) {
    const t = tableAt(editor.state); if (!t) return false;
    if (to < 0 || to >= t.map.width || to === t.col) return false;
    const cells = grid(t.table).map((r) => { const x = r.slice(); const [c] = x.splice(t.col, 1); x.splice(to, 0, c); return x; });
    return rebuild(editor, t, cells, t.row, to);
  },
  /** GFM always has a header row. "No header" is an empty one, which the Write and Read views leave out */
  hasHeader(state) { const t = tableAt(state); return !!t && !emptyHeader(t.table); },
  toggleHeader(editor) {
    const t = tableAt(editor.state); if (!t) return false; const { schema } = editor.state;
    const cells = grid(t.table);
    if (emptyHeader(t.table)) { if (cells.length < 2) return false; cells.shift(); return rebuild(editor, t, cells, Math.max(0, t.row - 1), t.col); }
    cells.unshift(Array.from({ length: t.map.width }, (_, i) => textCell(schema, '', { ...cells[0][i].attrs, colspan: 1, rowspan: 1 })));
    return rebuild(editor, t, cells, t.row + 1, t.col);
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
  const row = [{ head: tr('tbl.row') },
    { label: tr('tbl.header-row'), icon: icons.table, checked: t ? !emptyHeader(t.table) : false, run: () => tableCmd.toggleHeader(editor) },
    { label: tr('tbl.insert-above'), icon: icons.rowAbove, run: () => c().addRowBefore().run(), disabled: t?.row === 0 },
    { label: tr('tbl.insert-below'), icon: icons.rowBelow, run: () => c().addRowAfter().run() },
    { label: tr('tbl.move-up'), icon: icons.arrowUp, run: () => tableCmd.moveRow(editor, -1), disabled: !t || t.row <= 1 },
    { label: tr('tbl.move-down'), icon: icons.arrowDown, run: () => tableCmd.moveRow(editor, 1), disabled: !t || t.row === 0 || t.row >= t.map.height - 1 },
    { label: tr('tbl.delete-row'), icon: icons.rowDelete, run: () => c().deleteRow().run(), danger: true, disabled: t?.row === 0 }];
  const col = [{ head: tr('tbl.column') },
    { label: tr('tbl.insert-left'), icon: icons.colLeft, run: () => c().addColumnBefore().run() },
    { label: tr('tbl.insert-right'), icon: icons.colRight, run: () => c().addColumnAfter().run() },
    { label: tr('tbl.move-left'), icon: icons.arrowLeft, run: () => tableCmd.moveCol(editor, -1), disabled: !t || t.col === 0 },
    { label: tr('tbl.move-right'), icon: icons.arrowRight, run: () => tableCmd.moveCol(editor, 1), disabled: !t || t.col >= t.map.width - 1 },
    { label: tr('tbl.align-left'), icon: icons.alignLeft, checked: align === 'left', run: () => tableCmd.alignCol(editor, 'left') },
    { label: tr('tbl.align-centre'), icon: icons.alignCenter, checked: align === 'center', run: () => tableCmd.alignCol(editor, 'center') },
    { label: tr('tbl.align-right'), icon: icons.alignRight, checked: align === 'right', run: () => tableCmd.alignCol(editor, 'right') },
    { label: tr('tbl.sort-a-to-z'), icon: icons.sortAsc, run: () => tableCmd.sort(editor, false) },
    { label: tr('tbl.sort-z-to-a'), icon: icons.sortDesc, run: () => tableCmd.sort(editor, true) },
    { label: tr('tbl.delete-column'), icon: icons.colDelete, run: () => c().deleteColumn().run(), danger: true }];
  const tail = ['-', ...(toSheet ? [{ label: tr('tbl.open-as-sheet'), icon: icons.sheet, run: toSheet }] : []), { label: tr('tbl.delete-table'), icon: icons.trash, run: () => c().deleteTable().run(), danger: true }];
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
        // a table whose header row is empty is shown without it
        decorations(state) {
          const d = []; state.doc.descendants((n, pos) => { if (n.type.name === 'table') { if (emptyHeader(n)) d.push(Decoration.node(pos, pos + n.nodeSize, { class: 'tbl-nohead' })); return false; } return true; });
          return d.length ? DecorationSet.create(state.doc, d) : null;
        },
        // cells copied from a spreadsheet become a table (or fill this one), not a line of tabs
        handlePaste(view, event) {
          const text = event.clipboardData?.getData('text/plain');
          if (!text || view.state.selection.$from.parent.type.spec.code) return false;
          const rows = parseTSV(text) || parseCSV(text); if (!rows) return false;
          event.preventDefault(); tableCmd.paste(editor, rows); return true;
        },
      },
      view(view) {
        const page = view.dom.closest('.rich-page') || view.dom.parentElement;
        const ui = document.createElement('div'); ui.className = 'table-ui'; ui.hidden = true;
        const btn = (cls, label, icon) => `<button type="button" class="${cls}" aria-label="${label}" data-tip="${label}">${icon || ''}</button>`;
        ui.innerHTML = btn('tbl-grip tbl-col', tl('tbl', 'Column options'), opts.icons.grip) + btn('tbl-grip tbl-row', tl('tbl', 'Row options'), opts.icons.grip) + btn('tbl-add tbl-add-row', tl('tbl', 'Add a row'), opts.icons.plus) + btn('tbl-add tbl-add-col', tl('tbl', 'Add a column'), opts.icons.plus);
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
          popupMenu(grip, items, { label: kind === 'row' ? tl('tbl', 'Row') : tl('tbl', 'Column'), onClose: () => { open = false; grip.setAttribute('aria-expanded', 'false'); } });
        };
        for (const b of ui.children) b.addEventListener('mousedown', (ev) => ev.preventDefault());
        /* drag a grip to move its column or row: a line shows where it lands */
        let dragged = false;
        const line = document.createElement('div'); line.className = 'tbl-drop'; line.hidden = true; ui.append(line);
        const drag = (grip, kind) => grip.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0 || !hover) return;
          const t0 = focusCell(); if (!t0) return; const tableEl = hover.tableEl; const x0 = ev.clientX, y0 = ev.clientY; let moving = false, target = null;
          const rows = [...tableEl.rows]; const cols = [...rows[rows.length - 1].cells];
          const spans = kind === 'col' ? cols.map((c) => c.getBoundingClientRect()) : rows.map((r) => r.getBoundingClientRect());
          const pick = (ev2) => { const v = kind === 'col' ? ev2.clientX : ev2.clientY; let i = spans.findIndex((r) => v < (kind === 'col' ? r.right : r.bottom)); if (i < 0) i = spans.length - 1; return kind === 'row' ? Math.max(1, i) : i; };
          const mv = (ev2) => {
            if (!moving && Math.hypot(ev2.clientX - x0, ev2.clientY - y0) < 5) return;
            moving = true; dragged = true; target = pick(ev2); const pr = page.getBoundingClientRect(), r = spans[target], tr = tableEl.getBoundingClientRect();
            line.hidden = false; line.className = 'tbl-drop ' + (kind === 'col' ? 'is-col' : 'is-row');
            Object.assign(line.style, kind === 'col' ? { left: `${r.left - pr.left}px`, top: `${tr.top - pr.top}px`, height: `${tr.height}px`, width: `${r.width}px` } : { left: `${tr.left - pr.left}px`, top: `${r.top - pr.top}px`, width: `${tr.width}px`, height: `${r.height}px` });
          };
          const up = () => {
            removeEventListener('pointermove', mv); removeEventListener('pointerup', up); line.hidden = true;
            if (moving && target != null) { view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(t0.pos + 1 + t0.map.map[t0.row * t0.map.width + t0.col] + 1)))); kind === 'col' ? tableCmd.moveColTo(editor, target) : tableCmd.moveRowTo(editor, target); }
            setTimeout(() => { dragged = false; }, 0);
          };
          addEventListener('pointermove', mv); addEventListener('pointerup', up);
        });
        drag(colGrip, 'col'); drag(rowGrip, 'row');
        colGrip.addEventListener('click', () => { if (!dragged) menuFor(colGrip, 'col'); });
        rowGrip.addEventListener('click', () => { if (!dragged) menuFor(rowGrip, 'row'); });
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
