// Folio Sheets — PivotTable fields (area 6), laid out like Excel's pane: the source's fields, then four areas
// (Filters, Columns, Rows, Values). The pivot is saved as a readable ```pivot Name``` block (core/pivot.js) and placed
// in a sheet; Data → Refresh all recomputes every pivot. Sources: a range, an FQL query, or a data model.
import { h, fill, section, hint, field, input, select, button, actions, preview, status, rangeInput } from './kit.js';
import { parsePivot, serializePivot, computePivot, distinct, AGG_LABEL } from '../../core/pivot.js';
import { parse } from '../../core/fql/parse.js';
import { runBlock } from './queries.js';
import { L } from '../i18n.js';

/** the grid of a pivot source: "Orders!A1:F99", "query Name", "model Name" */
export async function sourceGrid(surface, source) {
  const m = /^\s*(query|model)\s+(.+?)\s*$/i.exec(source || '');
  if (!m) return surface.read(source);
  const name = m[2].replace(/^`|`$/g, '');
  for (const b of surface.fences('fql')) {
    let p; try { p = parse(b.body, { name: b.name }); } catch { continue; }
    if (m[1].toLowerCase() === 'query' && p.queries.some((q) => q.name === name)) return (await runBlock(surface, b.body, b.name, { only: name })).results[name];
    if (m[1].toLowerCase() === 'model' && p.models.some((x) => x.name === name)) { const r = await runBlock(surface, b.body, b.name, { flat: name }); return r.flat; }
  }
  throw new Error(L('No {kind} named {name}.', { kind: m[1].toLowerCase(), name }));
}
async function place(surface, name, spec, grid) {
  const loads = { ...(surface.workbook().loads || {}) };
  const [sheet, cell] = spec.place.includes('!') ? spec.place.split('!') : [spec.place || `${name}`, 'A1'];
  loads[`pivot/${name}`] = surface.protection.unguarded(() => surface.write(sheet.replace(/^'|'$/g, ''), cell || 'A1', grid, { prev: loads[`pivot/${name}`] }));
  surface.setWorkbook({ loads });
}
export const actions_ = {
  async refreshAll({ surface, ctx }) {
    let n = 0;
    for (const b of surface.fences('pivot')) {
      try { const spec = parsePivot(b.body); const g = await sourceGrid(surface, spec.source); await place(surface, b.name, spec, computePivot(g, spec)); n++; }
      catch (e) { ctx.toast(L('PivotTable {name}: {error}', { name: b.name, error: e.message }), { kind: 'error' }); }
    }
    return n;
  },
};
export { actions_ as actions };

