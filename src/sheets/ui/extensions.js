// Folio Sheets — extensibility (area 20). Two kinds of extension:
//
// 1. Workbook hooks, written by the person or an AI assistant in ```script``` blocks and run in the sandbox:
//      onOpen()                          after the workbook opens
//      onEdit({ sheet, range, value })   after a person edits cells (debounced, not for script or remote edits)
//      onSelectionChange({ sheet, range })
//    Hooks run only when the person allowed scripts for this file (Automate → Scripts → "Run hooks").
//
// 2. Code extensions inside Folio (features, future plugins), through register(): commands for the ribbon's
//    Automate menu, custom functions computed in the window, and listeners. They see the same `surface` API the
//    panels use and Univer's facade (FUniver), nothing else.
//      surface.extensions.register({ id, name, commands: [{ id, label, run(surface) }], functions: { NAME: fn },
//                                    onEdit(e), onOpen(), onSave(text) }) → unregister()
import { describe } from '../engine/script-describe.js';
import { L } from './i18n.js';

export function createExtensions({ api, surface, ctx }) {
  const exts = new Map();
  let info = { macros: [], functions: [], hooks: [] }, infoFor = null;
  let editTimer = 0, pendingEdit = null, running = false;

  function scriptInfo() {
    const code = surface.scriptCode();
    if (code !== infoFor) { infoFor = code; try { info = describe(code); } catch { info = { macros: [], functions: [], hooks: [] }; } }
    return info;
  }
  const hooksAllowed = () => !!surface.workbook().scripts?.hooks;

  async function hook(name, arg) {
    for (const e of exts.values()) { try { await e[name]?.(arg, surface); } catch (err) { console.error(`[extension ${e.id}]`, err); } }
    if (!hooksAllowed() || running || !scriptInfo().hooks.includes(name)) return;
    running = true;
    try { await surface.runMacro(name, arg === undefined ? [] : [arg]); }
    catch (err) { ctx.toast(L('The {hook} script stopped: {error}', { hook: name, error: err.message }), { kind: 'error' }); }
    finally { running = false; }
  }

  /* custom functions: UPPER_CASE functions of the scripts, computed in the engine's sandbox */
  const registered = new Set();
  /** a custom function's value: an extension's function in the window, or a script's in the data engine */
  async function callFunction(name, args) {
    for (const e of exts.values()) if (typeof e.functions?.[name] === 'function') return e.functions[name](...args);
    try { const r = await surface.call('script.call', { code: surface.scriptCode(), name, args }); return r.value ?? ''; }
    catch (e) { return `#ERROR: ${e.message}`; }
  }
  function registerFunctions() {
    if (surface.univerWorker?.()) { // formulas run in the worker: it registers the names and asks callFunction for values
      const names = [...scriptInfo().functions.map((f) => f.name), ...[...exts.values()].flatMap((e) => Object.keys(e.functions || {}))].filter((n) => !registered.has(n));
      if (!names.length) return;
      names.forEach((n) => registered.add(n));
      surface.registerWorkerFunctions(names).then(() => api.getFormula().executeCalculation?.());
      return;
    }
    const formula = api.getFormula();
    for (const f of scriptInfo().functions) {
      if (registered.has(f.name)) continue;
      registered.add(f.name);
      formula.registerAsyncFunction?.(f.name, async (...args) => {
        try { const r = await surface.call('script.call', { code: surface.scriptCode(), name: f.name, args: args.map(plain) }); return r.value ?? ''; }
        catch (e) { return `#ERROR: ${e.message}`; }
      }, { description: L('Custom function from the workbook scripts') });
    }
    for (const e of exts.values()) for (const [name, fn] of Object.entries(e.functions || {})) {
      if (registered.has(name)) continue; registered.add(name);
      formula.registerFunction?.(name, (...a) => fn(...a.map(plain)), { description: e.name || e.id });
    }
  }
  const plain = (a) => (a && typeof a === 'object' && typeof a.getValue === 'function' ? a.getValue() : Array.isArray(a) ? a.map(plain) : a);

  return {
    scriptInfo,
    callFunction,
    register(ext) {
      if (!ext?.id) throw new Error('An extension needs an id.');
      exts.set(ext.id, ext); registerFunctions();
      return () => exts.delete(ext.id);
    },
    list: () => [...exts.values()].map((e) => ({ id: e.id, name: e.name || e.id, commands: (e.commands || []).map((c) => ({ id: c.id, label: c.label })) })),
    command(id) { for (const e of exts.values()) for (const c of e.commands || []) if (`${e.id}:${c.id}` === id) return () => c.run(surface); return null; },
    loaded() { infoFor = null; registerFunctions(); setTimeout(() => hook('onOpen'), 0); },
    /** a kept workbook shown again: its functions, not its onOpen (Excel runs that once, when the file opens) */
    shown() { infoFor = null; registerFunctions(); },
    /** another workbook is about to be shown: a pending onEdit would run against it */
    leaving() { clearTimeout(editTimer); pendingEdit = null; },
    edited(cmd) {
      if (cmd.id !== 'sheet.mutation.set-range-values' || running) return;
      const p = cmd.params || {}; const rows = Object.keys(p.cellValue || {}).map(Number); if (!rows.length) return;
      const cols = Object.keys(p.cellValue[rows[0]] || {}).map(Number);
      pendingEdit = { sheet: surface.sheetName(), row: rows.reduce((m, x) => (x < m ? x : m), Infinity) + 1, column: cols.reduce((m, x) => (x < m ? x : m), Infinity) + 1, value: p.cellValue[rows[0]]?.[cols[0]]?.v ?? null };
      clearTimeout(editTimer); editTimer = setTimeout(() => { const e = pendingEdit; pendingEdit = null; hook('onEdit', e); }, 400);
      if (/\bfunction\s+[A-Z][A-Z0-9_.]*\s*\(/.test(surface.scriptCode())) registerFunctions();
    },
    selected() { const r = surface.range(); if (r && scriptInfo().hooks.includes('onSelectionChange')) hook('onSelectionChange', { sheet: surface.sheetName(), range: r.getA1Notation() }); },
    saved(text) { for (const e of exts.values()) e.onSave?.(text, surface); },
    refreshFunctions: registerFunctions,
  };
}
