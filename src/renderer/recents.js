// Folio — recently opened pages, per folder: one store shared by the search window (its empty list) and the sidebar's
// Recent list. Window storage only (never written into a note); a corrupt or unavailable storage reads as empty.
// { [workspace]: { [path]: lastOpenedMs } }, at most `max` pages a folder.
export const RECENT_KEY = 'folio.search.recent';

/**
 * workspace(): the open folder. storage: a Web Storage (localStorage by default; tests pass their own).
 * Returns { opened(p), moved(from, to), times(), list(n), onChange(fn) → unsubscribe }.
 */
export function createRecents({ workspace, storage = globalThis.localStorage, now = () => Date.now(), max = 100 } = {}) {
  const listeners = new Set();
  const readAll = () => {
    try { const v = JSON.parse(storage?.getItem(RECENT_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  };
  const writeAll = (all) => { try { storage?.setItem(RECENT_KEY, JSON.stringify(all)); } catch { /* full or blocked: recents are a convenience */ } listeners.forEach((fn) => { try { fn(); } catch {} }); };
  const mine = (all) => { const m = all[workspace()]; return m && typeof m === 'object' ? m : {}; };
  return {
    /** a page was opened (activated) */
    opened(p) {
      const ws = workspace(); if (!ws || !p) return;
      const all = readAll(); const m = { ...mine(all), [p]: now() };
      all[ws] = Object.fromEntries(Object.entries(m).filter(([, t]) => Number.isFinite(t)).sort((a, b) => b[1] - a[1]).slice(0, max));
      writeAll(all);
    },
    /** a page or folder was renamed or moved (`to` null: removed); its recents follow it */
    moved(from, to) {
      const ws = workspace(); if (!ws || !from) return;
      const all = readAll(); const m = mine(all); let changed = false;
      for (const k of Object.keys(m)) if (k === from || k.startsWith(from + '/')) { if (to) m[to + k.slice(from.length)] = Math.max(m[to + k.slice(from.length)] || 0, m[k]); delete m[k]; changed = true; }
      if (changed) { all[ws] = m; writeAll(all); }
    },
    /** { path: lastOpenedMs } for the open folder */
    times: () => ({ ...mine(readAll()) }),
    /** the paths opened most recently in the open folder, newest first */
    list: (n = 5) => Object.entries(mine(readAll())).filter(([, t]) => Number.isFinite(t)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([p]) => p),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
