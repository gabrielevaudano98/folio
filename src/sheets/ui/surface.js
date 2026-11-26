// Folio Sheets — the sheet surface: Folio's ribbon + Univer's grid + a side panel, over a .sheet.md file.
// Contract with app.js (same as every surface): mount(host, ctx) → { setText, setMode, focus, gotoCell, selectAtLine }.
// The file is the model: setText() loads it into Univer; edits come back as ctx.onChange(text) through convert.js,
// which leaves untouched sheets byte-identical.
//
// `surface` below is the API every panel and command uses (docs/sheets/README.md, "Renderer API"):
// read and write ranges, call the data engine, keep Folio's own settings (charts, slicers, print, protection…),
// replay script operations, and the hooks an extension can attach to.
import { buildRibbon, wireRibbon } from '../../renderer/page-ribbon.js';
import { toUniver, fromUniver, folioMeta } from '../core/convert.js';
import { setFence, readDoc } from '../core/sheetmd.js';
import { splitRef, toRange, addr, quoteSheet, parseAddr, fromRange } from '../core/a1.js';
import { startUniver } from './univer.js';
import { createCommands } from './commands.js';
import { TABS, COMPACT } from './ribbon.js';
import { icons as xsIcons } from './icons.js';
import { L } from './i18n.js';
import { createPanels } from './panels/index.js';
import { createCharts } from './charts.js';
import { createFloats } from './floats.js';
import { createProtection } from './protection.js';
import { createExtensions } from './extensions.js';
import { createOpLog } from '../core/collab.js';
import { engine } from './engine-client.js';
import { locale } from '../../renderer/i18n.js';

