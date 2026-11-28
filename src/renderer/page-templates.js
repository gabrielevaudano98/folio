// Folio — templates (D9). A template is a page in the Templates/ folder (or one of the starters below); applying it
// fills its variables and, when it is put into an existing page, merges its properties and inserts its body.
// Variables (Obsidian core Templates syntax, plus a few): {{title}} {{date}} {{date:YYYY-MM-DD}} {{time}} {{time:HH:mm}}
// {{datetime}} {{yesterday}} {{tomorrow}} {{weekday}} {{cursor}}. Anything else in {{…}} (Folio's live values) is left alone.
// Pure: runs in Node tests.
import { parseProps, setProp } from './page-props.js';

export const TEMPLATE_DIR = 'Templates';
export const DAILY = 'Daily note';
export const CURSOR = '⁣FOLIO-CURSOR⁣';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n, w = 2) => String(n).padStart(w, '0');
/** moment.js tokens used by Obsidian templates: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a, [literal] */
export function formatDate(d, fmt = 'YYYY-MM-DD') {
  const tok = { YYYY: d.getFullYear(), YY: pad(d.getFullYear() % 100), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: pad(d.getMonth() + 1), M: d.getMonth() + 1,
    DD: pad(d.getDate()), D: d.getDate(), dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3), HH: pad(d.getHours()), H: d.getHours(), hh: pad(d.getHours() % 12 || 12), h: d.getHours() % 12 || 12,
    mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), A: d.getHours() < 12 ? 'AM' : 'PM', a: d.getHours() < 12 ? 'am' : 'pm' };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A|a/g, (m, lit) => (lit != null ? lit : String(tok[m])));
}
/* people answers become links, so the page points at the person */
const kindOf = (spec, v) => (/\|\s*people\s*$/i.test(spec) && v && !/^\[\[/.test(v) ? `[[${v}]]` : v);
const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** fill the variables; {{cursor}} becomes CURSOR so the editor can put the caret there */
/** questions a template asks before it is used: {{ask:Project name}}, {{ask:Owner|people}}, {{ask:Due|date}}, {{ask:Notes|long}} */
export function askVars(text) {
  const out = [], seen = new Set();
  for (const m of String(text).matchAll(/\{\{\s*ask\s*:\s*([^}|]*?)\s*(?:\|\s*([a-z]+)\s*)?\}\}/gi)) {
    const label = m[1].trim(); if (!label || seen.has(label)) continue; seen.add(label);
    out.push({ label, kind: (m[2] || 'text').toLowerCase() });
  }
  return out;
}
export function fillTemplate(text, { title = 'Untitled', now = new Date(), answers = null, keepAsk = false } = {}) {
  return String(text).replace(/\{\{\s*([a-z]+)(?:\s*:\s*([^}]*?))?\s*\}\}/gi, (all, name, fmt) => {
    switch (name.toLowerCase()) {
      case 'title': return title;
      case 'date': return formatDate(now, fmt || 'YYYY-MM-DD');
      case 'time': return formatDate(now, fmt || 'HH:mm');
      case 'datetime': return formatDate(now, fmt || 'YYYY-MM-DD HH:mm');
      case 'yesterday': return formatDate(shift(now, -1), fmt || 'YYYY-MM-DD');
      case 'tomorrow': return formatDate(shift(now, 1), fmt || 'YYYY-MM-DD');
      case 'weekday': return formatDate(now, fmt || 'dddd');
      case 'cursor': return CURSOR;
      case 'ask': { const label = String(fmt || '').split('|')[0].trim(); if (keepAsk) return `[${label}]`; const v = answers?.[label]; return v == null ? '' : kindOf(String(fmt || ''), v); }
      default: return all;
    }
  });
}

