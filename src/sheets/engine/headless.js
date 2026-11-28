// Folio Sheets — Univer without a window (area 18: headless and batch work). The same formula engine as the grid,
// so MCP, the command-line tool and what-if analysis compute exactly what the person sees.
import { Univer, LocaleType, UniverInstanceType, ICommandService } from '@univerjs/core';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverDataValidationPlugin } from '@univerjs/data-validation';
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation';
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter';
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting';
import { UniverSheetsNotePlugin } from '@univerjs/sheets-note';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-filter/facade';
import '@univerjs/sheets-data-validation/facade';
import '@univerjs/sheets-conditional-formatting/facade';
import '@univerjs/sheets-note/facade';
import '@univerjs/sheets-numfmt/facade';
import { toRange, splitRef } from '../core/a1.js';
import { tuneFormulaCache } from '../core/formula-cache.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** one Univer per process; workbooks are units inside it */
export async function createHeadless({ functions = {}, tune = true } = {}) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: {} } });
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: false });
  univer.registerPlugin(UniverSheetsPlugin, { notExecuteFormula: false });
  univer.registerPlugin(UniverSheetsFormulaPlugin, { notExecuteFormula: false });
  univer.registerPlugin(UniverDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationPlugin);
  univer.registerPlugin(UniverSheetsFilterPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingPlugin);
  univer.registerPlugin(UniverSheetsNotePlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  if (tune) tuneFormulaCache(univer);
  const api = FUniver.newAPI(univer);
  const formula = api.getFormula();
  for (const [name, fn] of Object.entries(functions)) formula.registerFunction?.(name, fn);
  let busy = 0, gen = 0, started = 0;
  const waiters = new Set();
  formula.calculationStart(() => { busy++; started++; });
  formula.calculationEnd(() => { busy = Math.max(0, busy - 1); gen++; for (const w of waiters) w(); });
  /** wait until formulas have been computed and applied. Univer starts a calculation ~12 ms after an edit (it batches
   *  edits); when none starts within `idle` ms the edit touched no formula. */
  async function settle(max = 30000, idle = 40) {
    const s0 = started, g0 = gen, t0 = Date.now();
    await new Promise((resolve) => {
      const done = () => { if (!busy && gen > g0 && started > s0) finish(); };
      const finish = () => { waiters.delete(done); clearTimeout(tIdle); clearTimeout(tMax); resolve(); };
      const tIdle = setTimeout(() => { if (started === s0 && !busy) finish(); }, idle);
      const tMax = setTimeout(finish, max);
      waiters.add(done);
    });
    await sleep(0);
    if (Date.now() - t0 >= max) throw new Error('The calculation took too long.');
  }
  const commands = univer.__getInjector().get(ICommandService);

  let opened = 0; const usedIds = new Set();
  async function open(data) {
    // an id already used in this engine gets a fresh one (wb.id says which): Univer's plugins (validation, formatting
    // rules) keep state per unit id, and a workbook opened again under the same id would meet the rules of the one before
    const fresh = usedIds.has(data.id) ? `${data.id || 'wb'}~${++opened}` : data.id;
    usedIds.add(fresh);
    const json = fresh === data.id ? null : JSON.stringify(data).split(`"${data.id}"`).join(`"${fresh}"`).split(`\\"${data.id}\\"`).join(`\\"${fresh}\\"`);
    const unit = univer.createUnit(UniverInstanceType.UNIVER_SHEET, json ? { ...JSON.parse(json), id: fresh } : structuredClone(data));
    const id = unit.getUnitId();
    api.setCurrent?.(id);
    const fwb = api.getWorkbook(id);
    await settle();
    const sheet = (name) => (name ? fwb.getSheetByName(name) : fwb.getActiveSheet()) || (() => { throw new Error(`No sheet named ${name}`); })();
    return {
      id, api, fwb,
      save: () => fwb.save(),
      sheet,
      /** computed values of a range: "Sheet!A1:B2" or (sheet, "A1:B2") */
      values(name, a1) { if (a1 === undefined) ({ sheet: name, range: a1 } = splitRef(name)); return sheet(name).getRange(a1).getRawValues(); },
      display(name, a1) { if (a1 === undefined) ({ sheet: name, range: a1 } = splitRef(name)); return sheet(name).getRange(a1).getDisplayValues(); },
      formulas(name, a1) { return sheet(name).getRange(a1).getFormulas(); },
      set(name, a1, v) { const r = sheet(name).getRange(a1); Array.isArray(v) ? r.setValues(v) : r.setValue(v); },
      async setAndSettle(name, a1, v) { this.set(name, a1, v); await settle(); },
      addSheet(name) { return fwb.insertSheet(name); },
      sheetNames: () => fwb.getSheets().map((s) => s.getSheetName()),
      /** whole used area of every sheet as computed values */
      usedValues() {
        const out = {};
        for (const s of fwb.getSheets()) { const r = s.getDataRange(); out[s.getSheetName()] = r.getRawValues(); }
        return out;
      },
      settle,
      onMutation: (fn) => commands.onCommandExecuted((c) => { if (c.type === 2) fn(c); }),
      dependents: (a1, name) => formula.getRangeDependents?.([{ unitId: id, sheetId: sheet(name).getSheetId(), range: toRange(a1) }]),
      precedents: (a1, name) => { const p = toRange(a1); return formula.getCellDependencyTree?.({ unitId: id, sheetId: sheet(name).getSheetId(), row: p.startRow, column: p.startColumn }); },
    };
  }
  return {
    univer, api, open, settle,
    close(wb) { univer.__getInjector(); api.disposeUnit?.(wb.id) ?? univer.disposeUnit?.(wb.id); },
    dispose() { univer.dispose(); },
  };
}
