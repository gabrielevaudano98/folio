// Folio Sheets — Python in the workbook (area 24). Code lives in ```python Name``` blocks and runs in Pyodide (CPython
// in WebAssembly) inside the data engine: no access to files, the network or the computer. `folio.table("Sheet")`
// reads a sheet as a pandas DataFrame, `folio.output(df, sheet="Out", at="A1")` writes a result back.
import { h, fill, section, hint, field, input, button, actions, preview, status, codeEditor } from './kit.js';
import { componentCard } from './queries.js';
import { L } from '../i18n.js';

const STARTER = `import folio
import statistics

rows = folio.table("${'{sheet}'}")       # a list of dicts; with "import pandas" it is a DataFrame
print(len(rows), "rows")

# write a result back into the workbook:
# folio.output([["Mean", 1.5]], sheet="Python", at="A1")
`;

export default {
  title: 'Python',
  mount(body, { surface, ctx, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    let ed = null;
    async function render(name = opts.name || surface.fences('python')[0]?.name || null) {
      ed?.destroy(); ed = null;
      const blocks = surface.fences('python');
      const comp = h('div');
      const cur = blocks.find((b) => b.name === name);
      const nameIn = input({ value: name || 'Analysis', 'aria-label': L('Script name') });
      const holder = h('div.xs-code-holder');
      const st = status(); const out = h('div.xs-results'); const log = h('pre.xs-log', { hidden: true, 'aria-label': L('Output') });
      let draft = cur?.body ?? STARTER.replace('{sheet}', surface.sheetName());
      const save = () => { const n = nameIn.value.trim() || 'Analysis'; if (cur && n !== cur.name) surface.setFence('python', cur.name, null); surface.setFence('python', n, draft); return n; };
      const run = async () => {
        const n = save(); st.busy(L('Running {name}…', { name: n }));
        try {
          const r = await surface.call('python.run', { code: draft, sheets: surface.allGrids() }, { onProgress: (p) => p.status && st.busy(p.status) });
          log.hidden = !r.stdout; log.textContent = r.stdout || '';
          fill(out, ...(r.outputs || []).map((o) => h('div', h('p.xs-hint', L('Result for {sheet}!{at}', o)), preview(o.grid, { max: 50 }))));
          if (r.outputs?.length) out.append(actions(button(L('Write results to the sheets'), () => { for (const o of r.outputs) surface.protection.unguarded(() => surface.write(o.sheet, o.at, o.grid)); st.ok(L('{n} results written.', { n: r.outputs.length })); }, { primary: true })));
          st.ok(r.packages?.length ? L('Done. Packages used: {list}.', { list: r.packages.join(', ') }) : L('Done.'));
        } catch (e) { st.error(e.message); }
      };
      fill(root, 
        blocks.length > 1 ? h('div.xs-chips', blocks.map((b) => h('button.xs-chip', { type: 'button', 'aria-pressed': String(b.name === name), on: { click: () => render(b.name) } }, b.name))) : null,
        field(L('Name'), nameIn),
        h('div.field.xs-field', h('label', L('Code')), holder),
        actions(button(L('Run'), run, { primary: true, icon: surface.icons.play }), button(L('Save'), () => { save(); st.ok(L('Saved in the workbook.')); }), cur ? button(L('Delete'), () => { surface.setFence('python', cur.name, null); render(null); }, { quiet: true }) : null, button(L('New'), () => { opts.name = null; render('Analysis ' + (blocks.length + 1)); }, { quiet: true })),
        st, log, out,
        section(L('Python engine'), comp),
        h('details.xs-help', h('summary', L('Available in Python')), h('pre.xs-cheat', 'import folio\nfolio.sheets()                 # sheet names\nfolio.table("Orders")          # rows (pandas.DataFrame with "import pandas")\nfolio.output(data, sheet="Out", at="A1")\n\n# packages load on first import: numpy, pandas, scipy,\n# statsmodels, scikit-learn (checked against Pyodide’s lock file)')),
      );
      componentCard(comp, 'pyodide', { surface, ctx, name: L('Pyodide'), what: L('Python 3 compiled to WebAssembly. It runs on this computer in a sandbox; scientific packages are downloaded the first time a script imports them.') });
      ed = await codeEditor(holder, { value: draft, lang: 'python', label: L('Python code'), minLines: 12, onChange: (v) => { draft = v; } });
    }
    render();
    return { dispose() { ed?.destroy(); } };
  },
};
void hint;
