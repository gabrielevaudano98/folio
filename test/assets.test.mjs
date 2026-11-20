// Folio assets: the hidden .asset folder, deduplicated atomic saves, the asset trash, self-healing references,
// unused and missing files, moving pages, migration from assets/.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createNotes } from '../src/main/notes.js';
import { createAssets, refsIn, safeName, isAssetPath } from '../src/main/assets.js';

let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-assets-'));
let clock = Date.parse('2026-11-20T10:00:00Z'); const tick = (ms) => (clock += ms);
const notes = createNotes(() => ws);
const a = createAssets(notes, { now: () => clock });
const w = (rel, t) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), t); };
const png = (k) => Buffer.from([137, 80, 78, 71, k, k, k]);
console.log('\nassets');

{ const r = refsIn('![A|400](.asset/ab12cd34-photo.png "Cap") and [f](../.asset/x%20y.pdf). ![](assets/old.jpg){x=1} fonts: assets/A.woff2, assets/B.woff2\n![[.asset/e.mp3]] https://site.com/assets/no.png /assets/no2.png myassets/no3.png');
  assert.deepEqual(r.map((x) => x.decoded), ['.asset/ab12cd34-photo.png', '../.asset/x y.pdf', 'assets/old.jpg', 'assets/A.woff2', 'assets/B.woff2', '.asset/e.mp3']);
  assert.equal(safeName('../../My Photo (1).PNG'), 'My-Photo-1.png'); assert.equal(safeName('..'), 'file');
  assert(isAssetPath('a/.asset/x.png') && !isAssetPath('a/assets/x.png'));
  ok('references are found in images, links, slide attributes, fonts and embeds; web URLs and look-alike names are not; names are sanitised'); }

{ w('Docs/page.md', '# P\n');
  const p1 = await a.save('Docs/page.md', 'Photo.png', png(1)); const p2 = await a.save('Docs/page.md', 'Photo.png', png(1)); const p3 = await a.save('Docs/page.md', 'Photo.png', png(2));
  assert.equal(p1, p2); assert.notEqual(p1, p3); assert(/^\.asset\/[0-9a-f]{8}-Photo\.png$/.test(p1), p1);
  assert.deepEqual(fs.readdirSync(path.join(ws, 'Docs', '.asset')).sort(), [path.basename(p1), path.basename(p3)].sort()); // no temp files left
  assert.deepEqual(JSON.stringify(await notes.tree()).includes('.asset'), false);
  assert((await notes.list()).every((f) => !f.path.includes('.asset')));
  await assert.rejects(a.save('Docs/page.md', 'x.bin', Buffer.alloc(0)), /empty/);
  ok('save: identical content is stored once, different content is kept, writes are atomic, the folder is invisible to the tree and search'); }

