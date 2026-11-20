// Folio — atomic file writes. A note is never left half written: the new text goes to a hidden temporary file in the
// same folder, is flushed to disk, then replaces the old file in one rename. A crash or power cut leaves either the old
// note or the new one. Pure Node, tested in test/atomic.test.mjs.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']); // Windows: an antivirus, indexer or sync client has the file open
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpName = (file) => path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);

/** writes data to file atomically; a symbolic link keeps pointing at its target, which receives the text */
export async function writeAtomic(file, data, { mode } = {}) {
  const target = await fs.realpath(file).catch(() => file);
  const tmp = tmpName(target);
  const fh = await fs.open(tmp, 'w', mode);
  try { await fh.writeFile(data, typeof data === 'string' ? 'utf8' : undefined); await fh.sync(); }
  catch (e) { await fh.close().catch(() => {}); await fs.rm(tmp, { force: true }); throw e; }
  await fh.close();
  for (let i = 0; ; i++) {
    try { await fs.rename(tmp, target); return; }
    catch (e) {
      if (BUSY.has(e.code) && i < 5) { await sleep(20 * 2 ** i); continue; }
      await fs.rm(tmp, { force: true });
      // the file stays locked or the folder refuses renames (some network drives): fall back to writing in place
      if (BUSY.has(e.code) || e.code === 'EXDEV') { await fs.writeFile(target, data, { mode }); return; }
      throw e;
    }
  }
}

/** the same for small files written from synchronous code (settings) */
export function writeAtomicSync(file, data, { mode } = {}) {
  let target = file; try { target = fss.realpathSync(file); } catch {}
  const tmp = tmpName(target);
  const fd = fss.openSync(tmp, 'w', mode);
  try { fss.writeFileSync(fd, data); fss.fsyncSync(fd); } finally { fss.closeSync(fd); }
  try { fss.renameSync(tmp, target); }
  catch (e) {
    fss.rmSync(tmp, { force: true });
    if (BUSY.has(e.code) || e.code === 'EXDEV') fss.writeFileSync(target, data, { mode }); else throw e;
  }
}
