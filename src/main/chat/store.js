// Folio — chat conversations on disk: <folder>/.folio/chat/<id>.json, written atomically, beside version history.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeAtomic } from '../atomic.js';

const ID = /^[a-z0-9-]{8,40}$/;
export function createChatStore(getRoot) {
  const dir = () => { const r = getRoot(); if (!r) throw new Error('No folder is open.'); return path.join(path.resolve(r), '.folio', 'chat'); };
  const file = (id) => { if (!ID.test(id)) throw new Error('Bad conversation id.'); return path.join(dir(), id + '.json'); };
  return {
    create() { return { id: crypto.randomUUID(), title: '', created: Date.now(), updated: Date.now(), grants: {}, messages: [] }; },
    async save(conv) {
      if (!conv.messages.length) return;
      if (!conv.title) { const first = conv.messages.find((m) => m.role === 'user'); conv.title = (first?.text || '').replace(/\s+/g, ' ').trim().slice(0, 60); }
      conv.updated = Date.now();
      await fs.mkdir(dir(), { recursive: true });
      await writeAtomic(file(conv.id), JSON.stringify(conv), { mode: 0o600 });
    },
    async load(id) { try { const c = JSON.parse(await fs.readFile(file(id), 'utf8')); return Array.isArray(c.messages) ? c : null; } catch { return null; } },
    async list() {
      let names; try { names = await fs.readdir(dir()); } catch { return []; }
      const out = [];
      for (const n of names.filter((x) => x.endsWith('.json'))) { try { const c = JSON.parse(await fs.readFile(path.join(dir(), n), 'utf8')); out.push({ id: c.id, title: c.title || '', updated: c.updated || 0 }); } catch { /* damaged file: skipped */ } }
      return out.sort((a, b) => b.updated - a.updated);
    },
    async remove(id) { await fs.rm(file(id), { force: true }); },
  };
}