{ const f = await a.importFile('Docs/page.md', path.join(ws, 'Docs', '.asset', fs.readdirSync(path.join(ws, 'Docs', '.asset'))[0]));
  assert(/^\.asset\//.test(f)); assert.equal(fs.readdirSync(path.join(ws, 'Docs', '.asset')).length, 2); // importing a file already stored reuses it
  ok('importing a file already stored reuses it'); }

const used = (await a.save('Docs/page.md', 'Used.png', png(3))), gone = (await a.save('Docs/page.md', 'Gone.png', png(4)));
{ const before = `# P\n![x](${used}) ![y](${gone})\n`, after = `# P\n![x](${used})\n`;
  w('Docs/page.md', after);
  let o = await a.orphans('Docs/page.md', before, after); assert.deepEqual(o.map((x) => path.basename(x.path)), [path.basename(gone)]);
  w('Docs/other.md', `![z](${gone})`);
  assert.deepEqual(await a.orphans('Docs/page.md', before, after), []); // another page still uses it
  fs.unlinkSync(path.join(ws, 'Docs', 'other.md'));
  ok('removing a reference offers the file only when no other page uses it'); }

{ const rel = 'Docs/' + gone;
  assert.equal(await a.remove(rel), true); assert(!fs.existsSync(path.join(ws, rel)));
  assert(fs.readdirSync(path.join(ws, 'Docs', '.asset', '.trash'))[0].endsWith('~' + path.basename(gone)));
  const h = await a.heal('Docs/page.md', `![y](${gone})`); assert.deepEqual(h.restored, [rel]); assert(fs.existsSync(path.join(ws, rel)));
  assert.deepEqual((await a.heal('Docs/page.md', '![n](.asset/00000000-none.png)')).missing, ['Docs/.asset/00000000-none.png']);
  await a.remove(rel); tick(31 * 864e5); assert.equal(await a.purgeTrash(), 1); assert.equal((await a.heal('Docs/page.md', `![y](${gone})`)).missing.length, 1);
  await assert.rejects(a.remove('Docs/page.md'), /asset folder/); await assert.rejects(a.remove('../x'), /escapes/);
  ok('trash: a removed file comes back when a reference needs it (undo, restored version); after 30 days it is purged; only asset files can be removed'); }

{ const keep = await a.save('Docs/page.md', 'Keep.png', png(5)); tick(20 * 60e3);
  const fresh = await a.save('Docs/page.md', 'Fresh.png', png(6));
  w('Docs/page.md', `![x](${used}) ![m](.asset/ffffffff-missing.png)\n![k](${keep})`); fs.unlinkSync(path.join(ws, 'Docs', keep)); 
  for (const f of fs.readdirSync(path.join(ws, 'Docs', '.asset'))) if (f !== path.basename(fresh)) fs.utimesSync(path.join(ws, 'Docs', '.asset', f), new Date(clock - 1e6), new Date(clock - 1e6)); // the clock here is simulated
  fs.utimesSync(path.join(ws, 'Docs', fresh), new Date(clock), new Date(clock));
  const u = await a.usage();
  assert.deepEqual(u.used.map((x) => path.basename(x.path)), [path.basename(used)]);
  assert.deepEqual(u.missing.map((x) => path.basename(x.path)).sort(), ['ffffffff-missing.png', path.basename(keep)].sort());
  assert(!u.unused.some((x) => x.path === 'Docs/' + fresh) && !u.used.some((x) => x.path === 'Docs/' + fresh)); // a file made minutes ago is spared
  assert(u.unused.length >= 1);
  ok('usage: used, missing (with page and line) and unused files'); }

{ w('A/note.md', '# n\n'); const p = await a.save('A/note.md', 'Pic.png', png(7));
  w('A/note.md', `![p](${p}){w=1}\n![ext](https://x.com/assets/a.png)`);
  const r = await a.relocate('A/note.md', 'B/C/note.md', fs.readFileSync(path.join(ws, 'A/note.md'), 'utf8'));
  assert.equal(r.copied, 1); assert(r.text.includes('(.asset/' + path.basename(p) + ')') && r.text.includes('https://x.com/assets/a.png'));
  assert(fs.existsSync(path.join(ws, 'B/C/.asset', path.basename(p))) && fs.existsSync(path.join(ws, 'A', p)));
  assert.equal((await a.relocate('A/note.md', 'A/renamed.md', 'x')).text, 'x');
  ok('moving a page to another folder copies the files it uses and rewrites the references; renaming in place changes nothing'); }

{ w('L/old.md', '# L\n![a](assets/pic%20one.png) ![b](assets/b.png)'); w('L/sub/deep.md', '![a](../assets/pic%20one.png)');
  w('L/assets/pic one.png', 'ONE'); w('L/assets/b.png', 'BBB');
  const snaps = []; const r = await a.migrateLegacy({ onBefore: (f, t) => snaps.push(f) });
  assert.equal(r.files, 2); assert.equal(r.notes, 2); assert.deepEqual(snaps.sort(), ['L/old.md', 'L/sub/deep.md']);
  const t = fs.readFileSync(path.join(ws, 'L/old.md'), 'utf8'); assert(/\(\.asset\/pic%20one\.png\)/.test(t) && /\(\.asset\/b\.png\)/.test(t), t);
  assert(/\(\.\.\/\.asset\/pic%20one\.png\)/.test(fs.readFileSync(path.join(ws, 'L/sub/deep.md'), 'utf8')));
  assert(fs.existsSync(path.join(ws, 'L/.asset/pic one.png')) && !fs.existsSync(path.join(ws, 'L/assets')));
  assert.equal((await a.heal('L/old.md', '![a](assets/b.png)')).restored.length, 1); // an old version still finds its file in the trash
  ok('migration moves assets/ to .asset, rewrites every page (snapshot first), keeps originals in the trash so old versions still resolve'); }

{ w('S/p.md', '![a](.asset/11111111-in-use.png)'); w('S/.asset/11111111-in-use.png', 'x');
  assert.deepEqual([...(await a.stillUsed(['S/.asset/11111111-in-use.png', 'S/.asset/22222222-free.png']))], ['S/.asset/11111111-in-use.png']);
  ok('a stale question cannot remove a file some page still uses'); }

console.log(`\n${n} assets checks passed`);
