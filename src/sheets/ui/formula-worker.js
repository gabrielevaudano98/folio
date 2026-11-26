// Folio Sheets — the formula engine in a Web Worker. A second, windowless Univer that receives the workbook and every
// mutation from the window (@univerjs/rpc), computes, and sends the results back as mutations; the grid stays
// responsive while a large workbook recalculates. Started by univer.js (startUniver({ worker: true })).
//
// Custom functions written in the workbook's scripts run in the data engine, which only the window can reach. Univer
// refuses to send functions to a worker (that would mean evaluating their text), so the window sends their *names*
// over a MessageChannel; each is registered here as an async function that asks the window for the result.
import { LocaleType, Univer } from '@univerjs/core';
import { IRegisterFunctionService } from '@univerjs/engine-formula';
import enEngineFormula from '@univerjs/engine-formula/locale/en-US';
import enSheets from '@univerjs/sheets/locale/en-US';
import { baselineOf } from '../core/convert.js';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula/worker';
import { UniverRPCWorkerThreadPlugin } from '@univerjs/rpc/worker';
import { UniverSheetsPlugin } from '@univerjs/sheets/worker';
import { UniverRemoteSheetsFormulaPlugin } from '@univerjs/sheets-formula/worker';
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter/worker'; // SUBTOTAL and AGGREGATE skip rows a filter hides

let port = null, seq = 0;
const waiting = new Map(), registered = new Map();
const plain = (a) => (a && typeof a === 'object' && typeof a.getValue === 'function' ? a.getValue() : Array.isArray(a) ? a.map(plain) : a);
const ask = (name, args) => new Promise((resolve) => {
  const id = ++seq; waiting.set(id, resolve);
  port.postMessage({ op: 'call', id, name, args: args.map(plain) });
});
function register(names) {
  const fns = univer.__getInjector().get(IRegisterFunctionService);
  for (const name of names) {
    if (registered.has(name)) continue;
    registered.set(name, fns.registerAsyncFunction({ name, func: (...args) => ask(name, args), description: name }));
  }
}
// the window hands over its end of a MessageChannel once; Univer's RPC keeps the worker's own channel
self.addEventListener('message', (e) => {
  if (!e.data || e.data.folio !== 'udf-port' || !e.ports?.[0]) return;
  e.stopImmediatePropagation();
  port = e.ports[0];
  port.onmessage = (m) => {
    const d = m.data || {};
    if (d.op === 'ping') { port.postMessage({ op: 'pong' }); return; }
    if (d.op === 'register') { register(d.names || []); port.postMessage({ op: 'registered', id: d.id }); return; }
    // the file as the window opened it, made comparable (convert.js): the window's first save then has nothing to compute
    if (d.op === 'baseline') { let baseline = null; try { baseline = baselineOf(d.text, { share: true }); } catch { /* the window computes it */ } port.postMessage({ op: 'baseline', id: d.id, baseline }); return; }
    const r = waiting.get(d.id); if (r) { waiting.delete(d.id); r(d.value); }
  };
}, { capture: true });

const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: { ...enSheets, ...enEngineFormula } } });
univer.registerPlugin(UniverSheetsPlugin, { onlyRegisterFormulaRelatedMutations: true });
univer.registerPlugin(UniverFormulaEnginePlugin);
univer.registerPlugin(UniverRPCWorkerThreadPlugin);
univer.registerPlugin(UniverRemoteSheetsFormulaPlugin);
univer.registerPlugin(UniverSheetsFilterPlugin);
