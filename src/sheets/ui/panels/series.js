// Folio Sheets — Fill series (area 1): linear, growth or dates, down the rows or across the columns, from the first
// selected cell, until a stop value or the end of the selection, as Excel's Home → Fill → Series.
import { h, hint, field, number, button, actions, status, segmented } from './kit.js';
import { addr } from '../../core/a1.js';
import { L } from '../i18n.js';

/** values of a series: kind linear | growth | day | weekday | month | year */
export function series(start, { kind = 'linear', step = 1, stop = null, count = 10 }) {
  const out = []; const lim = Math.min(count, 100000);
  const toD = (v) => new Date(Math.round((v - 25569) * 864e5)), toN = (d) => d.getTime() / 864e5 + 25569;
  const d0 = toD(Number(start));
  /** start + n months, the day kept or clamped to the month's last day (Excel's EDATE) */
  const addMonths = (n) => { const y = d0.getUTCFullYear(), m = d0.getUTCMonth() + n; const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return toN(new Date(Date.UTC(y, m, Math.min(d0.getUTCDate(), last)))); };
  let v = Number(start);
  for (let i = 0; i < lim; i++) {
    if (kind === 'month') v = addMonths(i * step);
    else if (kind === 'year') v = addMonths(12 * i * step);
    if (stop != null && (step >= 0 ? v > stop : v < stop)) break;
    out.push(Math.round(v * 1e10) / 1e10);
    if (kind === 'linear') v += step;
    else if (kind === 'growth') v *= step;
    else if (kind === 'day') v += step;
    else if (kind === 'weekday') { const d = toD(v); let n = step; while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n--; } v = toN(d); }
  }
  return out;
}

export default {
  title: 'Series',
  mount(body, { surface }) {
    const root = h('div.xs-panel'); body.append(root);
    const r = surface.range();
    let dir = r && r.getWidth() > r.getHeight() ? 'cols' : 'rows', kind = 'linear';
    const step = number({ value: 1 }), stop = number({ placeholder: L('End of the selection') });
    const st = status();
    root.append(hint(L('Starts from the first selected cell.')),
      field(L('Series in'), segmented([['rows', L('Rows')], ['cols', L('Columns')]], dir, (v) => { dir = v; }, L('Series in'))),
      field(L('Type'), segmented([['linear', L('Linear')], ['growth', L('Growth')], ['day', L('Days')], ['weekday', L('Weekdays')], ['month', L('Months')], ['year', L('Years')]], kind, (v) => { kind = v; }, L('Type'))),
      field(L('Step'), step), field(L('Stop value'), stop),
      actions(button(L('Fill'), () => {
        const sel = surface.range(); const s = surface.ws(); const first = s.getRange(sel.getRow(), sel.getColumn()).getValue();
        if (typeof first !== 'number') return st.error(L('The first cell must hold a number or a date.'));
        const count = stop.value !== '' ? 100000 : (dir === 'rows' ? sel.getHeight() : sel.getWidth());
        const vals = series(first, { kind, step: Number(step.value) || 1, stop: stop.value === '' ? null : Number(stop.value), count });
        const end = dir === 'rows' ? addr(sel.getRow() + vals.length - 1, sel.getColumn()) : addr(sel.getRow(), sel.getColumn() + vals.length - 1);
        surface.applyOps([{ op: 'values', sheet: surface.sheetName(), range: `${addr(sel.getRow(), sel.getColumn())}:${end}`, values: dir === 'rows' ? vals.map((v) => [v]) : [vals] }]);
        st.ok(L('{n} values filled.', { n: vals.length }));
      }, { primary: true })), st);
    return {};
  },
};
