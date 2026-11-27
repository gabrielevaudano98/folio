// Folio — reminders (D1, D2, X13). Finds `[[2026-12-01]]{09:00 remind 30m}` mentions in the workspace's pages
// (page-when.js), keeps them in memory, and fires each one once when its time comes while Folio is open: the caller
// shows an Electron Notification and an in-app toast. Nothing runs when Folio is closed (decision 2: in-app first).
//
// A reminder whose time passed while Folio was closed is not announced on start: it is listed as overdue.
// Done and dismissed states are app state, kept by the caller in the settings file per workspace
// ({ "<folder>": { "<page>::<key>": "done" | "dismissed" } }), never in the .md.
// Reading is asynchronous and gives way between files; a page is only parsed when it contains "remind".
import { scanReminders } from '../renderer/page-when.js';

const realClock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
const MAX_WAIT = 60 * 60 * 1000; // the timer is re-armed at least hourly (a sleeping computer, a changed clock)
const GRACE = 60 * 1000; // a reminder that comes due less than a minute before a scan still fires (an edit just in time)

/** the id of a reminder in a page: "<page>::<mention>#<n>" */
export const reminderId = (rel, key) => `${rel}::${key}`;

/**
 * notes: { allFiles(), read(rel) }; isNote(rel); clock: { now, setTimeout, clearTimeout };
 * states(): the { id: state } map of the open workspace; setStates(map) stores it;
 * onFire(item) for each reminder that comes due; onChange() when the list changes.
 */
export function createReminders({ notes, isNote = (r) => /\.(md|markdown|mdx|txt)$/i.test(r), clock = realClock, states = () => ({}), setStates = () => {}, onFire = () => {}, onChange = () => {} }) {
  let byFile = new Map(); // rel -> reminders of that page
  let since = clock.now(); // reminders due after this moment fire; earlier ones are overdue
  const fired = new Set(); // id@time, so an unchanged reminder fires once
  let timer = null, gen = 0, touched = null; // touched: pages the watcher reported while a scan is reading the workspace

  const all = () => [...byFile.entries()].flatMap(([rel, list]) => list.map((r) => ({ ...r, rel, id: reminderId(rel, r.key) })));
  const stateOf = (id) => states()?.[id] || null;

  /** every reminder that is not dismissed, soonest first, with state: done, overdue or upcoming */
  function list() {
    const now = clock.now();
    return all().map((r) => { const s = stateOf(r.id); return { ...r, state: s === 'done' ? 'done' : r.at <= now ? 'overdue' : 'upcoming' }; })
      .filter((r) => stateOf(r.id) !== 'dismissed').sort((a, b) => a.at - b.at || a.rel.localeCompare(b.rel));
  }

  function arm() {
    if (timer) clock.clearTimeout(timer); timer = null;
    const now = clock.now();
    const next = all().filter((r) => r.at > since && !fired.has(`${r.id}@${r.at}`) && !stateOf(r.id)).reduce((m, r) => Math.min(m, r.at), Infinity);
    if (next === Infinity) return;
    timer = clock.setTimeout(tick, Math.max(0, Math.min(next - now, MAX_WAIT)));
  }
  function tick() {
    timer = null; const now = clock.now();
    const due = all().filter((r) => r.at > since && r.at <= now && !fired.has(`${r.id}@${r.at}`) && !stateOf(r.id));
    since = now;
    for (const r of due) { fired.add(`${r.id}@${r.at}`); try { onFire({ ...r, state: 'overdue' }); } catch (e) { console.error('[folio] reminder', e.message); } }
    if (due.length) onChange();
    arm();
  }

  /** one page changed (text) or went away (null) */
  function update(rel, text) {
    const before = JSON.stringify(byFile.get(rel) || []);
    const found = text != null && isNote(rel) && String(text).includes('remind') ? scanReminders(text) : [];
    if (found.length) byFile.set(rel, found); else byFile.delete(rel);
    touched?.add(rel); // a scan in flight must not overwrite this newer reading
    // a reminder added for a time a moment ago (typed just in time) still fires
    const now = clock.now(); if (found.some((r) => r.at <= now && r.at > now - GRACE && r.at <= since)) since = Math.min(since, now - GRACE);
    if (JSON.stringify(found) !== before) { onChange(); }
    tick();
  }

  /** the whole workspace, again (on open). Older states of reminders that no longer exist are dropped. */
  async function scanAll() {
    const g = ++gen; const next = new Map(); const mine = (touched = new Set()); let complete = true;
    let files = []; try { files = (await notes.allFiles()).filter(isNote); } catch { files = []; complete = false; }
    for (let i = 0; i < files.length; i++) {
      const text = await notes.read(files[i]).catch(() => { complete = false; return null; });
      if (g !== gen) return; // a newer scan (another workspace) took over
      if (text && text.includes('remind')) { const found = scanReminders(text); if (found.length) next.set(files[i], found); }
      if (i % 50 === 49) await new Promise((r) => setImmediate(r));
    }
    for (const rel of mine) { if (byFile.has(rel)) next.set(rel, byFile.get(rel)); else next.delete(rel); } // pages the watcher updated while we read
    if (g !== gen) return;
    touched = null; byFile = next; since = Math.max(since, 0);
    if (complete) { // only a scan that read everything may conclude that a reminder is gone
      const ids = new Set(all().map((r) => r.id)); const st = states() || {};
      const kept = Object.fromEntries(Object.entries(st).filter(([id]) => ids.has(id)));
      if (Object.keys(kept).length !== Object.keys(st).length) setStates(kept);
    }
    onChange(); tick();
  }

  /** a new workspace: forget everything, announce only what comes due from now on */
  function reset() { gen++; touched = null; byFile = new Map(); fired.clear(); since = clock.now(); if (timer) clock.clearTimeout(timer); timer = null; onChange(); }

  /** done / dismissed / null (back to the list) */
  function setState(id, state) {
    const st = { ...(states() || {}) };
    if (state === 'done' || state === 'dismissed') st[id] = state; else delete st[id];
    setStates(st); onChange(); arm();
  }
  /** a page was renamed: its reminders and their states follow it */
  function rename(from, to) {
    const st = { ...(states() || {}) }; let moved = false;
    for (const [rel, items] of [...byFile]) {
      const nrel = rel === from ? to : rel.startsWith(from + '/') ? to + rel.slice(from.length) : null; if (!nrel) continue;
      byFile.delete(rel); byFile.set(nrel, items);
      for (const r of items) { const a = reminderId(rel, r.key); if (st[a]) { st[reminderId(nrel, r.key)] = st[a]; delete st[a]; moved = true; } }
    }
    if (moved) setStates(st); onChange();
  }
  const stop = () => { gen++; if (timer) clock.clearTimeout(timer); timer = null; };
  return { list, update, scanAll, reset, setState, rename, stop, tick };
}
