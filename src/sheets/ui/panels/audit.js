// Folio Sheets — formula auditing (area 16): precedents and dependents of the selected cell from Univer's
// dependency tree (@univerjs/engine-formula), every formula of a sheet, errors, circular references, a step-by-step
// view of a formula with its values, and every note.
import { h, fill, section, hint, status, tabs, input } from './kit.js';
import { fromRange, addr, quoteSheet } from '../../core/a1.js';
import { refsOf, findCycles, substitute } from '../../core/refs.js';
import { L } from '../i18n.js';

export default {
  title: 'Formula auditing',
  mount(body, { surface, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    const sheetName = (id) => surface.wb().getSheetBySheetId(id)?.getSheetName() || id;
    const link = (ref, label = ref) => h('button.xs-link', { type: 'button', on: { click: () => surface.activate(ref) } }, label);
    const t = tabs([['precedents', L('Precedents')], ['dependents', L('Dependents')], ['formulas', L('Formulas')], ['errors', L('Errors')], ['circular', L('Circular')], ['evaluate', L('Evaluate')], ['notes', L('Notes')]], opts.tab || 'precedents', (id) => ({ precedents, dependents, formulas, errors, circular, evaluate, notes })[id]());
    root.append(t);
    const sel = () => { const r = surface.range(); return r ? { row: r.getRow(), col: r.getColumn(), a1: r.getA1Notation(), ref: `${quoteSheet(surface.sheetName())}!${addr(r.getRow(), r.getColumn())}` } : null; };
    const fapi = () => surface.formulaApi();

    function precedents() {
      const s = sel(); const out = h('div'); const st = status();
      const f = surface.ws().getRange(s.row, s.col).getFormula();
      if (!f) return h('div', h('p', L('{cell} holds no formula.', { cell: s.ref })), hint(L('Select a cell with a formula to see the cells it reads.')));
      (async () => {
        try {
          const tree = await fapi().getCellDependencyTree({ unitId: surface.unitId(), sheetId: surface.sheetId(), row: s.row, column: s.col });
          const ranges = (tree?.rangeList || []).map((x) => `${quoteSheet(sheetName(x.sheetId))}!${fromRange(x.range)}`);
          const list = ranges.length ? ranges : refsOf(f).map((r) => `${quoteSheet(r.sheet || surface.sheetName())}!${r.range}`);
          fill(out, h('p', h('code', f)), list.length ? h('ul.xs-list.xs-compact', list.map((r) => h('li', link(r), h('span.xs-item-sub', ` ${preview(r)}`)))) : hint(L('The formula reads no cells.')),
            tree?.parents?.length ? section(L('Formulas these depend on'), h('ul.xs-list.xs-compact', tree.parents.map((p) => { const r = `${quoteSheet(sheetName(p.subUnitId))}!${addr(p.row, p.column)}`; return h('li', link(r), h('code.xs-item-sub', ` ${p.formula}`)); }))) : null);
        } catch (e) { st.error(e.message); }
      })();
      return h('div', out, st);
    }
    const preview = (ref) => { try { const v = surface.read(ref); return v.length === 1 && v[0].length === 1 ? `= ${fmt(v[0][0])}` : L('{r}×{c} cells', { r: v.length, c: v[0].length }); } catch { return ''; } };
    const fmt = (v) => (v == null ? L('(empty)') : typeof v === 'number' ? String(Math.round(v * 1e9) / 1e9) : String(v));

    function dependents() {
      const s = sel(); const out = h('div'); const st = status();
      (async () => {
        try {
          const deps = await fapi().getRangeDependents([{ unitId: surface.unitId(), sheetId: surface.sheetId(), range: { startRow: s.row, endRow: s.row, startColumn: s.col, endColumn: s.col } }]);
          const list = (deps || []).filter((d) => !(d.subUnitId === surface.sheetId() && d.row === s.row && d.column === s.col));
          fill(out, h('p', L('Formulas that use {cell}:', { cell: s.ref })), list.length ? h('ul.xs-list.xs-compact', list.map((d) => { const r = `${quoteSheet(sheetName(d.subUnitId))}!${addr(d.row, d.column)}`; return h('li', link(r), h('code.xs-item-sub', ` ${d.formula}`)); })) : hint(L('No formula uses this cell.')));
        } catch (e) { st.error(e.message); }
      })();
      return h('div', out, st);
    }
    function allFormulas() {
      const out = {};
      for (const sh of surface.wb().getSheets()) {
        const r = sh.getDataRange(); const fs = r.getFormulas(); const r0 = r.getRow(), c0 = r.getColumn();
        fs.forEach((row, i) => row.forEach((f, j) => { if (f) out[`${quoteSheet(sh.getSheetName())}!${addr(r0 + i, c0 + j)}`] = f; }));
      }
      return out;
    }
    function formulas() {
      const q = input({ type: 'search', placeholder: L('Search formulas'), 'aria-label': L('Search formulas') });
      const all = Object.entries(allFormulas()); const ul = h('ul.xs-list.xs-compact');
      const draw = () => ul.replaceChildren(...all.filter(([c, f]) => !q.value || (c + f).toLowerCase().includes(q.value.toLowerCase())).slice(0, 500).map(([c, f]) => h('li', link(c), h('code.xs-item-sub', ` ${f}`))));
      q.addEventListener('input', draw); draw();
      return h('div', h('p.xs-hint', L('{n} formulas in this workbook.', { n: all.length })), q, ul);
    }
    function errors() {
      const list = [];
      for (const sh of surface.wb().getSheets()) {
        const r = sh.getDataRange(); const v = r.getRawValues(); const r0 = r.getRow(), c0 = r.getColumn();
        v.forEach((row, i) => row.forEach((x, j) => { if (typeof x === 'string' && /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!|ERROR)/.test(x)) list.push([`${quoteSheet(sh.getSheetName())}!${addr(r0 + i, c0 + j)}`, x]); }));
      }
      const why = { '#DIV/0!': L('A division by zero or by an empty cell.'), '#N/A': L('A lookup found no match.'), '#NAME?': L('An unknown function or name.'), '#REF!': L('A reference to a cell that no longer exists.'), '#VALUE!': L('Text where a number was expected.'), '#NUM!': L('A number out of range.'), '#SPILL!': L('A dynamic array has no room to spill.') };
      return list.length ? h('ul.xs-list', list.map(([c, e]) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', link(c), ` ${e}`), h('div.xs-item-sub', why[e] || ''))))) : h('p.xs-empty', L('No errors in this workbook.'));
    }
    function circular() {
      const cycles = findCycles(Object.fromEntries(Object.entries(allFormulas()).map(([k, v]) => [k.replace(/^'(.*)'!/, (m, n) => `${n.replace(/''/g, "'")}!`), v])));
      return cycles.length ? h('div', h('p', L('{n} circular references: these formulas depend on themselves, so they cannot be computed.', { n: cycles.length })), h('ul.xs-list', cycles.map((c) => h('li', c.map((x, i) => [i ? ' → ' : '', link(x.replace(/^(.*?)!/, (m, n) => `${quoteSheet(n)}!`), x)]))))) : h('p.xs-empty', L('No circular references.'));
    }
    function evaluate() {
      const s = sel(); const f = surface.ws().getRange(s.row, s.col).getFormula();
      if (!f) return hint(L('Select a cell with a formula.'));
      const valueOf = (sheet, a1) => { try { return surface.read(`${quoteSheet(sheet || surface.sheetName())}!${a1}`)[0][0]; } catch { return null; } };
      const result = surface.ws().getRange(s.row, s.col).getValue();
      return h('div', h('ol.xs-steps', h('li', h('code', f)), h('li', h('code', substitute(f, valueOf))), h('li', h('code', `= ${fmt(result)}`))),
        hint(L('Each reference is replaced by its current value; the last line is the result.')));
    }
    function notes() {
      const list = [];
      for (const sh of surface.wb().getSheets()) for (const n of sh.getNotes?.() || []) list.push([`${quoteSheet(sh.getSheetName())}!${addr(n.row, n.col)}`, n.note]);
      return list.length ? h('ul.xs-list', list.map(([c, n]) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', link(c)), h('div.xs-item-sub', n))))) : h('p.xs-empty', L('No notes in this workbook.'));
    }
    const refresh = () => t.show(t.current);
    return { update(o) { if (o.tab) t.show(o.tab); }, refresh, onSelection() { if (['precedents', 'dependents', 'evaluate'].includes(t.current)) refresh(); } };
  },
};
