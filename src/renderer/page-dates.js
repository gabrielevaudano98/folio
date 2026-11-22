// Folio — how a day link ([[2026-11-23]]) is shown: "Today", "Tomorrow", "Friday", "3 Dec", "15 Jan 2027".
// Pure (no DOM): used by the Write view chips, the Read view, exports and the Properties panel.
// The file always keeps the ISO day; only the drawing changes.

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/;

/** "2026-11-23" or "2026-11-23 09:30" → a local Date (noon when there is no time), or null */
export function parseDay(s) {
  const m = DAY_RE.exec(String(s).trim()); if (!m) return null;
  const d = new Date(2000, 0, 1, m[4] ? +m[4] : 12, m[5] ? +m[5] : 0); d.setFullYear(+m[1], +m[2] - 1, +m[3]); // setFullYear: years 0-99 stay as written
  if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null;
  if (m[4] && (+m[4] > 23 || +m[5] > 59)) return null;
  return { date: d, time: !!m[4] };
}

const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** whole days from `now` to `d` (negative in the past) */
export const dayDiff = (d, now = new Date()) => Math.round((startOf(d) - startOf(now)) / 864e5);

export const DATE_STYLES = ['relative', 'full', 'short', 'dmy', 'mdy', 'iso'];
/** the user's date format (Settings → Date format), shared by the Write view, the Read view and exports */
export const datePrefs = { style: 'relative', lang: 'en' };

const WORDS = {
  en: { today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday', last: (w) => `Last ${w}` },
  it: { today: 'Oggi', tomorrow: 'Domani', yesterday: 'Ieri', last: (w) => `${w} scorso` },
};
const lang2 = (lang) => (String(lang || 'en').slice(0, 2).toLowerCase() === 'it' ? 'it' : 'en');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, '0');

/**
 * The label of a day.
 * style: relative (default) · full ("Monday 23 November 2026") · short ("23 Nov 2026") · dmy · mdy · iso
 * relative: Today / Tomorrow / Yesterday, a weekday within the next 6 days, "Last Friday" within the past 6,
 * "3 Dec" this year, "15 Jan 2027" another year.
 */
export function formatDay(s, { style = 'relative', lang = 'en', now = new Date() } = {}) {
  const p = parseDay(s); if (!p) return String(s);
  const { date: d } = p; const L = lang2(lang); const loc = L === 'it' ? 'it-IT' : 'en-GB';
  const time = p.time ? ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) : '';
  let label;
  if (style === 'full') label = cap(d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  else if (style === 'short') label = d.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' });
  else if (style === 'dmy') label = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  else if (style === 'mdy') label = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  else if (style === 'iso') label = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  else {
    const n = dayDiff(d, now); const w = WORDS[L];
    const weekday = cap(d.toLocaleDateString(loc, { weekday: 'long' }));
    if (n === 0) label = w.today;
    else if (n === 1) label = w.tomorrow;
    else if (n === -1) label = w.yesterday;
    else if (n > 1 && n < 7) label = weekday;
    else if (n < -1 && n > -7) label = w.last(weekday);
    else if (d.getFullYear() === now.getFullYear()) label = d.toLocaleDateString(loc, { day: 'numeric', month: 'short' });
    else label = d.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' });
    label = label.replace(/\.$/, ''); // "3 dic." → "3 dic"
  }
  return label + time;
}

/** the long form for a tooltip: "Monday 23 November 2026" */
export const fullDay = (s, lang = 'en') => formatDay(s, { style: 'full', lang });

/** today, past or future, for the chip colour */
export function dayTense(s, now = new Date()) {
  const p = parseDay(s); if (!p) return null;
  const n = dayDiff(p.date, now); return n === 0 ? 'today' : n < 0 ? 'past' : 'future';
}

/** Date → "YYYY-MM-DD" */
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** the weeks of a month for a calendar: rows of 7 Dates, starting Monday (it) or Sunday (en) */
export function monthGrid(year, month, lang = 'en') {
  const first = new Date(year, month, 1, 12); const startDow = lang2(lang) === 'it' ? 1 : 0;
  const back = (first.getDay() - startDow + 7) % 7;
  const start = new Date(year, month, 1 - back, 12);
  const weeks = [];
  for (let w = 0; w < 6; w++) { const row = []; for (let i = 0; i < 7; i++) row.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i, 12)); weeks.push(row); }
  return weeks;
}
