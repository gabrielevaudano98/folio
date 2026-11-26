// Folio Sheets — what each ribbon command does. One table: command id → action on the Univer facade or a Univer command.
// Every change goes through Univer's command service, so it is undoable, recorded in the operation log (collab.js)
// and written back to the file by the surface.
import { L } from './i18n.js';
import { NUMBER_FORMATS } from './ribbon.js';
import { cssHex } from './univer.js';
import { FUNCTION_GROUPS } from './functions.js';
import { readDoc, setWorkbook, serializeDoc } from '../core/sheetmd.js';

const CONTENT = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const NAME = { gray: 'Grey', brown: 'Brown', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink', red: 'Red' };

/** decimals of a number format: "#,##0.00" → 2 */
export const decimalsOf = (p) => { const m = /0\.(0+)/.exec(p || ''); return m ? m[1].length : 0; };
/** the same pattern with n decimals */
export function withDecimals(p, n) {
  const base = !p || p === 'General' ? '0' : p;
  const fix = (s) => s.replace(/0(\.0+)?(?![\d.])/, n > 0 ? '0.' + '0'.repeat(n) : '0');
  return base.split(';').map(fix).join(';');
}

export function createCommands(env) {
  const { api, commands, host, ctx, panels, surface } = env;
  const wb = () => api.getActiveWorkbook();
  const ws = () => wb()?.getActiveSheet();
  const rg = () => wb()?.getActiveRange() || ws()?.getRange('A1');
  const exec = (id, params) => commands.executeCommand(id, params);
  const menu = (anchor, items) => ctx.showMenu(anchor, items.map((i) => (i === '-' || i.head ? i : { ...i, label: L(i.label) })));
  const colorItems = (apply, fill) => [
    ...CONTENT.map((c) => ({ label: NAME[c], run: () => apply(cssHex(getComputedStyle(document.documentElement).getPropertyValue(`--content-${c}${fill ? '-bg' : ''}`))) })),
    '-', { label: fill ? 'No fill' : 'Automatic', run: () => apply(null) },
  ];
  const curStyle = () => rg()?.getCellStyleData?.() || {};
  const pattern = () => rg()?.getNumberFormat?.() || 'General';
  const setPattern = (p) => rg().setNumberFormat(p);

  const insertFormula = (name) => {
    const r = rg(); const cell = r.getCell?.() ? r : r;
    surface.startEdit(`=${name}(`);
  };

  const table = {
    undo: () => wb().undo(), redo: () => wb().redo(),
    /* Home · Clipboard */
    'x:paste': (b) => menu(b, [
      { label: 'Paste', key: 'Mod+V', run: () => exec('sheet.command.paste') },
      { label: 'Paste values only', run: () => exec('sheet.command.paste-value') },
      { label: 'Paste formulas only', run: () => exec('sheet.command.paste-formula') },
      { label: 'Paste formatting only', run: () => exec('sheet.command.paste-format') },
      { label: 'Paste column widths', run: () => exec('sheet.command.paste-col-width') },
    ]),
    'x:cut': () => exec('sheet.command.cut'),
    'x:copy': () => exec('sheet.command.copy'),
    'x:painter': () => exec('sheet.operation.set-format-painter', { status: 1 }),
    /* Font */
    'x:font': (el) => rg().setFontFamily(el.value || getComputedStyle(document.documentElement).getPropertyValue('--font-sans').split(',')[0].replace(/"/g, '').trim()),
    'x:size': (el) => rg().setFontSize(Number(el.value)),
    'x:grow': () => exec('sheet.command.set-range-font-increase'),
    'x:shrink': () => exec('sheet.command.set-range-font-decrease'),
    'x:bold': () => exec('sheet.command.set-range-bold'),
    'x:italic': () => exec('sheet.command.set-range-italic'),
    'x:underline': () => exec('sheet.command.set-range-underline'),
    'x:strike': () => exec('sheet.command.set-range-stroke'),
    'x:borders': (b) => menu(b, [
      ...[['all', 'All borders'], ['outside', 'Outside borders'], ['inside', 'Inside borders'], ['top', 'Top border'], ['bottom', 'Bottom border'], ['left', 'Left border'], ['right', 'Right border'], ['none', 'No border']]
        .map(([type, label]) => ({ label, run: () => rg().setBorder(type, 1, cssHex(getComputedStyle(document.documentElement).getPropertyValue('--color-ink'))) })),
      '-', { label: 'Thick bottom border', run: () => rg().setBorder('bottom', 8, cssHex(getComputedStyle(document.documentElement).getPropertyValue('--color-ink'))) },
      { label: 'Double bottom border', run: () => rg().setBorder('bottom', 7, cssHex(getComputedStyle(document.documentElement).getPropertyValue('--color-ink'))) },
    ]),
    'x:fill': (b) => menu(b, colorItems((c) => (c ? rg().setBackground(c) : exec('sheet.command.reset-background-color')), true)),
    'x:fontColor': (b) => menu(b, colorItems((c) => (c ? rg().setFontColor(c) : exec('sheet.command.reset-range-text-color')), false)),
    /* Alignment */
    'x:vtop': () => exec('sheet.command.set-vertical-text-align', { value: 1 }), 'x:vmiddle': () => exec('sheet.command.set-vertical-text-align', { value: 2 }), 'x:vbottom': () => exec('sheet.command.set-vertical-text-align', { value: 3 }),
    'x:left': () => exec('sheet.command.set-horizontal-text-align', { value: 1 }), 'x:center': () => exec('sheet.command.set-horizontal-text-align', { value: 2 }), 'x:right': () => exec('sheet.command.set-horizontal-text-align', { value: 3 }),
    'x:rotate': (b) => menu(b, [[0, 'Horizontal'], [45, 'Angle counterclockwise'], [-45, 'Angle clockwise'], [90, 'Rotate text up'], [-90, 'Rotate text down']].map(([a, label]) => ({ label, run: () => rg().setTextRotation(a) }))),
    'x:wrap': () => exec('sheet.command.set-text-wrap', { value: curStyle().tb === 3 ? 1 : 3 }),
    'x:indentMore': () => indent(1), 'x:indentLess': () => indent(-1),
    'x:merge': (b) => menu(b, [
      { label: 'Merge and centre', run: () => { rg().merge(); exec('sheet.command.set-horizontal-text-align', { value: 2 }); } },
      { label: 'Merge across', run: () => rg().mergeAcross() },
      { label: 'Merge cells', run: () => rg().merge() },
      { label: 'Unmerge cells', run: () => rg().breakApart() },
    ]),
    /* Number */
    'x:numfmt': (el) => { if (el.value === 'more') { exec('sheet.operation.open.numfmt.panel'); el.value = 'general'; return; } const f = NUMBER_FORMATS.find(([id]) => id === el.value); if (f) setPattern(f[2]); },
    'x:currency': (b) => menu(b, [['"€"#,##0.00', '€ Euro'], ['"$"#,##0.00', '$ US dollar'], ['"£"#,##0.00', '£ Pound'], ['"CHF" #,##0.00', 'CHF Swiss franc'], ['[$¥-411]#,##0', '¥ Yen']].map(([p, label]) => ({ label, run: () => setPattern(p) }))),
    'x:percent': () => setPattern('0%'),
    'x:comma': () => setPattern('#,##0.00'),
    'x:decMore': () => setPattern(withDecimals(pattern(), decimalsOf(pattern()) + 1)),
    'x:decLess': () => setPattern(withDecimals(pattern(), Math.max(0, decimalsOf(pattern()) - 1))),
    /* Styles */
    'x:cf': (b) => menu(b, [
      { label: 'Highlight cells rules…', run: () => panels.open('cf', { preset: 'greaterThan' }) },
      { label: 'Top 10 items…', run: () => panels.open('cf', { preset: 'top' }) },
      { label: 'Highlight duplicates', run: () => exec('sheet.command.add-duplicate-values-conditional-rule', {}) },
      { label: 'Data bars', run: () => exec('sheet.command.add-data-bar-conditional-rule', {}) },
      { label: 'Colour scale', run: () => exec('sheet.command.add-color-scale-conditional-rule', {}) },
      { label: 'Icon set', run: () => exec('sheet.command.add-icon-set-conditional-rule', {}) },
      '-', { label: 'Manage rules…', run: () => exec('sheet.operation.open.conditional.formatting.panel') },
      { label: 'Clear rules from selection', run: () => exec('sheet.command.clear-range-conditional-rule') },
      { label: 'Clear rules from sheet', run: () => exec('sheet.command.clear-worksheet-conditional-rule') },
    ]),
    'x:asTable': () => { const r = rg(); const name = `Table${(ws().getTableList?.()?.length || 0) + 1}`; try { ws().addTable(name, r.getA1Notation(), `t-${Date.now().toString(36)}`); } catch (e) { ctx.toast(e.message, { kind: 'error' }); } },
    'x:cellStyles': (b) => menu(b, CELL_STYLES.map(([label, st]) => ({ label, run: () => applyStyle(rg(), st) }))),
    /* Cells */
    'x:insertMenu': (b) => menu(b, [
      { label: 'Insert rows above', run: () => exec('sheet.command.insert-row-before') },
      { label: 'Insert rows below', run: () => exec('sheet.command.insert-row-after') },
      { label: 'Insert columns left', run: () => exec('sheet.command.insert-col-before') },
      { label: 'Insert columns right', run: () => exec('sheet.command.insert-col-after') },
      { label: 'Insert cells, shift down', run: () => exec('sheet.command.insert-range-move-down-confirm') },
      { label: 'Insert cells, shift right', run: () => exec('sheet.command.insert-range-move-right-confirm') },
      '-', { label: 'Insert sheet', run: () => exec('sheet.command.insert-sheet') },
    ]),
    'x:insertQuick': (b) => table['x:insertMenu'](b),
    'x:deleteMenu': (b) => menu(b, [
      { label: 'Delete rows', run: () => exec('sheet.command.remove-row-confirm') },
      { label: 'Delete columns', run: () => exec('sheet.command.remove-col-confirm') },
      { label: 'Delete cells, shift up', run: () => exec('sheet.command.delete-range-move-up-confirm') },
      { label: 'Delete cells, shift left', run: () => exec('sheet.command.delete-range-move-left-confirm') },
      '-', { label: 'Delete sheet', danger: true, run: () => exec('sheet.command.remove-sheet-confirm') },
    ]),
    'x:formatMenu': (b) => menu(b, [
      { head: L('Cell size') },
      { label: 'Row height…', run: async () => { const v = await ask('Row height', ws().getRowHeight(rg().getRow())); if (v) ws().setRowHeights(rg().getRow(), rg().getHeight(), v); } },
      { label: 'Column width…', run: async () => { const v = await ask('Column width', ws().getColumnWidth(rg().getColumn())); if (v) ws().setColumnWidths(rg().getColumn(), rg().getWidth(), v); } },
      { label: 'AutoFit column width', run: () => exec('sheet.command.set-col-auto-width') },
      { label: 'AutoFit row height', run: () => ws().autoFitRow?.(rg().getRow()) },
      { head: L('Visibility') },
      { label: 'Hide rows', run: () => exec('sheet.command.set-row-hidden') }, { label: 'Hide columns', run: () => exec('sheet.command.set-col-hidden') },
      { label: 'Unhide rows', run: () => ws().showRows(rg().getRow(), rg().getHeight()) }, { label: 'Unhide columns', run: () => ws().showColumns(rg().getColumn(), rg().getWidth()) },
      { head: L('Sheet') },
      { label: 'Rename sheet', run: () => exec('sheet.operation.rename-sheet') },
      { label: 'Tab colour', run: () => menu(b, colorItems((c) => ws().setTabColor(c || ''), false)) },
      { label: 'Protect sheet…', run: () => panels.open('protect') },
    ]),
    /* Editing */
    'x:autosum': (b) => menu(b, ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map((f) => ({ label: { SUM: 'Sum', AVERAGE: 'Average', COUNT: 'Count numbers', MAX: 'Max', MIN: 'Min' }[f], run: () => surface.autoSum(f) }))),
    'x:fillMenu': (b) => menu(b, [{ label: 'Down', key: 'Mod+D', run: () => exec('sheet.command.copy-down') }, { label: 'Right', key: 'Mod+R', run: () => exec('sheet.command.copy-right') }, { label: 'Series…', run: () => panels.open('series') }]),
    'x:clear': (b) => menu(b, [{ label: 'Clear all', run: () => exec('sheet.command.clear-selection-all') }, { label: 'Clear formats', run: () => exec('sheet.command.clear-selection-format') }, { label: 'Clear contents', run: () => exec('sheet.command.clear-selection-content') }, { label: 'Clear notes', run: () => clearNotes() }]),
    'x:sortFilter': (b) => menu(b, [{ label: 'Sort A to Z', run: () => exec('sheet.command.sort-range-asc') }, { label: 'Sort Z to A', run: () => exec('sheet.command.sort-range-desc') }, { label: 'Custom sort…', run: () => exec('sheet.command.sort-range-custom') }, '-', { label: 'Filter', run: () => exec('sheet.command.smart-toggle-filter') }, { label: 'Clear filter', run: () => exec('sheet.command.clear-filter-criteria') }, { label: 'Reapply', run: () => exec('sheet.command.re-calc-filter') }]),
    'x:findMenu': (b) => menu(b, [{ label: 'Find…', key: 'Mod+F', run: () => exec('ui.operation.open-find-dialog') }, { label: 'Replace…', key: 'Mod+H', run: () => exec('ui.operation.open-replace-dialog') }, { label: 'Go to…', key: 'Mod+G', run: () => surface.goto() }, '-', { label: 'Formulas', run: () => panels.open('audit', { tab: 'formulas' }) }, { label: 'Notes', run: () => panels.open('audit', { tab: 'notes' }) }, { label: 'Data validation', run: () => exec('data-validation.operation.open-validation-panel') }]),
    /* Insert */
    'x:pivot': () => panels.open('pivot'),
    'x:image': (b) => menu(b, [{ label: 'Place over cells', run: () => exec('sheet.command.insert-float-image') }, { label: 'Place in cell', run: () => exec('sheet.command.insert-cell-image') }]),
    'x:chart:more': () => panels.open('chart', { type: 'column' }),
    'x:slicer': () => panels.open('slicer', { kind: 'slicer' }),
    'x:timeline': () => panels.open('slicer', { kind: 'timeline' }),
    'x:checkbox': () => rg().setDataValidation(api.newDataValidation().requireCheckbox().build()),
    'x:dropdown': () => exec('data-validation.operation.open-validation-panel'),
    'x:button': () => panels.open('scripts', { button: true }),
    'x:form': () => panels.open('form'),
    'x:entity': () => panels.open('entity'),
    'x:link': () => exec('sheet.operation.open-hyper-link-edit-panel'),
    'x:note': () => exec('sheet.operation.add-note-popup'),
    /* Page layout */
    'x:margins': (b) => menu(b, [['normal', 'Normal'], ['wide', 'Wide'], ['narrow', 'Narrow']].map(([v, label]) => ({ label, run: () => surface.setPrint({ margins: v }) }))),
    'x:orientation': (b) => menu(b, [['portrait', 'Portrait'], ['landscape', 'Landscape']].map(([v, label]) => ({ label, run: () => surface.setPrint({ orientation: v }) }))),
    'x:paper': (b) => menu(b, [['A4', 'A4'], ['A3', 'A3'], ['Letter', 'Letter'], ['Legal', 'Legal']].map(([v, label]) => ({ label, run: () => surface.setPrint({ paper: v }) }))),
    'x:printArea': (b) => menu(b, [{ label: 'Set print area', run: () => surface.setPrint({ area: rg().getA1Notation() }) }, { label: 'Clear print area', run: () => surface.setPrint({ area: null }) }]),
    'x:printTitles': () => surface.setPrint({ repeatRows: `${rg().getRow() + 1}:${rg().getRow() + rg().getHeight()}` }),
    'x:fit': (el) => surface.setPrint({ fit: el.value }),
    'x:printGrid': () => surface.setPrint({ gridlines: !surface.print().gridlines }),
    'x:printHeadings': () => surface.setPrint({ headings: !surface.print().headings }),
    'x:pdf': () => surface.exportPdf(),
    'x:pageSetup': () => panels.open('print'),
    /* Data · Workbook: files in and out, through the data engine */
    'x:importFile': () => importFile(),
    'x:exportXlsx': () => exportXlsx(),
    'x:exportCsv': () => exportCsv(),
    'x:print': () => surface.exportPdf({ print: true }),
    /* Formulas */
    'x:insertFn': () => exec('formula-ui.operation.insert-function'),
    'x:names': () => exec('sidebar.operation.defined-name'),
    'x:defineName': () => exec('sidebar.operation.defined-name'),
    'x:useName': (b) => { const names = wb().getDefinedNames(); menu(b, names.length ? names.map((n) => ({ label: n.getName(), run: () => surface.startEdit(`=${n.getName()}`) })) : [{ label: 'No names yet', disabled: true, run() {} }]); },
    'x:precedents': () => panels.open('audit', { tab: 'precedents' }),
    'x:dependents': () => panels.open('audit', { tab: 'dependents' }),
    'x:showFormulas': () => surface.toggleFormulas(),
    'x:errors': () => panels.open('audit', { tab: 'errors' }),
    'x:circular': () => panels.open('audit', { tab: 'circular' }),
    'x:evaluate': () => panels.open('audit', { tab: 'evaluate' }),
    'x:calcNow': () => api.getFormula().executeCalculation(),
    'x:calcMode': () => exec('sheets-formula-ui.operation.calculation-options'),
    /* Data */
    'x:getData': (b) => menu(b, [
      { head: L('From a file') },
      { label: 'Text or CSV…', run: () => panels.open('queries', { source: 'csv' }) }, { label: 'Excel workbook…', run: () => panels.open('queries', { source: 'xlsx' }) }, { label: 'JSON…', run: () => panels.open('queries', { source: 'json' }) }, { label: 'Parquet…', run: () => panels.open('queries', { source: 'parquet' }) },
      { head: L('From a database') }, { label: 'DuckDB or SQL query…', run: () => panels.open('queries', { source: 'sql' }) },
      { head: L('Other sources') }, { label: 'From this workbook', run: () => panels.open('queries', { source: 'sheet' }) }, { label: 'Blank query', run: () => panels.open('queries', { source: 'blank' }) },
    ]),
    'x:queries': () => panels.open('queries'),
    'x:refreshAll': () => surface.refreshAll(),
    'x:connections': () => panels.open('queries', { tab: 'connections' }),
    'x:model': () => panels.open('model'),
    'x:sortAz': () => exec('sheet.command.sort-range-asc'),
    'x:sortZa': () => exec('sheet.command.sort-range-desc'),
    'x:sortCustom': () => exec('sheet.command.sort-range-custom'),
    'x:filter': () => exec('sheet.command.smart-toggle-filter'),
    'x:filterClear': () => exec('sheet.command.clear-filter-criteria'),
    'x:filterReapply': () => exec('sheet.command.re-calc-filter'),
    'x:textToCols': () => panels.open('textToCols'),
    'x:dedupe': () => surface.removeDuplicates(),
    'x:validation': () => exec('data-validation.operation.open-validation-panel'),
    'x:whatif': (b) => menu(b, [{ label: 'Goal seek…', run: () => panels.open('whatif', { tab: 'goal' }) }, { label: 'Data table…', run: () => panels.open('whatif', { tab: 'table' }) }, { label: 'Scenario manager…', run: () => panels.open('whatif', { tab: 'scenarios' }) }]),
    'x:simulate': () => panels.open('whatif', { tab: 'simulation' }),
    'x:python': () => panels.open('python'),
    /* Review */
    'x:notesShow': () => surface.toggleNotes(),
    'x:protectSheet': () => panels.open('protect', { tab: 'sheet' }),
    'x:protectRange': () => panels.open('protect', { tab: 'ranges' }),
    'x:encrypt': () => panels.open('protect', { tab: 'encrypt' }),
    'x:sign': () => panels.open('protect', { tab: 'sign' }),
    'x:verify': () => panels.open('protect', { tab: 'sign' }),
    'x:history': () => panels.open('history'),
    'x:compare': () => panels.open('history', { tab: 'compare' }),
    'x:audit': () => panels.open('history', { tab: 'activity' }),
    /* View */
    'x:gridlines': () => ws().setHiddenGridlines(!ws().hasHiddenGridLines()),
    'x:formulaBar': () => surface.toggleFormulaBar(),
    'x:zoomIn': () => zoom(+0.1), 'x:zoomOut': () => zoom(-0.1), 'x:zoom100': () => ws().zoom(1),
    'x:zoomSel': () => { const r = rg(); const n = Math.max(r.getWidth(), r.getHeight() / 2); ws().zoom(Math.max(0.5, Math.min(2, 10 / Math.max(1, n)))); },
    'x:freeze': (b) => menu(b, [{ label: 'Freeze panes', run: () => exec('sheet.command.set-selection-frozen') }, { label: 'Freeze top row', run: () => ws().setFrozenRows(1) }, { label: 'Freeze first column', run: () => ws().setFrozenColumns(1) }, { label: 'Unfreeze panes', run: () => ws().cancelFreeze() }]),
    /* Automate */
    'x:scripts': () => panels.open('scripts'), 'x:newScript': () => panels.open('scripts', { create: true }),
    'x:runMacro': (b) => { const list = surface.macros(); menu(b, list.length ? list.map((m) => ({ label: m, run: () => surface.runMacro(m) })) : [{ label: 'No macros yet', disabled: true, run() {} }]); },
    'x:udf': () => panels.open('scripts', { tab: 'functions' }),
    'x:extensions': () => panels.open('scripts', { tab: 'hooks' }),
  };
  for (const t of ['column', 'bar', 'line', 'pie', 'area', 'scatter']) table[`x:chart:${t}`] = () => surface.addChart(t);
  for (const [g, list] of Object.entries(FUNCTION_GROUPS)) table[`x:fn:${g}`] = (b) => menu(b, (g === 'custom' ? surface.customFunctions() : list).map((f) => ({ label: f, run: () => insertFormula(f) })).concat(g === 'custom' ? [] : ['-', { label: 'More functions…', run: () => exec('formula-ui.operation.more-functions') }]));

  async function importFile() {
    const r = await globalThis.folio.sheetsImport(); if (!r) return;
    const base = r.name.replace(/\.[^.]+$/, '');
    let text = r.text;
    const made = await ctx.createDoc?.({ type: 'sheet', name: base, content: () => text });
    if (!made) return;
    if (r.source) {
      // keep the original package next to the new workbook, so Export writes into it (macros, pivots and the rest pass through)
      const rel = await globalThis.folio.saveImage(made.path, `${base}.${r.ext}`, r.source);
      const doc = readDoc(text); setWorkbook(doc, { ...doc.workbook, source: rel }); text = serializeDoc(doc);
      await globalThis.folio.write(made.path, text);
    }
    ctx.toast(L('{name} imported: {n} sheets.', { name: r.name, n: r.sheets.length }) + (r.vba ? ' ' + L('Its macros are kept for export to .xlsm.') : ''));
    ctx.openFile?.(made.path);
  }
  async function exportXlsx() {
    const text = surface.saveNow(); const source = surface.workbook().source || null;
    const ext = source && /\.xlsm$/i.test(source) ? 'xlsm' : 'xlsx';
    try {
      const bytes = await surface.call('file.exportXlsx', { text, source });
      const out = await ctx.saveBinary(ext, bytes);
      if (out) ctx.toast(source ? L('Exported into a copy of the original {ext}: macros and parts Folio does not edit are kept.', { ext }) : L('Exported to Excel.'));
    } catch (e) { ctx.toast(e.message, { kind: 'error' }); }
  }
  async function exportCsv() {
    try { const csv = await surface.call('file.exportCsv', { text: surface.saveNow(), sheet: surface.sheetName() }); await ctx.saveBinary('csv', new TextEncoder().encode('\uFEFF' + csv)); }
    catch (e) { ctx.toast(e.message, { kind: 'error' }); }
  }
  function indent(d) { const st = curStyle(); const pad = Math.max(0, (st.pd?.l || 0) + d * 12); exec('sheet.command.set-style', { style: { type: 'pd', value: { ...(st.pd || {}), l: pad } } }); }
  function zoom(d) { const z = ws().getZoom?.() || 1; ws().zoom(Math.round(Math.max(0.1, Math.min(4, z + d)) * 10) / 10); }
  function clearNotes() { const r = rg(); for (let i = 0; i < r.getHeight(); i++) for (let j = 0; j < r.getWidth(); j++) ws().getRange(r.getRow() + i, r.getColumn() + j).deleteNote?.(); }
  async function ask(label, value) { const v = await ctx.prompt({ title: L(label), label: L(label), value: String(Math.round(value || 0)), action: L('OK') }); const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }

  return {
    has: (cmd) => cmd in table,
    run(cmd, el) {
      const f = table[cmd];
      if (!f) return false;
      try { const r = f(el); if (r?.catch) r.catch((e) => ctx.toast(e.message, { kind: 'error' })); } catch (e) { ctx.toast(e.message || String(e), { kind: 'error' }); }
      return true;
    },
  };
}

/** Cell styles gallery: greys and weight only; authors add colour with Fill and Font colour */
export const CELL_STYLES = [
  ['Normal', { bold: false, italic: false, fill: null, border: null, size: 11 }],
  ['Title', { bold: true, size: 18 }],
  ['Heading 1', { bold: true, size: 14, border: { bottom: 'medium' } }],
  ['Heading 2', { bold: true, size: 12, border: { bottom: 'thin' } }],
  ['Total', { bold: true, border: { top: 'thin', bottom: 'double' } }],
  ['Input', { fill: 'var(--content-gray-bg)', border: { top: 'thin', bottom: 'thin', left: 'thin', right: 'thin' } }],
  ['Note', { italic: true, fill: 'var(--content-yellow-bg)' }],
  ['Good', { fill: 'var(--content-green-bg)', color: 'var(--content-green)' }],
  ['Bad', { fill: 'var(--content-red-bg)', color: 'var(--content-red)' }],
];
function applyStyle(range, st) {
  const root = getComputedStyle(document.documentElement);
  const col = (v) => (v && v.startsWith('var(') ? cssHex(root.getPropertyValue(v.slice(4, -1))) : v);
  if ('bold' in st) range.setFontWeight(st.bold ? 'bold' : 'normal');
  if ('italic' in st) range.setFontStyle(st.italic ? 'italic' : 'normal');
  if (st.size) range.setFontSize(st.size);
  if (st.fill) range.setBackground(col(st.fill));
  if (st.color) range.setFontColor(col(st.color));
  const ink = cssHex(root.getPropertyValue('--color-ink'));
  if (st.border === null) range.setBorder('none', 1, ink);
  else if (st.border) for (const [side, kind] of Object.entries(st.border)) range.setBorder(side, { thin: 1, medium: 8, double: 7 }[kind] || 1, ink);
}
