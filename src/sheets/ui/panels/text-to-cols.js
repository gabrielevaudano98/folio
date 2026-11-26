// Folio Sheets — Text to columns (area 1): split one column by a separator into the columns to its right, with a
// preview, as Excel's Data → Text to Columns.
import { h, fill, hint, field, input, button, actions, status, preview, checkbox, segmented } from './kit.js';
import { addr } from '../../core/a1.js';
import { L } from '../i18n.js';

export function splitText(values, sep, { trim = true, numbers = true } = {}) {
  const re = sep === 'space' ? /\s+/ : sep === 'tab' ? /\t/ : null;
  return values.map((v) => (v == null ? [''] : String(v).split(re || sep).map((x) => { const s = trim ? x.trim() : x; return numbers && s !== '' && Number.isFinite(Number(s.replace(',', '.'))) && /^-?[\d.,]+$/.test(s) ? Number(s.replace(',', '.')) : s; })));
}

export default {
  title: 'Text to columns',
  mount(body, { surface }) {
    const root = h('div.xs-panel'); body.append(root);
    let sep = ',';
    const other = input({ placeholder: ';', 'aria-label': L('Other separator') });
    const trim = checkbox(L('Trim spaces'), true), nums = checkbox(L('Convert numbers'), true);
    const out = h('div.xs-results'); const st = status();
    const values = () => { const r = surface.range(); return surface.ws().getRange(r.getRow(), r.getColumn(), r.getHeight(), 1).getRawValues().map((x) => x[0]); };
    const compute = () => splitText(values(), sep === 'other' ? other.value || ';' : sep, { trim: trim.control.checked, numbers: nums.control.checked });
    const draw = () => { const g = compute(); const w = Math.max(...g.map((x) => x.length)); fill(out, preview([Array.from({ length: w }, (_, i) => L('Column {n}', { n: i + 1 })), ...g], { max: 20 })); };
    root.append(hint(L('Splits the first selected column. The parts go into that column and the ones to its right; cells there are overwritten.')),
      field(L('Separator'), segmented([[',', L('Comma')], [';', L('Semicolon')], ['tab', L('Tab')], ['space', L('Space')], ['other', L('Other')]], sep, (v) => { sep = v; draw(); }, L('Separator'))),
      field(L('Other separator'), other), trim, nums,
      actions(button(L('Preview'), draw), button(L('Split'), () => {
        const r = surface.range(); const g = compute(); const w = Math.max(...g.map((x) => x.length));
        surface.applyOps([{ op: 'values', sheet: surface.sheetName(), range: `${addr(r.getRow(), r.getColumn())}:${addr(r.getRow() + g.length - 1, r.getColumn() + w - 1)}`, values: g.map((x) => Array.from({ length: w }, (_, i) => x[i] ?? null)) }]);
        st.ok(L('Split into {n} columns.', { n: w }));
      }, { primary: true })), st, out);
    other.addEventListener('input', () => { if (sep === 'other') draw(); });
    draw();
    return {};
  },
};
