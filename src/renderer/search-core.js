// Folio — the search window's pure core (Notion's search, help/search): the query ("quoted phrase" plus words, all must
// appear), content matches with a snippet, ranking (Best match: titles first, then content, recent edits higher; or
// Last edited) and the recent-pages groups (Today, Yesterday, Past week, Older). Shared by the main process (content
// search over the notes) and the window (ranking and drawing); no DOM, no Node.
import { fuzzy } from './fuzzy.js';

const DAY = 86400000;

/** "my projects" alpha → terms ['my projects', 'alpha'] (lower case); an unclosed quote counts as text */
export function parseQuery(raw) {
  const s = String(raw || '').trim();
  const terms = [];
  const rest = s.replace(/"([^"]+)"/g, (_, p) => { const t = p.trim().toLowerCase(); if (t) terms.push(t); return ' '; });
  for (const w of rest.replace(/"/g, ' ').split(/\s+/)) if (w) terms.push(w.toLowerCase());
  return { raw: s, terms: [...new Set(terms)], text: s.replace(/"/g, '').replace(/\s+/g, ' ').trim() };
}

/** [from, to) ranges of every term in s, merged and sorted */
export function termMarks(s, terms) {
  const low = s.toLowerCase(); const out = [];
  if (low.length !== s.length) return out; // a character changed length in lower case: no highlight rather than a wrong one
  for (const t of terms) for (let i = low.indexOf(t); i >= 0 && out.length < 50; i = low.indexOf(t, i + t.length)) out.push([i, i + t.length]);
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const m of out) { const last = merged[merged.length - 1]; if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]); else merged.push([...m]); }
  return merged;
}

/** the visible text of a line: list, quote and heading markers and the commonest inline marks removed */
const plainLine = (l) => l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)+/, '').replace(/\*\*|__|`/g, '').trim();

/** one line around its first match, at most `width` characters, with the marks inside it */
export function snippetOf(line, terms, width = 140) {
  let text = plainLine(line);
  let marks = termMarks(text, terms);
  if (text.length > width) {
    const first = marks[0]?.[0] ?? 0;
    let from = Math.max(0, first - Math.floor(width / 3));
    if (from > 0) { const sp = text.indexOf(' ', from); if (sp > 0 && sp < first) from = sp + 1; }
    const to = Math.min(text.length, from + width);
    text = (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
    const shift = (from > 0 ? 1 : 0) - from;
    marks = marks.map(([a, b]) => [a + shift, b + shift]).filter(([a, b]) => a >= 0 && b <= text.length);
  }
  return { text, marks };
}

/** the page icon written in front matter (`icon: 🚀`), or '' */
export function iconOf(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  const i = m && /^icon:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(m[1]);
  return i ? [...i[1].trim()].slice(0, 4).join('') : '';
}

/**
 * Content match of a note. Every term must appear somewhere in the text (Notion: all words, "exact phrase").
 * Returns null, or { total, line, snippets: [{ line, text, marks }] } with up to `max` snippets, best lines first
 * (the lines with the most distinct terms, then document order).
 */
export function matchContent(text, terms, { low = text.toLowerCase(), max = 2 } = {}) {
  if (!terms.length) return null;
  let total = 0;
  for (const t of terms) {
    let n = 0; for (let i = low.indexOf(t); i >= 0; i = low.indexOf(t, i + t.length)) if (++n >= 999) break;
    if (!n) return null;
    total += n;
  }
  const lines = text.split('\n'); const cand = [];
  for (let i = 0; i < lines.length && cand.length < 200; i++) {
    const l = lines[i].toLowerCase(); let k = 0;
    for (const t of terms) if (l.includes(t)) k++;
    if (k) cand.push({ i, k });
  }
  cand.sort((a, b) => b.k - a.k || a.i - b.i);
  const snippets = cand.slice(0, max).sort((a, b) => a.i - b.i).map(({ i }) => ({ line: i + 1, ...snippetOf(lines[i], terms) }));
  return { total, line: snippets[0]?.line || 1, snippets };
}

/** how a title matches: all terms inside it (strong), or the old Go-to-note fuzzy match of the whole query */
export function titleMatch(title, q) {
  if (!q.terms.length) return null;
  const low = title.toLowerCase();
  if (q.terms.every((t) => low.includes(t))) {
    const marks = termMarks(title, q.terms);
    const exact = low === q.text.toLowerCase();
    const starts = low.startsWith(q.terms[0]);
    return { score: 300 + (exact ? 120 : 0) + (starts ? 40 : 0) - Math.min(40, title.length - q.text.length), marks, strong: true };
  }
  const f = fuzzy(q.text, title);
  return f ? { score: Math.min(f.score, 120), marks: f.marks, strong: false } : null;
}

/** a boost for recent edits (Notion: "Pages that have been recently edited show up higher") */
export function recencyBoost(modified, now = Date.now()) {
  if (!modified) return 0;
  const age = now - modified;
  return age < DAY ? 30 : age < 7 * DAY ? 18 : age < 30 * DAY ? 8 : 0;
}

/**
 * Merge title and content matches into ranked rows.
 * files: [{ path, title, modified, open }]; content: Map path → matchContent result (or null to skip content).
 * sort: 'best' | 'edited'. Returns [{ path, title, modified, titleMarks, content, score }].
 */
export function rankResults(files, q, content, { sort = 'best', now = Date.now(), titleOnly = false } = {}) {
  const rows = [];
  for (const f of files) {
    const tm = titleMatch(f.title, q);
    const cm = titleOnly ? null : content?.get(f.path) || null;
    if (!tm && !cm) continue;
    let score = 0;
    if (tm) score += tm.strong ? tm.score : tm.score * 0.5;
    if (cm) score += Math.min(60, 12 * Math.log2(1 + cm.total)) + (tm?.strong ? 0 : 40);
    score += recencyBoost(f.modified, now) + (f.open ? 6 : 0);
    rows.push({ path: f.path, title: f.title, modified: f.modified || 0, titleMarks: tm?.marks || [], titleStrong: !!tm?.strong, content: cm, score });
  }
  if (sort === 'edited') rows.sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title));
  else rows.sort((a, b) => b.score - a.score || b.modified - a.modified || a.title.localeCompare(b.title));
  return rows;
}

/**
 * Recent pages for the empty query, grouped by day (local time).
 * items: [{ path, time }] (time: last opened or last edited, whichever is later). Returns [{ key, items }] in the order
 * today, yesterday, week (the 7 days before yesterday), older; empty groups left out.
 */
export function recencyGroups(items, now = Date.now(), { limit = 40 } = {}) {
  const d = new Date(now); const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
  const week = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7).getTime();
  const groups = { today: [], yesterday: [], week: [], older: [] };
  const sorted = items.filter((x) => x.time).sort((a, b) => b.time - a.time).slice(0, limit);
  for (const it of sorted) groups[it.time >= today ? 'today' : it.time >= yesterday ? 'yesterday' : it.time >= week ? 'week' : 'older'].push(it);
  return ['today', 'yesterday', 'week', 'older'].filter((k) => groups[k].length).map((key) => ({ key, items: groups[key] }));
}
