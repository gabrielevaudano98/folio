// Folio — version history. Pure Node, shared by the app and the stdio MCP bridge.
// Beside the workspace, never inside a document: <workspace>/.folio/history/
//   objects/ab/cdef….gz   the text of a version, compressed, named by its SHA-256 (identical texts are stored once)
//   files/<id>.json       per document: its path and its versions, newest last
// Dot folders are ignored by the tree, search, tags and backlinks, so history never shows up as notes.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gz = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const HOUR = 3600e3, DAY = 24 * HOUR;
export const POLICY = { everything: 30 * DAY, hourly: 183 * DAY, minGap: 3 * 60e3, maxVersions: 2000 };

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const fileId = (rel) => crypto.createHash('sha1').update(rel).digest('hex').slice(0, 20);
export const wordCount = (t) => (String(t).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

/* which versions survive: everything for 30 days, then one per hour for 6 months, then one per day.
   Named versions, the first and the newest are never dropped. Pure, so it is tested without a disk. */
export function keepers(versions, now = Date.now(), policy = POLICY) {
  const keep = new Set(); const seen = new Set();
  const order = [...versions].sort((a, b) => b.t - a.t);
  order.forEach((v, i) => {
    const age = now - v.t;
    if (v.name || i === 0 || i === order.length - 1 || age <= policy.everything) { keep.add(v.id + '@' + v.t); return; }
    const bucket = age <= policy.hourly ? 'h' + Math.floor(v.t / HOUR) : 'd' + Math.floor(v.t / DAY);
    if (!seen.has(bucket)) { seen.add(bucket); keep.add(v.id + '@' + v.t); }
  });
  let out = versions.filter((v) => keep.has(v.id + '@' + v.t));
  if (out.length > policy.maxVersions) { const named = out.filter((v) => v.name); const rest = out.filter((v) => !v.name).slice(-(policy.maxVersions - named.length)); out = [...named, ...rest].sort((a, b) => a.t - b.t); }
  return out;
}

export function createHistory(getRoot, { now = () => Date.now(), policy = POLICY } = {}) {
  const base = () => { const r = getRoot(); if (!r) throw new Error('No folder is open.'); return path.join(path.resolve(r), '.folio', 'history'); };
  const root = () => path.resolve(getRoot());
  const indexPath = (rel) => path.join(base(), 'files', fileId(rel) + '.json');
  const objectPath = (id) => path.join(base(), 'objects', id.slice(0, 2), id.slice(2) + '.gz');

  async function readIndex(rel) { try { return JSON.parse(await fs.readFile(indexPath(rel), 'utf8')); } catch { return { path: rel, versions: [] }; } }
  async function writeIndex(ix) { await fs.mkdir(path.dirname(indexPath(ix.path)), { recursive: true }); const tmp = indexPath(ix.path) + '.tmp'; await fs.writeFile(tmp, JSON.stringify(ix), 'utf8'); await fs.rename(tmp, indexPath(ix.path)); }
  async function putObject(id, text) { const p = objectPath(id); try { await fs.access(p); return; } catch {} await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, await gz(Buffer.from(text, 'utf8'))); }
  async function getObject(id) { return (await gunzip(await fs.readFile(objectPath(id)))).toString('utf8'); }

  /* snapshot(rel, text, { by, reason, force }): by is 'you' or an AI client's name.
     Skipped when the text equals the newest version; automatic edits are kept at least minGap apart (the newest one is replaced), unless forced. */
  async function snapshot(rel, text, { by = 'you', reason = 'edit', force = false } = {}) {
    if (typeof text !== 'string') return null;
    const ix = await readIndex(rel); const id = sha(text); const last = ix.versions[ix.versions.length - 1]; const t = now();
    if (last && last.id === id) return null;
    await putObject(id, text);
    const prevText = last ? await getObject(last.id).catch(() => '') : '';
    const entry = { id, t, size: Buffer.byteLength(text), words: wordCount(text), delta: wordCount(text) - (last ? wordCount(prevText) : 0), by, reason };
    if (!force && last && !last.name && last.by === by && last.reason === 'edit' && reason === 'edit' && t - last.t < policy.minGap) ix.versions[ix.versions.length - 1] = { ...entry, t: last.t, delta: wordCount(text) - (ix.versions.length > 1 ? (ix.versions[ix.versions.length - 2].words || 0) : 0), updated: t };
    else ix.versions.push(entry);
    ix.versions = keepers(ix.versions, t, policy); ix.path = rel;
    await writeIndex(ix); return entry;
  }
  async function list(rel) { const ix = await readIndex(rel); return [...ix.versions].reverse(); }
  async function get(rel, id) {
    const ix = await readIndex(rel); if (!ix.versions.some((v) => v.id === id)) throw new Error('That version is not in the history.');
    return getObject(id);
  }
  async function name(rel, id, label, note = '') {
    const ix = await readIndex(rel); const v = [...ix.versions].reverse().find((x) => x.id === id);
    if (!v) throw new Error('That version is not in the history.');
    if (label) { v.name = String(label).slice(0, 80); if (note) v.note = String(note).slice(0, 300); else delete v.note; } else { delete v.name; delete v.note; }
    await writeIndex(ix); return v;
  }
  /* a document moved: its history follows it */
  async function rename(from, to) {
    const ix = await readIndex(from); if (!ix.versions.length) return false;
    const target = await readIndex(to);
    ix.path = to; ix.versions = [...target.versions, ...ix.versions].sort((a, b) => a.t - b.t);
    await writeIndex(ix); await fs.rm(indexPath(from), { force: true }); return true;
  }
  async function clear(rel) { await fs.rm(indexPath(rel), { force: true }); return true; }
  /* documents whose file is gone but whose history remains */
  async function deleted() {
    let names; try { names = await fs.readdir(path.join(base(), 'files')); } catch { return []; }
    const out = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      let ix; try { ix = JSON.parse(await fs.readFile(path.join(base(), 'files', n), 'utf8')); } catch { continue; }
      if (!ix.versions?.length) continue;
      const exists = await fs.access(path.resolve(root(), ix.path)).then(() => true, () => false);
      if (!exists) { const last = ix.versions[ix.versions.length - 1]; out.push({ path: ix.path, last, versions: ix.versions.length }); }
    }
    return out.sort((a, b) => b.last.t - a.last.t);
  }
  /* who created each document, for the search window's Created by filter: { path: { by, t } }. Known only when Folio saw
     the file come into being, i.e. its oldest version was made when it was created (in Folio, 'created'; by an assistant,
     'ai'; the first save of a new file, 'edit'). A file that already existed starts with 'open' or 'before-ai': unknown.
     Index files are replaced by rename, so the folder's mtime changes with every write: the answer is cached on it. */
  let creatorsCache = null;
  async function creators() {
    const dir = path.join(base(), 'files');
    const st = await fs.stat(dir).catch(() => null); if (!st) return {};
    const key = dir + '\0' + st.mtimeMs;
    if (creatorsCache?.key === key) return creatorsCache.value;
    const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json'));
    const out = {};
    for (let i = 0; i < names.length; i += 64) {
      const ixs = await Promise.all(names.slice(i, i + 64).map((n) => fs.readFile(path.join(dir, n), 'utf8').then((t) => JSON.parse(t), () => null)));
      for (const ix of ixs) {
        const first = ix?.versions?.[0]; if (typeof ix?.path !== 'string' || !first) continue;
        if (['created', 'ai', 'edit'].includes(first.reason)) out[ix.path] = { by: typeof first.by === 'string' && first.by ? first.by : 'you', t: first.t };
      }
    }
    creatorsCache = { key, value: out };
    return out;
  }
  async function usage() {
    let total = 0; const walk = async (d) => { let es; try { es = await fs.readdir(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else total += (await fs.stat(p).catch(() => ({ size: 0 }))).size; } };
    await walk(base()); return total;
  }
  return { snapshot, list, get, name, rename, clear, deleted, usage, creators };
}

export { wordParts, revertHunk, countHunks } from './history-diff.js';
