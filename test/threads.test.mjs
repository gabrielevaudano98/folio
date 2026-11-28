// Folio — how many threads the speech model gets: the catalog number on a small PC, a quarter of the usable threads on a bigger one, never over 5.
import assert from 'node:assert/strict';
import { asrThreads, MAX_ASR_THREADS } from '../src/main/meeting/threads.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
console.log('\nspeech model threads');
t('a small PC keeps the catalog number', () => { for (const c of [1, 2, 4, 8]) assert.equal(asrThreads(2, c), 2, `${c} threads`); });
t('a bigger processor gets one thread per 4 usable ones', () => { assert.equal(asrThreads(2, 12), 3); assert.equal(asrThreads(2, 16), 4); });
t('more than 16 usable threads gets the most, 5, and never more', () => { assert.equal(asrThreads(2, 17), 5); assert.equal(asrThreads(2, 24), 5); assert.equal(asrThreads(2, 128), MAX_ASR_THREADS); });
t('the catalog number is a floor, odd inputs are safe', () => { assert.equal(asrThreads(3, 2), 3); for (const bad of [0, -4, NaN, undefined, Infinity]) assert.ok(asrThreads(2, bad) >= 2 && asrThreads(2, bad) <= 5, String(bad)); assert.equal(asrThreads(undefined, 8), 2); });
console.log(`\n${n} checks passed`);
