// Folio — assets. Pure Node, shared by the app and tests.
// Pictures, video, audio, PDFs and attachments live in a hidden `.asset` folder next to the page that uses them:
//   <folder>/.asset/<8 hex of the content hash>-<name>      the file (identical content is stored once)
//   <folder>/.asset/.trash/<time>~<name>                    removed files, recoverable for 30 days
// The folder is dot-named, so the tree, search, tags and backlinks ignore it, and on Windows and macOS it also
// carries the hidden attribute so the file manager does not list it. Folio refuses to rename or delete it directly.
// Older workspaces keep `assets/`: references to it still work, and `migrateLegacy` moves them to `.asset`.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './atomic.js';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NOTE_EXT, NotesError } from './notes.js';

const exec = promisify(execFile);
export const ASSET_DIR = '.asset';
export const LEGACY_DIR = 'assets';
export const TRASH_DIR = '.trash';
export const MAX_ASSET_BYTES = 250 * 1024 * 1024;
export const TRASH_DAYS = 30;
const SKIP = new Set(['node_modules', '.git', '.folio', '.obsidian', 'dist', 'build']);

/* a reference to an asset inside any text: `.asset/x.png`, `../.asset/x.png`, `sub/assets/x.png`.
   Works for images, links, slide `src=`, `poster=`, front matter fonts and wiki embeds, because it only looks at the path. */
const REF = /(?<![\w.%/:-])((?:(?:\.\.?|[\w%~-][\w%.~-]*)\/)*)(\.asset|assets)\/((?:[^\s()"'<>[\]|,{}\\]|\([^\s()"'<>[\]|,{}\\]*\))+)/g; // balanced (1) in a name, as CommonMark allows
export function refsIn(text) {
  const out = [];
  for (const m of String(text).matchAll(REF)) {
    let name = m[3].replace(/[.:;!?]+$/, '');
    if (!name || name.startsWith('.trash/') || name.includes('/')) continue;
    const raw = m[1] + m[2] + '/' + name;
    let decoded; try { decoded = decodeURI(raw); } catch { decoded = raw; }
    out.push({ start: m.index, end: m.index + raw.length, raw, prefix: m[1], dir: m[2], name, decoded });
  }
  return out;
}

export function safeName(name) {
  const base = path.basename(String(name || 'file').replace(/\\/g, '/'));
  const ext = path.extname(base).replace(/[^\w.]/g, '').slice(0, 12);
  let stem = base.slice(0, base.length - path.extname(base).length).replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80);
  if (!stem) stem = 'file';
  return stem + ext.toLowerCase();
}
export const isNote = (p) => NOTE_EXT.includes(path.extname(p).toLowerCase());
/** true when a workspace-relative path is the asset folder or inside it */
export const isAssetPath = (rel) => String(rel).split(/[\\/]+/).includes(ASSET_DIR);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const exists = (p) => fs.stat(p).then(() => true, () => false);

async function hideFolder(dir) {
  try {
    if (process.platform === 'win32') await exec('attrib', ['+h', dir], { windowsHide: true });
    else if (process.platform === 'darwin') await exec('chflags', ['hidden', dir]);
  } catch { /* the dot name already hides it everywhere else */ }
}
async function sameContent(a, b) {
  const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)]);
  if (sa.size !== sb.size) return false;
  const [ha, hb] = await Promise.all([hashFile(a), hashFile(b)]); // streamed: two big files are never held in memory together
  return ha === hb;
}
async function hashFile(file) {
  return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fss.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
}

