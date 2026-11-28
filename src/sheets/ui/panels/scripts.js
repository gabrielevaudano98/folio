// Folio Sheets — scripts, macros, custom functions and hooks (areas 13, 14 and 20). Folio Script is JavaScript with an
// Apps Script-like API (engine/script.js), kept in ```script Name``` blocks and run in a QuickJS sandbox.
import { h, section, hint, field, input, select, button, actions, status, codeEditor, tabs, checkbox } from './kit.js';
import { describe } from '../../engine/script-describe.js';
import { L } from '../i18n.js';

const STARTER = `// Folio Script: macros (any name), custom functions (UPPER_CASE) and hooks (onOpen, onEdit).

function addTotals() {
  const sh = Workbook.active();
  const last = sh.lastRow();
  const r = sh.range(\`A\${last + 1}\`);
  r.setValue('Total').setBold(true);
  for (let c = 2; c <= sh.lastColumn(); c++) {
    const col = sh.cell(1, c).getA1Notation().replace(/\\d+/, '');
    sh.cell(last + 1, c).setFormula(\`=SUM(\${col}2:\${col}\${last})\`).setBold(true);
  }
  ui.toast('Totals added');
}

// =VAT(B2) in a cell
function VAT(amount, rate = 0.22) {
  return Math.round(amount * rate * 100) / 100;
}
`;
const API = `Workbook.active() / .sheet(name) / .sheets() / .selection() / .insertSheet(name) / .name(definedName)
sheet.range("A1:C3") / .cell(row, col) / .lastRow() / .lastColumn() / .dataRange() / .appendRow([...]) / .activate()
range.getValue() / getValues() / getFormula() / setValue(v) / setValues([[...]]) / setFormula("=...") / clear()
range.setBold() / setItalic() / setBackground("#eee") / setFontColor() / setNumberFormat("0.00") / setNote(text)
range.offset(r, c) / getA1Notation() / activate()
ui.toast(message)   console.log(...)
SpreadsheetApp.getActiveSheet() and friends work too.
Hooks: onOpen(), onEdit({ sheet, row, column, value }), onSelectionChange({ sheet, range })`;

export const actions_ = {
  async runMacro({ surface, ctx }, name) {
    try { const r = await surface.runMacro(name); if (r.logs?.length) console.log(`[macro ${name}]`, ...r.logs); }
    catch (e) { ctx.toast(L('Macro {name} stopped: {error}', { name, error: e.message }), { kind: 'error' }); }
  },
};
export { actions_ as actions };