export default {
  title: 'PivotTable fields',
  mount(body, { surface, ctx, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    let name = opts.name || null;
    let spec = { source: '', rows: [], columns: [], values: [], filters: [], place: '', totals: 'both' };
    let grid = null;
    const st = status(); const out = h('div.xs-results');
    const existing = () => surface.fences('pivot');

    async function loadSource() {
      st.busy(L('Reading the source…'));
      try { grid = await sourceGrid(surface, spec.source); st.ok(L('{n} rows, {m} fields.', { n: Math.max(0, grid.length - 1), m: grid[0]?.length || 0 })); }
      catch (e) { grid = null; st.error(e.message); }
      render();
    }
    function start() {
      const list = existing();
      const sel = surface.selectionRef();
      const src = rangeInput(surface, opts.source || (sel.includes(':') ? sel : `${surface.sheetName()}!${surface.ws().getDataRange().getA1Notation()}`), { label: L('Table or range') });
      const queries = [];
      for (const b of surface.fences('fql')) { try { const p = parse(b.body, { name: b.name }); queries.push(...p.queries.map((q) => `query ${q.name}`), ...p.models.map((m) => `model ${m.name}`)); } catch { /* skip */ } }
      const srcSel = queries.length ? select([['', L('A range of this workbook')], ...queries.map((q) => [q, q])], opts.source && /^(query|model) /.test(opts.source) ? opts.source : '', { 'aria-label': L('Source') }) : null;
      fill(root, 
        section(L('Choose the data'), srcSel ? field(L('Source'), srcSel) : null, src, hint(L('The first row holds the field names.'))),
        actions(button(L('Create PivotTable'), async () => {
          spec = { ...spec, source: srcSel?.value || src.control.value };
          let n = 1; name = 'PivotTable'; while (existing().some((b) => b.name === name)) name = `PivotTable ${++n}`;
          spec.place = `'${name}'!A1`;
          await loadSource();
        }, { primary: true })),
        list.length ? section(L('PivotTables in this workbook'), h('ul.xs-list', list.map((b) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', b.name), h('div.xs-item-sub', parsePivot(b.body).source)), h('div.xs-item-actions', button(L('Edit'), () => edit(b.name), { quiet: true })))))) : null,
      );
    }
    async function edit(n) { const b = existing().find((x) => x.name === n); if (!b) return start(); name = n; spec = parsePivot(b.body); await loadSource(); }

    const AREAS = [['filters', 'Filters'], ['columns', 'Columns'], ['rows', 'Rows'], ['values', 'Values']];
    const inArea = (f) => AREAS.find(([a]) => (a === 'values' ? spec.values.some((v) => v.field === f) : a === 'filters' ? spec.filters.some((x) => x.field === f) : spec[a].includes(f)))?.[0];
    const isNum = (f) => { const i = grid[0].map(String).indexOf(f); return grid.slice(1, 50).some((r) => typeof r[i] === 'number'); };
    function removeField(f) { spec.rows = spec.rows.filter((x) => x !== f); spec.columns = spec.columns.filter((x) => x !== f); spec.values = spec.values.filter((x) => x.field !== f); spec.filters = spec.filters.filter((x) => x.field !== f); }
    function moveTo(f, area) {
      const agg = spec.values.find((v) => v.field === f)?.agg;
      removeField(f);
      if (area === 'values') spec.values.push({ agg: agg || (isNum(f) ? 'sum' : 'count'), field: f, as: '' });
      else if (area === 'filters') spec.filters.push({ field: f, not: false, values: distinct(grid, f) });
      else if (area) spec[area].push(f);
      render();
    }
    function chip(f, area) {
      const v = area === 'values' ? spec.values.find((x) => x.field === f) : null;
      const b = h('button.xs-chip', { type: 'button', 'aria-haspopup': 'menu', on: { click: (e) => ctx.showMenu(e.currentTarget, [
        ...AREAS.filter(([a]) => a !== area).map(([a, l]) => ({ label: L('Move to {area}', { area: L(l) }), run: () => moveTo(f, a) })),
        ...(area === 'values' ? ['-', { head: L('Summarise by') }, ...['sum', 'count', 'countunique', 'avg', 'min', 'max', 'median', 'stdev', 'sumfraction'].map((a) => ({ label: L(AGG_LABEL[a]), run: () => { v.agg = a; render(); } }))] : []),
        ...(area === 'filters' ? ['-', { label: L('Choose values…'), run: () => chooseValues(f) }] : []),
        '-', { label: L('Remove field'), run: () => { removeField(f); render(); } },
      ]) } }, area === 'values' ? `${L(AGG_LABEL[v.agg] || v.agg)} · ${f}` : f);
      return b;
    }
    async function chooseValues(f) {
      const flt = spec.filters.find((x) => x.field === f); const all = distinct(grid, f);
      const v = await ctx.prompt({ title: L('Show only these values of {field}', { field: f }), label: L('Values, separated by commas'), value: (flt.values.length ? flt.values : all).join(', '), action: L('Apply') });
      if (v == null) return; flt.values = v.split(',').map((x) => x.trim()).filter(Boolean); render();
    }
    function render() {
      if (!grid) return start();
      const fields = grid[0].map((c, i) => (c == null || c === '' ? `Column ${i + 1}` : String(c)));
      const search = input({ type: 'search', placeholder: L('Search fields'), 'aria-label': L('Search fields'), on: { input: () => { const q = search.value.toLowerCase(); for (const li of fl.children) li.hidden = !li.dataset.f.toLowerCase().includes(q); } } });
      const fl = h('ul.xs-fields', fields.map((f) => {
        const a = inArea(f);
        const box = h('input', { type: 'checkbox', checked: !!a, id: `pf-${f}`, on: { change: (e) => (e.target.checked ? moveTo(f, isNum(f) ? 'values' : 'rows') : (removeField(f), render())) } });
        return h('li', { 'data-f': f }, h('label', { for: `pf-${f}` }, box, h('span', f)), a ? h('span.xs-field-area', L(AREAS.find(([x]) => x === a)[1])) : null);
      }));
      const area = (a, l) => h('div.xs-area', { role: 'group', 'aria-label': L(l) }, h('div.xs-area-title', L(l)),
        h('div.xs-area-body', (a === 'values' ? spec.values.map((v) => v.field) : a === 'filters' ? spec.filters.map((x) => x.field) : spec[a]).map((f) => chip(f, a)), (a === 'values' ? spec.values : a === 'filters' ? spec.filters : spec[a]).length ? null : h('span.xs-area-empty', L('Use a field’s menu or tick it'))));
      let result = null, err = '';
      try { result = computePivot(grid, spec); } catch (e) { err = e.message; }
      const placeIn = input({ value: spec.place, 'aria-label': L('Place'), on: { change: () => { spec.place = placeIn.value.trim(); } } });
      const totals = select([['both', L('Rows and columns')], ['rows', L('Rows only')], ['columns', L('Columns only')], ['none', L('None')]], spec.totals || 'both', { on: { change: (e) => { spec.totals = e.target.value; render(); } } });
      fill(root, 
        h('div.xs-pivot-head', h('strong', name || L('New PivotTable')), h('span.xs-item-sub', spec.source)),
        search, fl,
        h('div.xs-areas', AREAS.map(([a, l]) => area(a, l))),
        field(L('Grand totals'), totals),
        field(L('Place in'), placeIn, L('A sheet name and cell, such as Pivot!A1. The sheet is created if needed.')),
        actions(button(L('Place in sheet'), async () => {
          if (!result) return st.error(err || L('Add a field to Rows or Values first.'));
          surface.setFence('pivot', name, serializePivot(spec));
          await place(surface, name, spec, result); st.ok(L('Saved as {name} and placed in {place}. Data → Refresh all updates it.', { name, place: spec.place }));
        }, { primary: true }), button(L('Change source'), () => { grid = null; start(); }, { quiet: true }),
        existing().some((b) => b.name === name) ? button(L('Delete'), () => { surface.setFence('pivot', name, null); grid = null; name = null; start(); }, { quiet: true }) : null),
        st,
        h('div.xs-results', err ? h('p.xs-hint', err) : result && (spec.rows.length || spec.values.length || spec.columns.length) ? preview(result, { max: 60, caption: L('Preview') }) : hint(L('Tick fields to build the table. Text fields go to Rows, numbers to Values; use a field’s menu to move it.'))),
        out,
      );
    }
    if (opts.edit) edit(opts.edit); else if (opts.source) { spec.source = opts.source; let n = 1; name = 'PivotTable'; while (existing().some((b) => b.name === name)) name = `PivotTable ${++n}`; spec.place = `'${name}'!A1`; loadSource(); } else start();
    return { update(o) { if (o.edit) edit(o.edit); else if (o.source) { spec.source = o.source; loadSource(); } }, refresh() {} };
  },
};
