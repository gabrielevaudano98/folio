// Folio Sheets — the window's door to the data engine (a separate process: src/sheets/engine/worker.js, started by
// src/main/sheets-engine.js). Heavy or risky work never runs in the window: file import and export, queries (FQL,
// DuckDB), scripts (QuickJS), Python (Pyodide), encryption and signatures (node-forge), what-if runs on a headless
// copy of the workbook.
let callN = 0;
const listeners = new Map();
let wired = false;
function wire(bridge) {
  if (wired || !bridge?.onSheetsProgress) return;
  wired = true;
  bridge.onSheetsProgress((p) => listeners.get(p?.call)?.(p));
}
/** call one engine method; resolves with its result or rejects with its error message */
export async function engine(method, payload = {}, { note = null, onProgress = null } = {}) {
  const bridge = globalThis.folio;
  if (!bridge?.sheets) throw new Error('The data engine is not available in this window.');
  wire(bridge);
  const call = onProgress ? `c${++callN}` : null;
  if (call) listeners.set(call, onProgress);
  try { return await bridge.sheets(method, payload, { note, call }); }
  finally { if (call) listeners.delete(call); }
}
/** optional components (DuckDB, Pyodide): status, install with progress, remove */
export const components = {
  list: () => globalThis.folio?.sheetsComponents?.() ?? Promise.resolve([]),
  install: (id) => globalThis.folio.sheetsInstall(id),
  uninstall: (id) => globalThis.folio.sheetsUninstall(id),
  cancel: () => globalThis.folio.sheetsCancelInstall(),
  onProgress: (fn) => globalThis.folio?.onSheetsInstallProgress?.(fn) || (() => {}),
};
