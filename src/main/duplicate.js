// Folio — duplicate a page, or a folder of pages. Pure Node, shared by the app and tests.
// The copy sits next to the original as "<name> copy" ("copy" comes from the window, in the person's language; then
// "copy 2", "copy 3"…). Every file a copied page uses gets a new file of its own in the copy's `.asset` folder, so the
// copy and the original share nothing; `[[links]]` to other pages stay as they are. Notes are written with atomic.js.
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from './atomic.js';
import { NOTE_EXT, NotesError } from './notes.js';

const SKIP = new Set(['node_modules', '.git', '.obsidian', '.trash', 'dist', 'build']);
const NOTE_TAIL = /((?:\.(?:slides|board|sheet))?\.(?:md|markdown|mdx|txt))$/i;
export const MAX_DUPLICATE = 2000;

/** the localised word, made safe for a file name */
export function cleanSuffix(s) {
  const v = String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return v || 'copy';
}
/** "<dir>/<name> copy<.ext>", then "… copy 2"…; `taken(rel)` says whether a path is in use */
export async function copyName(rel, suffix, taken, isDir = false) {
  const slash = rel.lastIndexOf('/'); const dir = slash < 0 ? '' : rel.slice(0, slash + 1); const name = rel.slice(slash + 1);
  const ext = isDir ? '' : (name.match(NOTE_TAIL)?.[1] || path.extname(name));
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 10000; i++) {
    const cand = `${dir}${stem} ${suffix}${i > 1 ? ' ' + i : ''}${ext}`;
    if (!(await taken(cand))) return cand;
  }
  throw new NotesError('Could not find a free name for the copy.');
}

/**
 * Duplicate `from` (a note or a folder). Returns { to, isDir, pages: [copied notes], assets: [new asset files], skipped }.
 * `write(rel, text)` writes one new note (the app adds its watcher and history bookkeeping); by default an atomic write.
 * On a failure nothing is left behind.
 */
export async function duplicate({ notes, assets, from, suffix, write, limit = MAX_DUPLICATE }) {
  const abs = notes.resolve(from, { notRoot: true });
  const st = await fs.stat(abs).catch(() => null);
  if (!st) throw new NotesError(`Not found: ${from}`);
  const isDir = st.isDirectory();
  if (!isDir && !NOTE_EXT.includes(path.extname(abs).toLowerCase())) throw new NotesError('Only notes and folders can be duplicated.');
  const src = notes.relOf(abs);
  const taken = (rel) => fs.lstat(notes.resolve(rel)).then(() => true, () => false);
  const to = await copyName(src, cleanSuffix(suffix), taken, isDir);
  write ||= async (rel, text) => {
    const target = notes.resolve(rel, { mustBeNote: true });
    if (await fs.lstat(target).then(() => true, () => false)) throw new NotesError(`Destination exists: ${rel}`);
    await fs.mkdir(path.dirname(target), { recursive: true }); await writeAtomic(target, text);
  };

  // the plan first: what is copied where (links are not followed, hidden folders and other files are left out)
  const pages = []; const dirs = []; let skipped = 0;
  if (!isDir) pages.push([src, to]);
  else {
    const walk = async (dirAbs, rel, depth) => {
      if (depth > 12) return;
      const entries = await fs.readdir(dirAbs, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || SKIP.has(e.name)) continue; // .asset: only the files the pages use are copied, below
        if (e.isSymbolicLink()) { skipped++; continue; }
        if (e.isDirectory()) { dirs.push(rel + '/' + e.name); await walk(path.join(dirAbs, e.name), rel + '/' + e.name, depth + 1); }
        else if (e.isFile() && NOTE_EXT.includes(path.extname(e.name).toLowerCase())) pages.push([src + rel + '/' + e.name, to + rel + '/' + e.name]);
        else if (e.isFile()) skipped++;
        if (pages.length > limit) throw new NotesError(`That folder has more than ${limit} notes, too many to duplicate at once.`);
      }
    };
    await walk(abs, '', 0);
  }

  const made = []; const copied = [];
  try {
    if (isDir) {
      await fs.mkdir(notes.resolve(to, { notRoot: true }));
      for (const d of dirs) if (!/(^|\/)assets$/.test(d)) await fs.mkdir(notes.resolve(to + d), { recursive: true }); // empty folders come along; a legacy picture folder does not
    }
    for (const [a, b] of pages) {
      const text = await fs.readFile(notes.resolve(a), 'utf8');
      const r = await assets.copyFor(a, b, text);
      copied.push(...r.copied);
      await write(b, r.text); made.push(b);
    }
  } catch (e) {
    if (isDir) await fs.rm(notes.resolve(to, { notRoot: true }), { recursive: true, force: true }).catch(() => {});
    else for (const p of made) await fs.unlink(notes.resolve(p)).catch(() => {});
    for (const p of copied) await fs.unlink(notes.resolve(p, { allowAsset: true })).catch(() => {});
    throw e;
  }
  return { to, isDir, pages: made, assets: copied, skipped };
}
