// Folio Sheets — every interface text has an Italian entry with the same {placeholders} (src/sheets/ui/locale-it.js).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { ribbonLabels } from '../src/sheets/ui/ribbon.js';
import IT from '../src/sheets/ui/locale-it.js';

const files = []; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && !/locale-it|icons\.js/.test(p)) files.push(p); } };
walk('src/sheets/ui');
const texts = new Set(ribbonLabels());
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bL\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g)) if (!m[2].includes('${')) texts.add(m[2].replace(/\\'/g, "'"));
  for (const m of s.matchAll(/title: '([^']+)'/g)) texts.add(m[1]);
}
for (const m of fs.readFileSync('src/sheets/ui/commands.js', 'utf8').matchAll(/label: '((?:\\'|[^'])*)'/g)) texts.add(m[1].replace(/\\'/g, "'"));
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const missing = [...texts].filter((t) => !(t in IT));
assert.deepEqual(missing, [], `missing Italian text: ${missing.join(' | ')}`);
const bad = [...texts].filter((t) => holes(t) !== holes(IT[t]));
assert.deepEqual(bad, [], `placeholders differ: ${bad.join(' | ')}`);
console.log(`sheets i18n\n  ✓ ${texts.size} interface texts have an Italian entry with the same placeholders`);
