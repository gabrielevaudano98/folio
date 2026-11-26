// Folio Sheets — chart settings (area 7): type, data, title, series by rows or columns, stacking. Charts are drawn by
// Apache ECharts over the grid (charts.js) and saved in the sheet's meta, the same spec Folio pages and slides use.
import { h, fill, section, hint, field, input, select, button, actions, rangeInput, checkbox, segmented } from './kit.js';
import { L } from '../i18n.js';

const TYPES = [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['doughnut', 'Doughnut'], ['scatter', 'Scatter'], ['radar', 'Radar'], ['funnel', 'Funnel']];

export default {
  title: 'Chart',
  mount(body, { surface, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    let key = opts.key || null;
    function render() {
      const list = surface.charts.list();
      if (!key || !surface.charts.specOf(key)) {
        fill(root, 
          section(L('Insert a chart'), hint(L('Select the data with its header row, then choose a type.')), h('div.xs-type-grid', TYPES.map(([t, l]) => button(L(l), () => { surface.addChart(t); key = surface.charts.list().at(-1); render(); }, { quiet: true, icon: surface.icons[{ column: 'colChart', bar: 'barChart', line: 'lineChart', area: 'areaChart', pie: 'pieChart', doughnut: 'pieChart', scatter: 'scatter', radar: 'trend', funnel: 'filter' }[t]] })))),
          list.length ? section(L('Charts in this workbook'), h('ul.xs-list', list.map((k) => { const s = surface.charts.specOf(k); return h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', s.title || L(TYPES.find(([t]) => t === s.type)?.[1] || 'Chart')), h('div.xs-item-sub', s.range)), h('div.xs-item-actions', button(L('Edit'), () => { key = k; render(); }, { quiet: true }))); }))) : null,
        );
        return;
      }
      const s = surface.charts.specOf(key);
      const up = (patch) => surface.charts.update(key, patch);
      const title = input({ value: s.title || '', on: { change: () => up({ title: title.value }) } });
      fill(root, 
        field(L('Type'), select(TYPES.map(([t, l]) => [t, L(l)]), s.type || 'column', { on: { change: (e) => up({ type: e.target.value }) } })),
        field(L('Title'), title),
        rangeInput(surface, s.range, { label: L('Data'), withSheet: false, onChange: (v) => up({ range: v }), help: L('Row 1 names the series, column A the categories.') }),
        field(L('Series in'), segmented([['columns', L('Columns')], ['rows', L('Rows')]], s.by || 'columns', (v) => up({ by: v === 'columns' ? null : v }), L('Series in'))),
        ['column', 'bar', 'area', 'line'].includes(s.type || 'column') ? checkbox(L('Stacked'), !!s.stacked, (on) => up({ stacked: on || null })) : null,
        actions(button(L('Done'), () => { key = null; render(); }, { primary: true }), button(L('Delete chart'), () => { surface.charts.remove(key); key = null; render(); }, { quiet: true })),
        hint(L('Drag the chart to move it; drag a corner to resize it.')),
      );
    }
    render();
    return { update(o) { if (o.key) { key = o.key; render(); } else if (o.type) { key = null; render(); } } };
  },
};
