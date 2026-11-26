// Folio Sheets — the ribbon. Excel's tabs and groups (Home, Insert, Page Layout, Formulas, Data, Review, View, Automate),
// drawn by the shared ribbon component (renderer/page-ribbon.js) in Folio's design system. Pure data: every control
// carries a command id that commands.js runs, so the full and the one-row layouts stay in step.
const B = (cmd, label, icon, key, opts = {}) => ({ cmd, label, icon, key, ...opts });
const big = (cmd, label, icon, key, opts) => ({ ...B(cmd, label, icon, key, opts), big: true });
const txt = (cmd, label, icon, key, opts) => B(cmd, label, icon, key, { ...opts, text: true });
const menu = { menu: true };

export const FONTS = [['', 'System'], ['Inter', 'Inter'], ['Arial', 'Arial'], ['Calibri', 'Calibri'], ['Aptos', 'Aptos'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Courier New', 'Courier New'], ['Verdana', 'Verdana']];
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72].map((n) => [String(n), String(n)]);
/** number formats of the Number group: [id, label, pattern] */
export const NUMBER_FORMATS = [
  ['general', 'General', 'General'], ['number', 'Number', '#,##0.00'], ['integer', 'Whole number', '#,##0'], ['currency', 'Currency', '"€"#,##0.00'],
  ['accounting', 'Accounting', '_("€"* #,##0.00_);_("€"* (#,##0.00);_("€"* "-"??_);_(@_)'], ['date', 'Short date', 'yyyy-mm-dd'], ['longdate', 'Long date', 'dddd, d mmmm yyyy'],
  ['time', 'Time', 'hh:mm:ss'], ['percent', 'Percentage', '0.00%'], ['fraction', 'Fraction', '# ?/?'], ['scientific', 'Scientific', '0.00E+00'], ['text', 'Text', '@'],
];

export const TABS = [
  { id: 'home', label: 'Home', groups: [
    { label: 'Clipboard', rank: 2, items: [big('x:paste', 'Paste', 'paste', 'Mod+V', menu), [[B('x:cut', 'Cut', 'cut', 'Mod+X')], [B('x:copy', 'Copy', 'copy', 'Mod+C')], [B('x:painter', 'Format painter', 'painter', null, { pressable: true })]]] },
    { label: 'Font', items: [[
      [B('x:font', 'Font', null, null, { select: FONTS, width: 132 }), B('x:size', 'Font size', null, null, { select: SIZES, width: 58 }), B('x:grow', 'Increase font size', 'grow'), B('x:shrink', 'Decrease font size', 'shrink')],
      [B('x:bold', 'Bold', 'bold', 'Mod+B', { pressable: true }), B('x:italic', 'Italic', 'italic', 'Mod+I', { pressable: true }), B('x:underline', 'Underline', 'underline', 'Mod+U', { pressable: true }), B('x:strike', 'Strikethrough', 'strike', null, { pressable: true }), B('x:borders', 'Borders', 'borders', null, menu), B('x:fill', 'Fill colour', 'fill', null, menu), B('x:fontColor', 'Font colour', 'fontColor', null, menu)],
    ]] },
    { label: 'Alignment', items: [[
      [B('x:vtop', 'Top align', 'top', null, { pressable: true }), B('x:vmiddle', 'Middle align', 'middle', null, { pressable: true }), B('x:vbottom', 'Bottom align', 'bottom', null, { pressable: true }), B('x:rotate', 'Orientation', 'rotate', null, menu), txt('x:wrap', 'Wrap text', 'wrap', null, { pressable: true })],
      [B('x:left', 'Align left', 'left', null, { pressable: true }), B('x:center', 'Centre', 'center', null, { pressable: true }), B('x:right', 'Align right', 'right', null, { pressable: true }), B('x:indentLess', 'Decrease indent', 'indentLess'), B('x:indentMore', 'Increase indent', 'indentMore'), txt('x:merge', 'Merge and centre', 'merge', null, menu)],
    ]] },
    { label: 'Number', items: [[
      [B('x:numfmt', 'Number format', null, null, { select: NUMBER_FORMATS.map(([id, l]) => [id, l]).concat([['more', 'More formats…']]), width: 150 })],
      [B('x:currency', 'Currency', 'euro', null, menu), B('x:percent', 'Percent style', 'percent'), B('x:comma', 'Thousands separator', 'hash'), B('x:decMore', 'Increase decimals', 'decMore'), B('x:decLess', 'Decrease decimals', 'decLess')],
    ]] },
    { label: 'Styles', rank: 3, items: [big('x:cf', 'Conditional formatting', 'props', null, menu), big('x:asTable', 'Format as table', 'table'), big('x:cellStyles', 'Cell styles', 'layers', null, menu)] },
    { label: 'Cells', rank: 4, items: [big('x:insertMenu', 'Insert', 'insertRows', null, menu), big('x:deleteMenu', 'Delete', 'deleteRows', null, menu), big('x:formatMenu', 'Format', 'ruler', null, menu)] },
    { label: 'Editing', rank: 1, items: [[[txt('x:autosum', 'AutoSum', 'sum', 'Alt+=', menu)], [txt('x:fillMenu', 'Fill', 'fillDown', null, menu)], [txt('x:clear', 'Clear', 'eraser', null, menu)]], big('x:sortFilter', 'Sort and filter', 'sortAz', null, menu), big('x:findMenu', 'Find and select', 'search', 'Mod+F', menu)] },
  ] },
  { id: 'insert', label: 'Insert', groups: [
    { label: 'Tables', items: [big('x:pivot', 'PivotTable', 'grid'), big('x:asTable', 'Table', 'table')] },
    { label: 'Illustrations', rank: 2, items: [big('x:image', 'Picture', 'image', null, menu)] },
    { label: 'Charts', items: [big('x:chart:column', 'Column', 'colChart'), [[B('x:chart:bar', 'Bar', 'barChart'), B('x:chart:line', 'Line', 'lineChart')], [B('x:chart:pie', 'Pie', 'pieChart'), B('x:chart:area', 'Area', 'areaChart')], [B('x:chart:scatter', 'Scatter', 'scatter'), B('x:chart:more', 'All charts', 'trend')]]] },
    { label: 'Filters', rank: 3, items: [[[txt('x:slicer', 'Slicer', 'slicer')], [txt('x:timeline', 'Timeline', 'timeline')]]] },
    { label: 'Controls', rank: 4, items: [[[txt('x:checkbox', 'Checkbox', 'checkbox')], [txt('x:dropdown', 'Drop-down list', 'listFilter')], [txt('x:button', 'Macro button', 'play')]], [[txt('x:form', 'Data form', 'form')], [txt('x:entity', 'Data type', 'blocks')]]] },
    { label: 'Links', rank: 5, items: [big('x:link', 'Link', 'link', 'Mod+K'), big('x:note', 'Note', 'note', 'Shift+F2')] },
  ] },
  { id: 'layout', label: 'Page Layout', groups: [
    { label: 'Page setup', items: [big('x:margins', 'Margins', 'ruler', null, menu), big('x:orientation', 'Orientation', 'rotate', null, menu), big('x:paper', 'Size', 'fileSheet', null, menu), big('x:printArea', 'Print area', 'grid', null, menu), big('x:printTitles', 'Print titles', 'rows')] },
    { label: 'Scale to fit', items: [[[B('x:fit', 'Scale', null, null, { select: [['1', 'Actual size'], ['width', 'Fit all columns'], ['page', 'Fit sheet on one page'], ['0.75', '75%'], ['0.5', '50%']], width: 150 })]]] },
    { label: 'Sheet options', items: [[[txt('x:printGrid', 'Print gridlines', 'grid', null, { pressable: true })], [txt('x:printHeadings', 'Print headings', 'cols', null, { pressable: true })]]] },
    { label: 'Output', items: [big('x:pageSetup', 'Page setup', 'ruler'), big('x:pdf', 'Export PDF', 'fileDown'), big('x:print', 'Print', 'print', 'Mod+P')] },
  ] },
  { id: 'formulas', label: 'Formulas', groups: [
    { label: 'Function library', items: [big('x:insertFn', 'Insert function', 'fx', 'Shift+F3'), big('x:autosum', 'AutoSum', 'sum', null, menu), [[txt('x:fn:financial', 'Financial', 'euro', null, menu)], [txt('x:fn:logical', 'Logical', 'check', null, menu)], [txt('x:fn:text', 'Text', 'textSearch', null, menu)]], [[txt('x:fn:date', 'Date and time', 'calendarClock', null, menu)], [txt('x:fn:lookup', 'Lookup', 'search', null, menu)], [txt('x:fn:math', 'Maths', 'calc', null, menu)]], [[txt('x:fn:stat', 'Statistical', 'trend', null, menu)], [txt('x:fn:array', 'Dynamic arrays', 'grid', null, menu)], [txt('x:fn:custom', 'Custom', 'braces', null, menu)]]] },
    { label: 'Defined names', items: [big('x:names', 'Name manager', 'names'), [[txt('x:defineName', 'Define name', 'tags')], [txt('x:useName', 'Use in formula', 'fx', null, menu)]]] },
    { label: 'Formula auditing', items: [[[txt('x:precedents', 'Trace precedents', 'trace')], [txt('x:dependents', 'Trace dependents', 'trace')], [txt('x:showFormulas', 'Show formulas', 'fx', 'Mod+`', { pressable: true })]], [[txt('x:errors', 'Error checking', 'warn')], [txt('x:circular', 'Circular references', 'refresh')], [txt('x:evaluate', 'Evaluate formula', 'play')]]] },
    { label: 'Calculation', items: [big('x:calcNow', 'Calculate now', 'calc', 'F9'), [[txt('x:calcMode', 'Automatic', 'gauge', null, menu)]]] },
  ] },
  { id: 'data', label: 'Data', groups: [
    { label: 'Workbook', rank: 2, items: [big('x:importFile', 'Import', 'fileIn'), [[txt('x:exportXlsx', 'Export to Excel', 'fileOut')], [txt('x:exportCsv', 'Export to CSV', 'fileDown')]]] },
    { label: 'Get and transform', items: [big('x:getData', 'Get data', 'database', null, menu), [[txt('x:queries', 'Queries', 'fileIn')], [txt('x:refreshAll', 'Refresh all', 'refresh', 'Mod+Alt+F5')], [txt('x:connections', 'Connections', 'link')]]] },
    { label: 'Data model', items: [big('x:model', 'Data model', 'model')] },
    { label: 'Sort and filter', items: [[[B('x:sortAz', 'Sort A to Z', 'sortAz')], [B('x:sortZa', 'Sort Z to A', 'sortZa')]], big('x:sortCustom', 'Sort', 'sortAz'), big('x:filter', 'Filter', 'filter', 'Mod+Shift+L', { pressable: true }), [[txt('x:filterClear', 'Clear', 'filterX')], [txt('x:filterReapply', 'Reapply', 'refresh')]]] },
    { label: 'Data tools', items: [[[txt('x:textToCols', 'Text to columns', 'split')], [txt('x:dedupe', 'Remove duplicates', 'dedupe')], [txt('x:validation', 'Data validation', 'checkbox')]]] },
    { label: 'Forecast', items: [big('x:whatif', 'What-if analysis', 'target', null, menu), big('x:simulate', 'Simulation', 'dice')] },
    { label: 'Analysis', rank: 1, items: [big('x:python', 'Python', 'python')] },
  ] },
  { id: 'review', label: 'Review', groups: [
    { label: 'Notes', items: [big('x:note', 'New note', 'note', 'Shift+F2'), [[txt('x:notesShow', 'Show all notes', 'eye', null, { pressable: true })]]] },
    { label: 'Protect', items: [big('x:protectSheet', 'Protect sheet', 'lock'), big('x:protectRange', 'Allow edit ranges', 'shield'), [[txt('x:encrypt', 'Encrypt sheets', 'fileLock')], [txt('x:sign', 'Sign workbook', 'sign')], [txt('x:verify', 'Check signature', 'check')]]] },
    { label: 'Changes', items: [big('x:history', 'Version history', 'history'), big('x:compare', 'Compare', 'compare'), big('x:audit', 'Activity', 'textSearch')] },
  ] },
  { id: 'view', label: 'View', groups: [
    { label: 'Show', items: [[[txt('x:gridlines', 'Gridlines', 'grid', null, { pressable: true })], [txt('x:formulaBar', 'Formula bar', 'fx', null, { pressable: true })]]] },
    { label: 'Zoom', items: [[[B('x:zoomOut', 'Zoom out', 'zoomOut', 'Mod+-'), B('x:zoom100', '100%', null, 'Mod+0', { label100: true }), B('x:zoomIn', 'Zoom in', 'zoomIn', 'Mod+=')], [txt('x:zoomSel', 'Zoom to selection', 'search')]]] },
    { label: 'Window', items: [big('x:freeze', 'Freeze panes', 'freeze', null, menu)] },
  ] },
  { id: 'automate', label: 'Automate', groups: [
    { label: 'Scripts', items: [big('x:scripts', 'Scripts', 'code'), [[txt('x:runMacro', 'Run macro', 'play', 'Alt+F8', menu)], [txt('x:newScript', 'New script', 'plus')]]] },
    { label: 'Functions', items: [big('x:udf', 'Custom functions', 'braces')] },
    { label: 'Extensions', items: [big('x:extensions', 'Hooks and extensions', 'puzzle')] },
    { label: 'Python', items: [big('x:python', 'Python', 'python')] },
  ] },
];

/** the one-row layout */
export const COMPACT = [
  [B('undo', 'Undo', 'undo', 'Mod+Z'), B('redo', 'Redo', 'redo', 'Mod+Shift+Z')],
  [B('x:font', 'Font', null, null, { select: FONTS, width: 112 }), B('x:size', 'Font size', null, null, { select: SIZES, width: 56 })],
  [B('x:bold', 'Bold', 'bold', 'Mod+B', { pressable: true }), B('x:italic', 'Italic', 'italic', 'Mod+I', { pressable: true }), B('x:underline', 'Underline', 'underline', 'Mod+U', { pressable: true }), B('x:fill', 'Fill colour', 'fill', null, menu), B('x:fontColor', 'Font colour', 'fontColor', null, menu), B('x:borders', 'Borders', 'borders', null, menu)],
  [B('x:left', 'Align left', 'left', null, { pressable: true }), B('x:center', 'Centre', 'center', null, { pressable: true }), B('x:right', 'Align right', 'right', null, { pressable: true }), B('x:wrap', 'Wrap text', 'wrap', null, { pressable: true }), B('x:merge', 'Merge and centre', 'merge', null, menu)],
  [B('x:numfmt', 'Number format', null, null, { select: NUMBER_FORMATS.map(([id, l]) => [id, l]), width: 120 }), B('x:percent', 'Percent style', 'percent'), B('x:decMore', 'Increase decimals', 'decMore'), B('x:decLess', 'Decrease decimals', 'decLess')],
  [B('x:autosum', 'AutoSum', 'sum', 'Alt+=', menu), B('x:filter', 'Filter', 'filter', null, { pressable: true }), B('x:sortAz', 'Sort A to Z', 'sortAz'), txt('x:insertQuick', 'Insert', 'plus', null, menu)],
];

/** every English label the ribbon shows (tests check each has a translation) */
export function ribbonLabels() {
  const out = new Set();
  const walk = (x) => { if (Array.isArray(x)) return x.forEach(walk); if (!x || typeof x !== 'object') return; if (x.label) out.add(x.label); if (x.tip) out.add(x.tip); if (x.select) for (const [v, l] of x.select) if (l && !/^\d+$/.test(l) && v !== '') out.add(l); if (x.groups) walk(x.groups); if (x.items) walk(x.items); };
  walk(TABS); walk(COMPACT);
  for (const [, l] of NUMBER_FORMATS) out.add(l);
  return [...out];
}
