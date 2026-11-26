# Folio Script — macros, custom functions and hooks

Folio Script is plain JavaScript in ```` ```script Name ```` ```` blocks of a workbook, with an API shaped like Google
Apps Script and Excel's object model. It replaces VBA for Folio workbooks; an imported `.xlsm` keeps its VBA project
untouched for export (see [README](README.md#area-25)).

````markdown
```script Macros
function addTotals() {                              // a macro: Automate → Run macro, or a button on the sheet
  const sh = Workbook.active();
  const last = sh.lastRow();
  sh.range(`F${last + 1}`).setFormula(`=SUM(F2:F${last})`).setBold(true);
  ui.toast('Totals added');
}

function VAT(amount, rate = 0.22) {                 // UPPER_CASE: a custom function, =VAT(B2) in a cell
  return Math.round(amount * rate * 100) / 100;
}

function onEdit(e) {                                // a hook (only when hooks are allowed for this file)
  if (e.sheet === 'Orders' && e.column === 4) Workbook.sheet('Log').appendRow([new Date().toISOString(), e.value]);
}
```
````

## API

| Object | Members |
|---|---|
| `Workbook` | `active()`, `sheet(name)`, `sheets()` / `getSheets()`, `getSheetByName(name)`, `selection()`, `insertSheet(name)`, `deleteSheet(name or sheet)`, `name(definedName)` |
| `Sheet` | `name`, `range("A1:C3")`, `range(row, col, rows, cols)`, `cell(row, col)`, `lastRow()`, `lastColumn()`, `dataRange()`, `appendRow([…])`, `find(text, { matchCase, entireCell })`, `createTextFinder(text)`, `insertRowsBefore/After(row, n)`, `deleteRows(row, n)`, `insertColumnsBefore/After(col, n)`, `deleteColumns(col, n)`, `setColumnWidth(col, px)`, `setRowHeight(row, px)`, `setFrozenRows(n)`, `setFrozenColumns(n)`, `setName(name)`, `clear()`, `activate()` |
| `Range` | `getValue()`, `getValues()`, `getFormula()`, `getFormulas()`, `getDisplayValues()`, `setValue(v)`, `setValues([[…]])`, `setFormula("=…")`, `setFormulas`, `clear()`, `setBold()`, `setItalic()`, `setBackground(c)`, `setFontColor(c)`, `setNumberFormat(p)`, `setHorizontalAlignment(a)`, `setVerticalAlignment(a)`, `setFontSize(n)`, `setFontFamily(f)`, `setFontWeight(w)`, `setFontStyle(s)`, `setUnderline()`, `setStrikethrough()`, `setWrap()`, `setBorder(top, left, bottom, right, vertical, horizontal, colour, style)` or `setBorder('all' \| 'outside' \| 'none', colour, style)`, `merge()`, `mergeAcross()`, `breakApart()`, `sort(column \| { column, ascending } \| [ … ])`, `find(text)`, `setNote(t)`, `offset(r, c, rows, cols)`, `getA1Notation()`, `getRow()`, `getColumn()`, `getNumRows()`, `getNumColumns()`, `activate()` |
| `ui` | `toast(message)`, `alert(message)` |
| `console` / `log` | `console.log(…)` — shown in the Scripts panel |
| `SpreadsheetApp` | `getActive()`, `getActiveSpreadsheet()`, `getActiveSheet()`, `getUi()` — for code written for Apps Script |

Setters return the range or the sheet, so calls chain. Rows and columns are 1-based everywhere, as in Apps Script.
`sort` reorders the rows of the range (empty cells last, text compared naturally: "Item 2" before "Item 10"); inserting
or deleting rows moves what the script reads at once, and the formulas move when the steps replay in the grid.

## How it runs

1. The window asks the data engine (`script.run`) with the workbook text; the engine computes every formula on a
   headless Univer and gives the script a copy: values, formulas, the active sheet and the selection.
2. The script runs in **QuickJS** compiled to WebAssembly (`quickjs-emscripten`): no `require`, `process`, `fetch`,
   file system, network or DOM; 64 MB of memory, 512 KB of stack, 5 seconds (1 second per custom-function call).
3. Writes do not touch the file. The script returns a list of operations (`values`, `clear`, `style`, `note`, `merge`,
   `unmerge`, `insertRows`, `deleteRows`, `insertCols`, `deleteCols`, `colWidth`, `rowHeight`, `freeze`, `insertSheet`,
   `deleteSheet`, `renameSheet`, `activate`, `select`; listed in `src/sheets/core/replay.js`).
4. The window replays them through Univer's commands (`replayOps`, the same code the tests run on the headless engine):
   undoable, recorded in the operation log, saved like any edit, and refused by a protected sheet like any edit.

Reads inside one run see the script's own earlier writes. Formulas a script writes are computed when the grid
recalculates after the run.

Custom functions run in a warm sandbox per script text (at most four kept), registered with Univer's formula engine as
asynchronous functions; an error shows as `#ERROR: message` in the cell.

## Hooks and extensions

- `onOpen()`, `onEdit({ sheet, row, column, value })`, `onSelectionChange({ sheet, range })` run only when
  **Automate → Scripts → Hooks → Run hooks in this workbook** is on (stored as `scripts.hooks` in the workbook settings).
  A hook that fails shows a message and does not stop editing.
- Code inside Folio extends sheets through `surface.extensions.register({ id, name, commands, functions, onOpen, onEdit, onSave })`
  (`src/sheets/ui/extensions.js`): commands appear under Automate, functions in the formula engine.
