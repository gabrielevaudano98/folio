// Folio Sheets — Queries and connections: Power Query for Folio (areas 10 and 11).
// Queries are FQL (docs/sheets/FQL.md) in ```fql Name``` blocks of the workbook. The panel lists them, edits them with
// a highlighted editor, previews every query, and loads results into sheets. FQL runs in the data engine (Arquero),
// with DuckDB for SQL, Parquet and database files when that component is installed.
import { h, fill, section, hint, field, input, button, actions as row, preview, status, codeEditor, tabs, segmented } from './kit.js';
import { parse, inputsOf, FqlError } from '../../core/fql/parse.js';
import { components } from '../engine-client.js';
import { L } from '../i18n.js';

const STARTERS = {
  csv: (p = 'data/sales.csv') => `from csv "${p}"\n| where Qty > 0\n| load to sheet "Sales" at A1`,
  xlsx: (p = 'data/book.xlsx') => `from xlsx "${p}" sheet "Sheet1"\n| load to sheet "Imported" at A1`,
  json: (p = 'data/items.json') => `from json "${p}"\n| load to sheet "Items" at A1`,
  parquet: (p = 'data/events.parquet') => `from parquet "${p}"\n| limit 1000\n| load to sheet "Events" at A1`,
  sql: () => `from sql "SELECT region, sum(amount) AS total FROM read_csv('data/sales.csv') GROUP BY region"\n| orderby -total\n| load to sheet "By region" at A1`,
  sheet: (_, ref) => `from sheet "${ref.sheet}"${ref.range ? ` range ${ref.range}` : ''}\n| derive Total = Qty * Price\n| groupby Region\n| rollup Revenue = sum(Total), Orders = count()\n| orderby -Revenue\n| load to sheet "Summary" at A1`,
  blank: () => `-- a query: a source, then steps joined by |\nfrom values([["Name", "Value"], ["a", 1], ["b", 2]])\n| load to sheet "Query" at A1`,
};

/** gather what a program needs (sheets as the person sees them, file paths) and run it in the engine */
export async function runBlock(surface, body, name, { onProgress, flat = null, only = null } = {}) {
  const program = parse(body, { name });
  const ins = inputsOf(program);
  const sheets = {};
  for (const s of ins.sheets) {
    const k = s.range ? `${s.sheet}!${s.range}` : s.sheet;
    if (!surface.sheetNames().includes(s.sheet)) continue; // the engine names the missing sheet
    sheets[k] = s.range ? surface.read(`'${s.sheet.replace(/'/g, "''")}'!${s.range}`) : surface.readSheet(s.sheet);
  }
  return surface.call('fql.run', { src: body, name, sheets, files: ins.files.map((f) => f.path), flat, only }, { onProgress });
}
/** write every `load to sheet` of a run into the grid, clearing what the previous load of the same query wrote */
export function applyLoads(surface, block, res) {
  const loads = { ...(surface.workbook().loads || {}) }; let n = 0;
  for (const ld of res.loads || []) {
    const grid = res.results[ld.query]; if (!grid) continue;
    const key = `${block}/${ld.query}`;
    const sheet = ld.to === 'table' ? ld.name : ld.sheet;
    if (ld.to === 'model') continue;
    loads[key] = surface.protection.unguarded(() => surface.write(sheet, ld.to === 'table' ? 'A1' : ld.cell || 'A1', grid, { prev: loads[key] }));
    n++;
  }
  surface.setWorkbook({ loads });
  return n;
}
const where = (e) => (e?.at ? L('line {line}, column {col}', e.at) : '');

export const actions = {
  /** Data → Refresh all: run every query block and load the results */
  async refreshAll({ surface, ctx }) {
    const blocks = surface.fences('fql'); if (!blocks.length) return 0;
    let loaded = 0;
    for (const b of blocks) {
      try { const res = await runBlock(surface, b.body, b.name || 'Query'); loaded += applyLoads(surface, b.name || 'Query', res); }
      catch (e) { ctx.toast(L('Query {name}: {error}', { name: b.name || 'Query', error: e.message }), { kind: 'error' }); }
    }
    if (loaded) ctx.toast(L('{n} query results refreshed.', { n: loaded }));
    return loaded;
  },
};

