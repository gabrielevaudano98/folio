// Per-change review of an AI edit: split the difference between "before" and "after" into hunks, and settle one hunk
// at a time. Pure text in, text out. Accepting a hunk makes it part of the baseline ("before"); rejecting it puts the
// old lines back into the document ("after"); editing it puts the reader's own text in both. Lines outside the hunk are
// never touched, so their line endings survive.
import { diffLines } from 'diff';

/**
 * Split the difference into unchanged runs and hunks. A hunk is a maximal run of removed and added lines, so two hunks
 * are always separated by at least one unchanged line and never overlap. Ids count from 0 in document order.
 * @returns {{ items: Array<{ type: 'same', text: string } | { type: 'hunk', old: string, new: string, id: number }>, count: number }}
 */
export function splitHunks(before, after) {
  const parts = diffLines(before ?? '', after ?? '');
  const items = []; let id = 0, cur = null;
  for (const p of parts) {
    if (!p.value) continue;
    if (p.added || p.removed) {
      cur ??= { type: 'hunk', old: '', new: '', id: id++ };
      if (p.added) cur.new += p.value; else cur.old += p.value;
    } else { if (cur) { items.push(cur); cur = null; } items.push({ type: 'same', text: p.value }); }
  }
  if (cur) items.push(cur);
  return { items, count: id };
}

/** The line ending a hunk uses: its own if it has one, else the document's, else "\n". */
export function hunkEol(hunk, ...context) {
  for (const t of [hunk?.new, hunk?.old, ...context]) { const m = /\r?\n/.exec(t || ''); if (m) return m[0]; }
  return '\n';
}

/** The proposed text of a hunk as the reader edits it: "\n" line breaks, without the hunk's closing line break. */
export function hunkDraft(hunk) {
  return (hunk?.new ?? '').replace(/\r?\n$/, '').replace(/\r\n/g, '\n');
}

/**
 * Turn the reader's edited text back into the exact text that replaces the hunk: line breaks in the hunk's own ending,
 * and the closing line break the hunk had (so the next line stays a line of its own). An untouched draft gives back the
 * proposed text byte for byte; an emptied one removes the lines.
 */
export function hunkEditText(hunk, value, ...context) {
  if (value === hunkDraft(hunk)) return hunk.new;
  const eol = hunkEol(hunk, ...context);
  const body = String(value ?? '').replace(/\r\n?/g, '\n').split('\n').join(eol);
  if (body === '') return '';
  return body + (/\n$/.test(hunk.new || hunk.old) ? eol : '');
}

/**
 * Settle hunk `id` of the difference between `before` and `after`: 'accept', 'reject', or 'edit' with `text` (the exact
 * replacement, see hunkEditText). With `expect` ({ old, new }), the hunk must still read the same, so a button drawn
 * for an older version of the note can never settle a different change. Returns the new { before, after } (every other
 * hunk stays pending: before and after still differ there), or null when there is no such hunk.
 */
export function settleHunk(before, after, id, action, { text, expect } = {}) {
  const { items } = splitHunks(before, after);
  const hit = items.find((it) => it.type === 'hunk' && it.id === id);
  if (!hit || (expect && (expect.old !== hit.old || expect.new !== hit.new))) return null;
  if (action === 'edit' && typeof text !== 'string') throw new TypeError('settleHunk: an edit needs its text');
  let b = '', a = '';
  for (const it of items) {
    if (it.type === 'same') { b += it.text; a += it.text; continue; }
    if (it === hit) { const keep = action === 'accept' ? it.new : action === 'edit' ? text : it.old; b += keep; a += keep; }
    else { b += it.old; a += it.new; }
  }
  return { before: b, after: a };
}
