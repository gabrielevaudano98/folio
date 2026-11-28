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
  const load = async () => { try { const j = JSON.parse(await fs.readFile(file(), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };
  const save = (j) => writeAtomic(file(), JSON.stringify(j, null, 2), { mode: 0o600 });
  return {
    available: usable,
    async status() { const j = await load(); return Object.fromEntries(Object.entries(j).map(([p, e]) => [p, { has: true, last4: e.last4 }])); },
    async set(provider, key) {
      key = String(key || '').trim();
      if (!key) throw new Error('Paste the key first.');
      if (/\s/.test(key) || key.length > 400) throw new Error('That does not look like an API key.');
      if (!usable()) throw new Error('This computer has no secure place to keep a key (no keychain or keyring), so Folio will not store it.');
      const j = await load(); j[provider] = { v: safeStorage.encryptString(key).toString('base64'), last4: key.slice(-4) };
      await fs.mkdir(file().replace(/[\\/][^\\/]*$/, ''), { recursive: true });
      await save(j);
    },
    async get(provider) {
      const e = (await load())[provider]; if (!e) return null;
      try { return safeStorage.decryptString(Buffer.from(e.v, 'base64')); } catch { return null; } // another user or a reset keychain
    },
    async remove(provider) { const j = await load(); if (!(provider in j)) return; delete j[provider]; await save(j); },
  };
}
