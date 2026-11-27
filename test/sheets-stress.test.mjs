// Folio Sheets under load, in the app: a 50,000-row workbook opened, edited 300 times, saved, undone, closed and
// reopened; two workbooks switched 30 times; the data engine and the formula worker killed mid-session; the file
// changed on disk while open. Memory is sampled from outside (every Electron process). Opt-in, it takes minutes:
//   FOLIO_STRESS=1 node test/sheets-stress.test.mjs        (FOLIO_STRESS_ROWS=200000 for a bigger sheet)
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { spawn, execSync } from 'node:child_process';
import electron from 'electron';
import { workspace } from './harness.mjs';

if (process.env.FOLIO_STRESS !== '1') { console.log('\nsheets stress skipped (set FOLIO_STRESS=1)'); process.exit(0); }
const ROWS = Number(process.env.FOLIO_STRESS_ROWS || 50000);
const w = workspace('sheets-stress', 47615);
const big = ['## Data', '', '| Date | Region | Product | Qty | Price | Total | Flag |', '| --- | --- | --- | --: | --: | --: | --- |'];
for (let i = 2; i <= ROWS + 1; i++) big.push(`| ${46000 + (i % 365)} | ${['EU', 'US', 'APAC'][i % 3]} | P${i % 97} | ${i % 13} | ${(i % 50) / 2} | =D${i}*E${i} | =IF(F${i}>100,"big","") |`);
big.push('', '## Summary', '', '| What | Value |', '| --- | --: |', `| Total | =SUM(Data!F2:F${ROWS + 1}) |`, `| Big rows | =COUNTIF(Data!G2:G${ROWS + 1},"big") |`, `| EU qty | =SUMIFS(Data!D2:D${ROWS + 1},Data!B2:B${ROWS + 1},"EU") |`, '');
fs.writeFileSync(path.join(w.ws, 'sheets', 'Big.sheet.md'), big.join('\n'));
fs.writeFileSync(path.join(w.ws, 'sheets', 'Small.sheet.md'), '## S\n\n| A | B |\n| --- | --- |\n| 1 | =A2*2 |\n| 2 | =A3*2 |\n');
console.log(`sheets stress: ${ROWS} rows × 7 columns (${(fs.statSync(path.join(w.ws, 'sheets', 'Big.sheet.md')).size / 2 ** 20).toFixed(1)} MB)`);

const S = "document.querySelector('.surface-sheet:not([hidden])')?.__surface";
const mem = 'Math.round(performance.memory.usedJSHeapSize/2**20)';
const ev = (name, body, wait = 200) => ({ js: `(async()=>{try{const v=await (async()=>{${body}})();return JSON.stringify({step:${JSON.stringify(name)},v})}catch(e){return JSON.stringify({step:${JSON.stringify(name)},err:e.message})}})()`, log: true, wait });
const until = (expr, ms = 120000) => `await new Promise((r,j)=>{const t0=Date.now();const k=()=>{let v;try{v=(${expr})}catch{};if(v)r(v);else if(Date.now()-t0>${ms})j(new Error('timeout: ${expr.replace(/'/g, '').slice(0, 60)}'));else setTimeout(k,50)};k()})`;
const open = (f) => `document.querySelector('[data-file="${f}"]').click()`;
// long tasks (main thread blocked > 50 ms) while a block runs
const lt = "window.__lt=[];new PerformanceObserver((l)=>{for(const e of l.getEntries())window.__lt.push(Math.round(e.duration))}).observe({type:'longtask',buffered:false})";
const ltSum = 'const L=window.__lt.splice(0);return {n:L.length,total:L.reduce((a,b)=>a+b,0),max:Math.max(0,...L)}';
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

