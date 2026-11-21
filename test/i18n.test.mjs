// Folio D14: translatable strings. Every t('key') the renderer uses exists in the English catalogue, every translation
// refers to a real key and keeps its {placeholders}, and the help sheet's rows come from the real commands.
import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
import en from '../src/renderer/locales/en.js';
import it from '../src/renderer/locales/it.js';
import { t, setLocale, LOCALES, instance, slugKey } from '../src/renderer/i18n.js';
import { helpSections, SYNTAX } from '../src/renderer/page-help.js';

console.log('\ntranslations');
const dir = 'src/renderer';
const used = new Set();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of src.matchAll(/\b(?:t|tr)\('([a-z][\w-]*\.[\w.-]+)'/g)) used.add(m[1]);
  // tl('prefix', 'English text') looks the text up as prefix.slugKey(text); a text with no entry simply stays English, so only literal pairs that have an entry are checked
  for (const m of src.matchAll(/\btl\('([a-z]+)', '((?:[^'\\]|\\.)*)'\)/g)) { const k = `${m[1]}.${slugKey(m[2].replace(/\\'/g, "'"))}`; if (k in en || `${k}_one` in en) used.add(k); }
}
const missing = [...used].filter((k) => !(k in en) && !(`${k}_other` in en));
assert.deepEqual(missing, [], `keys used but not in en.js: ${missing}`);
assert.deepEqual(Object.entries(en).filter(([, v]) => v.includes('{{')).map(([k]) => k), [], 'no {{ in the catalogue (i18next prefix is a single brace)');
console.log(`  ✓ the ${used.size} keys used in the code all exist in the English catalogue`);

for (const [code, { dict }] of Object.entries(LOCALES)) {
  const stray = Object.keys(dict).filter((k) => !(k in en));
  assert.deepEqual(stray, [], `${code}: keys that English does not have: ${stray}`);
  for (const [k, v] of Object.entries(dict)) assert.deepEqual([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${code}: placeholders of ${k}`);
}
console.log('  ✓ every translation maps to a real key and keeps its {placeholders}');

// the other direction: nothing is left behind in English, plurals come in pairs, and the main process is covered like the window
{
  const base = (k) => k.replace(/_(one|other)$/, '');
  const itKeys = new Set(Object.keys(LOCALES.it.dict).map(base));
  const notYet = [...new Set(Object.keys(en).map(base))].filter((k) => !itKeys.has(k));
  assert.deepEqual(notYet, [], `keys with no Italian translation: ${notYet.slice(0, 20)}`);
  for (const [code, { dict }] of Object.entries(LOCALES)) {
    const lonely = Object.keys(dict).filter((k) => /_one$/.test(k) ? !(k.replace(/_one$/, '_other') in dict) : /_other$/.test(k) && !(k.replace(/_other$/, '_one') in dict));
    assert.deepEqual(lonely, [], `${code}: plural forms without their pair: ${lonely}`);
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
  const gaps = [];
  for (const f of walk('src/main')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\btl\('(menu|dlg)', '((?:[^'\\]|\\.)*)'\)|\brestart:\s*'((?:[^'\\]|\\.)*)'/g)) {
      const k = `${m[1] ?? 'dlg'}.${slugKey((m[2] ?? m[3]).replace(/\\'/g, "'"))}`;
      if (!(k in en)) gaps.push(`${f}: ${k} (English)`); else if (!(k in LOCALES.it.dict)) gaps.push(`${f}: ${k} (Italian)`);
    }
    for (const m of src.matchAll(/\bt\('([a-z][\w-]*\.[\w.-]+)'/g)) if (!(m[1] in en) && !(`${m[1]}_other` in en)) gaps.push(`${f}: ${m[1]} (English)`);
  }
  assert.deepEqual(gaps, [], `menus, dialogs and messages of the main process without an entry: ${gaps.slice(0, 10)}`);
  setLocale('it');
  assert.equal(t('mtg.stop'), 'Interrompi'); assert.equal(t('mtg.err-nothing'), 'Non c’è nessuna registrazione in corso.');
  assert.match(t('mtg.unsaved-sub', { n: 1, when: 'oggi' }), /1 riga\./); assert.match(t('mtg.unsaved-sub', { n: 3, when: 'oggi' }), /3 righe\./);
  setLocale('en');
  console.log('  ✓ every English key has an Italian one, plural forms come in pairs, and menus, dialogs and main-process messages are all translated');
}

// palette commands: the catalogue is the translation of the titles written in app.js, so a retitled command cannot drift
const appSrc = fs.readFileSync('src/renderer/app.js', 'utf8');
const cmdBlock = appSrc.slice(appSrc.indexOf('const COMMANDS = ['), appSrc.indexOf('\n];', appSrc.indexOf('const COMMANDS = [')));
const cmds = [...cmdBlock.matchAll(/\{ id: '([\w-]+)', title: '((?:[^'\\]|\\.)*)'/g)].map((m) => [m[1], m[2].replace(/\\'/g, "'")]);
assert.ok(cmds.length > 70, `found ${cmds.length} commands`);
for (const [id, title] of cmds) { assert.equal(en[`cmd.${id}`], title, `en cmd.${id} matches the title in app.js`); assert.ok(it[`cmd.${id}`], `it has cmd.${id}`); }
assert.equal(Object.keys(en).filter((k) => k.startsWith('cmd.') && !k.endsWith('-mac')).length, cmds.length, 'no catalogue entry without a command');
console.log(`  ✓ the ${cmds.length} palette commands are translated and match app.js`);

setLocale('it');
assert.equal(t('app.words', { n: 1 }), '1 parola'); assert.equal(t('app.words', { n: 12 }), '12 parole'); assert.equal(t('app.words', { n: 2000000 }), '2.000.000 parole', 'Italian “many” falls back to other');
assert.equal(t('app.you-removed', { n: 1, what: 'a.png', size: '1 KB' }).startsWith('Hai rimosso'), true);
assert.equal(t('review.accept'), 'Accetta'); assert.equal(t('info.minAgo', { n: 3 }), '3 min fa');
assert.equal(t('settings.language'), 'Lingua');
instance.addResource('en', 'translation', 't.only.english', 'English only');
assert.equal(t('t.only.english'), 'English only', 'a key the language lacks falls back to English');
assert.equal(t('no.such.key'), 'no.such.key');
assert.equal(setLocale('xx'), 'en', 'an unknown language falls back to English');
console.log('  ✓ Italian works; a missing key falls back to English, then to the key itself');

// plurals (i18next): name_one / name_other with {n}; Italian has its own categories and number format
instance.addResources('en', 'translation', { 't.items_one': '{n} item', 't.items_other': '{n} items' });
instance.addResources('it', 'translation', { 't.items_one': '{n} elemento', 't.items_many': '{n} di elementi', 't.items_other': '{n} elementi' });
setLocale('en'); assert.equal(t('t.items', { n: 1 }), '1 item'); assert.equal(t('t.items', { n: 1200 }), '1,200 items');
setLocale('it'); assert.equal(t('t.items', { n: 1 }), '1 elemento'); assert.equal(t('t.items', { n: 12000 }), '12.000 elementi');
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
