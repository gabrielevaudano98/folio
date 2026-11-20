// Folio — atomic file writes. A note is never left half written: the new text goes to a hidden temporary file in the
// same folder, is flushed to disk, then replaces the old file in one rename. A crash or power cut leaves either the old
// note or the new one. There is no in-place fallback: if the rename keeps failing (another program holds the file), the
// write fails with a clear message and the old file stays as it was. Tested in test/atomic.test.mjs.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']); // Windows: an antivirus, indexer or sync client has the file open
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpName = (file) => path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
const busyError = (target, e) => Object.assign(new Error(`${path.basename(target)} could not be saved because another program is using it. The file on disk is unchanged; try again in a moment.`), { code: e.code, cause: e });
const readOnly = (target) => Object.assign(new Error(`${path.basename(target)} is read-only, so Folio did not change it.`), { code: 'EACCES' });
/** the replacement keeps the mode of the file it replaces; a read-only file is refused, as a plain write would be */
function modeFor(prev, mode) {
  if (prev && !(prev.mode & 0o200)) return { readOnly: true }; // also the Windows read-only attribute
  return { mode: mode ?? (prev ? prev.mode & 0o7777 : undefined) };
}

/** writes data to file atomically; a symbolic link keeps pointing at its target, which receives the text */
export async function writeAtomic(file, data, { mode } = {}) {
  const target = await fs.realpath(file).catch(async () => { // a link whose target does not exist yet still writes through to it
    const l = await fs.lstat(file).catch(() => null);
    return l?.isSymbolicLink() ? path.resolve(path.dirname(file), await fs.readlink(file)) : file;
  });
  const m = modeFor(await fs.stat(target).catch(() => null), mode);
  if (m.readOnly) throw readOnly(target);
  const tmp = tmpName(target);
  const fh = await fs.open(tmp, 'w', m.mode);
  try { await fh.writeFile(data, typeof data === 'string' ? 'utf8' : undefined); await fh.sync(); }
  catch (e) { await fh.close().catch(() => {}); await fs.rm(tmp, { force: true }); throw e; }
  await fh.close();
  if (m.mode !== undefined) await fs.chmod(tmp, m.mode).catch(() => {}); // open() applies the umask
  for (let i = 0; ; i++) {
    try { await fs.rename(tmp, target); return; }
    catch (e) {
      if (BUSY.has(e.code) && i < 6) { await sleep(25 * 2 ** i); continue; } // about 1.6 s in all
      await fs.rm(tmp, { force: true });
      throw BUSY.has(e.code) ? busyError(target, e) : e;
    }
  }
}

/** the same for small files written from synchronous code (settings) */
export function writeAtomicSync(file, data, { mode } = {}) {
  let target = file;
  try { target = fss.realpathSync(file); } catch { try { if (fss.lstatSync(file).isSymbolicLink()) target = path.resolve(path.dirname(file), fss.readlinkSync(file)); } catch {} }
  let prev = null; try { prev = fss.statSync(target); } catch {}
  const m = modeFor(prev, mode);
  if (m.readOnly) throw readOnly(target);
  const tmp = tmpName(target);
  const fd = fss.openSync(tmp, 'w', m.mode);
  try { fss.writeFileSync(fd, data); fss.fsyncSync(fd); }
  catch (e) { fss.closeSync(fd); fss.rmSync(tmp, { force: true }); throw e; }
  fss.closeSync(fd);
  if (m.mode !== undefined) try { fss.chmodSync(tmp, m.mode); } catch {}
  for (let i = 0; ; i++) { // the same retries as writeAtomic, waiting without a timer
    try { fss.renameSync(tmp, target); return; }
    catch (e) {
      if (BUSY.has(e.code) && i < 6) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * 2 ** i); continue; }
      fss.rmSync(tmp, { force: true }); throw BUSY.has(e.code) ? busyError(target, e) : e;
    }
  }
}
