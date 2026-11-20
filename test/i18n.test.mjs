// Folio D14: translatable strings. Every t('key') the renderer uses exists in the English catalogue, every translation
// refers to a real key and keeps its {placeholders}, and the help sheet's rows come from the real commands.
import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
import en from '../src/renderer/locales/en.js';
import it from '../src/renderer/locales/it.js';
import { t, setLocale, LOCALES } from '../src/renderer/i18n.js';
import { helpSections, SYNTAX } from '../src/renderer/page-help.js';

console.log('\ntranslations');
const dir = 'src/renderer';
const used = new Set();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/\bt\('([a-z][\w]*\.[\w.]+)'/g)) used.add(m[1]);
const missing = [...used].filter((k) => !(k in en) && !(`${k}.other` in en));
assert.deepEqual(missing, [], `keys used but not in en.js: ${missing}`);
console.log(`  ✓ the ${used.size} keys used in the code all exist in the English catalogue`);

for (const [code, { dict }] of Object.entries(LOCALES)) {
  const stray = Object.keys(dict).filter((k) => !(k in en));
  assert.deepEqual(stray, [], `${code}: keys that English does not have: ${stray}`);
  for (const [k, v] of Object.entries(dict)) assert.deepEqual([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${code}: placeholders of ${k}`);
}
console.log('  ✓ every translation maps to a real key and keeps its {placeholders}');

setLocale('it'); assert.equal(t('review.accept'), 'Accetta'); assert.equal(t('info.minAgo', { n: 3 }), '3 min fa');
assert.equal(t('settings.language'), 'Lingua');
delete LOCALES.it.dict['review.reject'];
assert.equal(t('review.reject'), 'Reject', 'a missing key falls back to English'); LOCALES.it.dict['review.reject'] = it['review.reject'] ?? 'Rifiuta';
assert.equal(t('no.such.key'), 'no.such.key');
assert.equal(setLocale('xx'), 'en', 'an unknown language falls back to English');
console.log('  ✓ Italian works; a missing key falls back to English, then to the key itself');

// plurals: key.one / key.other with {n}
en['t.items.one'] = '{n} item'; en['t.items.other'] = '{n} items';
assert.equal(t('t.items', { n: 1 }), '1 item'); assert.equal(t('t.items', { n: 1200 }), '1,200 items'); delete en['t.items.one']; delete en['t.items.other'];
console.log('  ✓ plurals and number formatting follow the language');

setLocale('en');
const commands = [{ id: 'a', title: 'Zeta', key: 'Mod+Z' }, { id: 'b', title: 'Alpha', key: 'Mod+Shift+A' }, { id: 'c', title: 'No key' }];
const secs = helpSections(commands, (k) => k.replace('Mod+', 'Ctrl+'));
const sc = secs.find((s) => s.id === 'shortcuts');
assert.deepEqual(sc.rows, [['Alpha', 'Ctrl+Shift+A'], ['Zeta', 'Ctrl+Z']]);
assert.deepEqual(helpSections(commands, (k) => k, 'alpha').map((s) => s.id), ['shortcuts']);
assert.equal(helpSections(commands, (k) => k, 'zzzqq').length, 0);
assert(SYNTAX.length >= 15 && helpSections([], (k) => k, 'callout').some((s) => s.id === 'syntax'));
console.log('  ✓ the help sheet lists the commands that have a shortcut, sorted, and filters by what you type');
