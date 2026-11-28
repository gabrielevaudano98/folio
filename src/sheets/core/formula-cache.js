// Folio Sheets — Univer's compiled-formula cache: its size, and when it must be emptied.
//
// Size. Univer keeps the parsed form (AST) of each formula in an LRU cache of 5,000 entries (lexer trees: 2,000),
// keyed by unit, sheet, cell and formula text. A recalculation reads every formula in order, so with more formulas
// than the limit each entry is evicted before it is read again: every recalculation parses every formula from scratch
// (~35 ms per 1,000 formulas). Folio raises the limit (about 3 KB per parsed formula).
//
// Emptying. A parsed formula also depends on things outside its text: defined names are written into it when it is
// parsed, and tables and sheet names are resolved then too. Univer refreshes an entry only when a recalculation that
// carries the change reads that very entry; an entry for a cell text that does not exist at that moment (rows moved
// it elsewhere) keeps the old meaning, and comes back to life when rows move again: a stale value. Found by
// test/sheets-formula-cache.test.mjs (insert rows after moving a defined name). Stock Univer has the same flaw, hidden
// by its small cache. So Folio empties the cache whenever a recalculation reports a changed defined name, table, or
// sheet (insert, delete, rename): rare events, after which every formula is parsed once.
import { AstTreeBuilder, IFormulaDependencyGenerator } from '@univerjs/engine-formula';

/** most parsed formulas kept (~3 KB each: ~360 MB at the limit); beyond it Univer works as before */
export const FORMULA_CACHE_LIMIT = 120000;

const hasEntries = (o) => { if (o == null || typeof o !== 'object') return false; for (const k in o) if (o[k] != null) return true; return false; };

/** raise the limits on a Univer instance and keep the cache honest; returns whether it could (false when Univer's
 *  internals look different: then nothing is changed) */
export function tuneFormulaCache(univer, limit = FORMULA_CACHE_LIMIT) {
  try {
    const injector = univer.__getInjector();
    const cache = injector.get(AstTreeBuilder).cacheService;
    const gen = injector.get(IFormulaDependencyGenerator);
    const cfg = gen?._currentConfigService;
    const asts = cache?._asts, lex = cache?._lexerTrees;
    if (!asts || !lex || typeof asts.limit !== 'number' || typeof lex.limit !== 'number' || typeof cache.clearCompiled !== 'function') return false;
    if (!gen || typeof gen.generate !== 'function' || !cfg || typeof cfg.getDirtyDefinedNameMap !== 'function' || typeof cfg.getDirtyNameMap !== 'function') return false;
    const generate = gen.generate;
    gen.generate = function (...args) {
      if (hasEntries(cfg.getDirtyDefinedNameMap()) || hasEntries(cfg.getDirtyNameMap()) || hasEntries(cfg.getDirtySuperTableMap?.())) cache.clearCompiled();
      return generate.apply(this, args);
    };
    // Univer indexes every formula cell in a fresh R-tree before looking for address functions (INDIRECT, OFFSET),
    // even when no formula has one (~0.3 s per full pass at 100k formulas). With none, the call does nothing else.
    const byRef = gen._calculateListByFunctionRefNode;
    if (typeof byRef === 'function' && gen._executedAddressFunctionNodeIds instanceof Set) {
      gen._calculateListByFunctionRefNode = function (treeList) {
        for (let i = 0; i < treeList.length; i++) if (treeList[i].addressFunctionNodes?.length) return byRef.call(this, treeList);
        this._executedAddressFunctionNodeIds.clear();
        return Promise.resolve();
      };
    }
    if (asts.limit < limit) asts.limit = limit;
    if (lex.limit < limit) lex.limit = limit;
    return true;
  } catch { return false; }
}
