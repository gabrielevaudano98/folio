// Folio — locked pages (X3). The app keeps them in its settings, per workspace folder: { "<folder>": { "<rel path>": true } }.
// Never in the .md. Shared by the window (through settings), the MCP gate in main.js and the stdio bridge (src/mcp/stdio.js),
// which reads them from settings.json when Folio is closed.
import fs from 'node:fs';

/** macOS and Windows file systems ignore case: `Pages/A.md` is the locked `pages/a.md` there */
export const foldsCase = (platform = process.platform) => platform === 'darwin' || platform === 'win32';

/** the locked pages of one workspace folder (an older flat map, from before folders were kept apart, counts as none) */
export function locksOf(lockedPages, workspace) {
  const m = workspace && lockedPages && typeof lockedPages === 'object' ? lockedPages[workspace] : null;
  return m && typeof m === 'object' ? m : {};
}
/** the first locked page that `rel` is, or holds (a folder), or null */
export function lockedTarget(lockedPages, workspace, rel, { fold = foldsCase() } = {}) {
  if (typeof rel !== 'string' || !rel) return null;
  const m = locksOf(lockedPages, workspace); const f = (x) => (fold ? x.toLowerCase() : x); const r = f(rel);
  return Object.keys(m).find((k) => m[k] === true && (f(k) === r || f(k).startsWith(r + '/'))) || null;
}
/** the lockedPages of a settings.json; {} only when the file does not exist yet. Any other failure (unreadable, corrupt) throws, so a write is refused rather than let through unlocked */
export function readLockedPages(settingsFile) {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')).lockedPages || {}; } catch (e) { if (e?.code === 'ENOENT') return {}; throw e; }
}
/**
 * The MCP gate: a write tool may not touch a locked page or a folder holding one. Throws with a message for the assistant.
 * `notes` turns the tool's path into the workspace-relative form the locks use.
 */
export function assertUnlocked(tool, args, { notes, lockedPages, workspace, fold }) {
  if (!tool?.write) return;
  for (const p of [args?.path, args?.from]) {
    let rel = null; try { rel = typeof p === 'string' && p.trim() ? notes.relOf(notes.resolve(p)) : null; } catch { /* the tool reports a bad path itself */ }
    const hit = lockedTarget(lockedPages, workspace, rel, { fold });
    if (hit) throw new Error(`${hit} is locked in Folio. The user can unlock it from the page menu (Unlock page).`);
  }
}
/** for link updates after a move: is this file a locked page (it then keeps its old link) */
export const isLockedPage = (lockedPages, workspace, rel, opts) => { const m = locksOf(lockedPages, workspace); const f = (x) => ((opts?.fold ?? foldsCase()) ? x.toLowerCase() : x); return Object.keys(m).some((k) => m[k] === true && f(k) === f(rel)); };