const CSS_ID = 'folio-univer-css';
function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const link = Object.assign(document.createElement('link'), { id: CSS_ID, rel: 'stylesheet', href: 'sheets-univer.css' });
  document.head.append(link);
}
/** mutations that do not change the document: formula results, view state */
const NOT_A_CHANGE = /^(formula\.|sheet\.mutation\.set-worksheet-row-is-auto-height|sheet\.mutation\.set-worksheet-row-auto-height|sheet\.mutation\.set-zoom|sheet\.mutation\.set-selections|sheet\.mutation\.set-worksheet-activate|sheet\.mutation\.set-scroll|sheet\.mutation\.toggle-gridlines-color|sheet\.mutation\.set-float-dom|sheet\.mutation\.remove-float-dom)/;
const STYLE_KEYS = { bold: (r, v) => r.setFontWeight(v ? 'bold' : 'normal'), italic: (r, v) => r.setFontStyle(v ? 'italic' : 'normal'), color: (r, v) => r.setFontColor(v), fill: (r, v) => (v ? r.setBackground(v) : r.setBackground(null)), numfmt: (r, v) => r.setNumberFormat(v), align: (r, v) => r.setHorizontalAlignment({ left: 'left', center: 'center', centre: 'center', right: 'right' }[String(v).toLowerCase()] || 'left') };

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
  const U = startUniver(gridEl, { lang: locale(), dark: !!ctx.isDark?.() });
  const { api } = U;

  /* ---------- state ---------- */
  let text = null;          // the text last loaded or written
  let loaded = null;        // what toUniver() returned for it
  let unitId = null;
  let loading = false;      // mutations while loading are not edits
  let sheetMeta = {};       // Folio's own meta per sheet id: charts, print, slicers, protection…
  let workbookMeta = {};    // Folio's own workbook settings: scenarios, print, source, loads…
  const oplog = createOpLog({ actor: 'me' });
  ctx.userName?.().then?.((n) => { if (n) oplog.actor = n; }).catch?.(() => {});

  const wb = () => api.getActiveWorkbook();
  const ws = () => wb()?.getActiveSheet();
  const sheetByName = (n) => (n ? wb()?.getSheetByName(n) : ws());

  const surface = {
    icons, ctx, L, oplog,
    wb, ws,
    range: () => wb()?.getActiveRange(),
    sheetId: () => ws()?.getSheetId(),
    sheetName: () => ws()?.getSheetName(),
    sheetNames: () => wb()?.getSheets().map((s) => s.getSheetName()) || [],
    unitId: () => unitId,
    /** Univer's formula facade: dependency trees, calculation control, custom functions */
    formulaApi: () => api.getFormula(),
    /** run a Univer command by id (its own panels and operations) */
    exec: (id, params) => U.commands.executeCommand(id, params),
    meta: (id = surface.sheetId()) => (sheetMeta[id] ||= {}),
    metaByName: (name) => { const s = sheetByName(name); return s ? surface.meta(s.getSheetId()) : null; },
    workbook: () => workbookMeta,
    fences: (lang) => readDoc(text || '').fences.filter((f) => !lang || f.lang === lang),
    /** change Folio-owned meta and write the file */
    setMeta(patch, id = surface.sheetId()) { const m = surface.meta(id); Object.assign(m, patch); for (const [k, v] of Object.entries(patch)) if (v == null) delete m[k]; save(); },
    setWorkbook(patch) { Object.assign(workbookMeta, patch); for (const [k, v] of Object.entries(patch)) if (v == null) delete workbookMeta[k]; save(); },
    /** add, replace or remove (body null) a named block: ```fql Sales``` etc. */
    setFence(lang_, name, body) { save(true); setFence(loaded.doc, lang_, name, body); const out = fromUniver(surface.snapshot(), loaded, { sheetMeta, workbook: workbookMeta }); writeText(out); },
    snapshot: () => wb().save(),
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
      const h = grid.length, w = Math.max(1, ...grid.map((r) => r.length));
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
    applyOps(ops = []) {
      for (const o of ops) {
        try {
          if (o.op === 'insertSheet') { if (!sheetByName(o.sheet)) wb().insertSheet(o.sheet); continue; }
          const s = sheetByName(o.sheet); if (!s) continue;
          if (o.op === 'activate') { s.activate(); continue; }
          const r = s.getRange(o.range);
          if (o.op === 'values') r.setValues(o.values.map((row) => row.map((v) => (v === undefined ? null : v))));
          else if (o.op === 'clear') r.clearContent();
          else if (o.op === 'style') STYLE_KEYS[o.key]?.(r, o.value);
          else if (o.op === 'note') { if (o.value == null) r.deleteNote?.(); else r.createOrUpdateNote?.({ note: o.value, width: 160, height: 72 }); }
          else if (o.op === 'select') { s.activate(); r.activate(); }
        } catch (e) { ctx.toast(L('A script step failed: {error}', { error: e.message }), { kind: 'error' }); }
      }
    },
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
  const cmds = createCommands({ api, commands: U.commands, host, ctx, panels, surface });
  const ribbon = wireRibbon(ribbonEl, { run: (cmd, el) => { if (!cmds.run(cmd, el)) ctx.toast(L('Not available yet.')); setTimeout(syncRibbon, 0); }, modeKey: 'folio.ribbon.sheet', defaultMode: 'full' });
  void ribbon;

  /* ---------- load and save ---------- */
  function load(t) {
    loading = true;
    try {
      const prevSheet = ws()?.getSheetName();
      if (unitId) { charts.clear(); floats.clear(); api.disposeUnit(unitId); unitId = null; }
      loaded = toUniver(t, { id: `folio-${Math.random().toString(36).slice(2, 8)}`, name: ctx.getPath?.() || 'Workbook' });
      sheetMeta = {};
      const sheets = loaded.doc.blocks.filter((b) => b.type === 'sheet');
      sheets.forEach((b, i) => { sheetMeta[`sheet-${i + 1}`] = structuredClone(folioMeta(b.meta)); });
      workbookMeta = structuredClone(Object.fromEntries(Object.entries(loaded.doc.workbook || {}).filter(([k]) => k !== 'names' && k !== 'univer')));
      const unit = U.open(loaded.data);
      unitId = unit.getUnitId();
      text = t;
      if (prevSheet) { const s = wb().getSheetByName(prevSheet); if (s) s.activate(); }
      oplog.reset(loaded.data);
      // drawings need the sheet's render unit, which Univer creates on the next frames
      setTimeout(() => { try { charts.renderAll(); floats.renderAll(); } catch (e) { console.error('[sheets] drawings', e); } }, 60);
      panels.refresh();
      extensions.loaded();
      setTimeout(syncRibbon, 0);
    } finally { setTimeout(() => { loading = false; }, 0); }
  }
  function writeText(out) { if (out === text) return; text = out; ctx.onChange(out); }
  let saveTimer = 0;
  function save(now = false) {
    clearTimeout(saveTimer);
    const run = () => {
      if (!loaded || !unitId) return;
      charts.sync(); floats.sync();
      writeText(fromUniver(surface.snapshot(), loaded, { sheetMeta, workbook: workbookMeta }));
    };
    if (now === true) run(); else saveTimer = setTimeout(run, 250);
  }
  U.commands.onCommandExecuted((c, options) => {
    if (c.type !== 2 || loading || NOT_A_CHANGE.test(c.id)) return;
    oplog.record(c, options);
    save();
    charts.refreshSoon();
    extensions.edited(c);
  });
  api.addEvent?.(api.Event.SelectionChanged, () => { syncRibbon(); extensions.selected(); panels.selectionChanged(); });

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
    const set = (cmd, v) => ribbonEl.querySelectorAll(`select[data-cmd="${cmd}"]`).forEach((s) => { if ([...s.options].some((o) => o.value === v)) s.value = v; });
    set('x:font', st.ff || ''); set('x:size', String(st.fs || 11));
    const p = r.getNumberFormat?.() || 'General';
    import('./ribbon.js').then(({ NUMBER_FORMATS }) => set('x:numfmt', (NUMBER_FORMATS.find((f) => f[2] === p) || ['general'])[0]));
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
    setText(t) { if (t === text) return; load(t); },
    setMode() { /* one view */ },
    focus() { surface.focusGrid(); },
    /** "Costs!B7" from a reference or a search result */
    gotoCell(part) { if (part) gotoRef(part); },
    selectAtLine() {},
    setDark(on) { U.setDark(on); charts.refresh(); },
    surface,
    dispose() { U.dispose(); },
  };
}