const steps = [
  { size: [1400, 900], wait: 1500 },
  ev('setup', `${lt}; return ${mem}`),
  ev('open big', `const t=performance.now(); ${open('sheets/Big.sheet.md')}; ${until(`${S}?.read?.('Summary!B2')?.[0]?.[0]>0`, 180000)}; return {ms:Math.round(performance.now()-t), total:${S}.read('Summary!B2')[0][0], heap:${mem}}`, 500),
  ev('long tasks while opening', ltSum),
  // values kept from the last open: the grid shows numbers at once, the worker then confirms them
  ev('cached reopen', `const total=${S}.read('Summary!B2')[0][0]; await new Promise(r=>setTimeout(r,4500)); document.querySelector('[data-close="sheets/Big.sheet.md"]').click(); ${until("!document.querySelector('[data-close=\"sheets/Big.sheet.md\"]')", 30000)}; await new Promise(r=>setTimeout(r,1500)); const t=performance.now(); ${open('sheets/Big.sheet.md')}; ${until(`${S}?.read?.('Summary!B2')?.[0]?.[0]>0`, 180000)}; const first=Math.round(performance.now()-t); const shown=${S}.read('Summary!B2')[0][0]; await new Promise(r=>setTimeout(r,12000)); return {firstValueMs:first, shown, same:shown===total, after:${S}.read('Summary!B2')[0][0]===total}`, 500),
  // 300 edits: each one changes a Qty and waits for the Summary to recompute
  ev('300 edits', `const s=${S}; const times=[], recalc=[]; let before=s.read('Summary!B2')[0][0];
    for(let k=0;k<300;k++){ const r=2+Math.floor(Math.random()*${ROWS}); const t=performance.now(); await s.write('Data', 'D'+r, [[(k%11)+20]]); times.push(performance.now()-t);
      if(k%30===0){ const t2=performance.now(); ${until(`${S}.read('Summary!B2')[0][0]!==before`, 20000)}; recalc.push(Math.round(performance.now()-t2)); before=s.read('Summary!B2')[0][0]; } else await new Promise(r=>setTimeout(r,5)); }
    times.sort((a,b)=>a-b); return {p50:Math.round(times[150]),p95:Math.round(times[285]),max:Math.round(times[299]),recalc,heap:${mem}}`, 500),
  ev('long tasks while editing', ltSum),
  ev('save', `const s=${S}; const t=performance.now(); await s.saveNow(); return {ms:Math.round(performance.now()-t), last:s.lastSaveMs?.(), heap:${mem}}`, 300),
  ev('undo 50', `const s=${S}; const t=performance.now(); for(let k=0;k<50;k++) await s.exec('univer.command.undo'); return {ms:Math.round(performance.now()-t)}`, 2000),
  ev('long tasks while undoing', ltSum),
  // close and reopen 4 times: memory should come back
  ...[1, 2, 3, 4].map((k) => ev(`close+reopen ${k}`, `const t=performance.now(); document.querySelector('[data-close="sheets/Big.sheet.md"]').click(); ${until("!document.querySelector('[data-close=\"sheets/Big.sheet.md\"]')", 30000)}; await new Promise(r=>setTimeout(r,1500)); const closed=${mem}; ${open('sheets/Big.sheet.md')}; ${until(`${S}?.read?.('Summary!B2')?.[0]?.[0]>0`, 180000)}; return {ms:Math.round(performance.now()-t), heapClosed:closed, heapOpen:${mem}}`, 500)),
  // tab switching
  ev('open small', `${open('sheets/Small.sheet.md')}; ${until(`${S}?.read?.('S!B2')?.[0]?.[0]===2`, 30000)}; return 1`, 300),
  ev('30 tab switches', `const t=performance.now(); for(let k=0;k<30;k++){ document.querySelector('[data-file="sheets/'+(k%2?'Small':'Big')+'.sheet.md"]').click(); await new Promise(r=>setTimeout(r,120)); } return {ms:Math.round(performance.now()-t), heap:${mem}, errors:(window.__folioErrors||[]).length}`, 500),
  // the data engine dies: the next call should start a new one
  ev('engine ping', `return await folio.sheets('ping', {})`),
  ev('KILL-ENGINE', `return 'kill'`, 2500),
  ev('engine after kill', `const t=performance.now(); try { const v=await folio.sheets('ping', {}); return {ok:v, ms:Math.round(performance.now()-t)}; } catch(e) { const v2=await folio.sheets('ping', {}).catch(e2=>'ERR '+e2.message); return {first:e.message, second:v2}; }`),
  // the formula worker dies: do formulas still recompute?
  ev('worker killed', `${open('sheets/Small.sheet.md')}; await new Promise(r=>setTimeout(r,800)); const s=${S}; const wk=s.univerWorker?.(); if(!wk) return 'no worker'; wk.terminate(); await s.write('S','A2',[[21]]); await new Promise(r=>setTimeout(r,2500)); return {b2:s.read('S!B2')[0][0], toast:[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | ')}`, 500),
  // the file changes on disk while open (another editor, git checkout, sync client)
  ev('DISK-WRITE', `return 'write'`, 3000),
  ev('after disk change', `const s=${S}; return {a2:s.read('S!A2')[0][0], b2:s.read('S!B2')[0][0], toast:[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | ')}`),
  ev('errors', 'return window.__folioErrors||[]'),
];
const stepsFile = path.join(w.tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: w.ud, FOLIO_SHOT: stepsFile, FOLIO_EXPORT_DIR: w.out }, stdio: ['ignore', 'pipe', 'pipe'] });
const results = {}; const samples = []; let log = '', buf = '';
const procs = () => { try { return execSync(`ps -o pid=,ppid=,rss=,args= -e`).toString().split('\n').filter((l) => l.includes(w.ud) || l.includes('electron')).map((l) => l.trim().split(/\s+/)); } catch { return []; } };
const tree = () => { const all = procs(); const mine = new Set([String(child.pid)]); let grew = true; while (grew) { grew = false; for (const p of all) if (mine.has(p[1]) && !mine.has(p[0])) { mine.add(p[0]); grew = true; } }
  const out = {}; for (const p of all) if (mine.has(p[0])) { const a = p.slice(3).join(' '); const k = /--type=renderer/.test(a) ? 'renderer' : /--type=utility/.test(a) ? (/node\.mojom|NodeService/.test(a) ? 'engine' : 'utility') : /--type=gpu/.test(a) ? 'gpu' : /--type=zygote/.test(a) ? 'zygote' : p[0] === String(child.pid) ? 'main' : 'other'; out[k] = (out[k] || 0) + Math.round(Number(p[2]) / 1024); out[k + '#'] = (out[k + '#'] || 0) + 1; out[k + ':pids'] = [...(out[k + ':pids'] || []), p[0]]; } return out; };
