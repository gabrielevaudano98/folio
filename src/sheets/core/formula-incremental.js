// Folio Sheets — incremental recalculation on top of Univer's formula engine.
//
// Why: at every recalculation Univer 1.6 reads every formula of every open workbook again and rebuilds one dependency
// object per formula cell (FormulaDependencyGenerator._generateTreeList), even when the edit only changed a number or
// a single formula. At 100k formulas that is ~1 s per edit before the first formula is computed.
//
// What this does: after a full pass it remembers the objects Univer built, one per formula cell. At the next
// recalculation it compares every cell's formula (text, shared-formula id, offsets) with the remembered one:
//   - nothing changed: it hands Univer the same objects back, with their per-run state reset;
//   - a few cells changed (a formula typed, filled, pasted, removed; a workbook opened or reloaded): Univer builds
//     objects for those cells only (whole shared-formula runs they belong to), the rest are handed back;
//   - anything else: Univer's own full pass, as before.
// Univer then does everything else as usual: finds what depends on the edited cells, orders it, computes it.
// Anything outside the formulas themselves sends the recalculation down the full path:
//   sheet order, names or sizes changed; a forced calculation; a sheet renamed/inserted/removed; a defined name or table
//   changed; feature or "other" formulas (validation, conditional formatting); address functions (INDIRECT, OFFSET);
//   iterative or external-reference calculation; the array-formula second pass; a changed set too large to be worth it.
// Univer's dependency index is watched too: whatever removes entries from it outside a pass (a formula set again in
// its cell, a workbook closed, a defined name changed) makes the module forget those cells.
//
// Which cells are dirty is decided each time with Univer's own rules (volatile functions, as recorded by Univer's own
// check during the full pass; cells inside the edited ranges). test/sheets-formula-cache.test.mjs compares the values
// with stock Univer after random edits. Off switch: enableIncrementalRecalc(univer, { enabled: false }) or
// localStorage 'folio.sheets.incremental' = 'off' in the window.
import { IFormulaDependencyGenerator } from '@univerjs/engine-formula';

const nonEmpty = (o) => {
  if (o == null) return false;
  if (o instanceof Map) { for (const v of o.values()) if (v instanceof Map ? nonEmpty(v) : v != null) return true; return false; }
  if (typeof o !== 'object') return Boolean(o);
  for (const k in o) { const v = o[k]; if (v != null && (typeof v !== 'object' || nonEmpty(v) || typeof v.forValue === 'function')) return true; }
  return false;
};
/** a partial pass is worth it below this share of the formulas (and this many cells) */
const PARTIAL_SHARE = 0.25, PARTIAL_MAX = 20000;

/** what the dependency objects of a sheet are made of, besides its formulas: order, names, sizes of every sheet */
function sheetSignature(cfg, unitData) {
  let sig = '';
  for (const unitId of Object.keys(unitData || {})) {
    const info = cfg.getSheetsInfo?.(unitId) || {};
    sig += `${unitId}|${JSON.stringify(info.sheetOrder || [])}|${JSON.stringify(info.sheetNameMap || {})}|`;
    const sheets = unitData[unitId] || {};
    for (const sheetId of Object.keys(sheets)) sig += `${sheetId}:${sheets[sheetId]?.rowCount}:${sheets[sheetId]?.columnCount};`;
  }
  return sig;
}
const same = (a, b) => b && a.f === b.f && a.si === b.si && (a.x || 0) === b.x && (a.y || 0) === b.y;
const copyItem = (it) => ({ f: it.f, si: it.si, x: it.x || 0, y: it.y || 0 });

/**
 * Turn the incremental path on for one Univer instance (the worker's, the headless engine's or the window's).
 * Returns { stats, remembered, disable(), enable() }, or null when Univer's internals are not the ones this was written
 * for (then Univer works exactly as before).
 */
