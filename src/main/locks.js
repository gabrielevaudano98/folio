// Folio — locked pages (X3). The app keeps them in its settings, per workspace folder: { "<folder>": { "<rel path>": true } }.
// Never in the .md. Shared by the window (through settings) and the MCP gate in main.js.

/** the locked pages of one workspace folder (an older flat map, from before folders were kept apart, counts as none) */
export function locksOf(lockedPages, workspace) {
  const m = workspace && lockedPages && typeof lockedPages === 'object' ? lockedPages[workspace] : null;
  return m && typeof m === 'object' ? m : {};
}
/** the first locked page that `rel` is, or holds (a folder), or null */
export function lockedTarget(lockedPages, workspace, rel) {
  if (typeof rel !== 'string' || !rel) return null;
  const m = locksOf(lockedPages, workspace);
  return Object.keys(m).find((k) => m[k] === true && (k === rel || k.startsWith(rel + '/'))) || null;
}
