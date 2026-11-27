// Folio Sheets — the sheet surface: Folio's ribbon + Univer's grid + a side panel, over a .sheet.md file.
// Contract with app.js (same as every surface): mount(host, ctx) → { setText, setMode, focus, gotoCell, selectAtLine }.
// The file is the model: setText() loads it into Univer; edits come back as ctx.onChange(text) through convert.js,
// which leaves untouched sheets byte-identical.
//
// `surface` below is the API every panel and command uses (docs/sheets/README.md, "Renderer API"):
// read and write ranges, call the data engine, keep Folio's own settings (charts, slicers, print, protection…),
// replay script operations, and the hooks an extension can attach to.
import { buildRibbon, wireRibbon, setComboValue } from '../../renderer/page-ribbon.js';
import { toUniver, fromUniver, fromUniverAsync, folioMeta } from '../core/convert.js';
import { replayOps } from '../core/replay.js';
import { setFence, readDoc } from '../core/sheetmd.js';
import { splitRef, toRange, addr, quoteSheet, parseAddr, fromRange } from '../core/a1.js';
import { startUniver } from './univer.js';
import { createCommands } from './commands.js';
import { TABS, COMPACT, NUMBER_FORMATS } from './ribbon.js';
import { numfmt, IUniverInstanceService, IResourceManagerService, IUndoRedoService, UniverInstanceType } from '@univerjs/core';
import { icons as xsIcons } from './icons.js';
import { L } from './i18n.js';
import { createPanels } from './panels/index.js';
import { createCharts } from './charts.js';
import { createFloats } from './floats.js';
import { createProtection } from './protection.js';
import { createExtensions } from './extensions.js';
import { createOpLog } from '../core/collab.js';
import { engine } from './engine-client.js';
import { applyValues, storeValues } from './value-cache.js';
import { locale } from '../../renderer/i18n.js';

const CSS_ID = 'folio-univer-css';
function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const link = Object.assign(document.createElement('link'), { id: CSS_ID, rel: 'stylesheet', href: 'sheets-univer.css' });
  document.head.append(link);
}
/** mutations that do not change the document: formula results, view state */
const NOT_A_CHANGE = /^(formula\.|sheet\.mutation\.set-worksheet-row-is-auto-height|sheet\.mutation\.set-worksheet-row-auto-height|sheet\.mutation\.set-zoom|sheet\.mutation\.set-selections|sheet\.mutation\.set-worksheet-activate|sheet\.mutation\.set-scroll|sheet\.mutation\.toggle-gridlines-color|sheet\.mutation\.set-float-dom|sheet\.mutation\.remove-float-dom)/;

