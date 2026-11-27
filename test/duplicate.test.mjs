// Folio X1: duplicate a page or a folder. Unique localised names, the files a page uses copied (never shared) and
// re-pointed, [[links]] kept, folders copied recursively, the workspace boundary respected, nothing left on failure.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createNotes } from '../src/main/notes.js';
import { createAssets, refsIn } from '../src/main/assets.js';
import { duplicate, copyName, cleanSuffix } from '../src/main/duplicate.js';

let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-dup-'));
const notes = createNotes(() => ws);
const assets = createAssets(notes);
const w = (rel, t) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), t); };
const r = (rel) => fs.readFileSync(path.join(ws, rel), 'utf8');
const has = (rel) => fs.existsSync(path.join(ws, rel));
const png = (k) => Buffer.from([137, 80, 78, 71, k, k, k, k]);
console.log('\nduplicate');

{ const taken = new Set(['Plan copy.md', 'Docs/Deck copy.slides.md', 'Docs/Deck copy 2.slides.md']);
  const t = async (p) => taken.has(p);
  assert.equal(await copyName('Plan.md', 'copy', t), 'Plan copy 2.md');
  assert.equal(await copyName('Notes.md', 'copia', t), 'Notes copia.md');
  assert.equal(await copyName('Docs/Deck.slides.md', 'copy', t), 'Docs/Deck copy 3.slides.md');
  assert.equal(await copyName('Docs/Area', 'copy', t, true), 'Docs/Area copy');
  assert.equal(await copyName('a.b/v1.2 notes.txt', 'copy', t), 'a.b/v1.2 notes copy.txt');
  assert.equal(cleanSuffix('../x:y'), '..xy'); assert.equal(cleanSuffix(''), 'copy'); assert.equal(cleanSuffix('  copia  '), 'copia');
  ok('names: "<name> <localised suffix>" before the type extension, then 2, 3…; the suffix cannot carry a path'); }

{ w('Docs/page.md', '# Page\n');
  const pic = await assets.save('Docs/page.md', 'Photo.png', png(1));
  const pdf = await assets.save('Docs/page.md', 'Report.pdf', png(2));
  const text = `---\ntags: [a]\n---\n# Page\n\n![Photo|300](${pic} "Cap") see [[Other]] and [[Docs/Other#Costs|costs]]\n\n[r](${pdf}) again ![](${pic})\n`;
  w('Docs/page.md', text);
  const res = await duplicate({ notes, assets, from: 'Docs/page.md', suffix: 'copy' });
  assert.equal(res.to, 'Docs/page copy.md'); assert.equal(res.isDir, false); assert.deepEqual(res.pages, ['Docs/page copy.md']);
  assert.equal(r('Docs/page.md'), text, 'the original is untouched');
  const copy = r('Docs/page copy.md');
  const refs = refsIn(copy).map((x) => x.decoded);
  assert.equal(refs.length, 3); assert.equal(res.assets.length, 2, 'each file is copied once even when used twice');
  for (const x of refs) { assert(![pic, pdf].includes(x), 'no reference points at a file of the original'); assert(has('Docs/' + x), x); }
  assert.deepEqual(fs.readFileSync(path.join(ws, 'Docs', refs[0])), png(1)); assert.deepEqual(fs.readFileSync(path.join(ws, 'Docs', refs[1])), png(2));
  assert.equal(refs[0], refs[2]);
  assert.equal(copy.replace(/\.asset\/[^\s)"]+/g, 'X'), text.replace(/\.asset\/[^\s)"]+/g, 'X'), 'everything else, [[links]] included, is unchanged');
  assert.deepEqual(res.assets.map((p) => p.split('/').slice(0, 2).join('/')), ['Docs/.asset', 'Docs/.asset']);
  const again = await duplicate({ notes, assets, from: 'Docs/page.md', suffix: 'copy' });
  assert.equal(again.to, 'Docs/page copy 2.md');
  assert.equal(new Set([...res.assets, ...again.assets, 'Docs/' + pic, 'Docs/' + pdf]).size, 6, 'a second copy gets files of its own too');
  ok('page: copy next to the original, its files copied into new files and re-pointed, links and the rest of the text unchanged'); }

