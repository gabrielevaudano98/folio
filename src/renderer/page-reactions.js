// Folio — reactions and @mentions in comments (D16), with no syntax of their own.
// A reaction is a reply made of a single emoji; a mention is the same [[People/Name]] link the @ menu writes. Every other
// editor shows both as what they are in the file: a short reply and a wiki link. Pure; runs on parsed comments.

const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const PICT = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|️|‍|⃣/u;

/** the emoji a reply consists of, or '' when it is anything else (one emoji only: two make it a message) */
export function reactionOf(text) {
  const s = String(text || '').trim(); if (!s || s.length > 16) return '';
  const parts = seg ? [...seg.segment(s)].map((x) => x.segment) : [s];
  if (parts.length !== 1) return '';
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|^[0-9#*]️?⃣$/u.test(parts[0]) && [...parts[0]].every((ch) => PICT.test(ch) || /[0-9#*]/.test(ch)) ? parts[0] : '';
}

/** split a thread's comments (docReview items) into messages and reactions; the first comment is always a message */
export function splitThread(comments) {
  const messages = [], by = new Map();
  comments.forEach((c, k) => {
    const e = k > 0 ? reactionOf(c.text) : '';
    if (!e) { messages.push({ c, k }); return; }
    const r = by.get(e) || { emoji: e, authors: [], keys: [] };
    r.authors.push(c.author || ''); r.keys.push(k); by.set(e, r);
  });
  return { messages, reactions: [...by.values()] };
}

/** the reply to remove when `author` takes their reaction back (their latest one with that emoji), or -1 */
export const myReaction = (reaction, author) => { for (let i = reaction.authors.length - 1; i >= 0; i--) if (reaction.authors[i] === author) return reaction.keys[i]; return -1; };

export const QUICK = ['👍', '❤️', '🎉', '😄', '👀', '✅', '🙏', '❓'];

const LINK = /\[\[([^\]|#\n]+?)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g;
/** a comment's text as parts: plain text and links; a link to a People page is a mention */
export function commentParts(text) {
  const out = []; let at = 0; const s = String(text ?? ''); LINK.lastIndex = 0; let m;
  while ((m = LINK.exec(s))) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    const target = m[1].trim(), name = target.split('/').pop();
    out.push({ link: target, label: (m[2] || name).replace(/^@/, ''), person: /(^|\/)people\//i.test(target) });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

/** the @query being typed just before the caret, or null: `Thanks @ad` -> { query: 'ad', from } */
export function mentionAt(value, caret) {
  const m = /(^|\s)@([^\s@[\]]{0,30})$/.exec(String(value).slice(0, caret));
  return m ? { query: m[2], from: caret - m[2].length - 1 } : null;
}
