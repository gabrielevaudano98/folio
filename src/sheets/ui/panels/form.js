// Folio Sheets — data form (area 17): one record of a table at a time, with a field per column, as Excel's Form.
// Fields follow the column's data validation: a list becomes a drop-down, a checkbox a switch. Every change is a
// normal grid edit (undoable, saved).
import { h, fill, hint, field, input, select, button, actions, status, rangeInput } from './kit.js';
import { toRange, colName } from '../../core/a1.js';
import { L } from '../i18n.js';

export default {
  title: 'Data form',
  mount(body, { surface }) {
    const root = h('div.xs-panel'); body.append(root);
    let src = surface.ws().getDataRange().getA1Notation(), at = 1;
    function render() {
      let r; try { r = toRange(src); } catch { r = null; }
      const s = surface.ws();
      const pick = rangeInput(surface, src, { label: L('Table'), withSheet: false, onChange: (v) => { src = v; at = 1; render(); } });
      if (!r) { fill(root, pick); return; }
      const w = r.endColumn - r.startColumn + 1;
      const head = s.getRange(r.startRow, r.startColumn, 1, w).getRawValues()[0].map((x, i) => String(x ?? colName(r.startColumn + i)));
      const count = r.endRow - r.startRow;
      at = Math.max(1, Math.min(at, count + 1));
      const row = r.startRow + at;
      const isNew = at > count;
      const vals = isNew ? head.map(() => null) : s.getRange(row, r.startColumn, 1, w).getRawValues()[0];
      const fs = s.getRange(row, r.startColumn, 1, w).getFormulas?.()?.[0] || [];
      const st = status();
      const controls = head.map((name, i) => {
        const dv = s.getRange(row, r.startColumn + i).getDataValidation?.();
        const crit = dv?.getCriteriaType?.(); const list = crit === 'list' ? String(dv.getCriteriaValues?.()?.[1] || '').split(',').map((x) => x.trim()).filter(Boolean) : null;
        const c = fs[i] ? input({ value: fs[i], readOnly: true, title: L('Computed by a formula') })
          : list ? select([['', '—'], ...list.map((x) => [x, x])], vals[i] ?? '')
          : input({ value: vals[i] ?? '', inputmode: typeof vals[i] === 'number' ? 'decimal' : null });
        return field(name, c);
      });
      const write = (target) => {
        const values = [controls.map((f, i) => { if (fs[i]) return fs[i]; const v = f.control.value; return v === '' ? null : Number.isFinite(Number(v)) && /^-?[\d.]+(e-?\d+)?$/i.test(v) ? Number(v) : v; })];
        surface.applyOps([{ op: 'values', sheet: surface.sheetName(), range: `${colName(r.startColumn)}${target + 1}:${colName(r.endColumn)}${target + 1}`, values }]);
      };
      fill(root, pick,
        h('div.xs-form-head', h('strong', isNew ? L('New record') : L('Record {n} of {m}', { n: at, m: count })), h('div.xs-form-nav',
          button('', () => { at = 1; render(); }, { quiet: true, title: L('First'), icon: surface.icons.undo, disabled: at <= 1 }),
          button(L('Previous'), () => { at--; render(); }, { quiet: true, disabled: at <= 1 }),
          button(L('Next'), () => { at++; render(); }, { quiet: true, disabled: at > count }))),
        h('form.xs-form', { on: { submit: (e) => { e.preventDefault(); write(row); if (isNew) { src = `${colName(r.startColumn)}${r.startRow + 1}:${colName(r.endColumn)}${r.endRow + 2}`; } st.ok(isNew ? L('Record added.') : L('Record saved.')); render(); } } }, controls,
          actions(h('button.btn.btn-primary', { type: 'submit' }, isNew ? L('Add record') : L('Save record')), isNew ? null : button(L('New record'), () => { at = count + 1; render(); }, { quiet: true }),
            isNew ? null : button(L('Clear record'), () => { surface.applyOps([{ op: 'clear', sheet: surface.sheetName(), range: `${colName(r.startColumn)}${row + 1}:${colName(r.endColumn)}${row + 1}` }]); render(); }, { quiet: true }))),
        st, hint(L('Enter saves the record; formula columns are shown but not edited.')));
    }
    render();
    return { refresh: render };
  },
};
