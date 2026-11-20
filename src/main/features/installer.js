// Folio — downloads and installs catalog components. Runs in the main process; all disk and network work is asynchronous.
// Resumable (HTTP Range), checked (SHA-256 of every file), atomic (a component appears only when complete), one at a time.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { COMPONENTS, keepLlamaFile } from './catalog.js';
import { parseTgz, parseZip, selectFiles } from './unpack.js';

const KEEP = { llama: keepLlamaFile };
const MARK = '.installed.json';

export class CancelledError extends Error { constructor() { super('Download cancelled.'); this.cancelled = true; } }

async function sha256File(p) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fss.createReadStream(p, { highWaterMark: 1 << 20 })) h.update(chunk);
  return h.digest('hex');
}
const sizeOf = async (p) => (await fs.stat(p).catch(() => null))?.size ?? 0;
const exists = async (p) => !!(await fs.stat(p).catch(() => null));

/**
 * @param {{ root: string, platformKey: string, fetch: typeof fetch, onProgress?: (s: object) => void, freeBytes?: (dir: string) => Promise<number>, components?: object }} o
 */
export function createInstaller({ root, platformKey, fetch, onProgress = () => {}, freeBytes, components = COMPONENTS }) {
  const filesOf = (id) => components[id]?.files || components[id]?.platforms?.[platformKey] || null;
  const dl = path.join(root, '.downloads'), staging = path.join(root, '.staging');
  const live = new Map(); // id -> { state, done, total, error }
  let busy = null; // { ids, abort }
  let lastEmit = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 250) return;
    lastEmit = now; onProgress(snapshot());
  };
  const snapshot = () => Object.fromEntries([...live].map(([id, s]) => [id, { ...s }]));

  const dirOf = (id) => { if (!components[id]) throw new Error(`Unknown component: ${id}`); return path.join(root, id); };

  /** state of a component on disk: ready, partial (a download to resume), not-installed, corrupt, unsupported */
  async function status(id) {
    const c = components[id]; const files = filesOf(id);
    if (!c || !files) return { id, state: 'unsupported', total: 0 };
    const total = files.reduce((n, f) => n + f.bytes, 0);
    const l = live.get(id);
    if (l && ['queued', 'downloading', 'verifying', 'unpacking'].includes(l.state)) return { id, ...l, total };
    let mark = null;
    try { mark = JSON.parse(await fs.readFile(path.join(dirOf(id), MARK), 'utf8')); } catch {}
    if (mark) {
      if (mark.version !== c.version || mark.platform !== platformKey) return { id, state: 'outdated', total };
      for (const f of files) if (!f.unpack && (await sizeOf(path.join(dirOf(id), f.name))) !== f.bytes) return { id, state: 'corrupt', total };
      return { id, state: 'ready', total, diskBytes: mark.diskBytes || total };
    }
    let part = 0; for (const f of files) part += await sizeOf(path.join(dl, id, f.name + '.part'));
    return { id, state: part ? 'partial' : 'not-installed', done: part, total, error: l?.error };
  }

  async function download(id, f, signal) {
    const part = path.join(dl, id, f.name + '.part');
    await fs.mkdir(path.dirname(part), { recursive: true });
    let have = await sizeOf(part);
    if (have > f.bytes) { await fs.rm(part, { force: true }); have = 0; }
    const s = live.get(id);
    if (have < f.bytes) {
      const res = await fetch(f.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal, redirect: 'follow' });
      if (res.status === 200 && have) have = 0; // the server ignored the range: start again
      else if (res.status !== 200 && res.status !== 206) throw new Error(`Download of ${f.name} failed (HTTP ${res.status}).`);
      const fh = await fs.open(part, have ? 'a' : 'w');
      s.done = s.base + have;
      try {
        for await (const chunk of res.body) {
          if (signal.aborted) throw new CancelledError();
          await fh.write(chunk); have += chunk.length; s.done = s.base + have; emit();
          if (have > f.bytes) throw new Error(`${f.name} is larger than expected.`);
        }
      } finally { await fh.close(); }
    }
    s.state = 'verifying'; emit(true);
    const got = await sha256File(part);
    if (got !== f.sha256 || (await sizeOf(part)) !== f.bytes) { await fs.rm(part, { force: true }); throw new Error(`${f.name} did not match its checksum, so it was deleted. Try again.`); }
    s.state = 'downloading'; s.base += f.bytes;
    return part;
  }

  /** move verified downloads into a staging folder, unpacking archives, then swap it in */
  async function place(id, parts) {
    const files = filesOf(id);
    const stage = path.join(staging, id);
    await fs.rm(stage, { recursive: true, force: true }); await fs.mkdir(stage, { recursive: true });
    let diskBytes = 0;
    for (const [i, f] of files.entries()) {
      if (!f.unpack) { await fs.rename(parts[i], path.join(stage, f.name)); diskBytes += f.bytes; continue; }
      const buf = await fs.readFile(parts[i]);
      const entries = f.unpack === 'zip' ? await parseZip(buf) : parseTgz(buf);
      const out = selectFiles(entries, { strip: f.strip || 0, keep: f.keep ? KEEP[f.keep] : undefined });
      if (!out.length) throw new Error(`${f.name} held none of the expected files.`);
      for (const o of out) {
        const dest = path.join(stage, ...(f.into ? f.into.split('/') : []), ...o.path.split('/'));
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, o.data, { mode: o.mode }); diskBytes += o.data.length;
      }
      await fs.rm(parts[i], { force: true });
    }
    await fs.writeFile(path.join(stage, MARK), JSON.stringify({ id, version: components[id].version, platform: platformKey, diskBytes, files: files.map((f) => ({ name: f.name, sha256: f.sha256 })) }, null, 2));
    const dest = dirOf(id), old = dest + '.old';
    await fs.rm(old, { recursive: true, force: true });
    if (await exists(dest)) await fs.rename(dest, old);
    await fs.rename(stage, dest);
    await fs.rm(old, { recursive: true, force: true });
    await fs.rm(path.join(dl, id), { recursive: true, force: true });
  }

  /** installs the listed components in order; resolves when all are ready, rejects on error or cancel */
  async function install(ids) {
    if (busy) throw new Error('Another download is running. Wait for it or cancel it.');
    for (const id of ids) if (!filesOf(id)) throw new Error(`${components[id]?.name || id} is not available on this computer.`);
    const ac = new AbortController();
    busy = { ids, abort: () => ac.abort() }; // taken before the first await, so two calls cannot both start
    try { return await run(ids, ac); } finally { busy = null; }
  }
  async function run(ids, ac) {
    const todo = [];
    for (const id of ids) if ((await status(id)).state !== 'ready') todo.push(id);
    if (!todo.length) return;
    await fs.mkdir(root, { recursive: true });
    let need = 0;
    for (const id of todo) for (const f of filesOf(id)) need += f.bytes * (f.unpack ? 4 : 1) - (await sizeOf(path.join(dl, id, f.name + '.part')));
    if (freeBytes) {
      const free = await freeBytes(root);
      if (free < need * 1.1) throw new Error(`Not enough free disk space: this needs about ${gb(need)}, and ${gb(free)} is free.`);
    }
    for (const id of todo) live.set(id, { state: 'queued', done: 0, base: 0, total: filesOf(id).reduce((n, f) => n + f.bytes, 0) });
    emit(true);
    try {
      for (const id of todo) {
        const s = live.get(id); s.state = 'downloading'; s.error = undefined; emit(true);
        const parts = [];
        for (const f of filesOf(id)) parts.push(await download(id, f, ac.signal));
        s.state = 'unpacking'; emit(true);
        await place(id, parts);
        live.delete(id); emit(true);
      }
    } catch (e) {
      const err = ac.signal.aborted || e.name === 'AbortError' ? new CancelledError() : e;
      for (const id of todo) { const s = live.get(id); if (s) { s.state = 'failed'; s.error = err.cancelled ? null : err.message; } }
      emit(true);
      for (const id of todo) if (live.get(id)?.state === 'failed') live.set(id, { state: 'idle', error: live.get(id).error });
      throw err;
    }
  }

  return {
    status,
    statuses: async (ids) => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await status(id)]))),
    install,
    busy: () => !!busy,
    cancel: () => { busy?.abort(); },
    /** removes a component and any partial download of it; the caller makes sure nothing is using it */
    async uninstall(id) {
      if (busy?.ids.includes(id)) throw new Error('Cancel the download first.');
      await fs.rm(dirOf(id), { recursive: true, force: true });
      await fs.rm(path.join(dl, id), { recursive: true, force: true });
      live.delete(id);
    },
    pathOf: dirOf,
    /** leftovers of an install that was interrupted while placing files; partial downloads are kept to resume */
    async cleanup() { await fs.rm(staging, { recursive: true, force: true }); for (const id of Object.keys(components)) await fs.rm(dirOf(id) + '.old', { recursive: true, force: true }); },
  };
}
const gb = (n) => `${(n / 2 ** 30).toFixed(1)} GB`;
