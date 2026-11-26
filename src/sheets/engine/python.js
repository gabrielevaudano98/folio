// Folio Sheets — Python (area 24) with Pyodide: CPython compiled to WebAssembly, so Python code from a workbook runs
// in a sandbox with no access to the file system or the computer. Pyodide is an optional component (Settings →
// Optional features). numpy, pandas, scipy, statsmodels and scikit-learn load on first use; Pyodide checks each
// package against the SHA-256 in its lock file.
//
//   ```python Forecast
//   import folio
//   df = folio.table("Orders")              # a pandas DataFrame (a list of dicts without pandas)
//   df["Total"] = df.Qty * df.Price
//   folio.output(df.groupby("Region").Total.sum().reset_index(), sheet="By region", at="A1")
//   ```
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const KNOWN = ['numpy', 'pandas', 'scipy', 'statsmodels', 'scikit-learn', 'matplotlib'];
let pyP = null, out = [];
export const available = (dir) => !!dir && fs.existsSync(path.join(dir, 'pyodide', 'pyodide.js'));

async function py(dir, cacheDir) {
  if (pyP) return pyP;
  if (!available(dir)) throw new Error('Python needs Pyodide. Install it in Settings → Optional features.');
  const { loadPyodide } = createRequire(path.join(dir, 'pyodide', 'package.json'))('./pyodide.js');
  pyP = loadPyodide({ indexURL: path.join(dir, 'pyodide') + path.sep, packageCacheDir: cacheDir, stdout: (s) => out.push(s), stderr: (s) => out.push(s), checkAPIVersion: true });
  const p = await pyP;
  p.runPython(PRELUDE);
  return p;
}
const PRELUDE = `
import sys, types, json
folio = types.ModuleType("folio")
folio._tables = {}
folio._outputs = []
def _table(name):
    rows = folio._tables.get(name)
    if rows is None: raise KeyError("No sheet or table named " + repr(name) + ". Available: " + ", ".join(folio._tables))
    head, body = rows[0], rows[1:]
    try:
        import pandas as pd
        return pd.DataFrame(body, columns=[str(h) for h in head])
    except ImportError:
        return [dict(zip(head, r)) for r in body]
def _output(data, sheet="Python", at="A1"):
    try:
        import pandas as pd
        if isinstance(data, pd.Series): data = data.reset_index()
        if isinstance(data, pd.DataFrame):
            grid = [list(map(str, data.columns))] + data.astype(object).where(data.notna(), None).values.tolist()
        else: grid = data
    except ImportError: grid = data
    if grid and isinstance(grid[0], dict):
        head = list(grid[0].keys()); grid = [head] + [[r.get(h) for h in head] for r in grid]
    folio._outputs.append({"sheet": sheet, "at": at, "grid": json.loads(json.dumps(grid, default=str))})
folio.table = _table
folio.output = _output
folio.sheets = lambda: list(folio._tables)
sys.modules["folio"] = folio
`;

/** run code with sheets: { Name: grid } → { stdout, outputs: [{ sheet, at, grid }], packages } */
export async function run(dir, cacheDir, code, sheets = {}, { onStatus = () => {} } = {}) {
  out = [];
  const p = await py(dir, cacheDir);
  const wanted = KNOWN.filter((k) => new RegExp(`^\\s*(import|from)\\s+${k.replace('-', '_').replace('scikit_learn', 'sklearn')}\\b`, 'm').test(code));
  if (wanted.length) { onStatus(`Loading ${wanted.join(', ')}…`); await p.loadPackage(wanted, { messageCallback: () => {}, errorCallback: (e) => out.push(String(e)) }); }
  const mod = p.pyimport('folio'); mod._tables = p.toPy(sheets); mod.destroy?.();
  p.runPython('folio._outputs = []');
  try { await p.runPythonAsync(code); }
  catch (e) { const msg = String(e.message || e).split('\n').filter(Boolean); throw new Error(msg.slice(-3).join('\n')); }
  const outputs = p.runPython('import json; json.dumps(folio._outputs)');
  return { stdout: out.join('\n'), outputs: JSON.parse(outputs), packages: wanted };
}
export const version = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'pyodide', 'package.json'), 'utf8')).version; } catch { return null; } };
