// Folio — chat conversations on disk: <folder>/.folio/chat/<id>.json, written atomically, beside version history.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import fss from 'node:fs';
import { writeAtomic } from '../atomic.js';

const ID = /^[a-z0-9-]{8,40}$/;
export function createChatStore(getRoot) {
  const dirOf = (r) => { if (!r) throw new Error('No folder is open.'); return path.join(path.resolve(r), '.folio', 'chat'); };
  const dir = () => dirOf(getRoot());
  /** .folio and .folio/chat must be real folders inside the workspace: a link there would send chats elsewhere */
  const plain = (r) => { for (const p of [path.join(path.resolve(r), '.folio'), dirOf(r)]) { const l = fss.lstatSync(p, { throwIfNoEntry: false }); if (l?.isSymbolicLink()) throw new Error('The .folio folder is a link, so Folio will not store chats there.'); } };
  const file = (id, r) => { if (!ID.test(id)) throw new Error('Bad conversation id.'); return path.join(dirOf(r ?? getRoot()), id + '.json'); };
  // a conversation belongs to the folder it was made or opened in: a late save after a folder switch never lands in the new folder
  const own = (c) => { Object.defineProperty(c, '_root', { value: getRoot(), enumerable: false, writable: true }); return c; };
  return {
    create() { return own({ id: crypto.randomUUID(), title: '', created: Date.now(), updated: Date.now(), grants: {}, messages: [] }); },
    async save(conv) {
      if (!conv.messages.length) return;
      if (!conv.title) { const first = conv.messages.find((m) => m.role === 'user'); conv.title = (first?.text || '').replace(/\s+/g, ' ').trim().slice(0, 60); }
      conv.updated = Date.now();
      const r = conv._root ?? getRoot(); plain(r);
      await fs.mkdir(dirOf(r), { recursive: true });
      await writeAtomic(file(conv.id, r), JSON.stringify(conv), { mode: 0o600 });
    },
    async load(id) { try { plain(getRoot()); const c = JSON.parse(await fs.readFile(file(id), 'utf8')); if (!Array.isArray(c.messages)) return null; c.grants = {}; return own(c); } catch { return null; } }, // a stored grant is never trusted: permissions are given in the app, per session
    async list() {
      let names; try { plain(getRoot()); names = await fs.readdir(dir()); } catch { return []; }
      const out = [];
      for (const n of names.filter((x) => x.endsWith('.json'))) { try { const c = JSON.parse(await fs.readFile(path.join(dir(), n), 'utf8')); out.push({ id: c.id, title: c.title || '', updated: c.updated || 0 }); } catch { /* damaged file: skipped */ } }
      return out.sort((a, b) => b.updated - a.updated);
    },
    async remove(id) { await fs.rm(file(id), { force: true }); },
  };
}
