// Every file under src/ has its own row in docs/reference/source-map.md, in the section of its top folder, so the map
// cannot fall out of date unnoticed. A section starts at a "## " heading that names `src/<top>/` and ends at the next
// "## " heading. A row is a table line that starts with the file's path relative to that folder in backticks
// (src/main/features/catalog.js → "| `features/catalog.js` |"); a section may instead list full paths (templates).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const doc = fs.readFileSync(path.join(root, 'docs/reference/source-map.md'), 'utf8');
const sections = {};
for (const part of doc.split(/\n(?=## )/)) {
  const m = part.match(/^## [^\n]*`src\/([\w-]+)\/`/);
  if (m) sections[m[1]] = part;
}
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(root, p).split(path.sep).join('/')); } };
walk(path.join(root, 'src'));

const missing = files.filter((f) => {
  const [, top, ...rest] = f.split('/');
  const sec = sections[top];
  if (!sec) return true;
  return !sec.includes('\n| `' + rest.join('/') + '` |') && !sec.includes(f);
});
console.log('\nsource map');
assert.deepEqual(missing, [], `add a row for each of these files to docs/reference/source-map.md, in the section of its folder: ${missing.join(', ')}`);
console.log(`  ok all ${files.length} files under src/ have a row in docs/reference/source-map.md`);
