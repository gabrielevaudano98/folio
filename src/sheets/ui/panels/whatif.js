// Folio Sheets — what-if analysis and simulation (area 23): Goal seek, Data table, Scenario manager and Monte Carlo
// simulation. Everything is computed by the data engine on a headless copy of the workbook (engine/whatif.js) with
// the same formula engine as the grid; the grid changes only when the person applies a result.
import { h, fill, section, hint, field, input, number, select, button, actions, preview, status, tabs, rangeInput, fmtNum } from './kit.js';
import { splitRef, addr } from '../../core/a1.js';
import { L } from '../i18n.js';

const cellOf = (surface, v) => { const s = String(v || '').trim(); if (!s) return ''; return s.includes('!') ? s : `${surface.sheetName()}!${s}`; };
const listOf = (s) => String(s).split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean).map((x) => (Number.isFinite(Number(x)) ? Number(x) : x));

export default {
  title: 'What-if analysis',
  mount(body, { surface, ctx, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    const call = (m, p, o) => surface.call(m, { text: surface.saveNow(), active: surface.sheetName(), ...p }, o);
    const cur = () => surface.selectionRef();
    const t = tabs([['goal', L('Goal seek')], ['table', L('Data table')], ['scenarios', L('Scenarios')], ['simulation', L('Simulation')]], opts.tab || 'goal', (id) => ({ goal, table, scenarios, simulation })[id]());
    root.append(t);

    function goal() {
      const set = rangeInput(surface, cur(), { label: L('Set cell'), help: L('A cell with a formula.') });
      const to = number({ value: '' }); const by = rangeInput(surface, '', { label: L('By changing cell'), help: L('A cell with a number the formula depends on.') });
      const st = status(); const after = h('div');
      return h('div', hint(L('Finds the value of one input that makes a formula reach a target, as Excel’s Goal Seek.')), set, field(L('To value'), to), by,
        actions(button(L('Find'), async () => {
          st.busy(L('Searching…'));
          try {
            const r = await call('whatif.goalSeek', { set: cellOf(surface, set.control.value), to: Number(to.value), by: cellOf(surface, by.control.value) });
            st[r.found ? 'ok' : 'error'](r.found ? L('{cell} = {value} gives {result} (in {steps} steps).', { cell: by.control.value, value: fmtNum(r.value, 8), result: fmtNum(r.result, 8), steps: r.steps }) : r.message);
            after.replaceChildren(actions(button(L('Put {value} in {cell}', { value: fmtNum(r.value, 6), cell: by.control.value }), () => surface.applyOps([{ op: 'values', ...refOp(by.control.value), values: [[r.value]] }]), { primary: true })));
          } catch (e) { st.error(e.message); after.replaceChildren(); }
        }, { primary: true })), st, after);
    }
    const refOp = (ref) => { const p = splitRef(cellOf(surface, ref)); return { sheet: p.sheet, range: p.range }; };

    function table() {
      const colIn = rangeInput(surface, '', { label: L('Input cell (down the rows)') });
      const colVals = input({ placeholder: '0.02, 0.03, 0.04, 0.05' });
      const rowIn = rangeInput(surface, '', { label: L('Second input cell (across the columns, optional)') });
      const rowVals = input({ placeholder: '12, 24, 36' });
      const outs = input({ placeholder: 'B9, B10' });
      const at = input({ value: '' , placeholder: 'Sensitivity!A1' });
      const st = status(); const out = h('div.xs-results');
      return h('div', hint(L('Recomputes the outputs for every value of one or two inputs, as Excel’s Data Table. The result is written as values; run it again after changes.')),
        colIn, field(L('Values for the input'), colVals), rowIn, field(L('Values for the second input'), rowVals), field(L('Output cells'), outs, L('With two inputs, the first output cell is used.')), field(L('Place the table at'), at, L('Optional: a sheet and cell. Leave empty to only preview.')),
        actions(button(L('Compute'), async () => {
          st.busy(L('Computing…'));
          try {
            const r = await call('whatif.dataTable', { colInput: cellOf(surface, colIn.control.value), colValues: listOf(colVals.value), rowInput: rowIn.control.value ? cellOf(surface, rowIn.control.value) : null, rowValues: listOf(rowVals.value), outputs: listOf(outs.value).map((c) => cellOf(surface, c)) });
            fill(out, preview(r.grid));
            if (at.value.trim()) { const p = splitRef(at.value.trim()); surface.protection.unguarded(() => surface.write(p.sheet || surface.sheetName(), p.range || 'A1', r.grid)); st.ok(L('Table written to {ref}.', { ref: at.value.trim() })); } else st.ok(L('Done.'));
          } catch (e) { st.error(e.message); }
        }, { primary: true })), st, out);
    }

    function scenarios() {
      const list = surface.workbook().scenarios || [];
      const save = (l) => surface.setWorkbook({ scenarios: l.length ? l : null });
      const name = input({ placeholder: L('Best case') });
      const cells = rangeInput(surface, '', { label: L('Changing cells'), help: L('Their current values are stored in the scenario.') });
      const results = input({ placeholder: 'Summary!B12' });
      const st = status(); const out = h('div.xs-results');
      const take = () => {
        const r = surface.resolve(cells.control.value); if (!r) throw new Error(L('Not a cell or range: {ref}', { ref: cells.control.value }));
        const vals = r.range.getRawValues(); const o = {}; const sname = r.sheet.getSheetName();
        const r0 = r.range.getRow(), c0 = r.range.getColumn();
        vals.forEach((row, i) => row.forEach((v, j) => { o[`${sname}!${addr(r0 + i, c0 + j)}`] = v; }));
        return o;
      };
      return h('div', hint(L('Named sets of input values you can switch between and compare, as Excel’s Scenario Manager.')),
        list.length ? h('ul.xs-list', list.map((s, i) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', s.name), h('div.xs-item-sub', Object.entries(s.cells).map(([k, v]) => `${k} = ${v}`).join(', '))),
          h('div.xs-item-actions', button(L('Show'), () => { surface.applyOps(Object.entries(s.cells).map(([k, v]) => ({ op: 'values', ...refOp(k), values: [[v]] }))); st.ok(L('Scenario {name} applied. Undo puts the previous values back.', { name: s.name })); }, { quiet: true }), button(L('Delete'), () => { save(list.filter((_, k) => k !== i)); t.show('scenarios'); }, { quiet: true }))))) : h('p.xs-empty', L('No scenarios yet.')),
        section(L('Add a scenario'), field(L('Name'), name), cells, actions(button(L('Add'), () => { try { if (!name.value.trim()) return; save([...list, { name: name.value.trim(), cells: take() }]); t.show('scenarios'); } catch (e) { st.error(e.message); } }))),
        section(L('Summary'), field(L('Result cells'), results), actions(button(L('Compare scenarios'), async () => {
          st.busy(L('Computing…'));
          try { const r = await call('whatif.scenarios', { list, results: listOf(results.value).map((c) => cellOf(surface, c)) }); fill(out, preview(r.grid), actions(button(L('Write the summary to a new sheet'), () => surface.protection.unguarded(() => surface.write('Scenario summary', 'A1', r.grid))))); st.ok(L('Done.')); }
          catch (e) { st.error(e.message); }
        }, { primary: true, disabled: !list.length }))), st, out);
    }

    function simulation() {
      const rows = h('div.xs-sim-inputs');
      const addRow = (cell = '', dist = 'normal', a = '', b = '', c = '') => {
        const cellIn = input({ value: cell, placeholder: 'B2', 'aria-label': L('Input cell') });
        const d = select([['normal', L('Normal (mean, sd)')], ['uniform', L('Uniform (min, max)')], ['triangular', L('Triangular (min, mode, max)')], ['pert', L('PERT (min, likely, max)')], ['lognormal', L('Log-normal (mu, sigma)')]], dist, { 'aria-label': L('Distribution') });
        const p = [a, b, c].map((v, i) => number({ value: v, 'aria-label': L('Parameter {n}', { n: i + 1 }) }));
        const PH = { normal: [L('mean'), L('sd')], uniform: [L('min'), L('max')], triangular: [L('min'), L('mode'), L('max')], pert: [L('min'), L('likely'), L('max')], lognormal: ['mu', 'sigma'] };
        const ph = () => p.forEach((x, i) => { const n = PH[d.value][i]; x.placeholder = n || ''; x.hidden = !n; x.setAttribute('aria-label', n || ''); });
        d.addEventListener('change', ph); ph();
        const rm = button('', () => r.remove(), { quiet: true, icon: surface.icons.close, title: L('Remove') });
        const r = h('div.xs-sim-row', cellIn, d, ...p, rm); r.read = () => [cellOf(surface, cellIn.value), [d.value, ...p.map((x) => x.value).filter((x) => x !== '').map(Number)]]; rows.append(r);
      };
      addRow(surface.range()?.getA1Notation() || '', 'normal');
      const outs = input({ placeholder: 'F9' }); const n = number({ value: 500, min: 10, max: 5000 }); const seed = number({ value: 1 });
      const st = status(); const out = h('div.xs-results');
      return h('div', hint(L('Draws the inputs from distributions many times and summarises the outputs (Monte Carlo). The same seed gives the same results.')),
        section(L('Inputs'), rows, actions(button(L('Add input'), () => addRow(), { quiet: true, icon: surface.icons.plus }))),
        field(L('Output cells'), outs), h('div.xs-row', field(L('Runs'), n), field(L('Seed'), seed)),
        actions(button(L('Run simulation'), async () => {
          const inputs = Object.fromEntries([...rows.children].map((r) => r.read()).filter(([c]) => c));
          st.busy(L('Running…'));
          try {
            const r = await call('whatif.simulate', { inputs, outputs: listOf(outs.value).map((c) => cellOf(surface, c)), iterations: Number(n.value), seed: Number(seed.value) }, { onProgress: (p) => st.busy(L('Running… {done} of {of}', p)) });
            const grid = [[L('Output'), L('Mean'), L('Std dev'), 'P5', 'P50', 'P95', L('Min'), L('Max')], ...Object.entries(r.results).map(([k, s]) => [k, s.mean, s.sd, s.p5, s.p50, s.p95, s.min, s.max])];
            fill(out, preview(grid), ...Object.entries(r.results).map(([k, s]) => histogram(k, s)), actions(button(L('Write the summary to a new sheet'), () => surface.protection.unguarded(() => surface.write('Simulation', 'A1', grid)))));
            st.ok(L('{n} runs.', { n: r.iterations }));
          } catch (e) { st.error(e.message); }
        }, { primary: true })), st, out);
    }
    function histogram(title, s) {
      const max = Math.max(1, ...s.hist.map((b) => b.count));
      return h('figure.xs-hist', h('figcaption', title), h('div.xs-hist-bars', { role: 'img', 'aria-label': L('Distribution of {cell}: from {min} to {max}, median {p50}', { cell: title, min: fmtNum(s.min), max: fmtNum(s.max), p50: fmtNum(s.p50) }) }, s.hist.map((b) => h('span', { style: { height: `${(b.count / max) * 100}%` }, title: `${fmtNum(b.from)} – ${fmtNum(b.to)}: ${b.count}` }))), h('div.xs-hist-axis', h('span', fmtNum(s.min)), h('span', fmtNum(s.max))));
    }
    void ctx;
    return { update(o) { if (o.tab) t.show(o.tab); } };
  },
};
