// Folio — per-page appearance (Notion's "Appearance & layout"): front matter keys, written only when not the default.
//   font: serif | mono   small-text: true   full-width: true   toc: true   cover: .asset/<file> | gradient-N   cover-y: 0..100
// Pure: each setter rewrites only its own line through page-props.js (CRLF files stay CRLF). Runs in Node tests.
import { parseProps, setProp, removeProp } from './page-props.js';

export const FONTS = ['serif', 'mono'];
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

/** the appearance a page's front matter asks for */
export function readAppearance(text) {
  const out = { font: '', small: false, full: false, toc: false, cover: null, coverY: COVER_Y_DEFAULT };
  for (const p of parseProps(text).props) {
    if (p.readOnly) continue;
    if (p.key === 'font' && FONTS.includes(String(p.value))) out.font = String(p.value);
    else if (p.key === 'small-text' && p.value === true) out.small = true;
    else if (p.key === 'full-width' && p.value === true) out.full = true;
    else if (p.key === 'toc' && p.value === true) out.toc = true;
    else if (p.key === 'cover') out.cover = coverOf(p.value);
    else if (p.key === 'cover-y' && typeof p.value === 'number' && Number.isFinite(p.value)) out.coverY = clampY(p.value);
  }
  return out;
}

/** does the appearance own this property (so the properties panel and the reading view do not list it)? Values it does not understand stay visible. */
export function owns(key, value, hasCover = true) {
  const v = typeof value === 'string' ? value.trim() : value;
  if (key === 'font') return FONTS.includes(String(v));
  if (key === 'small-text' || key === 'full-width' || key === 'toc') return v === true || v === 'true';
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

/** set one appearance option; the default removes the line, so a default page has no appearance keys at all */
export function setAppearance(text, key, value) {
  if (key === 'cover') return setCover(text, value);
  const off = value === false || value == null || value === '' || (key === 'cover-y' && clampY(value) === COVER_Y_DEFAULT) || (key === 'font' && !FONTS.includes(value));
  if (off) return removeProp(text, key);
  if (key === 'font') return setProp(text, key, value, 'text');
  if (key === 'small-text' || key === 'full-width' || key === 'toc') return setProp(text, key, true, 'checkbox');
  if (key === 'cover-y') return setProp(text, key, clampY(value), 'number');
  return text;
}
/** a new cover resets its position; removing it takes its position with it */
export function setCover(text, value) {
  if (!value) return removeProp(removeProp(text, 'cover-y'), 'cover');
  const c = coverOf(value); if (!c) return text;
  return setProp(removeProp(text, 'cover-y'), 'cover', c.value, 'text');
}
