// Per-change review of an AI edit: split the difference between "before" and "after" into hunks, and settle one hunk
// at a time. Pure text in, text out. Accepting a hunk makes it part of the baseline ("before"); rejecting it puts the
// old lines back into the document ("after"). Lines outside the hunk are never touched, so line endings survive.
import { diffLines } from 'diff';

/** @returns {{ items: Array<{ type: 'same', text: string } | { type: 'hunk', old: string, new: string, id: number }>, count: number }} */
export function splitHunks(before, after) {
  const parts = diffLines(before ?? '', after ?? '');
  const items = []; let id = 0, cur = null;
  for (const p of parts) {
    if (p.added || p.removed) {
      cur ??= { type: 'hunk', old: '', new: '', id: id++ };
      if (p.added) cur.new += p.value; else cur.old += p.value;
    } else { if (cur) { items.push(cur); cur = null; } items.push({ type: 'same', text: p.value }); }
  }
  if (cur) items.push(cur);
  return { items, count: id };
}

/** Settle hunk `id`. Returns the new { before, after }; the other hunks stay pending (before and after still differ there). */
export function settleHunk(before, after, id, action) {
  const { items } = splitHunks(before, after);
  let b = '', a = '';
  for (const it of items) {
    if (it.type === 'same') { b += it.text; a += it.text; continue; }
    if (it.id === id) { const keep = action === 'accept' ? it.new : it.old; b += keep; a += keep; }
    else { b += it.old; a += it.new; }
  }
  return { before: b, after: a };
}
