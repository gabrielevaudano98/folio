// Folio — the main process side of Folio Sheets' data engine (src/sheets/engine/worker.js).
// Starts the engine as a utilityProcess on first use and stops it after a minute without calls, resolves every
// workspace path a call needs (the engine never chooses files: AGENTS.md invariant 2), relays progress to the window,
// and installs the engine's optional components (DuckDB, Pyodide) from the pinned catalog (ADR 0005).
import path from 'node:path';
import fs from 'node:fs/promises';
import { createInstaller } from './features/installer.js';
import { COMPONENTS } from './features/catalog.js';
import { componentsRoot } from './meeting/service.js';

const IMPORT_EXT = ['xlsx', 'xlsm', 'xltx', 'xltm', 'xls', 'xlsb', 'ods', 'csv', 'tsv', 'txt'];
const IDLE_MS = 60_000;
const MAX_IMPORT = 200 * 1024 * 1024;

/** a file's bytes, refused once more than `cap` bytes are read (a size check before reading misses a file that grows) */
async function readCapped(file, cap, tooBig) {
  const fh = await fs.open(file, 'r');
  try {
    const chunks = []; let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(1 << 20, cap + 1 - total));
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead)); total += bytesRead;
      if (total > cap) throw new Error(tooBig);
    }
    return Buffer.concat(chunks, total);
  } finally { await fh.close(); }
}
export function createSheetsEngine({ app, net, utilityProcess, dialog, h, getWin, notes, enginePath, wasmPath, env = process.env }) {
  const send = (ch, data) => getWin()?.webContents.send(ch, data);
  const root = componentsRoot(app, env);
  const installer = createInstaller({
    root, platformKey: `${process.platform}-${process.arch}`,
    fetch: (url, o) => net.fetch(url, { ...o, bypassCustomProtocolHandlers: true }),
    onProgress: (p) => send('sheets:install-progress', p),
    freeBytes: async (dir) => { const s = await fs.statfs(dir); return Number(s.bavail) * Number(s.bsize); },
  });

  let child = null, seq = 0, idle = 0;
  const pending = new Map();
  function start() {
    if (child) return child;
    const opts = { dataDir: path.join(app.getPath('userData'), 'sheets'), duckdbDir: installer.pathOf('duckdb'), pythonDir: installer.pathOf('pyodide'), wasm: wasmPath };
    child = utilityProcess.fork(enginePath, [], { serviceName: 'Folio sheets engine', stdio: 'pipe', env: { ...env, FOLIO_SHEETS_ENGINE: JSON.stringify(opts) }, execArgv: ['--max-old-space-size=3072'] });
    child.stdout?.on('data', (d) => process.stdout.write(`[sheets-engine] ${d}`));
    child.stderr?.on('data', (d) => process.stderr.write(`[sheets-engine] ${d}`));
    child.on('message', (m) => {
      const p = pending.get(m?.id); if (!p) return;
      if (m.progress) { send('sheets:progress', { call: p.call, ...m.progress }); return; }
      pending.delete(m.id); clearTimeout(p.timer);
      if (m.ok) p.resolve(m.value); else p.reject(Object.assign(new Error(m.error), { line: m.line, at: m.at }));
      arm();
    });
    child.on('exit', () => { child = null; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('The data engine stopped. Try again.')); } pending.clear(); });
    return child;
  }
  const arm = () => { clearTimeout(idle); if (!pending.size) idle = setTimeout(() => { child?.kill(); child = null; }, IDLE_MS); };
  /** call the engine; `timeoutMs` stops a call that runs away (the engine restarts on the next call) */
  function call(method, payload = {}, { timeoutMs = 10 * 60_000, call: callId = null } = {}) {
    const c = start(); clearTimeout(idle);
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('The data engine took too long and was stopped.')); child?.kill(); child = null; }, timeoutMs);
      pending.set(id, { resolve, reject, timer, call: callId });
      c.postMessage({ id, method, payload });
    });
  }

  /** workspace-relative paths → absolute paths, each checked to stay inside the workspace */
  const resolveAll = (rels = []) => Object.fromEntries([...new Set(rels)].map((r) => {
    if (typeof r !== 'string' || !r || r.length > 1024) throw new Error('Not a file path.');
    return [r, notes.resolve(r.replace(/^\/+/, ''))];
  }));
  // relative to the open note: "data/x.csv" next to "Reports/Sales.sheet.md" is "Reports/data/x.csv"
  const relTo = (noteRel, p) => (p.startsWith('/') ? p.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(noteRel || ''), p)));

  const ALLOWED = new Set(['ping', 'file.exportXlsx', 'file.exportCsv', 'fql.inputs', 'fql.run', 'sql.run', 'script.describe', 'script.run', 'script.call', 'python.run', 'crypto.hash', 'crypto.check', 'crypto.encrypt', 'crypto.decrypt', 'crypto.sign', 'crypto.verify', 'whatif.goalSeek', 'whatif.dataTable', 'whatif.scenarios', 'whatif.simulate', 'calc.grids', 'calc.preview', 'book.values', 'book.refresh', 'book.macro']);
  /** a call for a note: the window and the MCP tools send workspace paths relative to the note, the engine gets
   *  absolute ones, each checked to stay inside the workspace */
  async function callFor(method, payload = {}, o = {}) {
    if (!ALLOWED.has(method)) throw new Error(`Unknown engine method ${method}`);
    const p = { ...payload };
    if (Array.isArray(p.files)) { const map = {}; for (const f of p.files) Object.assign(map, { [f]: resolveAll([relTo(o.note, f)])[relTo(o.note, f)] }); p.files = map; }
    if (method === 'file.exportXlsx' && p.source) { const abs = notes.resolve(relTo(o.note, p.source), { allowAsset: true }); p.source = new Uint8Array(await fs.readFile(abs)); }
    return call(method, p, { call: o.call ?? null, timeoutMs: method === 'script.call' ? 10_000 : undefined });
  }
  h('sheets:call', (method, payload = {}, o = {}) => callFor(method, payload, o));

  /** pick a spreadsheet file and convert it; the original package comes back too when export should write into it */
  h('sheets:import', async () => {
    const dev = !app.isPackaged && env.FOLIO_IMPORT_SHEET;
    const r = dev ? { filePaths: [dev] } : await dialog.showOpenDialog(getWin(), { title: 'Import a spreadsheet', properties: ['openFile'], filters: [{ name: 'Spreadsheets', extensions: IMPORT_EXT }] });
    if (r.canceled || !r.filePaths?.[0]) return null;
    const file = r.filePaths[0], ext = path.extname(file).slice(1).toLowerCase();
    if (!IMPORT_EXT.includes(ext)) throw new Error('Choose an Excel, OpenDocument or CSV file.');
    const bytes = new Uint8Array(await readCapped(file, MAX_IMPORT, 'This file is too large to import (over 200 MB). Query it with Get data → SQL instead.'));
    const out = await call('file.import', { bytes, name: path.basename(file) });
    return { ...out, name: path.basename(file), ext, source: out.keepSource ? bytes : null };
  });

  /* optional components */
  const COMP = ['duckdb', 'pyodide'];
  h('sheets:components', async () => {
    const s = await installer.statuses(COMP);
    return COMP.map((id) => { const c = COMPONENTS[id] || {}; return { id, name: c.name, version: c.version, license: c.license, licenseUrl: c.licenseUrl, attribution: c.attribution, ...s[id] }; });
  });
  h('sheets:install', async (id) => {
    if (!COMP.includes(id)) throw new Error('Unknown component.');
    try { await installer.install([id]); } catch (e) { if (!e.cancelled) throw e; }
    child?.kill(); child = null; // the next call starts an engine that sees the new component
    send('sheets:install-progress', {});
    return (await installer.statuses([id]))[id];
  });
  h('sheets:uninstall', async (id) => { if (!COMP.includes(id)) throw new Error('Unknown component.'); child?.kill(); child = null; await installer.uninstall(id); return (await installer.statuses([id]))[id]; });
  h('sheets:cancel-install', () => { installer.cancel(); return true; });

  return { call, callFor, stop: () => { child?.kill(); child = null; } };
}
