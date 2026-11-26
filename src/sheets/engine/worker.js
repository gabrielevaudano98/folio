// Folio Sheets — the data engine. An Electron utilityProcess (a plain Node process without Electron APIs or a window),
// started on first use and stopped after a minute idle. Heavy or risky work never runs in the window or the main process
// (AGENTS.md invariant 6): file import and export, FQL queries, DuckDB, scripts (QuickJS), Python (Pyodide),
// encryption and signatures, what-if analysis and batch recalculation on a headless Univer.
//
// Protocol (parentPort): { id, method, payload } → { id, ok, value } | { id, ok: false, error } and { id, progress }.
// The main process resolves every workspace path before a call (files: { "rel/path": "/abs/path" }), so the engine
// never decides which files it may read.
import fs from 'node:fs/promises';
import path from 'node:path';
import { importFile, exportXlsx, exportCsv, readXlsxGrid } from './io.js';
import { runScript, callFunction, describe, scriptWorkbook } from './script.js';
import * as crypto from './crypto.js';
import * as whatif from './whatif.js';
import * as duck from './duck.js';
import * as python from './python.js';
import { toUniver } from '../core/convert.js';
import { run as runFql } from '../core/fql/run.js';
import { parse as parseFql, inputsOf } from '../core/fql/parse.js';

const port = process.parentPort;
const opts = JSON.parse(process.env.FOLIO_SHEETS_ENGINE || '{}'); // { dataDir, duckdbDir, pythonDir, wasm }
if (opts.wasm) globalThis.__folioQuickJsWasm = opts.wasm;

let H = null;
const headless = async () => (H ||= await (await import('./headless.js')).createHeadless());

/** computed values of every sheet, by sheet name, as { r: { c: value } } (formulas only) */
async function computedValues(text) {
  const { data } = toUniver(text);
  const h = await headless(); const wb = await h.open(data);
  try {
    const out = {};
    for (const id of data.sheetOrder) {
      const name = data.sheets[id].name; const cells = data.sheets[id].cellData || {};
      const rows = Object.keys(cells).map(Number); if (!rows.length) continue;
      const maxR = Math.max(...rows), maxC = Math.max(...rows.flatMap((r) => Object.keys(cells[r]).map(Number)));
      const vals = wb.fwb.getSheetByName(name).getRange(0, 0, maxR + 1, maxC + 1).getRawValues();
      out[name] = {};
      for (const r of rows) for (const c of Object.keys(cells[r])) if (cells[r][c]?.f) (out[name][r] ||= {})[c] = vals[r]?.[c] ?? null;
    }
    return { out, data };
  } finally { h.close(wb); }
}
async function grids(text) {
  const { data } = toUniver(text);
  const h = await headless(); const wb = await h.open(data);
  try { return Object.fromEntries(data.sheetOrder.map((id) => { const s = wb.fwb.getSheetBySheetId(id); return [s.getSheetName(), s.getDataRange().getRawValues()]; })); } finally { h.close(wb); }
}
async function readFiles(files = {}, kinds = {}) {
  const out = {};
  for (const [rel, abs] of Object.entries(files)) {
    if (kinds[rel] === 'parquet' || kinds[rel] === 'db') { out[rel] = { path: abs }; continue; }
    const st = await fs.stat(abs); if (st.size > 256 * 1024 * 1024) throw new Error(`${rel} is larger than 256 MB: query it with SQL (DuckDB) instead.`);
    const bytes = await fs.readFile(abs);
    out[rel] = kinds[rel] === 'xlsx' ? { bytes } : { text: bytes.toString('utf8').replace(/^﻿/, ''), bytes };
  }
  return out;
}
async function signingKeys() {
  const dir = path.join(opts.dataDir || '.', 'keys'); const file = path.join(dir, 'sheets-signing.json');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* first use */ }
  const kp = crypto.newKeyPair();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(kp), { mode: 0o600 });
  return kp;
}

