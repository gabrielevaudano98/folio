// Folio — the spreadsheet data components downloaded for real from Settings: progress, Cancel, Resume, then each one
// used by the data engine (DuckDB SQL over a CSV in the folder, a Python block). Needs the network, so it runs only when asked:
//   FOLIO_COMPONENTS_E2E=1 node test/sheets-components-e2e.test.mjs
// With FOLIO_COMPONENTS_READY=<folder> it skips the download and uses components already installed there (a machine
// whose proxy Chromium cannot verify: download them with the installer from Node first).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, log, step, errors } from './harness.mjs';

if (process.env.FOLIO_COMPONENTS_E2E !== '1') { console.log('\ncomponents e2e skipped (set FOLIO_COMPONENTS_E2E=1)'); process.exit(0); }
const w = workspace('sheets-components-e2e', 47614);
const ready = process.env.FOLIO_COMPONENTS_READY;
const comp = ready || path.join(w.tmp, 'components'); fs.mkdirSync(comp, { recursive: true });
fs.writeFileSync(path.join(w.ws, 'sheets', 'orders.csv'), 'region,qty\nEU,4\nUS,12\nEU,6\n');
const S = '#set-sheets-components';
const waitFor = (expr, ms) => ({ js: `new Promise((r)=>{const t0=Date.now();const k=()=>{let v;try{v=(${expr})}catch{};if(v||Date.now()-t0>${ms})r(v?(typeof v==='object'?v:true):false);else setTimeout(k,150)};k()})`, log: true, wait: 100 });
const sub = (id) => `document.querySelector('${S} #sc-${id}')?.textContent`;
const btn = (id) => `document.querySelector('${S} [data-sc-row="${id}"] [data-sc]')`;
const t0 = "window.__t0=performance.now()";
const ev = (expr) => ({ js: `(async()=>{try{return JSON.parse(JSON.stringify(await (async()=>{${expr}})()))}catch(e){return 'ERR '+e.message}})()`, log: true, wait: 200 });
const steps = [
  { size: [1200, 900], wait: 800 },
  step("window.__folioRun('settings')", 1200),
  waitFor(`${btn('duckdb')}?.dataset.sc===${ready ? "'remove'" : "'install'"}`, 10000),
  ...(ready ? [] : [
  // DuckDB: start, see the bar move, cancel part way, resume
  step(`${btn('duckdb')}.click()`, 50),
  waitFor(`(()=>{const p=document.querySelector('${S} [data-sc-row="duckdb"] progress');return p&&p.value>=5&&p.value<90?{pct:p.value,text:${sub('duckdb')}}:null})()`, 60000),
  step(`document.querySelector('${S} [data-sc="cancel"]').click()`, 50),
  waitFor(`${btn('duckdb')}?.dataset.sc==='install'&&{text:${sub('duckdb')},label:${btn('duckdb')}.textContent}`, 15000),
  step(t0 + `;${btn('duckdb')}.click()`, 50),
  waitFor(`${btn('duckdb')}?.dataset.sc==='remove'&&{text:${sub('duckdb')},s:Math.round(performance.now()-window.__t0)}`, 240000),
  // Python
  step(t0 + `;${btn('pyodide')}.click()`, 50),
  waitFor(`${btn('pyodide')}?.dataset.sc==='remove'&&{text:${sub('pyodide')},s:Math.round(performance.now()-window.__t0)}`, 240000),
  ]),
  log(`[${sub('duckdb')}, ${sub('pyodide')}]`),
  // used by the engine
  ev("const t=performance.now();const r=await folio.sheets('sql.run',{sql:\"select region, sum(qty)::INT as qty from 'sheets/orders.csv' group by region order by region\",files:['sheets/orders.csv']});return {r,ms:Math.round(performance.now()-t)}"),
  ev("const t=performance.now();const r=await folio.sheets('python.run',{code:'import statistics\\nrows = folio.table(\"S\")\\nfolio.output([[\"mean\"],[statistics.mean(r[\"q\"] for r in rows)]])',sheets:{S:[['q'],[2],[4],[9]]}});return {r,ms:Math.round(performance.now()-t)}"),
  ev("const t=performance.now();const r=await folio.sheets('python.run',{code:'import pandas as pd\\ndf = pd.DataFrame({\"a\":[1,2,3]})\\nfolio.output([[\"sum\"],[int(df.a.sum())]])',sheets:{}});return {r,ms:Math.round(performance.now()-t)}"),
  errors,
];
const r = await runApp(w, steps, { FOLIO_COMPONENTS_DIR: comp }, 900000);
const js = [...r.js]; const shown = js.shift();
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };
console.log('spreadsheet data components, for real');
assert.equal(shown, true, r.log.slice(-2000));
if (!ready) {
  const [moving, stopped, duck, py] = js.splice(0, 4);
  assert.ok(moving?.pct >= 5, JSON.stringify(moving)); ok(`progress shows while downloading (${moving.text})`);
  assert.match(stopped.label, /Resume/, JSON.stringify(stopped)); assert.match(stopped.text, /stopped at \d+%/); ok(`Cancel keeps the part downloaded (${stopped.text})`);
  assert.match(duck.text, /On this computer/); ok(`DuckDB resumed and installed in ${duck.s} ms`);
  assert.match(py.text, /On this computer/); ok(`Python installed in ${py.s} ms`);
}
const [subs, sql, pyr, pandas, errs] = js;
assert.ok(subs.every((x) => /On this computer/.test(x)), JSON.stringify(subs)); ok(`Settings: ${subs.join(' / ')}`);
assert.deepEqual(sql.r?.rows ?? sql.r, [['region', 'qty'], ['EU', 10], ['US', 12]], JSON.stringify(sql)); ok(`DuckDB SQL over a CSV in the folder (${sql.ms} ms, cold start)`);
assert.deepEqual(pyr.r?.outputs?.[0]?.grid, [['mean'], [5]], JSON.stringify(pyr)); ok(`a Python block (${pyr.ms} ms, cold start)`);
if (typeof pandas === 'string') console.log('  – pandas: ' + pandas); else { assert.deepEqual(pandas.r?.outputs?.[0]?.grid, [['sum'], [6]], JSON.stringify(pandas)); ok(`pandas downloaded and loaded on first import (${pandas.ms} ms, packages: ${pandas.r.packages.join(', ')})`); }
assert.deepEqual(errs, []);
console.log(`\n${n} checks passed`);
