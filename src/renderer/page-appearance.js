// Folio — per-page appearance (Notion's "Appearance & layout"): front matter keys, written only when not the default.
//   font: sans | serif | mono   small-text: true | false   full-width: true | false   toc: true   cover: .asset/<file> | gradient-N   cover-y: 0..100
// The default is the app-wide one from Settings (font, small text, full width; sans, off, off when unset), so a page
// only says what differs from it: `font: sans` or `small-text: false` appear only when Settings default to otherwise.
// Pure: each setter rewrites only its own line through page-props.js (CRLF files stay CRLF). Runs in Node tests.
import { parseProps, setProp, removeProp } from './page-props.js';

export const FONTS = ['serif', 'mono'];
const FONT_VALUES = ['sans', ...FONTS];
/** the app-wide defaults (Settings), normalised: { font: '' (sans) | serif | mono, small, full } */
export function appearanceDefaults(d = {}) {
  return { font: FONTS.includes(d?.font) ? d.font : '', small: d?.small === true, full: d?.full === true };
}
const bool = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);
export const GRADIENTS = 6;
export const COVER_Y_DEFAULT = 50;
export const KEYS = ['font', 'small-text', 'full-width', 'toc', 'cover', 'cover-y'];

/** a cover is a page's own picture (.asset/ path inside the folder) or one of the built-in gradients; never a web address */
export function coverOf(value) {
  const v = String(value ?? '').trim();
  const g = /^gradient-([1-9]\d?)$/.exec(v);
  if (g && +g[1] <= GRADIENTS) return { kind: 'gradient', n: +g[1], value: v };
  if (/^\.asset\/[^/\\]+$/.test(v) && !/(^|\/)\.\.(\/|$)/.test(v)) return { kind: 'asset', src: v, value: v };
  return null;
}
const clampY = (n) => Math.min(100, Math.max(0, Math.round(Number(n))));

/** the appearance a page shows: its front matter over the app-wide defaults */
export function readAppearance(text, defaults) {
  const d = appearanceDefaults(defaults);
  const out = { font: d.font, small: d.small, full: d.full, toc: false, cover: null, coverY: COVER_Y_DEFAULT };
  for (const p of parseProps(text).props) {
    if (p.readOnly) continue;
    if (p.key === 'font' && FONT_VALUES.includes(String(p.value))) out.font = p.value === 'sans' ? '' : String(p.value);
    else if (p.key === 'small-text' && bool(p.value) !== null) out.small = bool(p.value); // `"false"` reads like false, as owns() hides it
    else if (p.key === 'full-width' && bool(p.value) !== null) out.full = bool(p.value);
    else if (p.key === 'toc' && p.value === true) out.toc = true;
    else if (p.key === 'cover') out.cover = coverOf(p.value);
    else if (p.key === 'cover-y' && typeof p.value === 'number' && Number.isFinite(p.value)) out.coverY = clampY(p.value);
  }
  return out;
}

/** does the appearance own this property (so the properties panel and the reading view do not list it)? Values it does not understand stay visible. */
export function owns(key, value, hasCover = true) {
  const v = typeof value === 'string' ? value.trim() : value;
  if (key === 'font') return FONT_VALUES.includes(String(v));
  if (key === 'small-text' || key === 'full-width') return bool(v) !== null;
  if (key === 'toc') return v === true || v === 'true';
  if (key === 'cover') return !!coverOf(v);
  if (key === 'cover-y') return hasCover && v !== '' && Number.isFinite(Number(v));
  return false;
}
/** the same for a whole front matter text: is this property of the page one the appearance owns? */
export function ownedKeys(text) {
  const props = parseProps(text).props;
  const hasCover = props.some((p) => p.key === 'cover' && !p.readOnly && coverOf(p.value));
  return new Set(props.filter((p) => !p.readOnly && owns(p.key, p.value, hasCover)).map((p) => p.key));
}

/** set one appearance option; the default (the app-wide one for font, small text and full width) removes the line,
    so a page that looks like the defaults has no appearance keys at all */
export function setAppearance(text, key, value, defaults) {
  if (key === 'cover') return setCover(text, value);
  const d = appearanceDefaults(defaults);
  // a line under this name that the appearance does not own (a nested map, `font: comic`) is the person's: back to the
  // default leaves it alone, and a read-only one is never overwritten
  const cur = parseProps(text).props.find((p) => p.key === key);
  const removable = !cur || (!cur.readOnly && owns(key, cur.value));
  const drop = () => (removable ? removeProp(text, key) : text);
  if (cur?.readOnly) return text;
  if (key === 'font') {
    const f = FONTS.includes(value) ? value : ''; // anything else is sans
    return f === d.font ? drop() : setProp(text, key, f || 'sans', 'text');
  }
  if (key === 'small-text' || key === 'full-width') {
    const on = value === true; return on === d[key === 'small-text' ? 'small' : 'full'] ? drop() : setProp(text, key, on, 'checkbox');
  }
  const off = value === false || value == null || value === '' || (key === 'cover-y' && clampY(value) === COVER_Y_DEFAULT);
  if (off) return key === 'toc' ? drop() : removeProp(text, key);
  if (key === 'toc') return setProp(text, key, true, 'checkbox');
  if (key === 'cover-y') return setProp(text, key, clampY(value), 'number');
  return text;
}
/** a new cover resets its position; removing it takes its position with it */
export function setCover(text, value) {
  if (!value) return removeProp(removeProp(text, 'cover-y'), 'cover');
  const c = coverOf(value); if (!c) return text;
  return setProp(removeProp(text, 'cover-y'), 'cover', c.value, 'text');
}
