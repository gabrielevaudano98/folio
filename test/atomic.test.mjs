// Folio — atomic writes: the old or the new text, never a half; links keep their target; no temporary files left.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { writeAtomic, writeAtomicSync, writeNew } from '../src/main/atomic.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-atomic-'));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
const leftovers = () => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
console.log('\natomic writes');
await t('creates and replaces a file, leaving no temporary file', async () => {
  const f = path.join(dir, 'a.md');
  await writeAtomic(f, 'one'); await writeAtomic(f, 'two – è');
  assert.equal(fs.readFileSync(f, 'utf8'), 'two – è'); assert.deepEqual(leftovers(), []);
});
await t('many writes in a row end with the last one', async () => {
  const f = path.join(dir, 'b.md');
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeAtomic(f, `v${i}`)));
  assert.match(fs.readFileSync(f, 'utf8'), /^v\d+$/); assert.deepEqual(leftovers(), []);
});
await t('a failed write leaves the old text and no temporary file', async () => {
  const f = path.join(dir, 'c.md'); fs.writeFileSync(f, 'old');
  await assert.rejects(writeAtomic(f, Symbol('not text'))); // fails after the temporary file exists
  assert.equal(fs.readFileSync(f, 'utf8'), 'old'); assert.deepEqual(leftovers(), []);
  assert.throws(() => writeAtomicSync(f, Symbol('not text')));
  assert.equal(fs.readFileSync(f, 'utf8'), 'old'); assert.deepEqual(leftovers(), []);
});
if (process.platform !== 'win32') await t('the file keeps its mode; a read-only file is refused', async () => {
  const f = path.join(dir, 'private.md'); fs.writeFileSync(f, 'a'); fs.chmodSync(f, 0o600);
  await writeAtomic(f, 'b'); assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  const ro = path.join(dir, 'ro.md'); fs.writeFileSync(ro, 'keep'); fs.chmodSync(ro, 0o444);
  await assert.rejects(writeAtomic(ro, 'new'), /read-only/); assert.equal(fs.readFileSync(ro, 'utf8'), 'keep');
  assert.deepEqual(leftovers(), []);
});
if (process.platform !== 'win32') await t('a symbolic link keeps pointing at its target', async () => {
  const real = path.join(dir, 'real.md'), link = path.join(dir, 'link.md'); fs.writeFileSync(real, 'r'); fs.symlinkSync(real, link);
  await writeAtomic(link, 'through the link');
  assert.ok(fs.lstatSync(link).isSymbolicLink()); assert.equal(fs.readFileSync(real, 'utf8'), 'through the link');
});
if (process.platform !== 'win32') await t('a link whose target does not exist yet writes through to it', async () => {
  const real = path.join(dir, 'later.md'), link = path.join(dir, 'dangling.md'); fs.symlinkSync(real, link);
  await writeAtomic(link, 'created'); assert.ok(fs.lstatSync(link).isSymbolicLink()); assert.equal(fs.readFileSync(real, 'utf8'), 'created');
  const real2 = path.join(dir, 'later2.md'), link2 = path.join(dir, 'dangling2.md'); fs.symlinkSync(real2, link2);
  writeAtomicSync(link2, 'sync'); assert.ok(fs.lstatSync(link2).isSymbolicLink()); assert.equal(fs.readFileSync(real2, 'utf8'), 'sync');
});
await t('a busy rename is retried, then refused without touching the old file', () => {
  const f = path.join(dir, 'busy.json'); fs.writeFileSync(f, 'old'); const real = fs.renameSync; let n = 0;
  const busy = () => Object.assign(new Error('busy'), { code: 'EBUSY' });
  try {
    fs.renameSync = (...a) => { if (++n <= 2) throw busy(); return real(...a); };
    writeAtomicSync(f, 'new'); assert.equal(fs.readFileSync(f, 'utf8'), 'new'); assert.equal(n, 3);
    fs.renameSync = () => { throw busy(); };
    assert.throws(() => writeAtomicSync(f, 'newer'), /another program is using it/);
  } finally { fs.renameSync = real; }
  assert.equal(fs.readFileSync(f, 'utf8'), 'new'); assert.deepEqual(leftovers(), []);
});
await t('writeNew creates a file and never replaces one', async () => {
  const f = path.join(dir, 'new.md'); await writeNew(f, 'first');
  await assert.rejects(writeNew(f, 'second'), (e) => e.code === 'EEXIST');
  assert.equal(fs.readFileSync(f, 'utf8'), 'first'); assert.deepEqual(leftovers(), []);
});
await t('sync version, with a file mode', () => {
  const f = path.join(dir, 'settings.json'); writeAtomicSync(f, '{"a":1}', { mode: 0o600 }); writeAtomicSync(f, '{"a":2}', { mode: 0o600 });
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":2}'); if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(leftovers(), []);
});
console.log(`  ${n} passed`);
