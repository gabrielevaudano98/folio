// Folio — what the inline pickers of a page offer: [[ links, @ mentions, # tags, : emoji. Pure logic: the host (app.js)
// supplies the workspace through `ctx`, so everything here runs in Node tests.
//
// Everything the pickers write is plain Markdown text, so pages stay portable and lossless:
//   [[Note]]  [[Note#Heading]]  [[Note#^id]]   a link          [[2026-11-21]]  a day (daily note in Journal/)
//   [[People/Ada]]                              a person       [status:: Done]  a chip (inline field)
//   #tag                                        a tag          😀               an emoji character
import { t as tr, tl } from './i18n.js';
import { fuzzy, fuzzyItem } from './fuzzy.js';
import { resolveTarget, docKind, parseRef } from './refs-syntax.js';

export const STATUSES = [tl('men', 'Not started'), tl('men', 'In progress'), 'Blocked', 'Done'];
/** the status words a page offers: front matter `folio: status: [A, B]` (or a `- A` list), else the defaults */
export function statusOptions(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || '')); if (!fm) return STATUSES;
  const lines = fm[1].split(/\r?\n/); const at = lines.findIndex((l) => /^folio:\s*$/.test(l)); if (at < 0) return STATUSES;
  const clean = (v) => v.trim().replace(/^["']|["']$/g, '').trim();
  for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) {
    const m = /^\s+status:\s*(.*)$/.exec(lines[i]); if (!m) continue;
    const base = lines[i].match(/^\s*/)[0].length; let out = [];
    if (m[1].trim().startsWith('[')) out = m[1].trim().replace(/^\[|\]$/g, '').split(',').map(clean);
    else for (let j = i + 1; j < lines.length; j++) { const li = /^(\s*)-\s+(.*)$/.exec(lines[j]); if (!li || li[1].length < base) break; out.push(clean(li[2])); }
    out = out.filter(Boolean); return out.length ? out : STATUSES;
  }
  return STATUSES;
}
export const JOURNAL = 'Journal';
/* a daily note name: YYYY-MM-DD that is a real calendar day (2026-02-31 is not) */
const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DAY = { test: (s) => { const m = DAY_SHAPE.exec(String(s)); if (!m) return false; const d = new Date(0); d.setUTCFullYear(+m[1], +m[2] - 1, +m[3]); /* not Date.UTC, which maps years 0-99 to 1900-1999 */ return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; } };
/* #tag: starts after a space or "(", has a letter, digits and - _ / allowed (Obsidian rules) */
export const TAG = /(^|[\s(])#((?=[\p{L}\p{N}_\-/]*[\p{L}_])[\p{L}\p{N}_\-/]+)/gu;
/* [key:: value], the inline field of Dataview and Obsidian */
export const FIELD = /\[([A-Za-z][\w ]{0,29}?)::[ \t]*([^\]\n]{0,80}?)[ \t]*\]/g;

const norm = (p) => String(p).replace(/\\/g, '/');
export const stemOf = (p) => norm(p).split('/').pop().replace(/(\.(slides|board|sheet))?\.(md|markdown|mdx|txt)$/i, '');
export const isPerson = (p) => /(^|\/)people\//i.test(norm(p));
const KIND = { page: 'Page', slides: tl('men', 'Slides'), board: tl('men', 'Board'), sheet: tl('men', 'Sheet') };
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const longDay = (d) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/* "Ada" → tint class for a status word */
export const statusClass = (v) => ({ 'not started': 'gray', todo: 'gray', 'to do': 'gray', backlog: 'gray', 'in progress': 'blue', doing: 'blue', started: 'blue', review: 'purple', blocked: 'red', stuck: 'red', done: 'green', complete: 'green', completed: 'green', shipped: 'green' }[String(v).trim().toLowerCase()] || 'gray');

/** tags of a document: the front matter list and every #tag in the text, outside code. Unique, first spelling wins. */
export function extractTags(text) {
  const found = new Map(); const add = (t) => { t = String(t).replace(/^#/, '').trim(); if (t && !found.has(t.toLowerCase())) found.set(t.toLowerCase(), t); };
  let body = String(text);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (fm) {
    body = body.slice(fm[0].length);
    const m = /^tags?:[ \t]*(.*)$/im.exec(fm[1]);
    if (m) {
      const inline = m[1].replace(/^\[|\]$/g, '').trim();
      if (inline) inline.split(',').forEach(add);
      else { const after = fm[1].slice(m.index + m[0].length); for (const l of after.split('\n').slice(1)) { const li = /^\s*-\s+(.+)$/.exec(l); if (li) add(li[1]); else if (l.trim()) break; } }
    }
  }
  body = body.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');
  TAG.lastIndex = 0; let m;
  while ((m = TAG.exec(body))) add(m[2]);
  return [...found.values()];
}

/** ids already written at the end of blocks (` ^abc123`), with the block text, for "[[Note#^" */
export function blockIds(text) {
  const out = [];
  for (const line of String(text).split('\n')) { const m = /^(.*?)\s\^([A-Za-z0-9-]+)\s*$/.exec(line); if (m) out.push({ id: m[2], text: m[1].replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+(?:\[.\]\s+)?/, '').trim() }); }
  return out;
}

/* ---------- dates ---------- */
let chronoLib = null;
const chrono = async () => (chronoLib ||= await import('chrono-node'));
const relative = (d, now) => { const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()), b = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const n = Math.round((a - b) / 864e5); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : null; };

