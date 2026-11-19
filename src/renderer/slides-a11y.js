// Folio — accessibility checker for slide decks (P8). Pure: works on a parsed deck.
import { parseFill, safeColor } from './slides-objects.js';

const THEME = { folio: { paper: '#fcfcfc', ink: '#1f1f1f' }, graphite: { paper: '#1c1c1c', ink: '#f2f2f2' }, paper: { paper: '#f5f5f5', ink: '#1f1f1f' } };
const NAMED = { white: '#ffffff', black: '#000000' };
function rgb(c) {
  c = NAMED[String(c).toLowerCase()] || c;
  const m = String(c || '').match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
const lum = ([r, g, b]) => { const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
/** WCAG contrast ratio of two colours, or null when either is not a plain colour */
export function contrast(a, b) { const x = rgb(a), y = rgb(b); if (!x || !y) return null; const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p); return (l1 + 0.05) / (l2 + 0.05); }

/** issues: { slide (index), number, severity: 'error'|'warning'|'tip', kind, message, object? } */
export function checkDeck(deck) {
  const issues = []; const titles = new Map();
  const add = (s, severity, kind, message, object) => issues.push({ slide: s.index, number: s.number, severity, kind, message, object });
  for (const s of deck.slides) {
    if (s.master) continue;
    const e = s.eff; const base = THEME[deck.theme] || THEME.folio;
    const paper = safeColor(e.backgroundColor) || safeColor(e.paper) || base.paper, ink = safeColor(e.color) || safeColor(e.ink) || base.ink;
    const name = `Slide ${s.number}`;
    // titles
    const boxTitle = (s.objects || []).some((o) => /^\s*#{1,3}\s+\S/m.test(o.body || ''));
    if (!s.title && !boxTitle && !/^\s*#{1,6}\s+\S/m.test(s.content)) add(s, 'error', 'title', `${name} has no title. Screen readers and the outline use titles to move between slides.`);
    else if (s.title) { const k = s.title.trim().toLowerCase(); titles.set(k, [...(titles.get(k) || []), s]); }
    // pictures without a description
    const flowImgs = [...s.content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)(?!\{)/g)].filter((m) => !/^bg\b/i.test(m[1].trim()));
    for (const m of flowImgs) if (!m[1].trim()) add(s, 'error', 'alt', `${name}: a picture (${m[2].split('/').pop()}) has no alternative text.`);
    (s.objects || []).forEach((o, i) => {
      if (o.kind === 'image' && !String(o.attrs.alt ?? o.alt ?? '').trim()) add(s, 'error', 'alt', `${name}: a picture (${String(o.src).split('/').pop()}) has no alternative text.`, i);
      if (o.kind === 'media' && !/\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(o.attrs.src || '') && !o.attrs.captions) add(s, 'tip', 'captions', `${name}: a video has no captions. Add a captions file (captions=assets/clip.vtt) or a transcript in the notes.`, i);
      if (o.kind === 'box' || o.kind === 'shape') {
        const fill = parseFill(o.attrs.fill); const bg = fill?.kind === 'solid' ? fill.color : fill ? null : paper;
        const fg = safeColor(o.attrs.color) || ink;
        const size = parseFloat(o.attrs.size) || 30; const ratio = bg && fg ? contrast(fg, bg) : null; const need = size >= 24 ? 3 : 4.5;
        if (ratio != null && ratio < need && (o.body || '').trim()) add(s, 'error', 'contrast', `${name}: text in ${o.id || o.kind} has a contrast of ${ratio.toFixed(1)}:1, below ${need}:1.`, i);
        if (o.attrs.size && size < 18 && (o.body || '').trim()) add(s, 'warning', 'size', `${name}: text in ${o.id || o.kind} is ${size}px, too small to read from a distance (use 18px or more).`, i);
      }
    });
    const r = contrast(ink, paper); if (r != null && r < 4.5) add(s, 'error', 'contrast', `${name}: text and background have a contrast of ${r.toFixed(1)}:1, below 4.5:1.`);
    if (/\]\((https?:\/\/[^)]+)\)/.test(s.content) && /\[(click here|here|link|this)\]\(/i.test(s.content)) add(s, 'warning', 'link', `${name}: a link says only “here”. Say where it goes.`);
  }
  for (const [, list] of titles) if (list.length > 1) for (const s of list) add(s, 'warning', 'duplicate', `Slide ${s.number} has the same title as ${list.filter((x) => x !== s).map((x) => 'slide ' + x.number).join(', ')}. Distinct titles help people find their place.`);
  const order = { error: 0, warning: 1, tip: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || a.slide - b.slide);
}
