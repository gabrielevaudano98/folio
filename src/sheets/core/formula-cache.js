// Folio Sheets — size of Univer's compiled-formula cache.
// Univer keeps the parsed form (AST) of each formula in an LRU cache of 5,000 entries (lexer trees: 2,000), keyed by
// unit, sheet, cell and formula text. A recalculation reads every formula in order, so with more formulas than the
// limit each entry is evicted before it is read again: every recalculation parses every formula from scratch
// (~35 ms per 1,000 formulas). Raising the limit changes nothing but how many parsed formulas stay in memory (about
// 3 KB each): the cache is Univer's own, with its own invalidation (defined names, functions, units), and the small
// workbooks it already served well use exactly this path. Measured: 100k formulas, an edit 4.7 s -> 1.3 s.
import { AstTreeBuilder } from '@univerjs/engine-formula';

/** most parsed formulas kept (~3 KB each: ~360 MB at the limit); beyond it Univer works as before */
export const FORMULA_CACHE_LIMIT = 120000;

/** raise the limits on a Univer instance; returns whether it did (false when Univer's internals look different) */
export function tuneFormulaCache(univer, limit = FORMULA_CACHE_LIMIT) {
  try {
    const cache = univer.__getInjector().get(AstTreeBuilder).cacheService;
    const asts = cache?._asts, lex = cache?._lexerTrees;
    if (!asts || !lex || typeof asts.limit !== 'number' || typeof lex.limit !== 'number') return false;
    if (asts.limit < limit) asts.limit = limit;
    if (lex.limit < limit) lex.limit = limit;
    return true;
  } catch { return false; }
}
