// Folio Sheets — page setup (area 8): paper, orientation, margins, scale, print area, titles, gridlines and headings,
// saved with the workbook (`print` in the workbook settings) and used by every PDF export.
import { h, hint, field, select, button, actions, status, checkbox, rangeInput, segmented } from './kit.js';
import { L } from '../i18n.js';

export default {
  title: 'Page setup',
  mount(body, { surface }) {
    const root = h('div.xs-panel'); body.append(root);
    const p = () => surface.print();
    const set = (o) => surface.setPrint(o);
    const st = status();
    root.append(
      field(L('Paper'), select([['A4', 'A4'], ['A3', 'A3'], ['Letter', 'Letter'], ['Legal', 'Legal']], p().paper || 'A4', { on: { change: (e) => set({ paper: e.target.value }) } })),
      field(L('Orientation'), segmented([['portrait', L('Portrait')], ['landscape', L('Landscape')]], p().orientation || 'portrait', (v) => set({ orientation: v }), L('Orientation'))),
      field(L('Margins'), segmented([['normal', L('Normal')], ['wide', L('Wide')], ['narrow', L('Narrow')]], p().margins || 'normal', (v) => set({ margins: v }), L('Margins'))),
      field(L('Scale'), select([['1', L('Actual size')], ['width', L('Fit all columns')], ['0.75', '75%'], ['0.5', '50%']], p().fit || '1', { on: { change: (e) => set({ fit: e.target.value }) } })),
      rangeInput(surface, p().area || '', { label: L('Print area'), withSheet: false, onChange: (v) => set({ area: v || null }), help: L('Empty: the whole used range.') }),
      rangeInput(surface, p().repeatRows || '', { label: L('Rows to repeat on every page'), withSheet: false, onChange: (v) => set({ repeatRows: v || null }), help: L('Such as 1:1 for the header row.') }),
      checkbox(L('Print gridlines'), !!p().gridlines, (v) => set({ gridlines: v || null })),
      checkbox(L('Print row and column headings'), !!p().headings, (v) => set({ headings: v || null })),
      actions(button(L('Export PDF'), async () => { st.busy(L('Making the PDF…')); try { await surface.exportPdf(); st.clear(); } catch (e) { st.error(e.message); } }, { primary: true })),
      st, hint(L('These settings are saved with the workbook.')),
    );
    return {};
  },
};