export function enableIncrementalRecalc(univer, { enabled = true } = {}) {
  if (!enabled) return null;
  let gen;
  try { gen = univer.__getInjector().get(IFormulaDependencyGenerator); } catch { return null; }
  const need = ['_generateTreeList', '_detectForcedRecalculationNode', '_updateReferenceContext'];
  if (!gen || need.some((k) => typeof gen[k] !== 'function') || !(gen._dependencyTreeCache instanceof Map) || !(gen._updateRangeFlattenCache instanceof Map)
    || !gen._currentConfigService || !gen._otherFormulaManagerService || !gen._featureCalculationManagerService) return null;
  const cfg = gen._currentConfigService;
  const cfgNeed = ['isForceCalculate', 'getClearDependencyTreeCache', 'getDirtyNameMap', 'getDirtyDefinedNameMap', 'getDirtyUnitFeatureMap', 'getDirtyUnitOtherFormulaMap', 'getDirtyData', 'getExcludedRange', 'getSheetsInfo'];
  if (cfgNeed.some((k) => typeof cfg[k] !== 'function')) return null;
  const dm = gen._dependencyManagerService, units = gen._univerInstanceService;
  if (!dm || typeof dm.getFormulaDependency !== 'function' || !units || typeof units.getUnit !== 'function') return null;

  const stats = { fast: 0, partial: 0, full: 0, why: {} };
  const count = (why) => { stats.why[why] = (stats.why[why] || 0) + 1; };
  // memo: what the last passes built. byId: treeId -> { tree, ranges, volatile }; formulas: unit -> sheet -> row -> col
  // -> { f, si, x, y } for every cell whose object is in byId; units: unitId -> the workbook object it was built for
  let memo = null, recording = null, on = true, inPass = false, tainted = false;

  /* ---- Univer's dependency index, watched ---- */
  const forgetCell = (u, s, r, c) => {
    if (!memo) return;
    const id = dm.getFormulaDependency(u, s, r, c);
    if (id != null) memo.byId.delete(id);
    const row = memo.formulas[u]?.[s]?.[r];
    if (row && row[c] != null) { delete row[c]; memo.cells--; }
  };
  const forgetSheet = (u, s) => {
    if (!memo) return;
    for (const [id, e] of memo.byId) if (e.tree.unitId === u && (s == null || e.tree.subUnitId === s)) memo.byId.delete(id);
    const sheets = memo.formulas[u]; if (!sheets) return;
    for (const sid of s == null ? Object.keys(sheets) : [s]) { const rows = sheets[sid]; if (!rows) continue; for (const r in rows) memo.cells -= Object.keys(rows[r]).length; delete sheets[sid]; }
  };
  const wrap = (name, before) => { const f = dm[name]; if (typeof f === 'function') dm[name] = function (...args) { before(...args); return f.apply(this, args); }; };
  // removals never come from a pass; one that arrives while a pass waits (a custom function's answer) spoils that pass
  wrap('removeFormulaDependency', (u, s, r, c) => { tainted = true; forgetCell(u, s, r, c); });
  wrap('clearFormulaDependency', (u, s) => { tainted = true; forgetSheet(u, s); });
  for (const name of ['removeOtherFormulaDependency', 'clearOtherFormulaDependency', 'removeFeatureFormulaDependency', 'clearFeatureFormulaDependency',
    'removeFormulaDependencyByDefinedName', 'removeAllFormulaDependency']) wrap(name, () => { tainted = true; if (memo) count(`forgot: ${name}`); memo = null; });
  // additions come from the passes; from anywhere else nothing remembered can be trusted
  for (const name of ['reset', 'addFormulaDependency', 'addOtherFormulaDependency', 'addFeatureFormulaDependency', 'addFormulaDependencyByDefinedName',
    'addDependencyRTreeCache', 'updateDependencyTreeDirtyState']) wrap(name, () => { if (!inPass) { if (memo) count(`forgot: ${name}`); memo = null; } });

  const originalDetect = gen._detectForcedRecalculationNode;
  gen._detectForcedRecalculationNode = function (tree, node) {
    const v = originalDetect.call(this, tree, node);
    if (recording) recording.set(tree, v);
    return v;
  };

  /** why the remembered objects cannot be used at all now, or '' */
  function refuse(otherFormulaData, unitData) {
    if (!memo) return 'nothing remembered';
    if (cfg.isForceCalculate()) return 'forced';
    if (nonEmpty(cfg.getClearDependencyTreeCache())) return 'dependency cache cleared';
    if (nonEmpty(cfg.getDirtyNameMap())) return 'sheet names changed';
    if (nonEmpty(cfg.getDirtyDefinedNameMap())) return 'defined names changed';
    if (nonEmpty(cfg.getDirtySuperTableMap?.())) return 'tables changed';
    if (nonEmpty(cfg.getDirtyUnitFeatureMap())) return 'feature formulas dirty';
    if (nonEmpty(cfg.getDirtyUnitOtherFormulaMap())) return 'other formulas dirty';
    const dirty = cfg.getDirtyData() || {};
    if (dirty.dirtyIterationUnits?.length || dirty.dirtyReferenceUnits?.length) return 'iterative or external';
    if (nonEmpty(cfg.getExcludedRange())) return 'array formula pass';
    if (nonEmpty(otherFormulaData)) return 'other formulas';
    if (nonEmpty(gen._featureCalculationManagerService.getReferenceExecutorMap?.())) return 'feature formulas';
    if (memo.signature !== sheetSignature(cfg, unitData)) return 'sheets changed';
    return '';
  }

  /** cells whose formula differs from the remembered one (added or changed) and remembered cells now gone */
  function diff(formulaData) {
    const changed = [], gone = [];
    let seen = 0;
    for (const u in formulaData) {
      for (const s in formulaData[u]) {
        const rows = formulaData[u][s] || {}; const known = memo.formulas[u]?.[s];
        for (const r in rows) {
          const cols = rows[r]; if (!cols) continue; const kr = known?.[r];
          for (const c in cols) {
            const it = cols[c]; if (it == null) continue;
            if (same(it, kr?.[c])) seen++; else changed.push([u, s, r, c]);
          }
        }
      }
    }
    if (seen !== memo.cells) {
      for (const u in memo.formulas) for (const s in memo.formulas[u]) for (const r in memo.formulas[u][s]) for (const c in memo.formulas[u][s][r]) {
        const it = formulaData[u]?.[s]?.[r]?.[c];
        if (it == null) gone.push([u, s, r, c]);
      }
    }
    return { changed, gone };
  }

  /** the part of formulaData to rebuild: changed cells and every cell of a shared run that one of them is in or was in */
  function partOf(formulaData, changed, gone) {
    const part = Object.create(null); let n = 0;
    const add = (u, s, r, c) => {
      const it = formulaData[u]?.[s]?.[r]?.[c]; if (it == null) return;
      const ps = ((part[u] ||= Object.create(null))[s] ||= Object.create(null));
      const pr = (ps[r] ||= Object.create(null));
      if (pr[c] == null) { pr[c] = it; n++; }
    };
    const runs = new Map(); // "u\0s" -> Set of si
    const run = (u, s, si) => { if (si == null) return; const k = `${u}\u0000${s}`; (runs.get(k) || runs.set(k, new Set()).get(k)).add(si); };
    for (const [u, s, r, c] of changed) { add(u, s, r, c); run(u, s, formulaData[u][s][r][c].si); run(u, s, memo.formulas[u]?.[s]?.[r]?.[c]?.si); }
    for (const [u, s, r, c] of gone) run(u, s, memo.formulas[u]?.[s]?.[r]?.[c]?.si);
    for (const [k, sis] of runs) {
      const [u, s] = k.split('\u0000'); const rows = formulaData[u]?.[s] || {};
      for (const r in rows) { const cols = rows[r]; if (!cols) continue; for (const c in cols) if (cols[c] != null && sis.has(cols[c].si)) add(u, s, r, c); }
    }
    return { part, n };
  }

  /** hand a remembered object back, with what a fresh pass would have given it */
  function reuse(e) {
    const t = e.tree, flat = gen._updateRangeFlattenCache;
    t._state = 0; t.cycleGroup = undefined; t.isCache = true;
    if (!t.isVirtual) { t.rangeList = e.ranges.slice(); t.addressFunctionNodes = []; }
    let dirty = e.volatile;
    if (!dirty) {
      const ranges = flat.get(t.unitId)?.get(t.subUnitId);
      if (ranges) for (const r of ranges) if (t.inRangeData(r)) { dirty = true; break; }
    }
    t.isDirty = dirty;
    gen._dependencyTreeCache.set(t.treeId, t);
  }

  /** the entries for trees a pass built, or null if one of them is not a kind this module hands back */
  function entries(trees, volatile) {
    const out = [];
    for (const t of trees) {
      if (t.type !== 0 || t.featureId != null || t.formulaId != null || !t.formula) return null;
      if (t.addressFunctionNodes?.length) return null;
      if (!volatile.has(t)) return null; // Univer did not check it: do not guess
      if (t.isVirtual && (!t.refTree || !trees.includes?.(t.refTree) && !gen._dependencyTreeCache.has(t.refTree.treeId))) return null;
      out.push({ tree: t, ranges: t.isVirtual ? null : t.rangeList.slice(), volatile: volatile.get(t) === true });
    }
    return out;
  }

  function fresh(formulaData, unitData, list) {
    const es = entries(list, recording || new Map());
    if (!es) return null;
    const m = { byId: new Map(), formulas: Object.create(null), cells: 0, signature: sheetSignature(cfg, unitData), units: new Map(Object.keys(unitData || {}).map((id) => [id, units.getUnit(id)])) };
    for (const e of es) m.byId.set(e.tree.treeId, e);
    for (const u in formulaData) for (const s in formulaData[u]) for (const r in formulaData[u][s]) {
      const cols = formulaData[u][s][r]; if (!cols) continue;
      for (const c in cols) if (cols[c] != null) { (((m.formulas[u] ||= Object.create(null))[s] ||= Object.create(null))[r] ||= Object.create(null))[c] = copyItem(cols[c]); m.cells++; }
    }
    return m;
  }

  async function full(self, args, why) {
    stats.full++; count(why);
    memo = null;
    recording = new Map(); inPass = true; tainted = false;
    let list;
    try { list = await original.call(self, ...args); } finally { inPass = false; }
    const [formulaData, , unitData] = args;
    if (on && !tainted) { try { memo = fresh(formulaData, unitData, [...gen._dependencyTreeCache.values()]); } catch { memo = null; } }
    recording = null;
    return list;
  }

  const original = gen._generateTreeList;
  gen._generateTreeList = async function (formulaData, otherFormulaData, unitData) {
    const args = [formulaData, otherFormulaData, unitData];
    if (!on) return full(this, args, 'off');
    const why = refuse(otherFormulaData, unitData);
    if (why) return full(this, args, why);
    for (const [id, unit] of memo.units) if (units.getUnit(id) !== unit) forgetSheet(id); // a workbook closed and opened again
    const { changed, gone } = diff(formulaData);
    for (const [u, s, r, c] of gone) forgetCell(u, s, r, c);
    if (!changed.length) {
      // the same comparison Univer makes; with identical sheets it reports no change, which keeps its state current
      if (gen._updateReferenceContext(unitData)) return fullAfterContext(this, args);
      stats.fast++;
      for (const e of memo.byId.values()) reuse(e);
      return [...gen._dependencyTreeCache.values()];
    }
    const { part, n } = partOf(formulaData, changed, gone);
    if (n > PARTIAL_MAX || n > PARTIAL_SHARE * (memo.cells + n)) return full(this, args, 'many formulas changed');
    // forget what is rebuilt, then let Univer build it
    for (const u in part) for (const s in part[u]) for (const r in part[u][s]) for (const c in part[u][s][r]) forgetCell(u, s, r, c);
    gen._dependencyTreeCache.clear();
    recording = new Map(); inPass = true; tainted = false;
    let built;
    try { built = await original.call(this, part, otherFormulaData, unitData); } finally { inPass = false; }
    const made = [...gen._dependencyTreeCache.values()];
    const es = !tainted && memo ? entries(made, recording) : null;
    recording = null;
    if (!es) {
      // something this module does not hand back (an address function…), or the index changed meanwhile: start over
      gen._dependencyTreeCache.clear();
      return full(this, args, 'partial pass not reusable');
    }
    stats.partial++;
    for (const e of memo.byId.values()) if (!gen._dependencyTreeCache.has(e.tree.treeId)) reuse(e);
    for (const e of es) memo.byId.set(e.tree.treeId, e);
    for (const u in part) for (const s in part[u]) for (const r in part[u][s]) for (const c in part[u][s][r]) {
      (((memo.formulas[u] ||= Object.create(null))[s] ||= Object.create(null))[r] ||= Object.create(null))[c] = copyItem(part[u][s][r][c]); memo.cells++;
    }
    for (const id of Object.keys(unitData || {})) memo.units.set(id, units.getUnit(id));
    return built;
  };

  /** Univer saw a change the signature did not (it has already recorded the new context): a full pass that knows it */
  async function fullAfterContext(self, args) {
    const update = gen._updateReferenceContext; gen._updateReferenceContext = () => true;
    try { return await full(self, args, 'reference context'); } finally { gen._updateReferenceContext = update; }
  }

  return {
    stats,
    get enabled() { return on; },
    get remembered() { return memo ? memo.byId.size : 0; },
    disable() { on = false; memo = null; },
    enable() { on = true; },
  };
}