const FM = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
/** a filled template as front matter and body; the body loses the leading blank lines */
export function splitTemplate(text) { const m = FM.exec(text); return { fm: m ? m[0] : '', body: (m ? text.slice(m[0].length) : text).replace(/^\s*\n/, '') }; }
/** a template going into a page that already exists: its title heading would repeat the page's, so it is left out */
export const intoPage = (body) => body.replace(/^# [^\n]*\n+/, '');

/** merge a template's properties into a page's front matter: new keys are added, lists and tags are joined */
export function mergeProps(pageFm, templateFm) {
  let out = pageFm;
  for (const p of parseProps(templateFm).props) {
    if (p.readOnly) continue;
    const cur = parseProps(out).props.find((x) => x.key === p.key);
    if (!cur) out = setProp(out, p.key, p.value, p.type);
    else if (Array.isArray(cur.value) && Array.isArray(p.value)) {
      const join = [...cur.value, ...p.value.filter((v) => !cur.value.some((c) => String(c).toLowerCase() === String(v).toLowerCase()))];
      if (join.length !== cur.value.length) out = setProp(out, p.key, join, cur.type);
    }
  }
  return out;
}

/** a template button: ```template-button``` with `label:`, `template:` and `where: above|below` lines */
export function parseButton(src) {
  const get = (k) => new RegExp(`^\\s*${k}\\s*:\\s*(.+?)\\s*$`, 'im').exec(src)?.[1]?.replace(/^["']|["']$/g, '');
  const template = get('template') || '';
  return { label: get('label') || (template ? `New ${template}` : 'Insert template'), template, where: /^above$/i.test(get('where') || '') ? 'above' : 'below' };
}
export const buttonSource = ({ label, template, where = 'below' }) => `\`\`\`template-button\nlabel: ${label}\ntemplate: ${template}${where === 'above' ? '\nwhere: above' : ''}\n\`\`\``;

/* ---------- template pages: metadata, the collection, the community ---------- */
export { STARTERS, CATEGORIES } from './template-starters.js';
import { STARTERS } from './template-starters.js';

/* a template page describes itself in a `template:` map in its front matter; that map never reaches the pages made from it:
   template:
     description: Agenda, notes, decisions and actions
     category: Meetings
     icon: 📝 */
const META_BLOCK = /^template:[ \t]*\r?\n((?:[ \t][^\n]*(?:\n|$))*)/m;
export function templateMeta(text) {
  const m = FM.exec(String(text)); if (!m) return {};
  const b = META_BLOCK.exec(m[0]); if (!b) return {};
  const out = {}; for (const l of b[1].split('\n')) { const kv = /^[ \t]+([a-z]+):[ \t]*(.*?)[ \t]*$/i.exec(l); if (kv) out[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, ''); }
  return out;
}
/** the template without its own `template:` map (and without front matter, if nothing else was in it) */
export function withoutMeta(text) {
  const m = FM.exec(String(text)); if (!m || !META_BLOCK.test(m[0])) return text;
  const fm = m[0].replace(META_BLOCK, '');
  return (/^---[ \t]*\r?\n---/.test(fm) ? '' : fm) + text.slice(m[0].length);
}
const yamlValue = (v) => (/[:#\n'"]|^\s|\s$/.test(v) ? JSON.stringify(v) : v);
/** set the template's description, category or icon (adds the `template:` map, and front matter, when missing) */
export function setMeta(text, patch) {
  const meta = { ...templateMeta(text), ...patch };
  const block = 'template:\n' + Object.entries(meta).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `  ${k}: ${yamlValue(String(v))}`).join('\n') + '\n';
  const m = FM.exec(String(text));
  if (!m) return `---\n${block}---\n${text.startsWith('\n') ? '' : '\n'}${text}`;
  const fm = META_BLOCK.test(m[0]) ? m[0].replace(META_BLOCK, block) : m[0].replace(/^(---[ \t]*\r?\n)/, `$1${block}`);
  return fm + text.slice(m[0].length);
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
/**
 * the templates on offer: { id, name, desc, category, icon, source: mine|starter, path? }. Your pages in Templates/
 * (and its folders, which act as categories) come first and replace starters of the same name.
 * `metas` maps a template path to its templateMeta.
 */
export function listTemplates(files, metas = {}) {
  const mine = files.filter((f) => new RegExp(`^${TEMPLATE_DIR}/.+\\.(md|markdown)$`, 'i').test(f) && !/\.(slides|board|sheet)\.md$/i.test(f))
    .map((f) => {
      const parts = f.split('/'); const meta = metas[f] || {};
      return { id: f, source: 'mine', path: f, name: parts.at(-1).replace(/\.(md|markdown)$/i, ''), desc: meta.description || '', category: meta.category || (parts.length > 2 ? parts[1] : 'General'), icon: meta.icon || '' };
    });
  const taken = new Set(mine.map((t) => t.name.toLowerCase()));
  return [...mine.sort((a, b) => a.name.localeCompare(b.name)),
    ...STARTERS.filter((s) => !taken.has(s.name.toLowerCase())).map((s) => ({ id: 'starter:' + slug(s.name), source: 'starter', starter: true, ...s }))];
}

/** the community index: { templates: [{ id, name, description, category, author, file }] } → gallery items */
export function communityItems(index, baseUrl) {
  const list = Array.isArray(index?.templates) ? index.templates : [];
  return list.filter((t) => t && t.name && t.file && !/^[a-z]+:|\.\.|^\//i.test(t.file)).slice(0, 500).map((t) => ({
    id: 'community:' + slug(t.id || t.name), source: 'community', name: String(t.name).slice(0, 80), desc: String(t.description || '').slice(0, 200),
    category: String(t.category || 'Community').slice(0, 40), icon: [...String(t.icon || '')].slice(0, 8).join(''), author: String(t.author || '').slice(0, 60),
    url: new URL(t.file, baseUrl).href,
  }));
}
/** a file name for a template inside Templates/: no characters a file system refuses */
export const templateFileName = (name) => String(name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Template';
