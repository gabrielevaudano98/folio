// Pure text diff helpers for the version history view (no Node imports: used by the renderer too).
/* ---- changes between two texts, for the history view ----
   Returns parts [{ text, kind: 'same'|'add'|'del' }] and hunks (each run of changes with its position in the *new* text),
   so one hunk can be undone on the current text byte for byte. */
export function wordParts(oldText, newText, diffWords) {
  const raw = diffWords(oldText, newText);
  return raw.map((p) => ({ text: p.value, kind: p.added ? 'add' : p.removed ? 'del' : 'same' }));
}
/* revert one run of changes: parts is wordParts(version, current); hunk i is the i-th run of non-'same' parts.
   Returns the current text with that run put back as it was in the version. */
export function revertHunk(parts, index) {
  let out = ''; let h = -1; let inRun = false;
  for (const p of parts) {
    if (p.kind === 'same') { inRun = false; out += p.text; continue; }
    if (!inRun) { h++; inRun = true; }
    if (h === index) { if (p.kind === 'del') out += p.text; } // put the old words back, drop the new ones
    else if (p.kind === 'add') out += p.text; // keep the current text of every other hunk
  }
  return out;
}
export function countHunks(parts) { let n = 0, inRun = false; for (const p of parts) { if (p.kind === 'same') inRun = false; else if (!inRun) { n++; inRun = true; } } return n; }