export function createAssets(notes, { now = () => Date.now() } = {}) {
  const root = () => notes.root();
  const rel = (abs) => path.relative(root(), abs).split(path.sep).join('/');
  const inside = (abs) => abs === root() || abs.startsWith(root() + path.sep);
  const noteDir = (noteRel) => path.dirname(notes.resolve(noteRel));
  const assetDir = (noteRel) => path.join(noteDir(noteRel), ASSET_DIR);

  async function ensureDir(dir) {
    const fresh = !(await exists(dir));
    await fs.mkdir(dir, { recursive: true });
    if (fresh) await hideFolder(dir);
  }
  /** write into the asset folder atomically: a temp file, then a rename, so a crash never leaves half a picture */
  async function place(dir, name, { buf, src }) {
    await ensureDir(dir);
    // the folder may be a link: what it really leads to must still be inside the workspace
    const [realDir, realRoot] = await Promise.all([fs.realpath(dir), fs.realpath(root())]);
    if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) throw new NotesError('The asset folder leads outside the workspace through a link.');
    name = name.replace(/^[0-9a-f]{8}-(?=.)/, '');
    const full = buf ? sha(buf) : await hashFile(src);
    for (let i = 0; i < 4; i++) {
      const target = path.join(dir, `${full.slice(i * 8, i * 8 + 8)}-${name}`);
      if (await exists(target)) {
        const same = buf ? Buffer.compare(await fs.readFile(target), buf) === 0 : await sameContent(target, src);
        if (same) return target; // already stored: reuse it
        continue; // 32-bit prefix clash with different content: try the next slice
      }
      const tmp = path.join(dir, `.tmp-${crypto.randomBytes(6).toString('hex')}`);
      try { if (buf) await fs.writeFile(tmp, buf); else await fs.copyFile(src, tmp); await fs.rename(tmp, target); }
      catch (e) { await fs.unlink(tmp).catch(() => {}); throw e; }
      return target;
    }
    throw new NotesError('Could not store the file (name clash).');
  }
  const relFromNote = (noteRel, abs) => path.relative(noteDir(noteRel), abs).split(path.sep).join('/');

  /** save bytes (a pasted or dropped file) → path relative to the note */
  async function save(noteRel, name, bytes) {
    const buf = Buffer.from(bytes);
    if (!buf.length) throw new NotesError('That file is empty.');
    if (buf.length > MAX_ASSET_BYTES) throw new NotesError('That file is larger than 250 MB.');
    return relFromNote(noteRel, await place(assetDir(noteRel), safeName(name), { buf }));
  }
  /** copy a file from anywhere on this machine into the asset folder */
  async function importFile(noteRel, srcAbs) {
    const st = await fs.stat(srcAbs);
    if (!st.isFile()) throw new NotesError('That is not a file.');
    if (st.size > MAX_ASSET_BYTES) throw new NotesError('That file is larger than 250 MB.');
    return relFromNote(noteRel, await place(assetDir(noteRel), safeName(path.basename(srcAbs)), { src: srcAbs }));
  }

  /** every asset a text points to, as workspace-relative paths (whether or not the file exists) */
  function refsOf(noteRel, text) {
    const dir = noteDir(noteRel); const out = new Set();
    for (const r of refsIn(text)) { const abs = path.resolve(dir, r.decoded); if (inside(abs)) out.add(rel(abs)); }
    return out;
  }

  /* ---- trash ---- */
  const trashDirFor = (assetFileAbs) => path.join(path.dirname(path.dirname(assetFileAbs)), ASSET_DIR, TRASH_DIR);
  function assertAssetFile(abs) {
    const parent = path.basename(path.dirname(abs));
    if (!inside(abs) || ![ASSET_DIR, LEGACY_DIR].includes(parent) || isNote(abs)) throw new NotesError('That is not a file in an asset folder.');
  }
  /** move an asset to the asset trash (recoverable for 30 days), or delete it for good */
  async function remove(assetRel, { permanent = false } = {}) {
    const abs = notes.resolve(assetRel, { allowAsset: true }); assertAssetFile(abs);
    if (!(await exists(abs))) return false;
    if (permanent) { await fs.unlink(abs); return true; }
    const dir = trashDirFor(abs); await ensureDir(path.dirname(dir)); await fs.mkdir(dir, { recursive: true });
    await fs.rename(abs, path.join(dir, `${now().toString(36)}~${path.basename(abs)}`));
    return true;
  }
  async function trashed(abs) {
    const dir = trashDirFor(abs); const name = path.basename(abs);
    let entries; try { entries = await fs.readdir(dir); } catch { return null; }
    const hits = entries.filter((e) => e.endsWith('~' + name)).sort();
    return hits.length ? path.join(dir, hits[hits.length - 1]) : null;
  }
  /** put a trashed asset back where a reference expects it */
  async function restore(assetRel) {
    const abs = notes.resolve(assetRel, { allowAsset: true }); assertAssetFile(abs);
    if (await exists(abs)) return true;
    const t = await trashed(abs); if (!t) return false;
    await fs.mkdir(path.dirname(abs), { recursive: true }); await fs.rename(t, abs); return true;
  }
  async function purgeTrash(days = TRASH_DAYS) {
    let n = 0;
    for (const dir of await assetFolders()) {
      const td = path.join(dir, TRASH_DIR); let entries; try { entries = await fs.readdir(td); } catch { continue; }
      for (const e of entries) {
        const t = parseInt(e.split('~')[0], 36); const p = path.join(td, e);
        const age = Number.isFinite(t) ? now() - t : now() - (await fs.stat(p)).mtimeMs;
        if (age > days * 864e5) { await fs.unlink(p).catch(() => {}); n++; }
      }
    }
    return n;
  }

  /* ---- scanning ---- */
  async function assetFolders() {
    const out = [];
    async function walk(dir, depth) {
      if (depth > 12) return;
      let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory() || SKIP.has(e.name)) continue;
        const abs = path.join(dir, e.name);
        if (e.name === ASSET_DIR || e.name === LEGACY_DIR) out.push(abs);
        if (e.name === ASSET_DIR || !e.name.startsWith('.')) await walk(abs, depth + 1);
      }
    }
    await walk(root(), 0);
    return out;
  }
  async function readAll() {
    const files = await notes.allFiles();
    const texts = await Promise.all(files.map((f) => fs.readFile(notes.resolve(f), 'utf8').catch(() => '')));
    return { files, texts };
  }
  /** what is used, what is not, what is missing. `grace` spares files made in the last minutes (a paste not saved into a page yet). */
  async function usage({ grace = 15 * 60e3 } = {}) {
    const { files, texts } = await readAll(); const used = new Map(); const missing = [];
    files.forEach((f, i) => {
      for (const r of refsIn(texts[i])) {
        const abs = path.resolve(noteDir(f), r.decoded); if (!inside(abs)) continue;
        const p = rel(abs); if (!used.has(p)) used.set(p, new Set()); used.get(p).add(f);
      }
    });
    const found = new Map(); let legacy = 0;
    for (const dir of await assetFolders()) {
      let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isFile() || e.name.startsWith('.tmp-') || (path.basename(dir) === LEGACY_DIR && isNote(e.name))) continue;
        const abs = path.join(dir, e.name); const st = await fs.stat(abs).catch(() => null); if (!st) continue;
        found.set(rel(abs), { path: rel(abs), bytes: st.size, modified: st.mtimeMs, legacy: path.basename(dir) === LEGACY_DIR });
        if (path.basename(dir) === LEGACY_DIR) legacy++;
      }
    }
    const usedList = [], unused = [];
    for (const [p, f] of found) (used.has(p) ? usedList.push({ ...f, notes: [...used.get(p)] }) : (now() - f.modified > grace ? unused.push(f) : 0));
    files.forEach((f, i) => { for (const r of refsIn(texts[i])) { const p = rel(path.resolve(noteDir(f), r.decoded)); if (!found.has(p) && inside(path.resolve(noteDir(f), r.decoded))) missing.push({ path: p, note: f, line: texts[i].slice(0, r.start).split('\n').length }); } });
    const bytes = (l) => l.reduce((s, x) => s + x.bytes, 0);
    return { used: usedList, unused, missing, legacy, unusedBytes: bytes(unused), usedBytes: bytes(usedList) };
  }

  /** references a page lost between two texts whose file nothing else uses: candidates for "remove the file too?" */
  async function orphans(noteRel, before, after) {
    const was = refsOf(noteRel, before), is = refsOf(noteRel, after);
    const gone = [...was].filter((p) => !is.has(p)); if (!gone.length) return [];
    const { files, texts } = await readAll(); const elsewhere = new Set();
    files.forEach((f, i) => { if (f !== noteRel) for (const p of refsOf(f, texts[i])) elsewhere.add(p); });
    const out = [];
    for (const p of gone) {
      if (elsewhere.has(p)) continue;
      const st = await fs.stat(notes.resolve(p, { allowAsset: true })).catch(() => null);
      if (st?.isFile() && [ASSET_DIR, LEGACY_DIR].includes(path.basename(path.dirname(p)))) out.push({ path: p, bytes: st.size });
    }
    return out;
  }
  /** which of these files some page still references (a stale question must never remove a file in use) */
  async function stillUsed(paths) {
    const { files, texts } = await readAll(); const used = new Set();
    files.forEach((f, i) => { for (const p of refsOf(f, texts[i])) used.add(p); });
    return new Set(paths.filter((p) => used.has(p)));
  }
  /** called when a page opens or saves: files a reference expects but that are gone come back from the trash (undo, restored versions) */
  async function heal(noteRel, text) {
    const restored = [], missing = [];
    for (const p of refsOf(noteRel, text)) {
      if (!isAssetPath(p) && path.basename(path.dirname(p)) !== LEGACY_DIR) continue;
      const abs = notes.resolve(p, { allowAsset: true });
      if (await exists(abs)) continue;
      if (await restore(p).catch(() => false)) restored.push(p); else missing.push(p);
    }
    return { restored, missing };
  }

  /* ---- moving pages ---- */
  /** a page moved to another folder: the files it uses are copied into the new folder's .asset and the references follow (text returned, not written) */
  async function relocate(fromRel, toRel, text) {
    const oldDir = noteDir(fromRel), newDir = noteDir(toRel);
    if (oldDir === newDir) return { text, copied: 0 };
    let out = '', last = 0, copied = 0; const done = new Map();
    for (const r of refsIn(text)) {
      const src = path.resolve(oldDir, r.decoded);
      if (!inside(src) || !(await exists(src))) continue;
      let target = done.get(src);
      if (!target) { target = await place(assetDirOf(newDir), path.basename(src), { src }); done.set(src, target); copied++; }
      out += text.slice(last, r.start) + encodeURI(path.relative(newDir, target).split(path.sep).join('/')); last = r.end;
    }
    return { text: out + text.slice(last), copied };
  }
  const assetDirOf = (dir) => path.join(dir, ASSET_DIR);

  /** move every `assets/` folder to `.asset` and rewrite the references; originals go to the asset trash. onBefore(rel, text) lets the caller snapshot first. */
  async function migrateLegacy({ onBefore } = {}) {
    const { files, texts } = await readAll(); const plan = new Map(); const edits = new Map();
    for (let i = 0; i < files.length; i++) {
      let out = '', last = 0, changed = false;
      for (const r of refsIn(texts[i])) {
        if (r.dir !== LEGACY_DIR) continue;
        const src = path.resolve(noteDir(files[i]), r.decoded); if (!inside(src) || !(await exists(src))) continue;
        let dest = plan.get(src);
        if (!dest) {
          const dir = path.join(path.dirname(path.dirname(src)), ASSET_DIR);
          let d = path.join(dir, path.basename(src)), n = 1;
          while (await exists(d) && !(await sameContent(d, src))) d = path.join(dir, `${path.basename(src, path.extname(src))}-${++n}${path.extname(src)}`);
          dest = d; plan.set(src, dest);
        }
        const target = encodeURI(path.relative(noteDir(files[i]), dest).split(path.sep).join('/'));
        out += texts[i].slice(last, r.start) + target; last = r.end; changed = true;
      }
      if (changed) edits.set(files[i], out + texts[i].slice(last));
    }
    for (const [src, dest] of plan) { if (!(await exists(dest))) { await ensureDir(path.dirname(dest)); await fs.copyFile(src, dest); } }
    for (const [f, text] of edits) { await onBefore?.(f, texts[files.indexOf(f)]); await writeAtomic(notes.resolve(f), text); }
    for (const src of plan.keys()) await remove(rel(src)).catch(() => {});
    for (const dir of await assetFolders()) if (path.basename(dir) === LEGACY_DIR) await fs.rmdir(dir).catch(() => {});
    return { notes: edits.size, files: plan.size, changed: [...edits.keys()] };
  }

  return { save, importFile, refsOf, stillUsed, remove, restore, purgeTrash, usage, orphans, heal, relocate, migrateLegacy, assetDir, isAssetPath };
}
