// Folio — atomic writes: the old or the new text, never a half; links keep their target; no temporary files left.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { writeAtomic, writeAtomicSync } from '../src/main/atomic.js';

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
  await assert.rejects(writeAtomic(path.join(dir, 'missing-folder', 'x.md'), 'new'));
  assert.equal(fs.readFileSync(f, 'utf8'), 'old'); assert.deepEqual(leftovers(), []);
});
if (process.platform !== 'win32') await t('a symbolic link keeps pointing at its target', async () => {
  const real = path.join(dir, 'real.md'), link = path.join(dir, 'link.md'); fs.writeFileSync(real, 'r'); fs.symlinkSync(real, link);
  await writeAtomic(link, 'through the link');
  assert.ok(fs.lstatSync(link).isSymbolicLink()); assert.equal(fs.readFileSync(real, 'utf8'), 'through the link');
});
await t('sync version, with a file mode', () => {
  const f = path.join(dir, 'settings.json'); writeAtomicSync(f, '{"a":1}', { mode: 0o600 }); writeAtomicSync(f, '{"a":2}', { mode: 0o600 });
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":2}'); if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(leftovers(), []);
});
console.log(`  ${n} passed`);
