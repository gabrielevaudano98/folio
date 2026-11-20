// Folio — notes core. Pure Node, shared by the app (IPC + HTTP MCP) and the stdio MCP bridge.
import fs from 'node:fs/promises';
import path from 'node:path';
import { findRefs, resolveTarget, rewriteRefs } from '../renderer/refs-syntax.js';

export const NOTE_EXT = ['.md', '.markdown', '.mdx', '.txt'];
const IGNORE = new Set(['node_modules', '.git', '.obsidian', '.trash', '.DS_Store', 'dist', 'build']);
const MAX_FILES = 5000;

export class NotesError extends Error {}

export function createNotes(getRoot) {
  const root = () => {
    const r = getRoot();
    if (!r) throw new NotesError('No folder is open in Folio. Open a folder first.');
    return path.resolve(r);
  };

  function resolve(rel, { mustBeNote = false } = {}) {
    if (typeof rel !== 'string' || !rel.trim()) throw new NotesError('A relative path is required.');
    const base = root();
    const abs = path.resolve(base, rel.replace(/^[/\\]+/, ''));
    if (abs !== base && !abs.startsWith(base + path.sep)) throw new NotesError(`Path escapes the workspace: ${rel}`);
    if (mustBeNote && !NOTE_EXT.includes(path.extname(abs).toLowerCase())) {
      throw new NotesError(`Only Markdown or text files can be written (${NOTE_EXT.join(', ')}).`);
    }
    return abs;
  }
  const relOf = (abs) => path.relative(root(), abs).split(path.sep).join('/');

  async function walk(dir, out, depth = 0) {
    if (out.length >= MAX_FILES || depth > 12) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || IGNORE.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs, out, depth + 1);
      else if (NOTE_EXT.includes(path.extname(e.name).toLowerCase())) out.push(abs);
    }
  }

  async function tree(dir = root(), depth = 0) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
    const nodes = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || IGNORE.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth >= 10) continue;
        const children = await tree(abs, depth + 1);
        if (e.name === 'assets' && !children.length) continue; // a legacy picture folder holds no pages: not shown
        nodes.push({ type: 'dir', name: e.name, path: relOf(abs), children });
      } else if (NOTE_EXT.includes(path.extname(e.name).toLowerCase())) {
        nodes.push({ type: 'file', name: e.name, path: relOf(abs) });
      }
    }
    return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1));
  }

  async function list({ folder = '', limit = 500 } = {}) {
    const start = folder ? resolve(folder) : root();
    const files = [];
    await walk(start, files);
    const stats = await Promise.all(files.slice(0, limit).map(async (f) => {
      const s = await fs.stat(f).catch(() => null);
      return { path: relOf(f), bytes: s?.size ?? 0, modified: s ? new Date(s.mtimeMs).toISOString() : null };
    }));
    return stats.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  }

  async function read(rel, { fromLine, toLine } = {}) {
    const abs = resolve(rel);
    let text;
    try { text = await fs.readFile(abs, 'utf8'); } catch { throw new NotesError(`Note not found: ${rel}`); }
    if (fromLine || toLine) {
      const lines = text.split('\n');
      const a = Math.max(1, fromLine || 1), b = Math.min(lines.length, toLine || lines.length);
      return lines.slice(a - 1, b).join('\n');
    }
    return text;
  }

  async function write(rel, content, { overwrite = true } = {}) {
    const abs = resolve(rel, { mustBeNote: true });
    const exists = await fs.stat(abs).then(() => true, () => false);
    if (exists && !overwrite) throw new NotesError(`A note already exists at ${rel}.`);
    const before = exists ? await fs.readFile(abs, 'utf8') : null;
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    return { path: relOf(abs), before, after: content, created: !exists };
  }

  async function edit(rel, edits) {
    const abs = resolve(rel, { mustBeNote: true });
    const before = await read(rel);
    let text = before;
    for (const [i, e] of edits.entries()) {
      const count = text.split(e.oldText).length - 1;
      if (count === 0) throw new NotesError(`Edit ${i + 1}: oldText not found in ${rel}. Read the note again and copy the text exactly.`);
      if (count > 1 && !e.replaceAll) throw new NotesError(`Edit ${i + 1}: oldText appears ${count} times; add surrounding context or set replaceAll.`);
      text = e.replaceAll ? text.split(e.oldText).join(e.newText) : text.replace(e.oldText, () => e.newText);
    }
    await fs.writeFile(abs, text, 'utf8');
    return { path: relOf(abs), before, after: text, created: false };
  }

  async function append(rel, addition, { underHeading } = {}) {
    const abs = resolve(rel, { mustBeNote: true });
    const before = await fs.readFile(abs, 'utf8').catch(() => '');
    let text;
    if (underHeading) {
      const lines = before.split('\n');
      const idx = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === underHeading.trim().toLowerCase());
      if (idx === -1) throw new NotesError(`Heading not found: ${underHeading}`);
      const level = lines[idx].match(/^#+/)[0].length;
      let end = lines.length;
      for (let j = idx + 1; j < lines.length; j++) {
        const m = lines[j].match(/^(#{1,6})\s/);
        if (m && m[1].length <= level) { end = j; break; }
      }
      while (end > idx + 1 && lines[end - 1].trim() === '') end--;
      lines.splice(end, 0, addition);
      text = lines.join('\n');
    } else {
      text = before ? before.replace(/\n*$/, '\n\n') + addition + '\n' : addition + '\n';
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text, 'utf8');
    return { path: relOf(abs), before, after: text, created: !before };
  }

  async function search(query, { regex = false, caseSensitive = false, limit = 100, folder = '' } = {}) {
    if (!query) throw new NotesError('A query is required.');
    let re;
    try { re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? '' : 'i'); }
    catch (e) { throw new NotesError(`Invalid regular expression: ${e.message}`); }
    const files = [];
    await walk(folder ? resolve(folder) : root(), files);
    const results = [];
    for (const f of files) {
      const text = await fs.readFile(f, 'utf8').catch(() => '');
      const lines = text.split('\n');
      const name = path.basename(f);
      const nameHit = re.test(name);
      const matches = [];
      lines.forEach((l, i) => { if (re.test(l)) matches.push({ line: i + 1, text: l.trim().slice(0, 240) }); });
      if (matches.length || nameHit) {
        results.push({ path: relOf(f), matches: matches.slice(0, 8), total: matches.length });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  async function outline(rel) {
    const text = await read(rel);
    const out = [];
    let fence = false;
    text.split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      const m = !fence && l.match(/^(#{1,6})\s+(.*)$/);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/\s+#+\s*$/, '').trim(), line: i + 1 });
    });
    return out;
  }

  async function move(from, to) {
    const a = resolve(from);
    const isDir = (await fs.stat(a).catch(() => null))?.isDirectory();
    const b = resolve(to, { mustBeNote: !isDir });
    if (await fs.stat(b).then(() => true, () => false)) throw new NotesError(`Destination exists: ${to}`);
    await fs.mkdir(path.dirname(b), { recursive: true });
    await fs.rename(a, b);
    return { from: relOf(a), to: relOf(b) };
  }

  /* references between documents */
  async function allTexts() {
    const files = (await list({ limit: 20000 })).map((f) => f.path);
    const texts = await Promise.all(files.map((f) => fs.readFile(resolve(f), 'utf8').catch(() => '')));
    return { files, texts };
  }
  /** after a move, point every reference that targeted `from` at `to`; returns the paths rewritten */
  async function rewriteAfterMove(from, to) {
    const { files, texts } = await allTexts();
    const before = files.map((f) => (f === to ? from : f));
    const changed = [];
    for (let i = 0; i < files.length; i++) {
      if (!texts[i] || !/\[\[|\{\{/.test(texts[i])) continue;
      const next = rewriteRefs(texts[i], before[i], from, to, before);
      if (next !== texts[i]) { await fs.writeFile(resolve(files[i]), next, 'utf8'); changed.push(files[i]); }
    }
    return changed;
  }
  async function backlinks(target) {
    const { files, texts } = await allTexts(); const want = relOf(resolve(target)); const out = [];
    files.forEach((f, i) => {
      const lines = texts[i].split('\n');
      for (const r of findRefs(texts[i])) if (resolveTarget(r.target, files, f) === want) {
        const line = texts[i].slice(0, r.start).split('\n').length;
        out.push({ path: f, line, kind: r.kind, ref: r.raw, text: lines[line - 1].trim().slice(0, 200) });
      }
    });
    return out;
  }
  async function brokenLinks(only) {
    const { files, texts } = await allTexts(); const out = [];
    files.forEach((f, i) => {
      if (only && f !== relOf(resolve(only))) return;
      for (const r of findRefs(texts[i])) if (r.target && !resolveTarget(r.target, files, f)) out.push({ path: f, line: texts[i].slice(0, r.start).split('\n').length, ref: r.raw });
    });
    return out;
  }

  return { root, resolve, relOf, tree, list, read, write, edit, append, search, outline, move, rewriteAfterMove, backlinks, brokenLinks, allFiles: async () => (await list({ limit: 20000 })).map((f) => f.path) };
}
