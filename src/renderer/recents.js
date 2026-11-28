// Folio — recently opened pages, per folder: one store shared by the search window (its empty list) and the sidebar's
// Recent list. Window storage only (never written into a note); a corrupt or unavailable storage reads as empty.
// { [workspace]: { [path]: lastOpenedMs } }, at most `max` pages a folder.
export const RECENT_KEY = 'folio.search.recent';

/**
 * workspace(): the open folder. storage: a Web Storage (localStorage by default; tests pass their own).
 * Returns { opened(p), moved(from, to), forget(p) → entries, restore(entries), times(), list(n), onChange(fn) → unsubscribe }.
 */
const defaultStorage = () => { try { return globalThis.localStorage; } catch { return null; } }; // the getter itself can throw when storage is denied

export function createRecents({ workspace, storage = defaultStorage(), now = () => Date.now(), max = 100 } = {}) {
  const listeners = new Set();
  const readAll = () => {
    try { const v = JSON.parse(storage?.getItem(RECENT_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  };
  const writeAll = (all) => { try { storage?.setItem(RECENT_KEY, JSON.stringify(all)); } catch { /* full or blocked: recents are a convenience */ } listeners.forEach((fn) => { try { fn(); } catch {} }); };
  // a folder's map, with only finite timestamps: an array, a string or a broken entry reads as nothing
  const mine = (all) => { const m = all[workspace()]; return m && typeof m === 'object' && !Array.isArray(m) ? Object.fromEntries(Object.entries(m).filter(([, t]) => Number.isFinite(t))) : {}; };
  return {
    /** a page was opened (activated) */
    opened(p) {
      const ws = workspace(); if (!ws || !p) return;
      const all = readAll(); const m = { ...mine(all), [p]: now() };
      all[ws] = Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, max));
      writeAll(all);
    },
    /** a page or folder was renamed or moved (`to` null: removed); its recents follow it */
    moved(from, to) {
      const ws = workspace(); if (!ws || !from) return;
      const all = readAll(); const m = mine(all); let changed = false;
      for (const k of Object.keys(m)) if (k === from || k.startsWith(from + '/')) { if (to) m[to + k.slice(from.length)] = Math.max(m[to + k.slice(from.length)] || 0, m[k]); delete m[k]; changed = true; }
      if (changed) { all[ws] = m; writeAll(all); }
    },
    /** a page or folder was deleted: its entries leave the list; returns them, for restore() on Undo */
    forget(p) {
      const ws = workspace(); if (!ws || !p) return {};
      const all = readAll(); const m = mine(all); const gone = {};
      for (const k of Object.keys(m)) if (k === p || k.startsWith(p + '/')) { gone[k] = m[k]; delete m[k]; }
      if (Object.keys(gone).length) { all[ws] = m; writeAll(all); }
      return gone;
    },
    /** put back entries forget() returned (a newer opening of the same path wins) */
    restore(entries) {
      const ws = workspace(); if (!ws || !entries || !Object.keys(entries).length) return;
      const all = readAll(); const m = mine(all);
      for (const [k, t] of Object.entries(entries)) if (Number.isFinite(t)) m[k] = Math.max(m[k] || 0, t);
      all[ws] = Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, max)); writeAll(all);
    },
    /** { path: lastOpenedMs } for the open folder */
    times: () => ({ ...mine(readAll()) }),
    /** the paths opened most recently in the open folder, newest first */
    list: (n = 5) => Object.entries(mine(readAll())).filter(([, t]) => Number.isFinite(t)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([p]) => p),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
