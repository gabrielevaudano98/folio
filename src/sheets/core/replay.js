// Folio Sheets — the operations a Folio Script returns (engine/script.js), replayed on a Univer workbook through its
// facade: every step is a Univer command, so it is undoable, recorded in the operation log, saved like any edit and
// refused by a protected sheet. The window (surface.applyOps) and the headless engine (tests, CLI) share this.
//
//   { op: 'values', sheet, range, values }        { op: 'clear', sheet, range }
//   { op: 'style', sheet, range, key, value }     key: bold italic underline strike color fill numfmt align valign wrap size font border
//   { op: 'note', sheet, range, value }           { op: 'merge' | 'unmerge', sheet, range, across? }
//   { op: 'insertRows' | 'deleteRows' | 'insertCols' | 'deleteCols', sheet, at (0-based), count }
//   { op: 'colWidth' | 'rowHeight', sheet, at, size }    { op: 'freeze', sheet, rows?, cols? }
//   { op: 'insertSheet' | 'deleteSheet' | 'activate', sheet }   { op: 'renameSheet', sheet, name }   { op: 'select', sheet, range }

const ALIGN = { left: 'left', center: 'center', centre: 'center', right: 'right', justify: 'justify' };
const VALIGN = { top: 'top', middle: 'middle', center: 'middle', centre: 'middle', bottom: 'bottom' };
const BORDER_STYLE = { thin: 1, hair: 2, dotted: 3, dashed: 4, 'dash-dot': 5, 'dash-dot-dot': 6, double: 7, medium: 8, thick: 13 };

export const STYLE_KEYS = {
  bold: (r, v) => r.setFontWeight(v ? 'bold' : 'normal'),
  italic: (r, v) => r.setFontStyle(v ? 'italic' : 'normal'),
  underline: (r, v) => r.setFontLine(v ? 'underline' : 'none'),
  strike: (r, v) => r.setFontLine(v ? 'line-through' : 'none'),
  color: (r, v) => r.setFontColor(v),
  fill: (r, v) => r.setBackground(v || null),
  numfmt: (r, v) => r.setNumberFormat(v),
  align: (r, v) => r.setHorizontalAlignment(ALIGN[String(v).toLowerCase()] || 'left'),
  valign: (r, v) => r.setVerticalAlignment(VALIGN[String(v).toLowerCase()] || 'bottom'),
  wrap: (r, v) => r.setWrap(!!v),
  size: (r, v) => r.setFontSize(Math.max(1, Math.min(409, Number(v) || 11))),
  font: (r, v) => r.setFontFamily(String(v)),
  // { sides: ['top', 'bottom'…] or 'all' | 'outside' | 'inside' | 'none', style: 'thin', color: '#000000' }
  border: (r, v) => {
    const style = BORDER_STYLE[v?.style] || 1, color = v?.color || '#000000';
    for (const side of Array.isArray(v?.sides) ? v.sides : [v?.sides || 'all']) r.setBorder(side, style, color);
  },
};

/** replay `ops` on a Univer facade workbook; `onError(op, error)` is told about a step that failed (the rest go on) */
export function replayOps(fwb, ops = [], { onError = () => {}, activeSheet = null } = {}) {
  const byName = (n) => (n ? fwb.getSheetByName(n) : activeSheet?.() || fwb.getActiveSheet());
  let done = 0;
  for (const o of ops) {
    try {
      if (o.op === 'insertSheet') { if (!fwb.getSheetByName(o.sheet)) fwb.insertSheet(o.sheet); done++; continue; }
      const s = byName(o.sheet); if (!s) throw new Error(`No sheet named ${o.sheet}`);
      switch (o.op) {
        case 'activate': s.activate(); break;
        case 'deleteSheet': fwb.deleteSheet(s); break;
        case 'renameSheet': s.setName(String(o.name)); break;
        case 'insertRows': s.insertRowsBefore(o.at, o.count || 1); break;
        case 'deleteRows': s.deleteRows(o.at, o.count || 1); break;
        case 'insertCols': s.insertColumnsBefore(o.at, o.count || 1); break;
        case 'deleteCols': s.deleteColumns(o.at, o.count || 1); break;
        case 'colWidth': s.setColumnWidth(o.at, Math.max(4, Number(o.size) || 104)); break;
        case 'rowHeight': s.setRowHeight(o.at, Math.max(4, Number(o.size) || 24)); break;
        case 'freeze': if (o.rows != null) s.setFrozenRows(o.rows); if (o.cols != null) s.setFrozenColumns(o.cols); break;
        default: {
          const r = s.getRange(o.range);
          if (o.op === 'values') r.setValues(o.values.map((row) => row.map((v) => (v === undefined ? null : v))));
          else if (o.op === 'clear') r.clearContent();
          else if (o.op === 'style') { const f = STYLE_KEYS[o.key]; if (!f) throw new Error(`Unknown style ${o.key}`); f(r, o.value); }
          else if (o.op === 'note') { if (o.value == null) r.deleteNote?.(); else r.createOrUpdateNote?.({ note: o.value, width: 160, height: 72 }); }
          else if (o.op === 'merge') (o.across ? r.mergeAcross() : r.merge());
          else if (o.op === 'unmerge') r.breakApart();
          else if (o.op === 'select') { s.activate(); r.activate(); }
          else throw new Error(`Unknown step ${o.op}`);
        }
      }
      done++;
    } catch (e) { onError(o, e); }
  }
  return done;
}
