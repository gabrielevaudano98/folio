// Folio Sheets — the data model: Power Pivot for Folio (area 12). A model is FQL too:
//   model Sales
//     table Orders = query Clean            tables come from queries, sheets or files
//     table Regions = from sheet "Regions"
//     relate Orders.Region -> Regions.Code  many-to-one relations
//     measure Revenue = sum(Orders.Total)   measures, which may use other measures
// The panel shows tables, relations and measures, adds measures, and explores the model: measures by any column of
// any related table, the result loaded into a sheet or used as a PivotTable source.
import { h, fill, section, hint, field, input, select, button, actions, preview, status, checkbox } from './kit.js';
import { parse } from '../../core/fql/parse.js';
import { runBlock } from './queries.js';
import { L } from '../i18n.js';

function models(surface) {
  const out = [];
  for (const b of surface.fences('fql')) { try { for (const m of parse(b.body, { name: b.name }).models) out.push({ block: b, model: m }); } catch { /* a broken block is shown in Queries */ } }
  return out;
}
/** insert a line at the end of a model's indented block */
export function addToModel(body, model, line) {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^\\s*model\\s+\`?${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`?\\s*$`).test(l));
  if (i < 0) throw new Error(L('No model named {name}.', { name: model }));
  let j = i + 1; while (j < lines.length && /^\s+\S/.test(lines[j])) j++;
  lines.splice(j, 0, `  ${line}`);
  return lines.join('\n');
}
const q = (n) => (/^[A-Za-z_][\w]*$/.test(n) ? n : `\`${n}\``);

export default {
  title: 'Data model',
  mount(body, { surface, ctx }) {
    const root = h('div.xs-panel'); body.append(root);
    let pick = null;
    function render() {
      const list = models(surface);
      if (!list.length) {
        const tables = surface.sheetNames();
        const chosen = new Set(tables.slice(0, 2));
        fill(root, 
          h('div.xs-empty-state', h('p', L('No data model yet.')), hint(L('A data model joins tables by their keys and defines measures once, so every PivotTable and report computes them the same way.'))),
          section(L('Start a model from these sheets'), h('div.xs-checks', tables.map((t) => checkbox(t, chosen.has(t), (on) => (on ? chosen.add(t) : chosen.delete(t)))))),
          actions(button(L('Create model'), () => {
            const name = 'Model'; const body0 = [`model ${name}`, ...[...chosen].map((t) => `  table ${q(t)} = from sheet "${t}"`), `  -- relate ${q([...chosen][0] || 'Facts')}.Key -> ${q([...chosen][1] || 'Dimension')}.Key`, `  measure Rows = count(${q([...chosen][0] || 'Facts')})`].join('\n');
            surface.setFence('fql', 'Model', body0); render();
          }, { primary: true })),
        );
        return;
      }
      pick ||= list[0].model.name;
      const cur = list.find((x) => x.model.name === pick) || list[0];
      const m = cur.model;
      const st = status(); const out = h('div.xs-results');
      const measureBoxes = m.measures.map((x) => checkbox(x.name, true));
      const bySel = select([['', L('(no grouping)')]], '', { 'aria-label': L('Group by') });
      const bySel2 = select([['', L('(none)')]], '', { 'aria-label': L('Then by') });
      const loadCols = async () => {
        try {
          const flat = await runBlock(surface, cur.block.body, cur.block.name, { flat: m.name });
          const cols = (flat.flat?.[0] || []).filter((c) => String(c).includes('.'));
          for (const s of [bySel, bySel2]) s.append(...cols.map((c) => h('option', { value: c }, c)));
          st.ok(L('{n} rows in the model.', { n: Math.max(0, (flat.flat?.length || 1) - 1) }));
        } catch (e) { st.error(e.message); }
      };
      const explore = async (load) => {
        const ms = measureBoxes.filter((b) => b.control.checked).map((b) => q(b.querySelector('span').textContent));
        if (!ms.length) return st.error(L('Choose at least one measure.'));
        const by = [bySel.value, bySel2.value].filter(Boolean).map((c) => c.split('.').map(q).join('.'));
        const src = `${cur.block.body}\n\nquery __Explore = from model ${q(m.name)} evaluate ${ms.join(', ')}${by.length ? ` by ${by.join(', ')}` : ''}`;
        st.busy(L('Computing…'));
        try {
          const res = await runBlock(surface, src, cur.block.name, { only: '__Explore' });
          const grid = res.results.__Explore;
          fill(out, preview(grid, { max: 200 }));
          if (load) { const sheet = await ctx.prompt({ title: L('Load into a sheet'), label: L('Sheet name'), value: `${m.name} report`, action: L('Load') }); if (sheet) { surface.protection.unguarded(() => surface.write(sheet, 'A1', grid)); st.ok(L('Loaded into {sheet}.', { sheet })); return; } }
          st.ok(L('{n} rows.', { n: grid.length - 1 }));
        } catch (e) { st.error(e.plain || e.message); }
      };
      const mName = input({ placeholder: L('Margin') }), mExpr = input({ placeholder: 'sum(Orders.Total) - sum(Orders.Cost)' });
      fill(root, 
        list.length > 1 ? field(L('Model'), select(list.map((x) => [x.model.name, x.model.name]), pick, { on: { change: (e) => { pick = e.target.value; render(); } } })) : null,
        section(L('Tables'), h('ul.xs-list.xs-compact', m.tables.map((t) => h('li', h('strong', t.name), h('span.xs-item-sub', ` ${describeSource(t.source)}`))))),
        section(L('Relations'), m.relations.length ? h('ul.xs-list.xs-compact', m.relations.map((r) => h('li', `${r.from.table}.${r.from.col} → ${r.to.table}.${r.to.col}`))) : hint(L('No relations: each table is used on its own.'))),
        section(L('Measures'), m.measures.length ? h('ul.xs-list.xs-compact', m.measures.map((x) => h('li', h('strong', x.name)))) : hint(L('No measures yet.')),
          h('div.xs-inline-form', field(L('New measure'), mName), field(L('Formula'), mExpr), button(L('Add'), () => {
            if (!mName.value.trim() || !mExpr.value.trim()) return;
            try { const nb = addToModel(cur.block.body, m.name, `measure ${q(mName.value.trim())} = ${mExpr.value.trim()}`); parse(nb, { name: cur.block.name }); surface.setFence('fql', cur.block.name, nb); render(); }
            catch (e) { ctx.toast(e.plain || e.message, { kind: 'error' }); }
          }))),
        section(L('Explore'), h('div.xs-checks', measureBoxes), field(L('Group by'), bySel), field(L('Then by'), bySel2),
          actions(button(L('Show'), () => explore(false)), button(L('Load into a sheet'), () => explore(true), { primary: true }), button(L('PivotTable from this model'), () => surface.panels.open('pivot', { source: `model ${m.name}` }), { quiet: true })), st, out),
        h('p.xs-hint', L('The model is saved in the query block {name}; edit it there for anything this panel does not cover.', { name: cur.block.name })),
      );
      loadCols();
    }
    render();
    return { refresh: render };
  },
};
function describeSource(s) {
  if (!s) return '';
  switch (s.kind) { case 'sheet': return L('from sheet {name}', { name: s.sheet }); case 'query': return L('from query {name}', { name: s.name }); case 'csv': case 'json': case 'xlsx': case 'parquet': return L('from {file}', { file: s.path }); case 'sql': return L('from SQL'); default: return s.kind; }
}
