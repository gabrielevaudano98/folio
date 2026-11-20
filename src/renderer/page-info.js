// Folio — the Info tab of a page (D16): what the page holds and when the file last changed. Pure; runs on any text.
const words = (s) => (s.match(/[\p{L}\p{N}’'-]+/gu) || []).length;

export function docInfo(text) {
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(text); const body = fm ? text.slice(fm[0].length) : text;
  const prose = body.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ');
  const lines = prose.split('\n');
  const done = (prose.match(/^\s*[-*+] \[[xX]\]/gm) || []).length, open = (prose.match(/^\s*[-*+] \[ \]/gm) || []).length;
  const w = words(prose.replace(/!?\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)|\(https?:[^)]*\)/g, ' '));
  const count = (re) => (prose.match(re) || []).length;
  return {
    words: w, chars: prose.replace(/\s+/g, ' ').trim().length, lines: lines.length,
    minutes: Math.max(1, Math.round(w / 230)),
    headings: count(/^#{1,6}\s+\S/gm),
    links: count(/(?<!!)\[[^\]]*\]\([^)]+\)|(?<!!)\[\[[^\]]+\]\]/g),
    images: count(/!\[[^\]]*\]\([^)]+\)/g),
    embeds: count(/!\[\[[^\]]+\]\]/g),
    tables: count(/^\|.*\|\s*\n\|\s*:?-{2,}/gm),
    codeBlocks: (body.match(/^```/gm) || []).length >> 1,
    tasks: { done, open },
    comments: count(/\{>>[\s\S]*?<<\}/g),
    suggestions: count(/\{\+\+[\s\S]*?\+\+\}|\{--[\s\S]*?--\}|\{~~[\s\S]*?~~\}/g),
    tags: [...new Set((prose.match(/(?<![\w/#])#[\p{L}][\p{L}\p{N}_/-]*/gu) || []).map((t) => t.slice(1)))].slice(0, 20),
    bytes: new TextEncoder().encode(text).length,
  };
}

const plural = (n, one, many = one + 's') => `${new Intl.NumberFormat().format(n)} ${n === 1 ? one : many}`;
export const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const ago = (ms, now = Date.now()) => {
  const d = Math.max(0, now - ms), m = Math.round(d / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: new Date(ms).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
};

/** rows for the panel: [label, value]; `file` is { mtimeMs, birthtimeMs, size } when the main process knows it */
export function infoRows(info, path, file) {
  const rows = [['Words', plural(info.words, 'word')], ['Reading time', `${info.minutes} min`], ['Characters', new Intl.NumberFormat().format(info.chars)]];
  if (info.headings) rows.push(['Headings', String(info.headings)]);
  if (info.tasks.done + info.tasks.open) rows.push(['Tasks', `${info.tasks.done} of ${info.tasks.done + info.tasks.open} done`]);
  if (info.links) rows.push(['Links', String(info.links)]);
  if (info.images) rows.push(['Images', String(info.images)]);
  if (info.embeds) rows.push(['Embeds', String(info.embeds)]);
  if (info.tables) rows.push(['Tables', String(info.tables)]);
  if (info.codeBlocks) rows.push(['Code blocks', String(info.codeBlocks)]);
  if (info.comments) rows.push(['Comments', String(info.comments)]);
  if (info.suggestions) rows.push(['Suggestions', String(info.suggestions)]);
  rows.push(['Path', path || '']);
  rows.push(['Size', size(file?.size ?? info.bytes)]);
  if (file?.mtimeMs) rows.push(['Changed', ago(file.mtimeMs)]);
  if (file?.birthtimeMs) rows.push(['Created', new Date(file.birthtimeMs).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })]);
  return rows;
}
