// Folio — meeting notes from a transcript, checked against it. Pure, tested in Node.
// A small model is fast but invents owners and dates, so the model only proposes: every item must quote a line of the
// transcript, and the code keeps an item only when the quote is really on that line. Owners and dates survive only
// when they are written on the quoted line.
import { norm } from './transcript.js';

const item = (extra) => ({ type: 'object', required: ['line', 'quote', ...Object.keys(extra)], properties: { ...Object.fromEntries(Object.keys(extra).map((k) => [k, { type: 'string' }])), line: { type: 'integer' }, quote: { type: 'string' } } });
export const SCHEMA = {
  type: 'object', required: ['summary', 'decisions', 'actions', 'questions'],
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: item({ text: 1 }) },
    actions: { type: 'array', items: item({ task: 1, owner: 1, due: 1 }) },
    questions: { type: 'array', items: item({ text: 1 }) },
  },
};

export const SYSTEM = [
  'You write the minutes of a meeting from a numbered transcript. Write every field in the same language as the transcript: an Italian meeting gets Italian minutes.',
  '- summary: two or three sentences on what was discussed.',
  '- decisions: only choices the group made. Usually few. Do not list lines that are not decisions.',
  '- actions: only tasks someone was given or promised. owner: the person’s name as written on that line, else empty. due: the deadline as written on that line, else empty.',
  '- questions: questions left open.',
  'For every item give the line number [n] it comes from and copy in "quote" the exact words of that line. Never invent anything.',
].join('\n');

/** splits numbered lines into chunks the model can read at once (about 2,000 tokens each) */
export function chunk(L, maxChars = 6000) {
  const out = []; let cur = [], size = 0;
  for (const l of L) {
    const s = `[${l.n}] ${l.who}: ${l.text}`;
    if (cur.length && size + s.length > maxChars) { out.push(cur); cur = []; size = 0; }
    cur.push(s); size += s.length + 1;
  }
  if (cur.length) out.push(cur);
  return out.map((c) => c.join('\n'));
}

const PRONOUNS = new Set(['io', 'tu', 'lui', 'lei', 'noi', 'voi', 'loro', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'team', 'tutti', 'everyone', 'user', 'utente']);
const contains = (line, s) => { const a = norm(line), b = norm(s); return !!b && (` ${a} `).includes(` ${b} `); };
/** the quote must be on the line: exactly, or with at least 80% of its words in the same order of appearance */
export function quoteOnLine(line, quote) {
  if (contains(line, quote)) return true;
  const q = norm(quote).split(' ').filter(Boolean), l = norm(line).split(' ');
  if (q.length < 3) return false;
  let j = 0, hit = 0;
  for (const w of q) { const k = l.indexOf(w, j); if (k >= 0) { hit++; j = k + 1; } }
  return hit / q.length >= 0.8;
}

// A small model lists every line as a decision and turns statements into questions. Its proposals are kept only
// when the quoted line itself reads like one (Italian and English cues for now).
const DECISION = /\b(decis|decid|abbiamo scelto|scegliamo|si è deciso|siamo d accordo|d accordo|approvat|confermat|useremo|faremo|agreed|agree|decided|decision|we will|we ll|going with|approved|confirmed)/;
const QUESTION = /\?|\b(domanda|dubbio|aperto|aperta|da capire|da chiarire|non sappiamo|non è chiaro|question|open|unclear|not sure|tbd|to be decided)\b/;
export const readsLikeDecision = (line) => DECISION.test(norm(line));
export const readsLikeQuestion = (line) => /\?/.test(String(line)) || QUESTION.test(norm(line));

/** keeps what the transcript supports. L: lines from transcript.lines(). Returns the cleaned notes and what was dropped. */
export function verify(raw, L) {
  const byN = new Map(L.map((l) => [l.n, l.text]));
  let dropped = 0;
  const ok = (x) => { const line = byN.get(Number(x?.line)); const keep = !!line && typeof x.quote === 'string' && quoteOnLine(line, x.quote); if (!keep) dropped++; return keep; };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const seen = new Set();
  const uniq = (key) => { if (seen.has(key)) return false; seen.add(key); return true; };
  const notes = {
    summary: clean(raw?.summary),
    decisions: (raw?.decisions || []).filter(ok).filter((d) => readsLikeDecision(byN.get(Number(d.line)))).map((d) => ({ text: clean(d.text) || clean(d.quote), line: Number(d.line) })).filter((d) => uniq('d' + d.line + norm(d.text))),
    actions: (raw?.actions || []).filter(ok).map((a) => {
      const line = byN.get(Number(a.line));
      const owner = clean(a.owner), due = clean(a.due);
      return {
        task: clean(a.task) || clean(a.quote), line: Number(a.line),
        owner: owner && !PRONOUNS.has(norm(owner)) && contains(line, owner) ? owner : '',
        due: due && contains(line, due) ? due : '',
      };
    }).filter((a) => uniq('a' + a.line + norm(a.task))),
    questions: (raw?.questions || []).filter(ok).filter((q) => readsLikeQuestion(byN.get(Number(q.line)))).map((q) => ({ text: clean(q.text) || clean(q.quote), line: Number(q.line) })).filter((q) => uniq('q' + q.line + norm(q.text))),
  };
  return { notes, dropped };
}

/** joins the notes of several chunks; summaries are joined later by one more short request */
export function merge(parts) {
  const all = { summary: parts.map((p) => p.summary).filter(Boolean).join(' '), decisions: [], actions: [], questions: [] };
  for (const p of parts) for (const k of ['decisions', 'actions', 'questions']) all[k].push(...p[k]);
  for (const k of ['decisions', 'actions', 'questions']) all[k].sort((a, b) => a.line - b.line);
  return all;
}
