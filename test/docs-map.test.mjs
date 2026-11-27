// Every file under src/ is described in docs/reference/source-map.md, so the map cannot fall out of date unnoticed.
// A file is "described" when its path relative to its top folder (src/main/features/catalog.js → `features/catalog.js`)
// appears in backticks, or its full path appears anywhere on the page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const doc = fs.readFileSync(path.join(root, 'docs/reference/source-map.md'), 'utf8');
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(root, p).split(path.sep).join('/')); } };
walk(path.join(root, 'src'));

const missing = files.filter((f) => {
  const rel = f.split('/').slice(2).join('/'); // drop "src/<top>/"
  return !doc.includes('`' + rel + '`') && !doc.includes(f);
});
console.log('\nsource map');
assert.deepEqual(missing, [], `add these files to docs/reference/source-map.md: ${missing.join(', ')}`);
console.log(`  ok all ${files.length} files under src/ are in docs/reference/source-map.md`);
