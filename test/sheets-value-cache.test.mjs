// Values kept between sessions for big workbooks: restored only for the exact same text, never for small files.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: (k) => store.delete(k) };
const { applyValues, storeValues, hashText } = await import('../src/sheets/ui/value-cache.js');

const N = 6000;
const snap = () => { const cd = {}; for (let r = 0; r < N; r++) cd[r] = { 0: { v: r }, 1: { f: `=A${r + 1}*2`, v: r * 2 }, 2: { f: '=1/0', v: '#DIV/0!' } }; return { sheets: { s1: { cellData: cd } } }; };
const fresh = () => { const cd = {}; for (let r = 0; r < N; r++) cd[r] = { 0: { v: r }, 1: { f: `=A${r + 1}*2` }, 2: { f: '=1/0' } }; return { sheets: { s1: { cellData: cd } } }; };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
console.log('value cache');
t('the hash tells texts apart, including a one-character change', () => { assert.notEqual(hashText('abc'), hashText('abd')); assert.equal(hashText('abc'), hashText('abc')); });
t('a workbook with few formulas is not kept', () => { const small = { sheets: { s1: { cellData: { 0: { 0: { f: '=1', v: 1 } } } } } }; assert.equal(storeValues('small', small), false); assert.equal(store.size, 0); });
t('the values of a big workbook come back for the same text only', () => {
  assert.equal(storeValues('TEXT-A', snap()), true);
  const d = fresh(); assert.equal(applyValues('TEXT-A', d) > 0, true);
  assert.equal(d.sheets.s1.cellData[10][1].v, 20); assert.equal(d.sheets.s1.cellData[10][2].v, '#DIV/0!'); assert.equal(d.sheets.s1.cellData[10][0].v, 10);
  const other = fresh(); assert.equal(applyValues('TEXT-B', other), 0); assert.equal(other.sheets.s1.cellData[10][1].v, undefined);
});
t('a value typed in a cell is never overwritten', () => { const d = fresh(); d.sheets.s1.cellData[5][1].v = 'typed'; applyValues('TEXT-A', d); assert.equal(d.sheets.s1.cellData[5][1].v, 'typed'); });
t('only the last three texts are kept; damaged storage is no cache', () => {
  for (const k of ['B', 'C', 'D']) storeValues(`TEXT-${k}`, snap());
  assert.equal(applyValues('TEXT-A', fresh()), 0); assert.equal(applyValues('TEXT-D', fresh()) > 0, true);
  store.set('folio.sheets.values', '{not json'); assert.equal(applyValues('TEXT-D', fresh()), 0);
});
console.log(`\n${n} checks passed`);
