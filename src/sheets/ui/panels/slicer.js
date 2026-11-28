// Folio Sheets — slicers and timelines (area 22): buttons over the grid that filter a table by one column, or by a
// span of months. They drive Univer's filter (sheets-filter), drawn by floats.js and saved in the sheet's meta.
import { h, fill, section, hint, field, select, button, actions, rangeInput, input } from './kit.js';
import { asDate } from '../floats.js';
import { L } from '../i18n.js';

export default {
  title: 'Slicers and timelines',
  mount(body, { surface, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    function render(kind = opts.kind || 'slicer') {
      const sel = surface.selectionRef({ withSheet: false });
      const src = rangeInput(surface, sel.includes(':') ? sel : surface.ws().getDataRange().getA1Notation(), { label: L('Table or range'), withSheet: false, onChange: () => fillCols() });
      const colSel = select([], '', { 'aria-label': L('Column') });
      const title = input({ placeholder: L('Same as the column') });
      const fillCols = () => {
        const cols = surface.floats.columns(src.control.value);
        colSel.replaceChildren(...cols.map((c, i) => {
          const isDate = (() => { try { return surface.read(src.control.value).slice(1, 20).some((r) => asDate(r[i])); } catch { return false; } })();
          return h('option', { value: c, selected: kind === 'timeline' ? isDate : i === 0 }, c);
        }));
      };
      const list = surface.meta().slicers || [];
      fill(root, 
        section(kind === 'timeline' ? L('New timeline') : L('New slicer'),
          hint(kind === 'timeline' ? L('A timeline filters the table to a span of months of a date column. Shift-click a second month to choose a span.') : L('A slicer shows the values of one column as buttons; clicking one filters the table. Ctrl-click to choose several.')),
          src, field(L('Column'), colSel), field(L('Title'), title),
          actions(button(kind === 'timeline' ? L('Insert timeline') : L('Insert slicer'), () => { if (!colSel.value) return; surface.floats.addSlicer({ kind, source: src.control.value, column: colSel.value, title: title.value.trim() }); render(kind); }, { primary: true }),
            button(kind === 'timeline' ? L('New slicer instead') : L('New timeline instead'), () => render(kind === 'timeline' ? 'slicer' : 'timeline'), { quiet: true }))),
        list.length ? section(L('On this sheet'), h('ul.xs-list', list.map((s, i) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', `${s.kind === 'timeline' ? L('Timeline') : L('Slicer')}: ${s.title || s.column}`), h('div.xs-item-sub', `${s.source} · ${s.selected?.length ? L('{n} selected', { n: s.selected.length }) : L('showing all')}`)),
          h('div.xs-item-actions', button(L('Delete'), () => { surface.floats.remove(surface.sheetId(), 'slicers', i); render(kind); }, { quiet: true })))))) : null,
      );
      fillCols();
    }
    render();
    return { update(o) { render(o.kind); } };
  },
};
