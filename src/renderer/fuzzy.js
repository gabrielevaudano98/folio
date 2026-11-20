// Folio — fuzzy matching shared by the command palette and the / and @ menus.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Match q against s: a substring scores high (higher at the start), otherwise every letter in order. marks: [from, to) ranges. */
export function fuzzy(q, s) {
  if (!q) return { score: 1, marks: [] };
  const ql = q.toLowerCase(), sl = s.toLowerCase();
  const idx = sl.indexOf(ql);
  if (idx >= 0) return { score: 100 - idx + (idx === 0 ? 50 : 0), marks: [[idx, idx + q.length]] };
  let i = 0, score = 0; const marks = [];
  for (let j = 0; j < sl.length && i < ql.length; j++) if (sl[j] === ql[i]) { marks.push([j, j + 1]); score += j > 0 && /[\s/_-]/.test(sl[j - 1]) ? 6 : 1; i++; }
  return i === ql.length ? { score, marks } : null;
}

/* s as HTML with the matched ranges in <b> */
export function highlight(s, marks) { let out = '', last = 0; for (const [a, b] of marks) { out += esc(s.slice(last, a)) + '<b>' + esc(s.slice(a, b)) + '</b>'; last = b; } return out + esc(s.slice(last)); }

/* Best match of q over a label and its aliases; the marks only ever refer to the label. */
export function fuzzyItem(q, label, aliases = []) {
  const main = fuzzy(q, label);
  let best = main ? { score: main.score + 10, marks: main.marks } : null;
  for (const a of aliases) { const f = fuzzy(q, a); if (f && (!best || f.score > best.score)) best = { score: f.score, marks: main?.marks || [] }; }
  return best;
}