export function mountSheet(host, ctx) {
  ensureCss();
  const icons = { ...ctx.icons, ...xsIcons };
  host.classList.add('xs');
  host.innerHTML = `${buildRibbon({ icons, keyLabel: ctx.keyLabel, tabs: TABS, compact: COMPACT, label: L, trailing: '' })}
    <div class="xs-main">
      <div class="xs-grid" role="application" aria-label="${L('Spreadsheet')}"></div>
      <aside class="xs-dock" hidden aria-labelledby="xs-dock-title">
        <div class="xs-dock-resize" role="separator" aria-orientation="vertical" aria-label="${L('Resize panel')}" tabindex="0"></div>
        <header class="xs-dock-head"><h2 id="xs-dock-title" class="xs-dock-title" tabindex="-1"></h2><button class="rb" type="button" data-dock-close aria-label="${L('Close panel')}" data-tip="${L('Close panel')}">${icons.close}</button></header>
        <div class="xs-dock-body"></div>
      </aside>
    </div>`;
  const ribbonEl = host.querySelector('.ribbon');
  const gridEl = host.querySelector('.xs-grid');
  // formulas are computed in a Web Worker (the grid stays responsive on large workbooks); `folio.sheets.worker` = 'off'
  // in localStorage keeps them on the window's thread, as before
  const workerOff = (() => { try { return localStorage.getItem('folio.sheets.worker') === 'off'; } catch { return false; } })();
  let udfImpl = null; // set below, once the surface exists
  const U = startUniver(gridEl, { lang: locale(), dark: !!ctx.isDark?.(), worker: !workerOff, udf: (name, args) => udfImpl?.(name, args) ?? '#NAME?',
    onWorkerFailed: () => { try { localStorage.setItem('folio.sheets.worker', 'off'); } catch { /* private storage */ } ctx.toast(L('Formulas could not be computed in the background. Close and reopen the workbook to compute them here.'), { kind: 'error' }); } });
  const { api } = U;

  // a recalculation that takes longer than ~0.4 s (big workbooks: Univer re-reads every formula) says so, so stale totals
  // are not mistaken for a broken sheet; short ones never flash it
  const busyEl = document.createElement('div');
  busyEl.className = 'xs-busy'; busyEl.setAttribute('role', 'status'); busyEl.hidden = true; busyEl.textContent = L('Calculating…');
  host.querySelector('.xs-main').append(busyEl);
  let busyTimer = null, busyGuard = null, calcs = 0;
  try {
    const fm = api.getFormula();
    fm.calculationStart?.(() => { calcs++; clearTimeout(busyTimer); busyTimer = setTimeout(() => { busyEl.hidden = false; }, 400); clearTimeout(busyGuard); busyGuard = setTimeout(() => { calcs = 0; busyEl.hidden = true; }, 120_000); });
    fm.calculationEnd?.(() => { calcs = Math.max(0, calcs - 1); if (calcs === 0) { clearTimeout(busyTimer); clearTimeout(busyGuard); busyEl.hidden = true; } });
  } catch { /* the indicator is a courtesy */ }

  /* ---------- state ---------- */
  let text = null;          // the text last loaded or written
  let loaded = null;        // what toUniver() returned for it
  let unitId = null;
  let docTab = null;        // the document (the app's tab object) this workbook was loaded for
  let loading = false;      // mutations while loading are not edits
  let sheetMeta = {};       // Folio's own meta per sheet id: charts, print, slicers, protection…
  let workbookMeta = {};    // Folio's own workbook settings: scenarios, print, source, loads…
  let actor = 'me';
  let oplog = createOpLog({ actor }); // one per open workbook (kept with it while it is hidden)
  ctx.userName?.().then?.((n) => { if (n) { actor = n; oplog.actor = n; } }).catch?.(() => {});

  const wb = () => api.getActiveWorkbook();
  const ws = () => wb()?.getActiveSheet();
  const sheetByName = (n) => (n ? wb()?.getSheetByName(n) : ws());

  const surface = {
    icons, ctx, L,
    get oplog() { return oplog; },
    wb, ws,
    range: () => wb()?.getActiveRange(),
    sheetId: () => ws()?.getSheetId(),
    sheetName: () => ws()?.getSheetName(),
    sheetNames: () => wb()?.getSheets().map((s) => s.getSheetName()) || [],
    unitId: () => unitId,
    /** Univer's formula facade: dependency trees, calculation control, custom functions */
    formulaApi: () => api.getFormula(),
    /** Univer's facade (FUniver), for extensions and tests */
    univerApi: () => api,
    /** formulas computed in a Web Worker (formula-worker.js) */
    univerWorker: () => U.worker,
    /** how long the last save took, in ms (the save delay adapts to it) */
    lastSaveMs: () => saveMs,
    registerWorkerFunctions: (names) => U.registerWorkerFunctions(names),
    /** run a Univer command by id (its own panels and operations) */
    exec: (id, params) => U.commands.executeCommand(id, params),
    meta: (id = surface.sheetId()) => (sheetMeta[id] ||= {}),
    metaByName: (name) => { const s = sheetByName(name); return s ? surface.meta(s.getSheetId()) : null; },
    workbook: () => workbookMeta,
    // the blocks as last loaded or set (setFence re-reads them; grid edits never touch them): re-parsing the whole
    // file here cost ~85 ms per edit on a 50k-row workbook, since every edit asks for the script code (hooks, UDFs)
    fences: (lang) => (loaded?.doc?.fences || readDoc(text || '').fences).filter((f) => !lang || f.lang === lang),
    /** change Folio-owned meta and write the file */
    setMeta(patch, id = surface.sheetId()) { const m = surface.meta(id); Object.assign(m, patch); for (const [k, v] of Object.entries(patch)) if (v == null) delete m[k]; save(); },
    setWorkbook(patch) { Object.assign(workbookMeta, patch); for (const [k, v] of Object.entries(patch)) if (v == null) delete workbookMeta[k]; save(); },
    /** add, replace or remove (body null) a named block: ```fql Sales``` etc. */
    setFence(lang_, name, body) { save(true); setFence(loaded.doc, lang_, name, body); const out = fromUniver(surface.snapshot(), loaded, { sheetMeta, workbook: workbookMeta }); writeText(out); },
    snapshot: () => wb().save(),
    /** the workbook as Univer holds it, without the deep copy save() makes: read-only, for writing the file (a 50k-row
     *  workbook copies in ~0.6 s); anything that may change what it gets uses snapshot() */
    liveSnapshot() {
      const inj = U.univer.__getInjector(); const unit = inj.get(IUniverInstanceService).getUnit(unitId);
      if (!unit) return wb().save();
      return { ...unit.getSnapshot(), resources: inj.get(IResourceManagerService).getResources(unitId, UniverInstanceType.UNIVER_SHEET) };
    },
    text: () => text,
    /** write pending edits now and return the file text */
    saveNow() { save(true); return text; },
    path: () => ctx.getPath?.(),

    /* ---------- ranges ---------- */
    /** the selection as "Sheet!A1:B2" (or "A1:B2") */
    selectionRef({ withSheet = true } = {}) { const r = surface.range(); if (!r) return ''; const a = r.getA1Notation(); return withSheet ? `${quoteSheet(surface.sheetName())}!${a}` : a; },
    /** raw values of a reference ("Orders!A1:F9", "A1:B3", "Orders" = its data, a defined name) */
    read(ref) {
      const r = surface.resolve(ref); if (!r) throw new Error(L('Not a cell or range: {ref}', { ref }));
      return r.range.getRawValues().map((row) => row.map((v) => (v === undefined ? null : v)));
    },
    /** whole used area of a sheet */
    readSheet(name) { const s = sheetByName(name); if (!s) throw new Error(L('No sheet named {name}.', { name })); return s.getDataRange().getRawValues(); },
    /** a reference → { sheet: FWorksheet, range: FRange } or null */
    resolve(ref) {
      if (!ref) return null;
      const name = wb().getDefinedNames?.().find((n) => n.getName().toLowerCase() === String(ref).toLowerCase());
      const target = name ? name.getFormulaOrRefString().replace(/^=/, '') : String(ref).trim();
      const { sheet, range } = splitRef(target);
      const s = sheet ? wb().getSheetByName(sheet) : !range.includes(':') && !parseAddr(range) && wb().getSheetByName(range) ? wb().getSheetByName(range) : ws();
      if (!s) return null;
      if (!sheet && wb().getSheetByName(range) && !parseAddr(range)) return { sheet: s, range: s.getDataRange() };
      try { return { sheet: s, range: s.getRange(range.replace(/\$/g, '')) }; } catch { return null; }
    },
    /**
     * write a grid of values at a cell of a sheet (created when missing); `prev` is the range a previous write of the
     * same result used, cleared first so a shorter result leaves nothing behind. Returns the range written.
     */
    write(sheetName, at, grid, { prev = null, header = true } = {}) {
      let s = sheetByName(sheetName);
      if (!s) { const back = ws(); s = wb().insertSheet(sheetName); back?.activate(); } // results go to their sheet; the person stays where they are
      const start = parseAddr(at || 'A1') || [0, 0];
      if (prev) { try { const p = splitRef(prev); (p.sheet ? sheetByName(p.sheet) : s)?.getRange(p.range).clearContent(); } catch { /* a range that no longer exists */ } }
      const h = grid.length, w = grid.reduce((m, r) => Math.max(m, r.length), 1);
      if (!h) return null;
      const values = grid.map((r) => Array.from({ length: w }, (_, j) => { const v = r[j]; return v instanceof Date ? v.toISOString().slice(0, 10) : v === undefined ? null : v; }));
      const rng = s.getRange(start[0], start[1], h, w);
      rng.setValues(values);
      if (header) s.getRange(start[0], start[1], 1, w).setFontWeight('bold');
      return `${quoteSheet(s.getSheetName())}!${fromRange({ startRow: start[0], endRow: start[0] + h - 1, startColumn: start[1], endColumn: start[1] + w - 1, rangeType: 0 })}`;
    },
    activate(ref) { const r = surface.resolve(ref); if (!r) return; r.sheet.activate(); r.range.activate(); },

    /* ---------- the data engine ---------- */
    /** call the engine with the workbook as it is now; files are workspace paths relative to this note */
    async call(method, payload = {}, { onProgress } = {}) { return engine(method, payload, { note: ctx.getPath?.(), onProgress }); },
    /** grids every sheet a query or script may read, as the person sees them (computed values) */
    allGrids() { return Object.fromEntries(surface.sheetNames().map((n) => [n, surface.readSheet(n)])); },

    /* ---------- scripts ---------- */
    /** replay the operations a script returned, through Univer's commands (undoable, recorded, saved) */
    applyOps(ops = []) { return replayOps(wb(), ops, { activeSheet: ws, onError: (o, e) => ctx.toast(L('A script step failed: {error}', { error: e.message }), { kind: 'error' }) }); },
    scriptCode: () => surface.fences('script').map((f) => f.body).join('\n\n'),
    async runMacro(name, args = []) {
      const code = surface.scriptCode();
      if (!code.trim()) throw new Error(L('This workbook has no scripts yet.'));
      const res = await surface.call('script.run', { code, entry: name, text: surface.saveNow(), active: surface.sheetName(), selection: surface.range()?.getA1Notation(), args });
      surface.applyOps(res.ops);
      for (const t of res.toasts || []) ctx.toast(t);
      return res;
    },

    /* ---------- the grid ---------- */
    focusGrid() { gridEl.querySelector('canvas')?.focus?.({ preventScroll: true }); },
    goto: async () => { const v = await ctx.prompt({ title: L('Go to'), label: L('Cell, range or name'), value: surface.range()?.getA1Notation() || 'A1', action: L('Go') }); if (v) gotoRef(v); },
    startEdit(formula) { const r = surface.range(); ws().getRange(r.getRow(), r.getColumn()).setValue(formula.endsWith('(') ? formula + ')' : formula); },
    autoSum(fn = 'SUM') { autoSum(fn); },
    print: () => workbookMeta.print || {},
    setPrint(o) { surface.setWorkbook({ print: { ...(workbookMeta.print || {}), ...o } }); },
    exportPdf: (o = {}) => import('./print-ui.js').then((m) => m.exportPdf(surface, o)),
    toggleFormulas() { const on = !host.classList.contains('xs-show-formulas'); host.classList.toggle('xs-show-formulas', on); ws()?.setShowFormulas?.(on); if (!ws()?.setShowFormulas) panels.open('audit', { tab: 'formulas' }); },
    toggleFormulaBar() { host.classList.toggle('xs-no-fbar'); },
    toggleNotes: () => panels.open('audit', { tab: 'notes' }),
    removeDuplicates,
    refreshAll: async () => { await panels.run('queries', 'refreshAll'); await panels.run('pivot', 'refreshAll'); },
    addChart: (type) => charts.add(type),
    macros: () => extensions.scriptInfo().macros.map((m) => m.name),
    customFunctions: () => extensions.scriptInfo().functions.map((m) => m.name),
    save,
  };

  const panels = createPanels({ host, surface, icons, ctx });
  surface.panels = panels;
  const charts = createCharts({ api, surface, ctx });
  surface.charts = charts;
  const floats = createFloats({ api, surface, ctx, icons });
  surface.floats = floats;
  const protection = createProtection({ U, surface, ctx });
  surface.protection = protection;
  const extensions = createExtensions({ api, U, surface, ctx });
  surface.extensions = extensions;
  udfImpl = (name, args) => extensions.callFunction(name, args);
  const cmds = createCommands({ api, commands: U.commands, host, ctx, panels, surface });
  const ribbon = wireRibbon(ribbonEl, { run: (cmd, el) => { if (!cmds.run(cmd, el)) ctx.toast(L('Not available yet.')); setTimeout(syncRibbon, 0); }, modeKey: 'folio.ribbon.sheet', defaultMode: 'full', describe: numberPreview });
  void ribbon;

  /* ---------- load and save ---------- */
  let drawing = false; // Folio putting its charts and floating objects on the grid after a load: not an edit
  /** Folio putting its charts and floating objects on the grid (or taking them off): not an edit, and not a step of the
   *  workbook's undo history either. Univer records each drawing it inserts as undoable, so the first Ctrl+Z after
   *  opening (or after switching back) took a chart's box off instead of undoing the last edit. The workbook's undo
   *  and redo stacks are put back as they were; with an Univer that does not expose them, the drawing still happens. */
  function drawQuietly(fn) {
    const svc = (() => { try { return U.univer.__getInjector().get(IUndoRedoService); } catch { return null; } })();
    const id = unitId, undo = svc?._getUndoStack?.(id), redo = svc?._getRedoStack?.(id);
    const keepU = undo ? [...undo] : null, keepR = redo ? [...redo] : null;
    drawing = true;
    try { fn(); } catch (e) { console.error('[sheets] drawings', e); }
    finally {
      drawing = false;
      if (svc?._getUndoStack) {
        const u = svc._getUndoStack(id, true), r = svc._getRedoStack(id, true);
        u.length = 0; if (keepU) u.push(...keepU); r.length = 0; if (keepR) r.push(...keepR);
        svc._updateStatus?.();
      }
    }
  }
  /* ---------- workbooks kept while their tab is hidden ----------
   * Switching back to a workbook shown recently does not reload it: its Univer unit (with its undo history, selection
   * and computed values) stays in memory and becomes the current one again. Reloading a 50,000-row workbook cost 1.5 s
   * and kept ~70 MB of the window's memory each time. At most KEEP_HIDDEN workbooks, and KEEP_TEXT characters of them,
   * are kept besides the one shown; the least recently shown goes first. A workbook whose file changed meanwhile is
   * loaded again. */
  const KEEP_HIDDEN = 2, KEEP_TEXT = 8 * 2 ** 20;
  const kept = new Map(); // tab object → state of a hidden workbook
  const closed = new WeakSet(); // tabs the app closed: their workbook is let go, never kept
  const stateNow = () => ({ text, loaded, unitId, docTab, sheetMeta, workbookMeta, dirty, saveCache, oplog, saveMs, shown: Date.now() });
  function useState(st) { ({ text, loaded, unitId, docTab, sheetMeta, workbookMeta, dirty, saveCache, oplog, saveMs } = st); }
  function dropKept(st) { try { api.disposeUnit(st.unitId); } catch (e) { console.error('[sheets] dispose', e); } }
  function trimKept() {
    const order = [...kept.entries()].sort((a, b) => a[1].shown - b[1].shown); // oldest first
    let size = order.reduce((n, [, st]) => n + st.text.length, 0);
    for (const [k, st] of order) { if (kept.size <= KEEP_HIDDEN && size <= KEEP_TEXT) break; kept.delete(k); size -= st.text.length; dropKept(st); }
  }
  /** before another workbook is shown: write what this one has pending, take its drawings off the grid, cancel its
   *  pending onEdit hook (it would run against the next workbook) */
  function leave() {
    if (!unitId) return;
    if (pending || sliced) { try { save(true); } catch (e) { console.error('[sheets] save before leaving', e); } }
    clearTimeout(saveTimer); pending = false; if (sliced) { sliced.cancelled = true; sliced = null; }
    extensions.leaving();
    drawQuietly(() => { charts.sync(); floats.sync(); charts.clear(true); floats.clear(true); });
  }
  /** show a kept workbook again */
  function show(st) {
    loading = true;
    try {
      useState(st);
      const inj = U.univer.__getInjector(); const units = inj.get(IUniverInstanceService);
      units.setCurrentUnitForType(unitId); units.focusUnit(unitId);
      setTimeout(() => drawQuietly(() => { charts.renderAll(); floats.renderAll(); }), 60);
      panels.refresh();
      extensions.shown();
      setTimeout(syncRibbon, 0);
    } finally { setTimeout(() => { loading = false; }, 0); }
  }
  /** the app shows a document: the kept workbook when it is unchanged, otherwise a fresh load */
  function open(t) {
    const tab = ctx.docKey?.() || null;
    if (tab && tab === docTab) { if (t !== text) load(t, { replace: true }); return; } // the same document changed (another editor, the code view)
    const st = tab && kept.get(tab);
    leave();
    if (unitId) { const cur = stateNow(); if (docTab && !closed.has(docTab)) kept.set(docTab, cur); else dropKept(cur); unitId = null; }
    if (st) { kept.delete(tab); if (st.text === t) { show(st); trimKept(); return; } dropKept(st); } // its file changed while hidden
    load(t);
    trimKept();
  }
  /** the app closed a document: a kept workbook for it is let go */
  function forget(tab) { closed.add(tab); const st = kept.get(tab); if (st) { kept.delete(tab); dropKept(st); } }

  function load(t, { replace = false } = {}) {
    loading = true;
    try {
      const prevSheet = replace ? ws()?.getSheetName() : null; // reloading the same document keeps its sheet
      if (replace) { leave(); if (unitId) { api.disposeUnit(unitId); unitId = null; } }
      oplog = createOpLog({ actor });
      loaded = toUniver(t, { id: `folio-${Math.random().toString(36).slice(2, 8)}`, name: ctx.getPath?.() || 'Workbook', share: true });
      try { applyValues(t, loaded.data); } catch { /* a cache that cannot be read is no cache */ }
      dirty = new Set(['*']); saveCache = new Map();
      if (U.worker) { const mine = loaded; U.workerBaseline(t).then((b) => { if (b && loaded === mine) mine.provideBaseline(b); }); }
      sheetMeta = {}; saveMs = 0;
      const sheets = loaded.doc.blocks.filter((b) => b.type === 'sheet');
      sheets.forEach((b, i) => { sheetMeta[`sheet-${i + 1}`] = structuredClone(folioMeta(b.meta)); });
      workbookMeta = structuredClone(Object.fromEntries(Object.entries(loaded.doc.workbook || {}).filter(([k]) => k !== 'names' && k !== 'univer')));
      const unit = U.open(loaded.data);
      unitId = unit.getUnitId();
      text = t; docTab = ctx.docKey?.() || null;
      if (prevSheet) { const s = wb().getSheetByName(prevSheet); if (s) s.activate(); }
      oplog.reset(loaded.data);
      // drawings need the sheet's render unit, which Univer creates on the next frames
      setTimeout(() => drawQuietly(() => { charts.renderAll(); floats.renderAll(); }), 60);
      panels.refresh();
      extensions.loaded();
      setTimeout(syncRibbon, 0);
    } finally { setTimeout(() => { loading = false; }, 0); }
  }
  // every save names the document it belongs to (docTab, set at load): a save that lands after the tab changed goes
  // to that document, never to the one now shown
  // once the worker's results stop arriving and nothing is pending, keep the values for the next open of this text
  let settleTimer = null;
  function settleSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { if (!pending && !sliced && loaded) { try { storeValues(text, surface.liveSnapshot()); } catch { /* storage full */ } } }, 2500);
  }
  function writeText(out) { if (out === text) return; text = out; ctx.onChange(out, docTab); }
  let saveTimer = 0, saveMs = 0;
  // sheets changed since the last save (by their mutations' subUnitId; '*' when a change is not tied to one sheet);
  // the others reuse the block of the last save (fromUniver's cache), so a big workbook saves only what changed
  let dirty = new Set(['*']); let saveCache = new Map();
  // a large workbook saves in slices (fromUniverAsync) so typing never waits for it; an edit during the save makes it
  // give up (it reads Univer's live model), and saveNow() takes over from one in progress
  let changes = 0, sliced = null;
  const SLICE_ABOVE_MS = 40;
  let pending = false; // a save is scheduled and has not started
  function save(now = false) {
    clearTimeout(saveTimer); pending = now !== true;
    const begin = () => { pending = false; charts.sync(); floats.sync(); const changed = dirty; dirty = new Set(); return changed; };
    const run = () => {
      if (!loaded || !unitId) return;
      if (sliced) { sliced.cancelled = true; for (const id of sliced.changed) dirty.add(id); sliced = null; }
      const t0 = performance.now(); const changed = begin();
      writeText(fromUniver(surface.liveSnapshot(), loaded, { sheetMeta, workbook: workbookMeta, dirty: changed, cache: saveCache }));
      saveMs = performance.now() - t0;
    };
    const runSliced = async () => {
      if (!loaded || !unitId || sliced) return;
      const job = { cancelled: false, changed: begin(), at: changes }; sliced = job;
      const mine = loaded; const t0 = performance.now();
      const out = await fromUniverAsync(surface.liveSnapshot(), loaded, { sheetMeta, workbook: workbookMeta, dirty: job.changed, cache: saveCache }, { stale: () => job.cancelled || changes !== job.at || loaded !== mine });
      if (sliced === job) sliced = null;
      if (out == null || job.cancelled || loaded !== mine) { if (!job.cancelled) for (const id of job.changed) dirty.add(id); return; } // the next save redoes it
      writeText(out); saveMs = Math.min(saveMs, performance.now() - t0);
    };
    if (now === true) run();
    else if (saveMs > SLICE_ABOVE_MS) saveTimer = setTimeout(runSliced, 500); // it yields to typing, so it need not wait long
    else saveTimer = setTimeout(run, Math.max(250, saveMs * 4));
  }
  U.commands.onCommandExecuted((c, options) => {
    if (c.type !== 2 || loading || drawing || NOT_A_CHANGE.test(c.id)) return;
    // formula results the worker sends back (set-range-values marked fromSync): not an edit, so no save, no entry in
    // the operation log (results are excluded from collaboration) and no onEdit hook; charts still follow them
    if (options?.fromSync) { charts.refreshSoon(); settleSoon(); return; }
    // the cell editor is a document of its own (doc.mutation.* on every keystroke): only the workbook's changes count
    if (c.params?.unitId && c.params.unitId !== unitId) return;
    oplog.record(c, options);
    dirty.add(c.params?.subUnitId || '*'); changes++;
    save();
    charts.refreshSoon();
    extensions.edited(c);
  });
  api.addEvent?.(api.Event.SelectionChanged, () => { syncRibbon(); extensions.selected(); panels.selectionChanged(); });

  /* the Number format list shows the active cell in each format, as Excel does */
  function numberPreview(cmd, id) {
    if (cmd !== 'x:numfmt') return null;
    const f = NUMBER_FORMATS.find(([x]) => x === id); if (!f) return null;
    const v = surface.range()?.getRawValue?.(); // getValue() gives the displayed text
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    try { return f[2] === 'General' ? String(v) : numfmt.format(f[2], v); } catch { return null; }
  }

  /* ---------- ribbon state follows the selection ---------- */
  function syncRibbon() {
    const r = surface.range(); if (!r) return;
    const st = r.getCellStyleData?.() || {};
    const press = (cmd, on) => ribbonEl.querySelectorAll(`[data-cmd="${cmd}"][aria-pressed]`).forEach((b) => b.setAttribute('aria-pressed', String(!!on)));
    press('x:bold', st.bl); press('x:italic', st.it); press('x:underline', st.ul?.s); press('x:strike', st.st?.s); press('x:wrap', st.tb === 3);
    press('x:left', st.ht === 1); press('x:center', st.ht === 2); press('x:right', st.ht === 3);
    press('x:vtop', st.vt === 1); press('x:vmiddle', st.vt === 2); press('x:vbottom', st.vt === 3);
    press('x:filter', !!ws()?.getFilter?.());
    press('x:gridlines', !ws()?.hasHiddenGridLines?.());
    press('x:formulaBar', !host.classList.contains('xs-no-fbar'));
    press('x:showFormulas', host.classList.contains('xs-show-formulas'));
    press('x:printGrid', !!workbookMeta.print?.gridlines); press('x:printHeadings', !!workbookMeta.print?.headings);
    const set = (cmd, v) => setComboValue(ribbonEl, cmd, v);
    set('x:font', st.ff || ''); set('x:size', String(st.fs || 11));
    const p = r.getNumberFormat?.() || 'General';
    const nf = NUMBER_FORMATS.find((f) => f[2] === p);
    set('x:numfmt', nf ? nf[0] : 'general');
    if (!nf && p !== 'General') ribbonEl.querySelectorAll('.rb-combo-input[data-cmd="x:numfmt"]').forEach((i) => { i.value = i.dataset.label = L('Custom'); }); // a pattern the list does not name
    set('x:fit', String(workbookMeta.print?.fit ?? '1'));
  }

  /* ---------- helpers used by commands ---------- */
  function gotoRef(ref) {
    const r = surface.resolve(ref);
    if (!r) return ctx.toast(L('Not a cell or range: {ref}', { ref }));
    r.sheet.activate(); r.range.activate();
  }
  function autoSum(fn) {
    const s = ws(), r = surface.range();
    const row = r.getRow(), col = r.getColumn(), h = r.getHeight(), w = r.getWidth();
    if (h === 1 && w === 1) {
      // a single cell: sum the numbers above it, or to its left
      let top = row - 1; while (top >= 0 && typeof s.getRange(top, col).getValue() === 'number') top--;
      if (top < row - 1) return r.setFormula(`=${fn}(${addr(top + 1, col)}:${addr(row - 1, col)})`);
      let left = col - 1; while (left >= 0 && typeof s.getRange(row, left).getValue() === 'number') left--;
      if (left < col - 1) return r.setFormula(`=${fn}(${addr(row, left + 1)}:${addr(row, col - 1)})`);
      return r.setFormula(`=${fn}()`);
    }
    // a block: one total under each column
    for (let c = col; c < col + w; c++) s.getRange(row + h, c).setFormula(`=${fn}(${addr(row, c)}:${addr(row + h - 1, c)})`);
  }
  function removeDuplicates() {
    const r = surface.range(); const data = r.getCellDatas();
    const key = (row) => JSON.stringify(row.map((c) => c?.v ?? c?.f ?? ''));
    const seen = new Set(), keep = [];
    for (const row of data) { const k = key(row); if (!seen.has(k)) { seen.add(k); keep.push(row); } }
    const removed = data.length - keep.length;
    if (!removed) return ctx.toast(L('No duplicate rows found.'));
    const blank = () => Array.from({ length: data[0].length }, () => ({ v: null }));
    const value = {}; [...keep, ...Array.from({ length: removed }, blank)].forEach((row, i) => { value[r.getRow() + i] = {}; row.forEach((c, j) => { value[r.getRow() + i][r.getColumn() + j] = c ? { v: c.v ?? null, f: c.f ?? null, s: c.s ?? null, t: c.t } : { v: null }; }); });
    U.commands.executeCommand('sheet.command.set-range-values', { value, range: toRange(r.getA1Notation()) });
    ctx.toast(L('{n} duplicate rows removed, {m} unique rows remain.', { n: removed, m: keep.length }));
  }

  /* the panel can be resized; its width is remembered */
  const dock = host.querySelector('.xs-dock');
  try { const w = Number(localStorage.getItem('folio.sheet.dock')); if (w > 200) dock.style.width = `${w}px`; } catch { /* storage unavailable */ }
  const resizer = host.querySelector('.xs-dock-resize');
  resizer.addEventListener('pointerdown', (e) => {
    const x0 = e.clientX, w0 = dock.offsetWidth; e.target.setPointerCapture(e.pointerId);
    const move = (ev) => { dock.style.width = `${Math.max(280, Math.min(760, w0 - (ev.clientX - x0)))}px`; };
    const up = () => { e.target.removeEventListener('pointermove', move); try { localStorage.setItem('folio.sheet.dock', String(dock.offsetWidth)); } catch { /* storage unavailable */ } };
    e.target.addEventListener('pointermove', move); e.target.addEventListener('pointerup', up, { once: true });
  });
  resizer.addEventListener('keydown', (e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); dock.style.width = `${Math.max(280, Math.min(760, dock.offsetWidth + (e.key === 'ArrowLeft' ? 24 : -24)))}px`; });
  host.querySelector('[data-dock-close]').addEventListener('click', () => panels.close());

  host.__surface = surface; // tests and the developer console reach the API through the surface element
  return {
    setText(t) { if (t === text && (ctx.docKey?.() || null) === docTab) return; open(t); },
    /** the app closed this document's tab */
    forget,
    /** write what is pending now (the app calls this before the tab changes) */
    flush() { if (unitId && (pending || sliced)) surface.saveNow(); },
    setMode() { /* one view */ },
    focus() { surface.focusGrid(); },
    /** "Costs!B7" from a reference or a search result */
    gotoCell(part) { if (part) gotoRef(part); },
    selectAtLine() {},
    setDark(on) { U.setDark(on); charts.refresh(); },
    surface,
    dispose() { clearTimeout(settleTimer); kept.clear(); U.dispose(); },
  };
}
