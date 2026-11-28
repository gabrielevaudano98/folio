// Folio — page properties (D8): the YAML front matter as typed fields, as in Obsidian. Only the lines of the property
// you change are rewritten; comments, order, quoting and every other line stay as written. Nested maps and anything
// this reader does not understand are shown read-only and never rewritten. Pure: runs in Node tests.

export const TYPES = ['text', 'number', 'checkbox', 'date', 'datetime', 'list', 'tags', 'link'];
const FM = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(\r?\n|$)/;
const KEY = /^([A-Za-z_][\w .-]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;

/** strip YAML quotes from a scalar */
export function unquote(s) {
  s = String(s ?? '').trim();
  if (/^"(.*)"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (/^'(.*)'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  return s.replace(/\s+#.*$/, '');
}
/** quote a scalar only when YAML would misread it */
export function quote(s) {
  s = String(s ?? '');
  if (s === '') return '""';
  if (/^[\s]|[\s]$|^[-?:,[\]{}#&*!|>'"%@`]|: |\s#|^(true|false|yes|no|null|~)$/i.test(s) || /^[\d.+-][\d.eE+-]*$/.test(s) && !Number.isNaN(Number(s))) return JSON.stringify(s);
  return s;
}
const splitInline = (s) => {
  const out = []; let cur = '', q = null;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() || out.length) out.push(cur);
  return out.map(unquote).filter((x) => x !== '');
};

/** what kind of field a value looks like; tags and aliases are lists of tags by name, as in Obsidian */
/* types the user chose per property name in this workspace (Obsidian's types.json); applied when the value fits the type */
let OVERRIDES = {};
export const setTypeOverrides = (map) => { OVERRIDES = map && typeof map === 'object' ? { ...map } : {}; };
const FITS = {
  text: () => true, number: (v) => typeof v === 'number', checkbox: (v) => typeof v === 'boolean',
  date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v), datetime: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v),
  link: (v) => typeof v === 'string' && /^\[\[[^\]]+\]\]$/.test(v), list: Array.isArray, tags: Array.isArray,
};
export function inferType(key, value) {
  const k = key.toLowerCase();
  const chosen = OVERRIDES[k]; if (chosen && FITS[chosen]?.(value)) return chosen;
  if (Array.isArray(value)) return k === 'tags' || k === 'tag' ? 'tags' : 'list';
  if (k === 'tags' || k === 'tag') return 'tags';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return 'datetime';
  if (/^\[\[[^\]]+\]\]$/.test(value)) return 'link';
  return 'text';
}

/** the front matter of a page: { has, start, end (line indices of the --- lines), props: [{ key, value, type, from, to, style }] } */
export function parseProps(text) {
  const m = FM.exec(String(text));
  if (!m) return { has: false, props: [], lines: [], raw: '' };
  const lines = (m[1] || '').replace(/\r?\n$/, '').split(/\r?\n/);
  if (m[1] === undefined) lines.length = 0;
  const props = [];
  for (let i = 0; i < lines.length; i++) {
    const km = KEY.exec(lines[i]);
    if (!km || /^\s/.test(lines[i])) continue;
    const key = km[1]; const rest = km[2] ?? '';
    let j = i + 1; while (j < lines.length && (/^\s/.test(lines[j]) || /^-\s/.test(lines[j]) || lines[j].trim() === '')) j++;
    while (j > i + 1 && lines[j - 1].trim() === '') j--;
    const sub = lines.slice(i + 1, j);
    let value, style = 'plain', readOnly = false;
    if (!rest || /^#/.test(rest)) {
      if (sub.length && sub.every((l) => /^\s*-\s*/.test(l) || !l.trim())) { value = sub.filter((l) => l.trim()).map((l) => unquote(l.replace(/^\s*-\s*/, ''))); style = 'block'; }
      else if (sub.length) { value = sub.join('\n'); readOnly = true; style = 'map'; }
      else value = '';
    } else if (/^\[.*\]$/.test(rest)) { value = splitInline(rest.slice(1, -1)); style = 'inline'; }
    else if (/^[|>]/.test(rest)) { value = sub.map((l) => l.trim()).join('\n'); readOnly = true; style = 'multiline'; }
    else {
      const raw = rest.replace(/\s+#.*$/, '');
      if (/^(true|false)$/i.test(raw)) value = raw.toLowerCase() === 'true';
      else if (/^-?\d+(\.\d+)?$/.test(raw)) value = Number(raw);
      else value = unquote(rest);
      if (/^["']/.test(rest)) style = 'quoted';
    }
    props.push({ key, value, type: readOnly ? 'object' : inferType(key, value), from: i, to: j, style, readOnly });
    i = j - 1;
  }
  return { has: true, props, lines, raw: m[0] };
}

/* the YAML lines for one property */
function lines(key, value, type, style) {
  if (type === 'list' || type === 'tags') {
    const items = (Array.isArray(value) ? value : String(value).split(',')).map((x) => String(x).trim().replace(type === 'tags' ? /^#/ : /^$/, '')).filter(Boolean);
    if (!items.length) return [`${key}: []`];
    if (style === 'inline') return [`${key}: [${items.map(quote).join(', ')}]`];
    return [`${key}:`, ...items.map((x) => `  - ${quote(x)}`)];
  }
  if (type === 'checkbox') return [`${key}: ${value ? 'true' : 'false'}`];
  if (type === 'number') return [`${key}: ${value === '' || value == null || Number.isNaN(Number(value)) ? '' : Number(value)}`.trimEnd()];
  if (type === 'link') { const v = String(value ?? '').trim(); const link = !v ? '' : /^\[\[.*\]\]$/.test(v) ? v : `[[${v}]]`; return [`${key}: ${link ? JSON.stringify(link) : ''}`.trimEnd()]; }
  const v = String(value ?? '');
  if (style === 'quoted' && v) return [`${key}: ${JSON.stringify(v)}`];
  return [`${key}: ${v === '' ? '' : quote(v)}`.trimEnd()];
}
/* put new front matter lines back in front of the body; no front matter when nothing is left. The file's own line
   ending (CRLF or LF, the one after the opening ---) and the --- lines are kept as written. */
function rebuild(text, fmLines) {
  const m = FM.exec(text); const body = m ? text.slice(m[0].length) : text;
  if (!fmLines.length) return m ? body.replace(/^\r?\n/, '') : text;
  if (!m) { const eol = /\r\n/.test(text.split('\n', 1)[0] + '\n') ? '\r\n' : '\n'; return `---${eol}${fmLines.join(eol)}${eol}---${eol}${body ? `${eol}${body}` : ''}`; }
  const open = /^---[ \t]*(\r?\n)/.exec(m[0]); const eol = open[1];
  const close = /---[ \t]*(?:\r?\n)?$/.exec(m[0].slice(open[0].length + (m[1] || '').length))?.[0] ?? `---${eol}`;
  return `${open[0]}${fmLines.join(eol)}${eol}${close}${body}`;
}

/** set a property (added at the end when new); returns the new text */
export function setProp(text, key, value, type) {
  const p = parseProps(text); const cur = p.props.find((x) => x.key === key);
  if (cur?.readOnly) return text;
  const t = type || cur?.type || inferType(key, value);
  const out = lines(key, value, t, cur && (t === 'list' || t === 'tags') ? (cur.style === 'inline' ? 'inline' : 'block') : cur?.style);
  const ls = p.lines.slice();
  if (cur) ls.splice(cur.from, cur.to - cur.from, ...out); else ls.push(...out);
  return rebuild(text, ls);
}
export function removeProp(text, key) {
  const p = parseProps(text); const cur = p.props.find((x) => x.key === key); if (!cur) return text;
  const own = remindKeys(text).has(key + '-remind') ? p.props.find((x) => x.key === key + '-remind') : null; // a date's reminder goes with it
  const ls = p.lines.slice();
  for (const x of [cur, own].filter(Boolean).sort((a, b) => b.from - a.from)) ls.splice(x.from, x.to - x.from);
  return rebuild(text, ls);
}
export function renameProp(text, key, next) {
  next = String(next).trim(); if (!next || next === key || !/^[A-Za-z_][\w .-]*$/.test(next)) return text;
  const p = parseProps(text); if (p.props.some((x) => x.key === next)) return text;
  const cur = p.props.find((x) => x.key === key); if (!cur) return text;
  const ls = p.lines.slice(); ls[cur.from] = ls[cur.from].replace(/^[^:]+:/, `${next}:`);
  const own = remindKeys(text).has(key + '-remind') && !p.props.some((x) => x.key === next + '-remind') ? p.props.find((x) => x.key === key + '-remind') : null; // its reminder follows
  if (own) ls[own.from] = ls[own.from].replace(/^[^:]+:/, `${next}-remind:`);
  return rebuild(text, ls);
}
/* ---------- a reminder on a date property (#86) ----------
   `due: 2026-12-01` (or `due: 2026-12-01 09:00`) reminds when the next line, or any line of the front matter, says
   `due-remind: 30m`: `0` at its time (9:00 for a date without one), or a number with m, h, d or w before it. The date
   keeps its plain value, so other tools still read a date. Set, changed or removed, only that one line is written. */
export const REMIND_SUFFIX = '-remind';
const REMIND_VALUE = /^(0|\d{1,3}[mhdw])$/;
export const isRemindValue = (v) => REMIND_VALUE.test(String(v ?? '').trim());
/* a reminder line Folio may own, change or remove: writable, one line, a scalar that reads as a reminder. Anything else
   named `<key>-remind` (a list, a nested map, another word) is an ordinary property and is never touched */
const isRemindLine = (r) => !!r && !r.readOnly && r.to - r.from === 1 && (typeof r.value === 'string' || typeof r.value === 'number') && isRemindValue(r.value);
const isDateProp = (p) => !!p && !p.readOnly && (p.type === 'date' || p.type === 'datetime') && typeof p.value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.value);
/** the date properties that carry a reminder: [{ key, value, remind, line (1-based, of the date) }] */
export function propReminders(text) {
  const p = parseProps(text); const byKey = new Map(p.props.map((x) => [x.key, x]));
  return p.props.filter(isDateProp).map((d) => { const r = byKey.get(d.key + REMIND_SUFFIX); return isRemindLine(r) ? { key: d.key, value: d.value, remind: String(r.value).trim(), line: d.from + 2 } : null; }).filter(Boolean);
}
/** the `<key>-remind` lines that belong to a date property (shown as its bell, not as properties of their own) */
export function remindKeys(text) {
  const p = parseProps(text); const byKey = new Map(p.props.map((x) => [x.key, x]));
  return new Set(p.props.filter((x) => x.key.endsWith(REMIND_SUFFIX) && isRemindLine(x) && isDateProp(byKey.get(x.key.slice(0, -REMIND_SUFFIX.length)))).map((x) => x.key));
}
/** set (or with '' / null, remove) the reminder of a date property; a new line goes right after the date's own lines */
export function setPropRemind(text, key, remind) {
  const p = parseProps(text); const d = p.props.find((x) => x.key === key); if (!isDateProp(d)) return text;
  const rk = key + REMIND_SUFFIX; const cur = p.props.find((x) => x.key === rk);
  const v = remind == null ? '' : String(remind).trim();
  if (cur && !isRemindLine(cur)) return text; // a list, a map or another word under that name is the person's: left as it is
  if (!v) return cur ? removeProp(text, rk) : text;
  if (!isRemindValue(v)) return text;
  const ls = p.lines.slice(); // (`0` and `30m` need no quotes in YAML)
  if (cur) ls.splice(cur.from, cur.to - cur.from, `${rk}: ${v}`); else ls.splice(d.to, 0, `${rk}: ${v}`);
  return rebuild(text, ls);
}
/** a free name for a new property: "property", "property 2"… */
export function newKey(text, base = 'property') { const keys = new Set(parseProps(text).props.map((p) => p.key)); let k = base, n = 1; while (keys.has(k)) k = `${base} ${++n}`; return k; }

/* ---------- tags across the workspace ---------- */
const TAG_IN = (tag) => new RegExp(`(^|[\\s(])#(${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[/\\s).,;:!?]|$)`, 'giu');
/** rename #old to #new in a page: text outside code, nested tags (#old/child) and the front matter tags list */
export function renameTag(text, from, to) {
  from = from.replace(/^#/, ''); to = to.replace(/^#/, '').trim();
  if (!to || !/^[\p{L}\p{N}_\-/]+$/u.test(to) || !/[\p{L}_]/u.test(to)) return text;
  let out = text;
  // front matter
  const p = parseProps(out); const tp = p.props.find((x) => x.type === 'tags' && Array.isArray(x.value));
  if (tp) {
    const low = from.toLowerCase();
    const next = tp.value.map((t) => { const s = t.replace(/^#/, ''); const l = s.toLowerCase(); return l === low || l.startsWith(low + '/') ? to + s.slice(from.length) : t; });
    if (next.some((t, i) => t !== tp.value[i])) out = setProp(out, tp.key, next, 'tags');
  }
  // body, outside code fences and inline code
  const m = FM.exec(out); const head = m ? m[0] : ''; let body = out.slice(head.length);
  const parts = body.split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$|`[^`\n]*`)/m);
  body = parts.map((s, i) => (i % 2 ? s : s.replace(TAG_IN(from), (all, pre) => `${pre}#${to}`))).join('');
  return head + body;
}
