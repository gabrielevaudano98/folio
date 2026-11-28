// Folio — Settings → Spreadsheet data components, in the app: what is on this computer, what each part is for, its
// licence, and Remove behind a confirmation. Nothing is downloaded: DuckDB is made to look installed with its marker file.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, log, step, errors } from './harness.mjs';
import { COMPONENTS } from '../src/main/features/catalog.js';

const w = workspace('sheets-components', 47613);
const comp = path.join(w.tmp, 'components');
fs.mkdirSync(path.join(comp, 'duckdb'), { recursive: true });
fs.writeFileSync(path.join(comp, 'duckdb', '.installed.json'), JSON.stringify({ version: COMPONENTS.duckdb.version, platform: `${process.platform}-${process.arch}`, diskBytes: 60 * 2 ** 20 }));
const waitFor = (expr, ms) => ({ js: `new Promise((r)=>{const t0=Date.now();const k=()=>{let v;try{v=(${expr})}catch{};if(v||Date.now()-t0>${ms})r(!!v);else setTimeout(k,200)};k()})`, log: true, wait: 100 });
const S = '#set-sheets-components';
const rows = log(`[...document.querySelectorAll('${S} [data-sc-row]')].map((r)=>({id:r.dataset.scRow,title:r.querySelector('.row-title').textContent,subs:[...r.querySelectorAll('.row-sub')].map((e)=>e.textContent),btn:r.querySelector('[data-sc]')?.dataset.sc||null}))`);
const steps = [
  { size: [1200, 900], wait: 800 },
  step("window.__folioRun('settings')", 1200),
  waitFor(`document.querySelectorAll('${S} [data-sc-row]').length===2`, 10000),
  rows,
  log(`[...document.querySelectorAll('${S} .feature-licenses li')].map((l)=>l.textContent.replace(/\\s+/g,' ').trim())`),
  step(`document.querySelector('${S} [data-sc="remove"]').click()`, 500),
  log("document.querySelector('#sheet-prompt').open && document.querySelector('#prompt-title').textContent"),
  step("document.querySelector('#sheet-prompt [data-no]').click()", 400),
  log(`document.querySelector('${S} [data-sc-row="duckdb"] [data-sc]').dataset.sc`),
  step(`document.querySelector('${S} [data-sc="remove"]').click()`, 500),
  step("document.querySelector('#sheet-prompt [data-yes]').click()", 1200),
  waitFor(`document.querySelector('${S} [data-sc-row="duckdb"] [data-sc]')?.dataset.sc==='install'`, 5000),
  rows,
  errors,
];
const r = await runApp(w, steps, { FOLIO_COMPONENTS_DIR: comp }, 120000);
const [shown, before, licenses, prompt, kept, removed, after, errs] = r.js;
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('spreadsheet data components in Settings');
assert.equal(shown, true, r.log.slice(-3000));
assert.deepEqual(before.map((x) => [x.id, x.btn]), [['duckdb', 'remove'], ['pyodide', 'install']]);
assert.match(before[0].subs[1], /On this computer · 60 MB/); assert.match(before[1].subs[1], /Not downloaded · \d+ MB/);
assert.match(before[0].subs[0], /Parquet/); assert.match(before[1].subs[0], /python/);
ok('each part shows whether it is on this computer, its size and what it is for');
assert.equal(licenses.length, 2); assert.match(licenses[0], /DuckDB.*MIT/); assert.match(licenses[1], /Pyodide.*MPL-2\.0/);
ok('licences and attributions are listed');
assert.match(prompt, /Remove Data connectors \(DuckDB\)\?/); assert.equal(kept, 'remove');
ok('Remove asks first, and Cancel keeps the part');
assert.equal(removed, true); assert.match(after[0].subs[1], /Not downloaded/); assert.ok(!fs.existsSync(path.join(comp, 'duckdb', '.installed.json')));
ok('confirmed Remove deletes it from the computer');
assert.deepEqual(errs, []);
console.log(`\n${n} checks passed`);
