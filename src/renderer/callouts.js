// Folio — callouts: Obsidian and GitHub types, with Notion's icon and colour.
//   > [!tip] Title            a callout with a title
//   > [!warning]- Title       folded (Obsidian); [!warning]+ foldable, open
//   > [!note|💡 yellow] Text   Notion style: an emoji icon and a colour (Obsidian metadata syntax)
// Unknown types are drawn as notes, as in Obsidian. Pure: shared by the editor and the Read view.

export const CALLOUT_TYPES = {
  note: { label: 'Note', color: 'blue', icon: 'info' },
  abstract: { label: 'Abstract', color: 'blue', icon: 'doc' },
  info: { label: 'Info', color: 'blue', icon: 'info' },
  todo: { label: 'To do', color: 'blue', icon: 'check' },
  tip: { label: 'Tip', color: 'green', icon: 'bulb' },
  success: { label: 'Success', color: 'green', icon: 'check' },
  question: { label: 'Question', color: 'orange', icon: 'info' },
  warning: { label: 'Warning', color: 'orange', icon: 'alert' },
  important: { label: 'Important', color: 'purple', icon: 'alert' },
  failure: { label: 'Failure', color: 'red', icon: 'stop' },
  danger: { label: 'Danger', color: 'red', icon: 'alert' },
  caution: { label: 'Caution', color: 'red', icon: 'stop' },
  bug: { label: 'Bug', color: 'red', icon: 'alert' },
  example: { label: 'Example', color: 'purple', icon: 'listBullet' },
  quote: { label: 'Quote', color: 'gray', icon: 'quote' },
  callout: { label: 'Callout', color: 'gray', icon: 'bulb' },
};
export const CALLOUT_ALIASES = { summary: 'abstract', tldr: 'abstract', hint: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' };
const PALETTE = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

/* the head line of a callout: "[!type|meta]± Title" → { kind, type, label, color, emoji, fold, title, markerLength } */
export const CALLOUT_HEAD = /^\[!([A-Za-z][\w-]*)(?:\|([^\]\n]*))?\]([+-]?)[ \t]*([^\n]*)/;
export function parseCallout(line) {
  const m = CALLOUT_HEAD.exec(line || '');
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const type = CALLOUT_ALIASES[kind] || (CALLOUT_TYPES[kind] ? kind : 'note');
  const def = CALLOUT_TYPES[type];
  const meta = (m[2] || '').trim().split(/\s+/).filter(Boolean);
  const color = meta.find((w) => PALETTE.includes(w.toLowerCase()))?.toLowerCase() || def.color;
  const emoji = meta.find((w) => /\p{Extended_Pictographic}/u.test(w)) || null;
  const label = CALLOUT_TYPES[kind] || CALLOUT_ALIASES[kind] ? def.label : kind[0].toUpperCase() + kind.slice(1);
  const metaColor = meta.find((w) => PALETTE.includes(w.toLowerCase()))?.toLowerCase() || null;
  return { kind, type, label, color, metaColor, emoji, fold: m[3], title: m[4].trim(), markerLength: m[0].length - m[4].length };
}

/* the marker text for a callout: kind, metadata, fold */
export function calloutMarker({ kind, emoji = null, color = null, fold = '' }) {
  const meta = [emoji, color].filter(Boolean).join(' ');
  return `[!${kind}${meta ? '|' + meta : ''}]${fold}`;
}
