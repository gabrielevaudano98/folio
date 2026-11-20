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
export function inferType(key, value) {
  const k = key.toLowerCase();
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
/* put new front matter lines back in front of the body; no front matter when nothing is left */
function rebuild(text, fmLines) {
  const m = FM.exec(text); const body = m ? text.slice(m[0].length) : text;
  if (!fmLines.length) return m ? body.replace(/^\r?\n/, '') : text;
  return `---\n${fmLines.join('\n')}\n---\n${m ? body : body ? `\n${body}` : ''}`;
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
  const ls = p.lines.slice(); ls.splice(cur.from, cur.to - cur.from);
  return rebuild(text, ls);
}
export function renameProp(text, key, next) {
  next = String(next).trim(); if (!next || next === key || !/^[A-Za-z_][\w .-]*$/.test(next)) return text;
  const p = parseProps(text); if (p.props.some((x) => x.key === next)) return text;
  const cur = p.props.find((x) => x.key === key); if (!cur) return text;
  const ls = p.lines.slice(); ls[cur.from] = ls[cur.from].replace(/^[^:]+:/, `${next}:`);
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