const sampler = setInterval(() => samples.push({ t: Date.now(), ...tree() }), 1000);
const onLine = (l) => {
  if (!l.startsWith('js ')) return; let o; try { o = JSON.parse(JSON.parse(l.slice(3))); } catch { return; }
  results[o.step] = o.err ? { err: o.err } : o.v; console.log(`  · ${o.step}: ${JSON.stringify(results[o.step])}`);
  if (o.step === 'KILL-ENGINE') { const t = tree(); const pid = (t['engine:pids'] || t['utility:pids'] || []).at(-1); results.killed = pid; if (pid) try { process.kill(Number(pid), 'SIGKILL'); } catch {} }
  if (o.step === 'DISK-WRITE') fs.writeFileSync(path.join(w.ws, 'sheets', 'Small.sheet.md'), '## S\n\n| A | B |\n| --- | --- |\n| 100 | =A2*2 |\n| 2 | =A3*2 |\n');
};
const feed = (d) => { log += d; buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } };
child.stdout.on('data', feed); child.stderr.on('data', feed);
const t0 = Date.now(); const timer = setTimeout(() => child.kill(), 1500000);
await new Promise((r) => child.on('exit', r)); clearTimeout(timer); clearInterval(sampler);
fs.writeFileSync(path.join(process.env.FOLIO_STRESS_OUT || w.tmp, 'sheets-stress.json'), JSON.stringify({ rows: ROWS, results, samples, secs: Math.round((Date.now() - t0) / 1000) }, null, 1));
const peak = (k) => Math.max(0, ...samples.map((s) => s[k] || 0));
console.log(`\n  peak RSS MB: renderer ${peak('renderer')}, engine ${peak('engine') || peak('utility')}, gpu ${peak('gpu')}, main ${peak('main')}`);
console.log(`  results in ${path.join(process.env.FOLIO_STRESS_OUT || w.tmp, 'sheets-stress.json')}`);
if (!results.errors) console.log(log.slice(-3000));
assert.ok(results.errors, 'the run finished');