export default {
  title: 'Scripts',
  mount(body, { surface, ctx, opts }) {
    const root = h('div.xs-panel'); body.append(root);
    let ed = null;
    const t = tabs([['macros', L('Macros')], ['editor', L('Editor')], ['functions', L('Functions')], ['hooks', L('Hooks')]], opts.create ? 'editor' : opts.tab || (opts.button ? 'macros' : 'macros'), (id, el) => { ed?.destroy(); ed = null; return ({ macros, editor, functions, hooks })[id](el); });
    root.append(t);
    const info = () => describe(surface.scriptCode());

    function macros() {
      const st = status(); const ms = info().macros;
      const label = input({ placeholder: L('Button text') }); const which = select(ms.map((m) => [m.name, m.name]), ms[0]?.name);
      return h('div',
        ms.length ? h('ul.xs-list', ms.map((m) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', m.name), h('div.xs-item-sub', m.params.length ? `(${m.params.join(', ')})` : '')), h('div.xs-item-actions', button(L('Run'), async () => { st.busy(L('Running {name}…', { name: m.name })); try { const r = await surface.runMacro(m.name); st.ok(r.logs?.length ? r.logs.join('\n') : L('{name} finished: {n} changes.', { name: m.name, n: r.ops.length })); } catch (e) { st.error(e.line ? L('{error} (line {line})', { error: e.message, line: e.line }) : e.message); } }, { quiet: true, icon: surface.icons.play }))))) : h('div.xs-empty-state', h('p', L('No macros yet.')), actions(button(L('Write a script'), () => t.show('editor'), { primary: true }))),
        st,
        ms.length ? section(L('Button on the sheet'), hint(L('Places a button over the selected cell that runs a macro.')), field(L('Macro'), which), field(L('Text'), label), actions(button(L('Insert button'), () => { surface.floats.addButton({ label: label.value.trim() || which.value, macro: which.value }); st.ok(L('Button added. Drag it to move it.')); }))) : null,
      );
    }
    function editor(el) {
      const blocks = surface.fences('script');
      let name = opts.name || blocks[0]?.name || 'Macros';
      let draft = blocks.find((b) => b.name === name)?.body ?? STARTER;
      const st = status(); const holder = h('div.xs-code-holder');
      const nameIn = input({ value: name, 'aria-label': L('Script name') });
      const save = () => { const n = nameIn.value.trim() || 'Macros'; if (n !== name && blocks.some((b) => b.name === name)) surface.setFence('script', name, null); surface.setFence('script', n, draft); name = n; surface.extensions.refreshFunctions(); const d = describe(draft); st.ok(L('Saved: {m} macros, {f} functions, {h} hooks.', { m: d.macros.length, f: d.functions.length, h: d.hooks.length })); };
      const wrap = h('div',
        blocks.length > 1 ? h('div.xs-chips', blocks.map((b) => h('button.xs-chip', { type: 'button', 'aria-pressed': String(b.name === name), on: { click: () => { opts.name = b.name; t.show('editor'); } } }, b.name))) : null,
        field(L('Name'), nameIn), h('div.field.xs-field', h('label', L('Code (JavaScript)')), holder),
        actions(button(L('Save'), save, { primary: true }), button(L('New script'), () => { opts.name = `Script ${blocks.length + 1}`; surface.setFence('script', opts.name, '// a new script\n'); t.show('editor'); }, { quiet: true }), blocks.some((b) => b.name === name) ? button(L('Delete'), () => { surface.setFence('script', name, null); opts.name = null; t.show('editor'); }, { quiet: true }) : null),
        st,
        h('details.xs-help', h('summary', L('Script API')), h('pre.xs-cheat', API)),
        hint(L('Scripts run in a sandbox: no files, no network, at most 5 seconds and 64 MB. Their changes go through the normal undo.')),
      );
      queueMicrotask(async () => { ed = await codeEditor(holder, { value: draft, lang: 'javascript', label: L('Script code'), minLines: 14, onChange: (v) => { draft = v; } }); });
      void el;
      return wrap;
    }
    function functions() {
      const fs = info().functions;
      return h('div', hint(L('A function with an UPPER_CASE name is a custom function: type =NAME(A1) in a cell. It runs in the sandbox, so it must only compute from its arguments.')),
        fs.length ? h('ul.xs-list', fs.map((f) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', `=${f.name}(${f.params.join(', ')})`)), h('div.xs-item-actions', button(L('Insert'), () => surface.startEdit(`=${f.name}(`), { quiet: true }))))) : h('p.xs-empty', L('No custom functions yet.')));
    }
    function hooks() {
      const hs = info().hooks; const on = !!surface.workbook().scripts?.hooks;
      return h('div',
        hint(L('Hooks run by themselves: onOpen when the workbook opens, onEdit after you change cells, onSelectionChange when the selection moves. They run only if you allow them for this file.')),
        checkbox(L('Run hooks in this workbook'), on, (v) => surface.setWorkbook({ scripts: { ...(surface.workbook().scripts || {}), hooks: v || null } })),
        section(L('Hooks defined'), hs.length ? h('ul.xs-list.xs-compact', hs.map((x) => h('li', x))) : hint(L('None. Define function onEdit(e) { … } in a script.'))),
        section(L('Extensions'), (() => { const ex = surface.extensions.list(); return ex.length ? h('ul.xs-list', ex.map((e) => h('li.xs-item', h('div.xs-item-main', h('div.xs-item-title', e.name), h('div.xs-item-sub', e.commands.map((c) => c.label).join(', ')))))) : hint(L('No extensions are installed. Extensions add commands, functions and hooks through surface.extensions.register().')); })()),
      );
    }
    void ctx;
    return { update(o) { Object.assign(opts, o); t.show(o.create ? 'editor' : o.tab || 'macros'); }, dispose() { ed?.destroy(); } };
  },
};