/* words a date can start with, in English and Italian, so "@tod", "@dom", "@ven" already offer the day (Notion) */
const WEEKDAYS = [['sunday', 'domenica'], ['monday', 'lunedì', 'lunedi'], ['tuesday', 'martedì', 'martedi'], ['wednesday', 'mercoledì', 'mercoledi'], ['thursday', 'giovedì', 'giovedi'], ['friday', 'venerdì', 'venerdi'], ['saturday', 'sabato']];
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function keywordDays(q, ref) {
  const t = fold(q.trim()); if (t.length < 2) return [];
  const out = []; const hit = (words) => words.some((w) => fold(w).startsWith(t));
  if (hit(['today', 'oggi', 'now', 'adesso'])) out.push(ref);
  if (hit(['tomorrow', 'domani'])) out.push(addDays(ref, 1));
  if (hit(['yesterday', 'ieri'])) out.push(addDays(ref, -1));
  if (hit(['next week', 'prossima settimana', 'tra una settimana'])) out.push(addDays(ref, 7));
  WEEKDAYS.forEach((names, dow) => { if (hit(names) || hit(names.map((n) => 'next ' + n)) || hit(names.map((n) => n + ' prossimo'))) out.push(addDays(ref, ((dow - ref.getDay() + 7) % 7) || 7)); });
  return out;
}

/** @tomorrow, @next friday, @domani, @25 dec, and the first letters of any of them → days, in English and Italian */
export async function dateEntries(q, now = new Date(), { lang = 'en', label = null } = {}) {
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  let days = [];
  if (!q.trim()) days = [ref, addDays(ref, 1), addDays(ref, -1)];
  else if (/[\p{L}\d]/u.test(q)) {
    days.push(...keywordDays(q, ref));
    const c = await chrono();
    for (const parser of lang === 'it' ? [c.it, c] : [c, c.it]) {
      let d = null; try { d = parser.parseDate(q.trim(), ref, { forwardDate: true }); } catch { /* not a date */ }
      if (d) days.push(d);
    }
  }
  const seen = new Set(); days = days.filter((d) => !seen.has(ymd(d)) && seen.add(ymd(d))).slice(0, 4);
  return days.map((d) => { const rel = relative(d, ref); const name = label ? label(ymd(d)) : rel || longDay(d); return { item: { label: name, desc: label ? longDayIn(d, lang) : rel ? longDay(d) : ymd(d), icon: 'calendar' }, marks: [], group: 'Dates', insert: `[[${ymd(d)}]]` }; });
}
const longDayIn = (d, lang) => { const s = d.toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };

/* ---------- documents ---------- */
function docEntries(q, ctx, { people, limit, skipDays = false }) {
  const rows = [];
  for (const path of ctx.files) {
    if (path === ctx.from || !/\.(md|markdown|mdx|txt)$/i.test(path)) continue;
    if (!!people !== isPerson(path)) continue;
    if (skipDays && DAY.test(stemOf(path))) continue;
    const label = stemOf(path); const f = q ? fuzzyItem(q, label, [norm(path)]) : { score: 0, marks: [] };
    if (!f) continue;
    const dir = norm(path).split('/').slice(0, -1).join('/'); const kind = docKind(path);
    rows.push({ f, item: { label, desc: [KIND[kind] === 'Page' ? '' : KIND[kind], dir].filter(Boolean).join(' · '), icon: people ? 'user' : kind === 'page' ? 'doc' : kind }, marks: f.marks, group: people ? 'People' : 'Pages', insert: `[[${ctx.refName ? ctx.refName(path) : stemOf(path)}]]` });
  }
  return rows.sort((a, b) => b.f.score - a.f.score || a.item.label.localeCompare(b.item.label)).slice(0, limit).map(({ f, ...e }) => e);
}

