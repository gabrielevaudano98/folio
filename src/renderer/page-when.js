// Folio — a date mention with a time, an end and a reminder. Pure (no DOM): used by the Write view chips, the Read view,
// the date popover, the @ menu and the reminders engine in the main process.
//
// The day link stays exactly as it was (`[[2026-12-01]]`, the daily note, date-only: see DAY_ONLY in rich.js). Anything
// more is written right after it, with no space, between braces:
//   [[2026-12-01]]{09:00}                              Tuesday 1 December at 9:00
//   [[2026-12-03]]{→ 2026-12-05}                       3 to 5 December
//   [[2026-12-01]]{09:00 → 10:30}                      9:00 to 10:30 the same day
//   [[2026-12-01]]{09:00 → 2026-12-02 17:00}           a range with times
//   [[2026-12-01]]{09:00 remind}                       remind at 9:00
//   [[2026-12-01]]{09:00 remind 30m}                   remind 30 minutes before (m, h, d, w: minutes, hours, days, weeks)
//   [[2026-12-01]]{remind 1d}                          an all-day date: reminders count from 9:00 that day
// Text in braces that does not read exactly like this is ordinary text, left alone. Folio writes `→`; `->` is read too.
import { parseDay } from './page-dates.js';
import { propReminders } from './page-props.js';

/** the brace group right after `]]` */
export const TAIL = /^\{([^{}\n]{1,60})\}/;
/** a day link that may carry a brace group, for scanning text */
export const MENTION = /\[\[(\d{4}-\d{2}-\d{2})\]\](\{[^{}\n]{1,60}\})?/g;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const OFFSET = /^(\d{1,3})([mhdw])$/;
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !!parseDay(s);
const normTime = (s) => { const m = TIME.exec(s); return `${m[1].padStart(2, '0')}:${m[2]}`; };
/** the hour that an all-day date reminds at (Notion: 9:00 on the day) */
export const ALL_DAY_AT = '09:00';
/** the reminder choices of the date popover, as written in the file ('0' is "at the time") */
export const REMIND_PRESETS = ['0', '5m', '10m', '30m', '1h', '1d', '2d'];

/**
 * "09:00 → 2026-12-03 remind 30m" → { time, endDay, endTime, remind } (remind: null, '0' for at the time, or '30m'),
 * or null when it is not exactly this grammar.
 */
export function parseTail(body) {
  const parts = String(body).trim().split(/\s+/); if (!parts[0]) return null;
  const w = { time: null, endDay: null, endTime: null, remind: null }; let i = 0;
  if (TIME.test(parts[i])) w.time = normTime(parts[i++]);
  if (parts[i] === '→' || parts[i] === '->') {
    i++;
    if (isDay(parts[i] || '')) { w.endDay = parts[i++]; if (TIME.test(parts[i] || '')) w.endTime = normTime(parts[i++]); }
    else if (TIME.test(parts[i] || '')) w.endTime = normTime(parts[i++]);
    else return null;
    if (w.endTime && !w.time) return null; // an end time needs a start time
  }
  if (parts[i] === 'remind') {
    i++; w.remind = '0';
    const o = parts[i] || '';
    if (o === '0') i++; else if (OFFSET.test(o)) { i++; w.remind = +OFFSET.exec(o)[1] === 0 ? '0' : o; }
  }
  if (i !== parts.length) return null;
  return w.time || w.endDay || w.endTime || w.remind != null ? w : null;
}

/** `[[2026-12-01]]{09:00 remind}` (or a plain day link) → { day, time, endDay, endTime, remind }, else null */
export function parseMention(src) {
  const m = /^\[\[(\d{4}-\d{2}-\d{2})\]\](?:\{([^{}\n]{1,60})\})?$/.exec(String(src)); if (!m || !isDay(m[1])) return null;
  if (m[2] == null) return { day: m[1], time: null, endDay: null, endTime: null, remind: null };
  const w = parseTail(m[2]); return w ? { day: m[1], ...w } : null;
}
/** the length of a valid brace group at the start of `after` (the text right after `]]`), else 0 */
export function tailLength(after) {
  const m = TAIL.exec(String(after)); return m && parseTail(m[1]) ? m[0].length : 0;
}

/** the brace group for a mention: "{09:00 → 2026-12-03 remind 30m}", or '' when there is only a day */
export function tailText(w) {
  const out = [];
  if (w.time) out.push(normTime(w.time));
  const endTime = w.time && w.endTime ? normTime(w.endTime) : null;
  if (w.endDay || endTime) { out.push('→'); if (w.endDay) out.push(w.endDay); if (endTime) out.push(endTime); }
  if (w.remind != null && w.remind !== '') out.push(w.remind === '0' ? 'remind' : `remind ${w.remind}`);
  return out.length ? `{${out.join(' ')}}` : '';
}
/** { day, time, … } → the text written in the file */
export const mentionText = (w) => `[[${w.day}]]${tailText(w)}`;

/** "30m" → 30, "1h" → 60, "2d" → 2880, "0" → 0, else null */
export function offsetMinutes(r) {
  if (r === '0') return 0; const m = OFFSET.exec(String(r || '')); if (!m) return null;
  return +m[1] * { m: 1, h: 60, d: 1440, w: 10080 }[m[2]];
}
/** a local Date for a day and an optional "HH:MM" */
export function atTime(day, time) {
  const p = parseDay(day); if (!p) return null;
  const [h, mi] = (time || '00:00').split(':').map(Number); const d = new Date(p.date); d.setHours(h, mi, 0, 0); return d;
}
/** when a mention reminds, as a local Date, or null when it has no reminder */
export function remindAt(w) {
  if (!w || w.remind == null) return null;
  const base = atTime(w.day, w.time || ALL_DAY_AT); const off = offsetMinutes(w.remind); if (!base || off == null) return null;
  const cal = w.remind === '0' ? null : OFFSET.exec(String(w.remind));
  if (cal && (cal[2] === 'd' || cal[2] === 'w')) { base.setDate(base.getDate() - +cal[1] * (cal[2] === 'w' ? 7 : 1)); return base; } // calendar days: same local time across a clock change
  return new Date(base.getTime() - off * 60000);
}
/** the start of a mention (its time, or the start of the day) */
export const startOf = (w) => atTime(w.day, w.time);

