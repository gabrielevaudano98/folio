// Folio version history: snapshots are deduplicated and pruned, named versions last, restore is byte for byte.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { diffWords } from 'diff';
import { createHistory, keepers, wordParts, revertHunk, countHunks, wordCount, POLICY } from '../src/main/history.js';

let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-history-'));
let clock = Date.parse('2026-11-01T10:00:00Z'); const tick = (ms) => (clock += ms);
const h = createHistory(() => ws, { now: () => clock });
console.log('\nhistory');

{ const a = await h.snapshot('a.md', '# A\n\nOne\n', { reason: 'open', force: true });
  assert(a && a.words === 2 && a.by === 'you');
  assert.equal(await h.snapshot('a.md', '# A\n\nOne\n'), null); // same text: nothing new
  tick(10 * 60e3); const b = await h.snapshot('a.md', '# A\n\nOne two\n');
  tick(60e3); const c = await h.snapshot('a.md', '# A\n\nOne two three\n'); // within 3 minutes of b: replaces it
  let v = await h.list('a.md'); assert.equal(v.length, 2); assert.equal(v[0].id, c.id); assert.equal(v[0].t, b.t); assert.equal(v[0].delta, 2);
  tick(60e3); await h.snapshot('a.md', '# A\n\nOne two three four\n', { by: 'Claude', reason: 'ai', force: true });
  v = await h.list('a.md'); assert.equal(v.length, 3); assert.equal(v[0].by, 'Claude'); assert.equal(v[0].reason, 'ai');
  assert.equal(await h.get('a.md', v[2].id), '# A\n\nOne\n'); assert.equal(await h.get('a.md', v[1].id), '# A\n\nOne two three\n');
  ok('snapshots: same text is skipped, quick edits replace the newest version, AI edits and forced snapshots always add; restore returns the text exactly'); }

{ const objects = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : objects.push(p); } };
  await h.snapshot('copy.md', '# A\n\nOne\n', { reason: 'created', force: true }); walk(path.join(ws, '.folio', 'history', 'objects'));
  assert.equal(objects.length, 4, objects.join('\n')); // 4 distinct texts across both files, the shared one stored once
  assert(fs.existsSync(path.join(ws, '.folio')) && !fs.readdirSync(ws).includes('a.md'));
  ok('identical texts in two documents are stored once; history lives in .folio/history beside the files'); }

{ const v = await h.list('a.md'); const named = await h.name('a.md', v[2].id, 'First draft', 'sent to Ada');
  assert.equal(named.name, 'First draft'); assert.equal((await h.list('a.md'))[2].note, 'sent to Ada');
  await h.name('a.md', v[2].id, ''); assert.equal((await h.list('a.md'))[2].name, undefined);
  await assert.rejects(() => h.get('a.md', 'deadbeef'), /not in the history/);
  ok('named versions carry a note and can be unnamed; unknown versions are refused'); }

{ const D = 86400e3; const now = Date.parse('2027-06-01T00:00:00Z');
  const mk = (id, ago, extra = {}) => ({ id, t: now - ago, ...extra });
  const vs = [mk('old1', 400 * D), mk('old2', 400 * D - 3600e3), mk('named', 300 * D, { name: 'Release' }), mk('m1', 100 * D), mk('m2', 100 * D - 600e3), mk('m3', 100 * D - 7200e3), mk('r1', 5 * D), mk('r2', 5 * D - 60e3), mk('newest', 1000)];
  const out = keepers(vs, now).map((v) => v.id);
  assert(out.includes('named') && out.includes('newest') && out.includes('r1') && out.includes('r2'), out.join());
  assert.equal(out.filter((i) => i.startsWith('m')).length, 2, out.join()); // m1 and m2 share an hour; m3 is another
  assert.equal(out.filter((i) => i.startsWith('old')).length, 2, out.join()); // the oldest is always kept; old2 is the only one of its day left
  const big = Array.from({ length: 2600 }, (_, i) => mk('x' + i, i * 1000)); assert(keepers(big, now, { ...POLICY, maxVersions: 100 }).length <= 100);
  ok('retention: everything for 30 days, then hourly, then daily; named versions, the first and the newest stay; a size cap applies'); }

{ fs.writeFileSync(path.join(ws, 'a.md'), 'x'); await h.rename('a.md', 'moved/b.md');
  assert.equal((await h.list('a.md')).length, 0); assert.equal((await h.list('moved/b.md')).length, 3);
  const gone = await h.deleted(); assert(gone.some((d) => d.path === 'moved/b.md') && !gone.some((d) => d.path === 'a.md'), JSON.stringify(gone));
  fs.mkdirSync(path.join(ws, 'moved')); fs.writeFileSync(path.join(ws, 'moved', 'b.md'), 'back');
  assert(!(await h.deleted()).some((d) => d.path === 'moved/b.md'));
  await h.clear('moved/b.md'); assert.equal((await h.list('moved/b.md')).length, 0); assert((await h.usage()) > 0);
  ok('a rename moves the history with the document; deleted documents are listed with their last version; clear forgets one document'); }

{ const a = 'The quick brown fox jumps over the lazy dog. Second sentence stays.', b = 'The quick red fox leaps over the lazy dog. Second sentence stays! Extra.';
  const parts = wordParts(a, b, diffWords); assert.equal(parts.map((p) => p.text).filter((_, i) => parts[i].kind !== 'add').join(''), a); assert.equal(parts.filter((p) => p.kind !== 'del').map((p) => p.text).join(''), b);
  const hunks = countHunks(parts); assert(hunks >= 3, hunks);
  for (let i = 0; i < hunks; i++) assert.notEqual(revertHunk(parts, i), b); // every hunk changes the text
  const allBack = parts.filter((p) => p.kind !== 'add').map((p) => p.text).join(''); assert.equal(allBack, a);
  const one = revertHunk(parts, 0); assert.notEqual(one, b); assert(one.includes('brown') && one.includes('leaps') && one.includes('stays!'), one);
  assert.equal(wordCount('Dziękuję bardzo, it’s well-known 42'), 5);
  ok('changes between versions are word by word; one change can be put back on the current text without touching the others'); }

fs.rmSync(ws, { recursive: true, force: true });
console.log(`\n${n} history checks passed`);
