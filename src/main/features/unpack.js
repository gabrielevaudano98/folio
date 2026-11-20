// Folio — read .tgz and .zip archives in memory and decide which files to write. Pure, tested in Node.
// Archives come from pinned, hash-checked downloads, but the paths inside are still treated as untrusted.
import zlib from 'node:zlib';
import JSZip from 'jszip';

const str = (b, s, n) => { const x = b.subarray(s, s + n); const z = x.indexOf(0); return x.subarray(0, z < 0 ? n : z).toString('utf8'); };
const oct = (b, s, n) => parseInt(str(b, s, n).trim() || '0', 8);

/** entries of a tar archive (ustar, GNU long names, pax paths). type: file, dir, link (symbolic), other */
export function parseTar(buf) {
  const out = []; let off = 0, longName = null, paxPath = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = oct(h, 124, 12), flag = String.fromCharCode(h[156] || 48);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (flag === 'L') { longName = str(data, 0, data.length); continue; }
    if (flag === 'x') { const m = data.toString('utf8').match(/\d+ path=([^\n]*)\n/); paxPath = m ? m[1] : null; continue; }
    if (flag === 'g') continue;
    const prefix = str(h, 345, 155), base = str(h, 0, 100);
    const name = paxPath || longName || (prefix ? `${prefix}/${base}` : base);
    longName = paxPath = null;
    const type = flag === '0' || flag === '\0' || flag === '7' ? 'file' : flag === '5' ? 'dir' : flag === '2' ? 'link' : 'other';
    out.push({ name, type, data, linkname: str(h, 157, 100), mode: oct(h, 100, 8) });
  }
  return out;
}
export const parseTgz = (buf) => parseTar(zlib.gunzipSync(buf));

/** entries of a zip archive, same shape as parseTar */
export async function parseZip(buf) {
  const zip = await JSZip.loadAsync(buf);
  const out = [];
  for (const e of Object.values(zip.files)) {
    if (e.dir) { out.push({ name: e.name, type: 'dir', data: Buffer.alloc(0), mode: 0o755 }); continue; }
    out.push({ name: e.name, type: 'file', data: await e.async('nodebuffer'), mode: e.unixPermissions || 0o644 });
  }
  return out;
}

/** a safe relative path, or null: no absolute paths, drive letters, empty or '..' segments */
export function safeRel(name, strip = 0) {
  const parts = String(name).replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
  if (/^[a-zA-Z]:/.test(String(name)) || String(name).startsWith('/') || parts.includes('..')) return null;
  const rest = parts.slice(strip);
  return rest.length ? rest.join('/') : null;
}

/**
 * The files to write: regular files kept by `keep`, and symbolic links turned into copies of their target
 * (a link is never created on disk). Anything unsafe is refused, which fails the whole install.
 */
export function selectFiles(entries, { strip = 0, keep = () => true } = {}) {
  const files = new Map();
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const rel = safeRel(e.name, strip);
    if (rel === null) { if (safeRel(e.name, 0) === null) throw new Error(`Unsafe path in archive: ${e.name}`); continue; }
    if (keep(rel)) files.set(rel, { path: rel, data: e.data, mode: e.mode & 0o111 ? 0o755 : 0o644 });
  }
  const links = entries.filter((e) => e.type === 'link');
  for (let pass = 0, changed = true; changed && pass < 8; pass++) { // links to links (libx.so -> libx.so.1 -> libx.so.1.0.0)
    changed = false;
    for (const e of links) {
      const rel = safeRel(e.name, strip);
      if (rel === null || !keep(rel) || files.has(rel)) continue;
      const target = safeRel([...rel.split('/').slice(0, -1), e.linkname].join('/'));
      const src = target && files.get(target);
      if (src) { files.set(rel, { ...src, path: rel }); changed = true; } // a link to something we do not keep is left out
    }
  }
  return [...files.values()];
}
