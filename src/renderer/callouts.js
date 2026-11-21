import { tl } from './i18n.js';
// Folio — callouts: Obsidian and GitHub types, with Notion's icon and colour.
//   > [!tip] Title            a callout with a title
//   > [!warning]- Title       folded (Obsidian); [!warning]+ foldable, open
//   > [!note|💡 yellow] Text   Notion style: an emoji icon and a colour (Obsidian metadata syntax)
// Unknown types are drawn as notes, as in Obsidian. Pure: shared by the editor and the Read view.

export const CALLOUT_TYPES = {
  note: { label: tl('call', 'Note'), color: 'blue', icon: 'info' },
  abstract: { label: tl('call', 'Abstract'), color: 'blue', icon: 'doc' },
  info: { label: tl('call', 'Info'), color: 'blue', icon: 'info' },
  todo: { label: tl('call', 'To do'), color: 'blue', icon: 'check' },
  tip: { label: tl('call', 'Tip'), color: 'green', icon: 'bulb' },
  success: { label: tl('call', 'Success'), color: 'green', icon: 'check' },
  question: { label: tl('call', 'Question'), color: 'orange', icon: 'info' },
  warning: { label: tl('call', 'Warning'), color: 'orange', icon: 'alert' },
  important: { label: tl('call', 'Important'), color: 'purple', icon: 'alert' },
  failure: { label: tl('call', 'Failure'), color: 'red', icon: 'stop' },
  danger: { label: tl('call', 'Danger'), color: 'red', icon: 'alert' },
  caution: { label: tl('call', 'Caution'), color: 'red', icon: 'stop' },
  bug: { label: tl('call', 'Bug'), color: 'red', icon: 'alert' },
  example: { label: tl('call', 'Example'), color: 'purple', icon: 'listBullet' },
  quote: { label: tl('call', 'Quote'), color: 'gray', icon: 'quote' },
  callout: { label: tl('call', 'Callout'), color: 'gray', icon: 'bulb' },
};
export const CALLOUT_ALIASES = { summary: 'abstract', tldr: 'abstract', hint: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' };
const PALETTE = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

/* the head line of a callout: "[!type|meta]± Title" → { kind, type, label, color, emoji, fold, title, markerLength } */
export const CALLOUT_HEAD = /^\[!([A-Za-z][\w-]*)(?:\|([^\]\n]*))?\]([+-]?)[ \t]*([^\n]*)/;
export function parseCallout(line) {
  const m = CALLOUT_HEAD.exec(line || '');
  if (!m) return null;
  const kind = m[1].toLowerCase();
  // own keys only: "[!constructor]" or "[!toString]" must not reach Object.prototype
  const known = Object.hasOwn(CALLOUT_TYPES, kind), alias = Object.hasOwn(CALLOUT_ALIASES, kind) ? CALLOUT_ALIASES[kind] : null;
  const type = alias || (known ? kind : 'note');
  const def = CALLOUT_TYPES[type];
  const meta = (m[2] || '').trim().split(/\s+/).filter(Boolean);
  const color = meta.find((w) => PALETTE.includes(w.toLowerCase()))?.toLowerCase() || def.color;
  const emoji = meta.find((w) => /\p{Extended_Pictographic}/u.test(w)) || null;
  const label = known || alias ? def.label : kind[0].toUpperCase() + kind.slice(1);
  const metaColor = meta.find((w) => PALETTE.includes(w.toLowerCase()))?.toLowerCase() || null;
  return { kind, type, label, color, metaColor, emoji, fold: m[3], title: m[4].trim(), markerLength: m[0].length - m[4].length };
}

/* the marker text for a callout: kind, metadata, fold */
export function calloutMarker({ kind, emoji = null, color = null, fold = '' }) {
  const meta = [emoji, color].filter(Boolean).join(' ');
  return `[!${kind}${meta ? '|' + meta : ''}]${fold}`;
}
