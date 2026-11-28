// Folio — API keys for chat mode. Encrypted with the operating system's store (Electron safeStorage: Keychain, DPAPI,
// libsecret) and kept in one owner-only file. Without a real encryption backend nothing is stored: there is no plain-text
// fallback. The window never receives a key, only whether one exists and its last four characters.
import fs from 'node:fs/promises';
import { writeAtomic } from '../atomic.js';

export function createKeyStore({ file, safeStorage }) {
  const usable = () => {
    if (!safeStorage?.isEncryptionAvailable?.()) return false;
    return safeStorage.getSelectedStorageBackend?.() !== 'basic_text'; // Linux without a keyring would store it readable
  };
  // only a missing file is empty: a damaged one must not be overwritten with a single entry
  const load = async () => {
    let text; try { text = await fs.readFile(file(), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
    let j; try { j = JSON.parse(text); } catch { j = null; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('The saved key file is damaged, so Folio will not overwrite it. Remove ai-keys.json from the Folio data folder to start again.');
    return j;
  };
  let queue = Promise.resolve(); // read-modify-write of the one file runs one at a time, so two saves cannot drop each other's key
  const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
  const save = (j) => writeAtomic(file(), JSON.stringify(j, null, 2), { mode: 0o600 });
  return {
    available: usable,
    async status() { // only keys that can be used: after a keychain reset an entry cannot be decrypted
      let j; try { j = await load(); } catch { return {}; }
      const out = {};
      for (const [p, e] of Object.entries(j)) { try { safeStorage.decryptString(Buffer.from(e.v, 'base64')); out[p] = { has: true, last4: e.last4 }; } catch { /* not usable */ } }
      return out;
    },
    set: (provider, key) => serial(() => setNow(provider, key)),
    remove: (provider) => serial(async () => { const j = await load(); if (!(provider in j)) return; delete j[provider]; await save(j); }),
    async get(provider) {
      const e = (await load())[provider]; if (!e) return null;
      try { return safeStorage.decryptString(Buffer.from(e.v, 'base64')); } catch { return null; } // another user or a reset keychain
    },
  };
  async function setNow(provider, key) {
      key = String(key || '').trim();
      if (!key) throw new Error('Paste the key first.');
      if (/\s/.test(key) || key.length > 400) throw new Error('That does not look like an API key.');
      if (!usable()) throw new Error('This computer has no secure place to keep a key (no keychain or keyring), so Folio will not store it.');
      const j = await load(); j[provider] = { v: safeStorage.encryptString(key).toString('base64'), last4: key.length >= 16 ? key.slice(-4) : '' };
      await fs.mkdir(file().replace(/[\\/][^\\/]*$/, ''), { recursive: true });
      await save(j);
  }
}