export default {
  title: 'Queries and connections',
  mount(body, { surface, ctx, opts }) {
    let editing = null, ed = null;
    const root = h('div.xs-panel');
    body.append(root);

    function list() {
      ed?.destroy(); ed = null; editing = null;
      const blocks = surface.fences('fql');
      const st = status();
      const items = blocks.map((b) => {
        let names = []; let err = '';
        try {
          const p = parse(b.body, { name: b.name || 'Query' });
          const loadOf = (q) => { const ld = q.steps?.find((x) => x.op === 'load'); return !ld ? '' : ld.to === 'sheet' ? ` → ${ld.sheet}!${ld.cell || 'A1'}` : ld.to === 'table' ? ` → ${ld.name}` : ` → ${L('model')}`; };
          names = [...p.queries.map((q) => (p.queries.length === 1 && q.name === b.name ? L('Query') : q.name) + loadOf(q)), ...p.models.map((m) => L('model {name}', { name: m.name }))];
        } catch (e) { err = e.plain || e.message; }
        return h('li.xs-item',
          h('div.xs-item-main', h('div.xs-item-title', b.name || L('Untitled query')), h('div.xs-item-sub', err ? L('Error: {error}', { error: err }) : names.join(' · '))),
          h('div.xs-item-actions',
            button('', () => runOne(b, st), { quiet: true, icon: surface.icons.refresh, title: L('Run and load') }),
            button('', () => edit(b.name), { quiet: true, icon: surface.icons.code, title: L('Edit') }),
            button('', async () => { if (await ctx.confirm?.({ title: L('Delete query {name}?', { name: b.name }), body: L('The data it loaded stays in the sheets.'), action: L('Delete') }) !== false) { surface.setFence('fql', b.name, null); list(); } }, { quiet: true, icon: surface.icons.deleteRows, title: L('Delete') })));
      });
      fill(root, 
        tabs([['queries', L('Queries')], ['connections', L('Connections')]], opts.tab || 'queries', (id) => (id === 'queries'
          ? h('div',
            row(button(L('New query'), (e) => newMenu(e.currentTarget), { primary: true, icon: surface.icons.plus }), button(L('Refresh all'), async () => { st.busy(L('Refreshing…')); try { const n = await actions.refreshAll({ surface, ctx }); st.ok(L('{n} results loaded.', { n })); } catch (e) { st.error(e.message); } }, { icon: surface.icons.refresh })),
            st,
            blocks.length ? h('ul.xs-list', items) : h('div.xs-empty-state', h('p', L('No queries yet.')), hint(L('A query gets data from a sheet, a CSV, Excel, JSON or Parquet file, or SQL, transforms it step by step and loads the result into a sheet. Queries are saved in the workbook as readable FQL.'))))
          : connections())),
      );
      if (opts.source && !editing) { const s = opts.source; opts.source = null; create(s); }
    }
    async function runOne(b, st) {
      st.busy(L('Running {name}…', { name: b.name }));
      try { const res = await runBlock(surface, b.body, b.name || 'Query'); const n = applyLoads(surface, b.name || 'Query', res); st.ok(L('{name}: {n} results loaded.', { name: b.name, n })); }
      catch (e) { st.error(`${e.message}`); }
    }
    function newMenu(anchor) {
      ctx.showMenu(anchor, [
        { head: L('From a file') }, ...[['csv', 'Text or CSV…'], ['xlsx', 'Excel workbook…'], ['json', 'JSON…'], ['parquet', 'Parquet…']].map(([k, l]) => ({ label: L(l), run: () => create(k) })),
        { head: L('Other sources') }, { label: L('SQL (DuckDB)…'), run: () => create('sql') }, { label: L('From this workbook'), run: () => create('sheet') }, { label: L('Blank query'), run: () => create('blank') },
      ]);
    }
    async function create(kind) {
      let path = null;
      if (['csv', 'xlsx', 'json', 'parquet'].includes(kind)) {
        path = await ctx.prompt({ title: L('File in this folder'), label: L('Path relative to this workbook'), value: { csv: 'data/sales.csv', xlsx: 'data/book.xlsx', json: 'data/items.json', parquet: 'data/events.parquet' }[kind], hint: L('Files must be inside the open folder.'), action: L('Next') });
        if (!path) return;
      }
      const names = surface.fences('fql').map((f) => f.name);
      let name = { csv: 'Sales', xlsx: 'Imported', json: 'Items', parquet: 'Events', sql: 'By region', sheet: 'Summary', blank: 'Query' }[kind]; let n = 1; const base = name;
      while (names.includes(name)) name = `${base} ${++n}`;
      const sel = surface.selectionRef({ withSheet: false });
      const body0 = STARTERS[kind](path, { sheet: surface.sheetName(), range: sel.includes(':') ? sel : '' });
      surface.setFence('fql', name, body0);
      edit(name);
    }
    async function edit(name) {
      const b = surface.fences('fql').find((f) => f.name === name); if (!b) return list();
      editing = name; let draft = b.body; let last = null;
      const nameIn = input({ value: name, 'aria-label': L('Query name') });
      const st = status();
      const out = h('div.xs-results');
      const holder = h('div.xs-code-holder');
      const save = (body2 = draft) => {
        const nn = nameIn.value.trim() || name;
        if (nn !== editing) { surface.setFence('fql', editing, null); editing = nn; }
        surface.setFence('fql', editing, body2);
      };
      const run = async (load) => {
        st.busy(L('Running…'));
        try {
          parse(draft, { name: nameIn.value.trim() || name });
          const res = await runBlock(surface, draft, nameIn.value.trim() || name); last = res;
          const qs = Object.keys(res.results);
          const pick = h('div');
          const show = (q) => fill(pick, h('p.xs-hint', L('{rows} rows, {cols} columns', { rows: Math.max(0, res.results[q].length - 1), cols: res.results[q][0]?.length || 0 }) + (res.timings?.[q] != null ? ` · ${res.timings[q]} ms` : '')), preview(res.results[q], { max: 100, caption: q }));
          fill(out, qs.length > 1 ? segmented(qs.map((q) => [q, q]), qs.at(-1), show, L('Query')) : '', pick);
          show(qs.at(-1));
          if (load) { save(); const n = applyLoads(surface, editing, res); st.ok(n ? L('Saved. {n} results loaded into the sheets.', { n }) : L('Saved. Add "| load to sheet" to put the result in a sheet.')); }
          else st.ok(L('Preview ready. Nothing was written to the sheets.'));
        } catch (e) { st.error(`${e.plain || e.message}${e.at ? ` (${where(e)})` : e.line ? ` (${L('line {line}', { line: e.line })})` : ''}`); }
      };
      fill(root, 
        row(button(L('Back to queries'), () => { save(); list(); }, { quiet: true, icon: surface.icons.undo })),
        field(L('Name'), nameIn),
        h('div.field.xs-field', h('label', L('Steps (FQL)')), holder),
        row(button(L('Preview'), () => run(false), { icon: surface.icons.play }), button(L('Save and load'), () => run(true), { primary: true })),
        st, out,
        h('details.xs-help', h('summary', L('FQL at a glance')), h('pre.xs-cheat', 'from sheet "Orders" range A1:F99 | csv "f.csv" | xlsx "f.xlsx" sheet "S" | json | parquet | sql "…" on "db.duckdb"\n| where Qty > 0 and Region in ("EU", "US")\n| derive Total = Qty * Price, Year = year(Date)\n| groupby Region | rollup Revenue = sum(Total), N = count()\n| join Other on Region = Code left\n| pivot Month by Total | unpivot Q1, Q2 as Quarter, Value\n| fill down Region | dedupe | type Qty as number | split Name by " " into First, Last\n| orderby -Revenue | limit 10\n| load to sheet "Summary" at B2')),
      );
      ed = await codeEditor(holder, { value: draft, lang: 'fql', label: L('Query steps'), minLines: 10, onChange: (v) => { draft = v; } });
      void last;
    }
    function connections() {
      const wrap = h('div');
      const files = new Map();
      for (const b of surface.fences('fql')) { try { for (const f of inputsOf(parse(b.body, { name: b.name })).files) files.set(f.path, [...(files.get(f.path) || []), b.name]); } catch { /* broken query: listed in Queries */ } }
      wrap.append(section(L('Files used by queries'), files.size ? h('ul.xs-list', [...files].map(([p, by]) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', p), h('div.xs-item-sub', L('Used by {names}', { names: by.join(', ') })))))) : hint(L('No query reads a file yet.'))));
      const comp = h('div'); wrap.append(section(L('SQL engine'), comp));
      componentCard(comp, 'duckdb', { surface, ctx, name: L('DuckDB'), what: L('Runs SQL and reads Parquet, large CSV files and .duckdb databases inside this folder. It runs on this computer with no access to other files or the network.') });
      return wrap;
    }
    list();
    if (opts.edit) edit(opts.edit);
    return { update(o) { Object.assign(opts, o); if (o.source) { list(); } else if (o.tab) list(); }, refresh() { if (!editing) list(); }, dispose() { ed?.destroy(); } };
  },
};

/** an optional component: status, size, install with progress, remove (shared with the Python panel) */
export async function componentCard(el, id, { surface, ctx, name, what }) {
  const st = status();
  const render = async () => {
    const list = await components.list().catch(() => []);
    const c = list.find((x) => x.id === id) || { state: 'missing' };
    const ready = c.state === 'ready';
    const mb = c.total ? Math.round(c.total / 1e6) : null;
    fill(el, h('div.xs-card',
      h('div.xs-card-head', h('strong', name), h('span.xs-badge', ready ? L('Installed') : L('Not installed'))),
      h('p.xs-hint', what),
      row(ready ? button(L('Remove'), async () => { await components.uninstall(id); render(); }, { quiet: true })
        : button(mb ? L('Install ({mb} MB)', { mb }) : L('Install'), async () => {
          st.busy(L('Downloading…'));
          const off = components.onProgress((p) => { const x = p?.[id]; if (x?.total) st.busy(L('Downloading… {pct}%', { pct: Math.round(((x.done || 0) / x.total) * 100) })); });
          try { await components.install(id); st.ok(L('{name} is ready.', { name })); } catch (e) { st.error(e.message); } finally { off(); render(); }
        }, { primary: true })),
      st));
  };
  void surface; void ctx;
  await render();
}
export { FqlError };