/** "09:00" → "9:00" */
export const shortTime = (t) => { const m = TIME.exec(t || ''); return m ? `${+m[1]}:${m[2]}` : ''; };
/**
 * What a mention reads as: "Tomorrow 9:00", "3 Dec → 5 Dec", "Today 9:00 → 10:30".
 * dayLabel(day) draws one day in the user's date format.
 */
export function whenLabel(w, dayLabel = (d) => d) {
  let s = dayLabel(w.day) + (w.time ? ' ' + shortTime(w.time) : '');
  if (w.endDay) s += ' → ' + dayLabel(w.endDay) + (w.time && w.endTime ? ' ' + shortTime(w.endTime) : '');
  else if (w.time && w.endTime) s += ' → ' + shortTime(w.endTime);
  return s;
}

/* ---------- finding mentions in a page ---------- */
/** the text with fenced code, inline code and the front matter blanked out (same length, so offsets still match) */
function visible(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return String(text)
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/, blank)
    .replace(/^( {0,3})(```+|~~~+)[^\n]*\n[\s\S]*?(?:\n {0,3}\2[^\n]*|(?![\s\S]))/gm, blank)
    .replace(/`[^`\n]*`/g, blank);
}
/** every date mention with a valid brace group or none: [{ index, src, line (1-based), …when }] */
export function findWhen(text) {
  const src = String(text); const vis = visible(src); const out = [];
  MENTION.lastIndex = 0; let m;
  while ((m = MENTION.exec(vis))) {
    if (!isDay(m[1])) continue;
    let bs = 0; while (m.index - 1 - bs >= 0 && src[m.index - 1 - bs] === '\\') bs++;
    if (bs % 2) continue; // an escaped bracket is literal text, an example, not a mention
    let s = src.slice(m.index, m.index + m[0].length); let w = parseMention(s); // parsed from the page itself: blanked code must not make a bad group look valid
    if (!w && m[2]) { s = `[[${m[1]}]]`; w = parseMention(s); } // braces that are not a date tail stay ordinary text
    if (!w) continue;
    const line = vis.slice(0, m.index).split('\n').length;
    out.push({ index: m.index, src: s, line, ...w });
  }
  return out;
}

/** a line of a page as a reminder's title: list markers, the mention itself and link brackets taken out */
export function lineTitle(line, src) {
  return String(line)
    .replace(src, ' ')
    .replace(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s+)?(?:#{1,6}\s+)?/, '')
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\](?:\{[^{}\n]*\})?/g, '$2')
    .replace(/\[\[([^\]\n]+)\]\](?:\{[^{}\n]*\})?/g, (_, t) => t.split('/').pop().replace(/#.*$/, ''))
    .replace(/\[[A-Za-z][\w ]{0,29}?::[ \t]*([^\]\n]{0,80}?)[ \t]*\]/g, '$1')
    .replace(/[*_~`]+/g, '').replace(/\s\^[A-Za-z0-9-]+\s*$/, '')
    .replace(/\s+/g, ' ').trim().slice(0, 140);
}

/**
 * The reminders of a page: [{ key, src, line, title, at (ms), day, time, remind, … }].
 * `key` is the mention's own text and its count on the page ("[[2026-12-01]]{09:00 remind}#0"): editing the words around a
 * reminder keeps its key (and its Done state); changing its date or time makes it a new reminder.
 */
export function scanReminders(text) {
  const lines = String(text).split('\n'); const seen = new Map(); const out = [];
  for (const w of findWhen(text)) {
    if (w.remind == null) continue;
    const at = remindAt(w); if (!at) continue;
    const n = seen.get(w.src) || 0; seen.set(w.src, n + 1);
    out.push({ key: `${w.src}#${n}`, src: w.src, line: w.line, title: lineTitle(lines[w.line - 1] || '', w.src), at: at.getTime(), day: w.day, time: w.time, endDay: w.endDay, endTime: w.endTime, remind: w.remind });
  }
  // a date property with a `<name>-remind:` line; its key names the property, its date and the offset, so a new date is a new reminder
  const fm = propReminders(text);
  if (fm.length) {
    // the page's first heading, found outside the front matter and code (a `#` comment in a fence is not a title), read as written
    const at0 = /^#{1,6}[ \t]+\S/m.exec(visible(text)); const hl = at0 ? String(text).slice(at0.index).split(/\r?\n/, 1)[0] : '';
    const head = /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(hl); const page = head ? lineTitle(head[1], '') : '';
    for (const p of fm) {
      const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?$/.exec(p.value.trim()); if (!m || !isDay(m[1])) continue; // the whole value: `2026-12-01T09:00garbage` reminds of nothing
      const w = { day: m[1], time: m[2] && TIME.test(m[2]) ? m[2] : null, endDay: null, endTime: null, remind: p.remind === '0' ? '0' : p.remind };
      const at = remindAt(w); if (!at) continue;
      const src = `${p.key}: ${m[0]}`;
      out.push({ key: `fm:${src} remind ${p.remind}`, src, line: p.line, title: page ? `${page} · ${p.key}` : p.key, at: at.getTime(), day: w.day, time: w.time, endDay: null, endTime: null, remind: w.remind, prop: p.key });
    }
  }
  return out;
}