/* ---------- [[ ---------- */
export async function linkEntries(q, ctx) {
  const hash = q.indexOf('#');
  if (hash >= 0) {
    const docQ = q.slice(0, hash).trim(), part = q.slice(hash + 1);
    const path = docQ ? resolveTarget(docQ, ctx.files, ctx.from) : ctx.from;
    if (!path) return [];
    const name = docQ ? (ctx.refName ? ctx.refName(path) : docQ) : '';
    if (part.startsWith('^')) {
      const blocks = (await ctx.blocksOf(path)).map((b) => ({ b, f: fuzzy(part.slice(1), `${b.text} ${b.id}`) })).filter((x) => x.f).sort((a, b) => b.f.score - a.f.score).slice(0, 12);
      if (!blocks.length) return [{ item: { label: tl('men', 'No blocks to link to yet'), desc: tl('men', 'Use “Copy link to block” in a block’s menu to give one an id'), icon: 'info' }, marks: [], group: 'Blocks', disabled: true }];
      return blocks.map(({ b }) => ({ item: { label: b.text.length > 70 ? b.text.slice(0, 69) + '…' : b.text || b.id, desc: '^' + b.id, icon: 'link' }, marks: [], group: 'Blocks', insert: `[[${name}#^${b.id}]]` }));
    }
    const heads = (await ctx.headingsOf(path)).map((h) => ({ h, f: fuzzy(part, h.text) })).filter((x) => x.f).slice(0, 14);
    return heads.map(({ h, f }) => ({ item: { label: h.text, desc: `H${h.level}`, icon: 'outline' }, marks: f.marks, group: 'Headings', insert: `[[${name}#${h.text}]]` }));
  }
  const docs = [...docEntries(q, ctx, { people: false, limit: 9 }), ...docEntries(q, ctx, { people: true, limit: 4 })];
  const out = docs.slice(0, 12);
  const t = q.trim();
  if (t && !docs.some((d) => d.item.label.toLowerCase() === t.toLowerCase()) && !DAY.test(t)) out.push({ item: { label: tr('men.create', { t }), desc: tl('men', 'A new page next to this one'), icon: 'plus' }, marks: [], group: 'Create', create: t });
  if (DAY.test(t) && !out.length) out.push({ item: { label: t, desc: tl('men', 'Daily note'), icon: 'calendar' }, marks: [], group: 'Dates', insert: `[[${t}]]` });
  return out;
}

/* ---------- @ ---------- */
export async function atEntries(q, ctx) {
  const out = [];
  out.push(...await dateEntries(q, ctx.now ? ctx.now() : new Date(), { lang: ctx.lang?.() || 'en', label: ctx.dayLabel || null }));
  out.push(...docEntries(q, ctx, { people: true, limit: q ? 4 : 4 }));
  out.push(...docEntries(q, ctx, { people: false, limit: q ? 6 : 5, skipDays: true }));
  const statuses = ctx.statuses || STATUSES;
  const t = q.trim();
  if (t) {
    const hit = ['status', ...statuses].some((s) => fuzzy(t, s));
    if (hit) for (const s of statuses) { const f = t.toLowerCase() === 'status' || fuzzy(t, s) ? { marks: fuzzy(t, s)?.marks || [] } : null; if (f) out.push({ item: { label: s, desc: tl('men', 'Status chip'), icon: 'status' }, marks: f.marks, group: 'Status', insert: `[status:: ${s}]` }); }
  }
  return out.slice(0, 16);
}

/* ---------- # ---------- */
export async function tagEntries(q, ctx) {
  const t = q.trim(); if (!t) return [];
  const all = await ctx.tags();
  const rows = all.map((x) => ({ x, f: fuzzy(t, x.tag) })).filter((r) => r.f).sort((a, b) => b.f.score - a.f.score || b.x.count - a.x.count).slice(0, 10);
  const out = rows.map(({ x, f }) => ({ item: { label: '#' + x.tag, desc: tr('men.n-pages', { n: x.count }), icon: 'tag' }, marks: f.marks.map(([a, b]) => [a + 1, b + 1]), group: 'Tags', insert: `#${x.tag} ` }));
  if (!all.some((x) => x.tag.toLowerCase() === t.toLowerCase()) && /^[\p{L}\p{N}_\-/]+$/u.test(t) && /[\p{L}_]/u.test(t)) out.push({ item: { label: tr('men.new-tag', { t }), desc: tl('men', 'Use it on this page'), icon: 'plus' }, marks: [], group: 'Tags', insert: `#${t} ` });
  return out;
}

/* ---------- : ---------- */
let emojiList = null;
export async function emojiEntries(q) {
  const t = q.trim().toLowerCase(); if (t.length < 2 || !/^[\w+\-]+$/.test(t)) return [];
  emojiList ||= (await import('gemoji')).gemoji;
  const rows = [];
  for (const e of emojiList) {
    const f = fuzzyItem(t, e.names[0], [...e.names, ...e.tags]);
    if (f) rows.push({ e, score: f.score + (e.names.includes(t) ? 60 : 0) });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, 8).map(({ e }) => ({ item: { label: `:${e.names[0]}:`, desc: e.description, badge: e.emoji }, marks: [], group: 'Emoji', insert: e.emoji }));
}

/** one entry point for the editor: kind is 'link' ([[), 'at' (@), 'tag' (#) or 'emoji' (:) */
export function mentionEntries(kind, q, ctx) {
  if (kind === 'link') return linkEntries(q, ctx);
  if (kind === 'at') return atEntries(q, ctx);
  if (kind === 'tag') return tagEntries(q, ctx);
  return emojiEntries(q);
}

/** what a [[target]] is, for its chip: a day, a person, a page, or nothing yet */
export function linkKind(target, files, from) {
  const t = parseRef(target).target;
  if (DAY.test(t)) return 'date';
  const p = resolveTarget(t, files, from);
  return !p ? 'missing' : isPerson(p) ? 'person' : 'doc';
}
