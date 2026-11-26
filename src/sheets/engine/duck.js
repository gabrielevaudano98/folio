// Folio Sheets — external data through DuckDB (area 10). DuckDB is an optional component (Settings → Optional
// features): native code is downloaded on demand from the pinned catalog, never bundled (ADR 0005).
//
// Sandbox: every query runs in a fresh in-memory database with external access switched off, except for the files
// the main process resolved inside the workspace for this query (allowed_paths). A query cannot read other files,
// install extensions or reach the network. A `.duckdb` file of the workspace can be attached read-only.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

let mod = null;
export function available(dir) {
  try { return !!dir && fs.existsSync(path.join(dir, 'node_modules', '@duckdb', 'node-api', 'package.json')); } catch { return false; }
}
function load(dir) {
  if (mod) return mod;
  if (!available(dir)) throw new Error('SQL and Parquet need DuckDB. Install it in Settings → Optional features.');
  mod = createRequire(path.join(dir, 'package.json'))('@duckdb/node-api');
  return mod;
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** run SQL; files: { "data/sales.parquet": "/abs/path" } are readable under their workspace path; db: "/abs/x.duckdb" */
export async function query(dir, sql, { files = {}, db = null, maxRows = 1_000_000 } = {}) {
  const { DuckDBInstance } = load(dir);
  const inst = await DuckDBInstance.create(':memory:');
  const con = await inst.connect();
  try {
    const abs = Object.values(files);
    if (db) abs.push(db);
    await con.run(`SET allowed_paths = [${abs.map(lit).join(', ')}]`);
    await con.run('SET enable_external_access = false');
    await con.run("SET autoinstall_known_extensions = false; SET autoload_known_extensions = false");
    await con.run('SET lock_configuration = true');
    if (db) await con.run(`ATTACH ${lit(db)} AS db (READ_ONLY)`);
    // workspace paths in the query mean the resolved files
    let q = String(sql);
    for (const [rel, a] of Object.entries(files)) q = q.split(lit(rel)).join(lit(a));
    const reader = await con.runAndReadAll(q);
    const cols = reader.columnNames();
    const rows = reader.getRowsJS().slice(0, maxRows).map((r) => r.map(plain));
    return [cols, ...rows];
  } finally { con.closeSync?.(); inst.closeSync?.(); }
}
const plain = (v) => (typeof v === 'bigint' ? (Number.isSafeInteger(Number(v)) ? Number(v) : String(v)) : v instanceof Date ? v : v && typeof v === 'object' && 'toString' in v && !Array.isArray(v) ? String(v) : v);
export const version = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', '@duckdb', 'node-api', 'package.json'), 'utf8')).version; } catch { return null; } };