{ w('Area/intro.md', '# Intro\n[[outro]]\n');
  w('Area/Sub/deep.md', '# Deep\n');
  w('Area/Sub/Deeper/leaf.board.md', '# Leaf\n');
  fs.mkdirSync(path.join(ws, 'Area/Empty'));
  w('Area/notes.pdf', 'not a note');
  const pic = await assets.save('Area/Sub/deep.md', 'Pic.png', png(3));
  w('Area/Sub/deep.md', `# Deep\n![](${pic}) and ![](../../Docs/${(await assets.save('Docs/page.md', 'Shared.png', png(4)))})\n`);
  const res = await duplicate({ notes, assets, from: 'Area', suffix: 'copia' });
  assert.equal(res.to, 'Area copia'); assert.equal(res.isDir, true);
  assert.deepEqual(res.pages.sort(), ['Area copia/Sub/Deeper/leaf.board.md', 'Area copia/Sub/deep.md', 'Area copia/intro.md']);
  assert(fs.statSync(path.join(ws, 'Area copia/Empty')).isDirectory(), 'empty folders come along');
  assert(!has('Area copia/notes.pdf') && res.skipped === 1, 'other files are not copied (Folio writes only notes and .asset)');
  assert.equal(r('Area copia/intro.md'), '# Intro\n[[outro]]\n');
  const deep = refsIn(r('Area copia/Sub/deep.md')).map((x) => x.decoded);
  assert.deepEqual(deep.map((x) => x.split('/')[0]), ['.asset', '.asset'], 'files from anywhere land in the copy’s own .asset');
  for (const x of deep) assert(has('Area copia/Sub/' + x));
  assert.equal(res.assets.length, 2); assert(res.assets.every((p) => p.startsWith('Area copia/Sub/.asset/')));
  assert(has('Area/Sub/' + pic), 'the original keeps its files');
  ok('folder: copied recursively with the same rules; files used by its pages copied into the copy'); }

{ await assert.rejects(duplicate({ notes, assets, from: '../outside.md', suffix: 'copy' }), /escapes/);
  await assert.rejects(duplicate({ notes, assets, from: 'Docs/.asset', suffix: 'copy' }), /Hidden/);
  await assert.rejects(duplicate({ notes, assets, from: '', suffix: 'copy' }), /required/);
  w('pic.png', 'x'); await assert.rejects(duplicate({ notes, assets, from: 'pic.png', suffix: 'copy' }), /Only notes/);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-dup-out-')); fs.writeFileSync(path.join(out, 'secret.png'), 'secret');
  fs.mkdirSync(path.join(ws, 'L/.asset'), { recursive: true }); fs.symlinkSync(path.join(out, 'secret.png'), path.join(ws, 'L/.asset/11111111-s.png'));
  w('L/p.md', '![](.asset/11111111-s.png)\n');
  const res = await duplicate({ notes, assets, from: 'L/p.md', suffix: 'copy' });
  assert.equal(res.assets.length, 0); assert.equal(r('L/p copy.md'), '![](.asset/11111111-s.png)\n');
  assert.equal(fs.readdirSync(path.join(ws, 'L/.asset')).length, 1, 'a file that leads out of the workspace is not copied in');
  ok('workspace boundary: paths outside, hidden folders, non-notes and linked files outside are refused or left alone'); }

{ w('F/a.md', '![](.asset/x.png)'); w('F/b.md', '# b'); fs.mkdirSync(path.join(ws, 'F/.asset')); fs.writeFileSync(path.join(ws, 'F/.asset/x.png'), png(5));
  let calls = 0;
  const write = async (rel, text) => { if (++calls === 2) throw new Error('disk full'); fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), text); };
  await assert.rejects(duplicate({ notes, assets, from: 'F', suffix: 'copy', write }), /disk full/);
  assert(!has('F copy'), 'a failed folder copy leaves nothing behind');
  calls = 1; const before = fs.readdirSync(path.join(ws, 'F/.asset')).length;
  await assert.rejects(duplicate({ notes, assets, from: 'F/a.md', suffix: 'copy', write }), /disk full/);
  assert(!has('F/a copy.md')); assert.equal(fs.readdirSync(path.join(ws, 'F/.asset')).length, before, 'nor a failed page copy');
  await assert.rejects(duplicate({ notes, assets, from: 'F', suffix: 'copy', limit: 1 }), /too many/);
  assert(!has('F copy'));
  ok('failure: nothing is left behind; a folder over the limit is refused before anything is written'); }

fs.rmSync(ws, { recursive: true, force: true });
console.log(`  ${n} checks passed`);
