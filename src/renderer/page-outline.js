// Folio — sections of a page for the outline (D7): a heading and everything under it until a heading of the same or
// a higher level. Text in, text out, so the source view, the AI tools and the tests share it; the Write view does the
// same on the document (rich.js) to keep undo.
const setextText = (l) => !!l.trim() && !/^\s{0,3}([-*+]\s|\d+[.)]\s|>|#|\||```|~~~)/.test(l) && !/^ {4}/.test(l) && !/^ {0,3}([-*_=])( *\1){2,} *$/.test(l);

/** ATX headings outside front matter and code fences: { line, level, end } with end the line after the section */
export function sections(text) {
  const lines = String(text).split('\n'); const out = []; let fence = null, i = 0;
  if (/^---\s*$/.test(lines[0] || '')) { i = 1; while (i < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[i])) i++; i++; }
  for (; i < lines.length; i++) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (f) { if (!fence) fence = f[1][0].repeat(f[1].length); else if (lines[i].trim().startsWith(fence)) fence = null; continue; }
    if (fence) continue;
    const m = /^ {0,3}(#{1,6})(?:\s|$)/.exec(lines[i]);
    if (m) { out.push({ line: i, level: m[1].length }); continue; }
    const u = /^ {0,3}(=+|-+)\s*$/.exec(lines[i + 1] || '');
    if (u && setextText(lines[i])) {
      let first = i; while (first > 0 && setextText(lines[first - 1]) && !out.some((h) => h.line === first - 1)) first--;
      out.push({ line: first, level: u[1][0] === '=' ? 1 : 2, setext: i + 1 }); i++;
    }
  }
  for (let k = 0; k < out.length; k++) {
    const next = out.slice(k + 1).find((h) => h.level <= out[k].level);
    out[k].end = next ? next.line : lines.length;
  }
  return out;
}

/** move the section of the heading on line `from` so it starts where the heading on line `before` is (or the end: -1) */
export function moveSection(text, from, before) {
  const lines = String(text).split('\n'); const secs = sections(text);
  const s = secs.find((h) => h.line === from); if (!s) return text;
  if (before >= s.line && before < s.end) return text;
  let block = lines.slice(s.line, s.end);
  const rest = [...lines.slice(0, s.line), ...lines.slice(s.end)];
  let at = before < 0 ? rest.length : before > s.line ? before - (s.end - s.line) : before;
  // keep one blank line around the moved section
  while (block.length && block.at(-1).trim() === '') block.pop();
  if (before < 0) { while (rest.length && rest.at(-1).trim() === '') rest.pop(); at = rest.length; return [...rest, '', ...block, ''].join('\n'); }
  const out = [...rest.slice(0, at), ...block, '', ...rest.slice(at)];
  return out.join('\n');
}

/** promote (-1) or demote (+1) a heading and every heading in its section, staying within H1 to H6 */
export function shiftSection(text, line, delta) {
  const lines = String(text).split('\n'); const s = sections(text).find((h) => h.line === line); if (!s) return text;
  const inside = sections(text).filter((h) => h.line >= s.line && h.line < s.end);
  if (inside.some((h) => h.level + delta < 1 || h.level + delta > 6)) return text;
  const drop = new Set();
  for (const h of inside) {
    if (h.setext) {
      const lvl = h.level + delta;
      if (lvl <= 2) { lines[h.setext] = lines[h.setext].replace(/[=-]+/, (u) => (lvl === 1 ? '=' : '-').repeat(u.length)); continue; }
      lines[h.line] = '#'.repeat(lvl) + ' ' + lines.slice(h.line, h.setext).map((x) => x.trim()).join(' ');
      for (let k = h.line + 1; k <= h.setext; k++) drop.add(k);
    } else lines[h.line] = lines[h.line].replace(/^( {0,3})(#{1,6})/, (_, sp, hs) => sp + '#'.repeat(hs.length + delta));
  }
  return lines.filter((_, k) => !drop.has(k)).join('\n');
}