const METHODS = {
  ping: () => ({ engine: 1, duckdb: duck.available(opts.duckdbDir) ? duck.version(opts.duckdbDir) : null, python: python.available(opts.pythonDir) ? python.version(opts.pythonDir) : null }),

  /* files */
  'file.import': ({ bytes, name }) => importFile(bytes, name),
  'file.exportXlsx': async ({ text, source }) => { const { out } = await computedValues(text); return exportXlsx(text, { source, values: out }); },
  'file.exportCsv': async ({ text, sheet, sep }) => { const g = await grids(text); const grid = g[sheet] || Object.values(g)[0] || []; return exportCsv(grid, { sep }); },

  /* FQL: Power Query and Power Pivot */
  'fql.inputs': ({ src, name }) => inputsOf(parseFql(src, { name })),
  'fql.run': async ({ src, name, sheets, text, files, only, flat }) => {
    const program = parseFql(src, { name });
    const ins = inputsOf(program);
    const kinds = Object.fromEntries(ins.files.map((f) => [f.path, f.kind]));
    const env = {
      sheets: sheets || (text ? await grids(text) : {}),
      files: await readFiles(files, kinds),
      readers: {
        xlsx: async (bytes, sheet) => readXlsxGrid(bytes, sheet),
        sql: async (sql, db) => duck.query(opts.duckdbDir, sql, { files: Object.fromEntries(Object.entries(files || {}).filter(([r]) => kinds[r] === 'parquet' || kinds[r] === 'csv' || kinds[r] === 'json')), db: db ? files?.[db] : null }),
      },
    };
    return runFql(program, env, { only, flat });
  },
  'sql.run': ({ sql, files, db }) => duck.query(opts.duckdbDir, sql, { files, db: db ? files?.[db] : null }),

  /* scripts */
  'script.describe': ({ code }) => describe(code),
  'script.run': async ({ code, entry, text, active, selection, args }) => {
    const { out, data } = await computedValues(text);
    return runScript(code, entry, scriptWorkbook(data, { active, selection, values: out }), args || []);
  },
  'script.call': async ({ code, name, args }) => ({ value: await callFunction(code, name, args || []) }),

  /* python */
  'python.run': async ({ code, text, sheets }, progress) => python.run(opts.pythonDir, path.join(opts.dataDir || '.', 'pyodide-cache'), code, sheets || (text ? await grids(text) : {}), { onStatus: (s) => progress({ status: s }) }),

  /* protection, encryption, signatures */
  'crypto.hash': ({ password }) => crypto.hashPassword(password),
  'crypto.check': ({ password, record }) => crypto.checkPassword(password, record),
  'crypto.encrypt': ({ value, password }) => crypto.encrypt(value, password),
  'crypto.decrypt': ({ box, password }) => crypto.decrypt(box, password),
  'crypto.sign': async ({ text, signer }) => { const s = crypto.sign(text, await signingKeys(), { signer }); return { signature: s, text: crypto.withSignature(text, s) }; },
  'crypto.verify': async ({ text }) => crypto.verify(text, crypto.readSignature(text), { myPublicPem: (await signingKeys()).publicPem }),

  /* what-if */
  'whatif.goalSeek': async ({ text, ...o }) => whatif.goalSeek(await headless(), toUniver(text, { share: true }).data, o),
  'whatif.dataTable': async ({ text, ...o }) => whatif.dataTable(await headless(), toUniver(text, { share: true }).data, o),
  'whatif.scenarios': async ({ text, ...o }) => whatif.scenarios(await headless(), toUniver(text, { share: true }).data, o),
  'whatif.simulate': async ({ text, ...o }, progress) => whatif.simulate(await headless(), toUniver(text, { share: true }).data, { ...o, onProgress: progress }),

  /* batch: computed values for MCP, the command line and exports */
  'calc.grids': ({ text }) => grids(text),
};

let queue = Promise.resolve(); // one call at a time: the headless Univer and QuickJS are single-threaded anyway
port.on('message', (e) => {
  const { id, method, payload } = e.data || {};
  const f = METHODS[method];
  queue = queue.then(async () => {
    if (!f) return port.postMessage({ id, ok: false, error: `Unknown engine method ${method}` });
    try { const value = await f(payload || {}, (p) => port.postMessage({ id, progress: p })); port.postMessage({ id, ok: true, value }); }
    catch (err) { port.postMessage({ id, ok: false, error: err?.message || String(err), line: err?.line, at: err?.at }); }
  });
});
process.on('uncaughtException', (e) => { console.error('[sheets-engine]', e); });
