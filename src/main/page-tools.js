// Folio — page tools for AIs (D13): pure functions on Markdown text, used by the MCP tools.
// Sections are found by heading (ATX, outside code fences) or by an Obsidian block id (` ^abc123`).
// Every function returns new text; nothing here touches the disk, so each one is tested in Node.
import { maskCode, stamp, commentBody } from './critic-text.js';

export class PageToolError extends Error {}
const fail = (m) => { throw new PageToolError(m); };

/** headings with their section: { level, text, line, end } (1-based lines; `end` is the last line of the section, sub-sections included) */
export function sections(text) {
  const lines = String(text).split('\n'); const out = []; let fence = null;
  // YAML front matter (the first line is ---, up to the next --- or ...) is metadata: its "# comments" are not headings
  let start = 0;
  if (lines[0]?.trim() === '---') { const close = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l)); if (close > 0) start = close + 1; }
  lines.forEach((l, i) => {
    if (i < start) return;
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(l);
    if (fence) { if (f && f[1][0] === fence.ch && f[1].length >= fence.len && !f[2].trim()) fence = null; return; }
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) { fence = { ch: f[1][0], len: f[1].length }; return; }
    const m = l.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/);
    if (m) out.push({ level: m[1].length, text: (m[2] || '').replace(/\s*\^[\w-]+$/, '').trim(), line: i + 1 });
  });
  out.forEach((h, k) => {
    let end = lines.length;
    for (let j = k + 1; j < out.length; j++) if (out[j].level <= h.level) { end = out[j].line - 1; break; }
    while (end > h.line && lines[end - 1].trim() === '') end--;
    h.end = end;
  });
  return out;
}

const plain = (s) => String(s).replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** find one section by heading text ("Goals"), by path ("Plan > Goals") or by line; fails if it is missing or ambiguous */
export function findSection(text, ref, { line } = {}) {
  const all = sections(text);
  if (line) { const h = all.find((x) => x.line === line); if (!h) fail(`No heading at line ${line}.`); return h; }
  if (!ref) fail('Give the heading text (or its line).');
  const parts = String(ref).split(/\s*>\s*/).map(plain).filter(Boolean);
  const last = parts.pop();
  const hits = all.filter((h, k) => {
    if (plain(h.text) !== last) return false;
    // walk the real ancestor chain (each step: the nearest earlier heading of a lower level), nearest first;
    // the path parts must appear on it in order (intermediate levels may be skipped), never on a sibling branch
    let p = parts.length - 1; let at = k;
    while (p >= 0) {
      let j = at - 1; while (j >= 0 && all[j].level >= all[at].level) j--;
      if (j < 0) return false;
      at = j; if (plain(all[j].text) === parts[p]) p--;
    }
    return true;
  });
  if (!hits.length) fail(`Heading not found: ${ref}. Headings: ${all.map((h) => h.text).join(' | ') || '(none)'}`);
  if (hits.length > 1) fail(`"${ref}" matches ${hits.length} headings (lines ${hits.map((h) => h.line).join(', ')}). Pass "line", or a path such as "Parent > ${last}".`);
  return hits[0];
}

/** the block that ends with ` ^id`: { from, to } lines (1-based) of the paragraph, list or quote that carries it */
export function findBlock(text, id) {
  const lines = String(text).split('\n'); const want = String(id).replace(/^\^/, '');
  const masked = maskCode(String(text)).split('\n');
  const at = masked.findIndex((l) => new RegExp(`(^|\\s)\\^${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(l));
  if (at < 0) fail(`Block id not found: ^${want}`);
  let from = at, to = at;
  while (from > 0 && lines[from - 1].trim() !== '') from--;
  while (to + 1 < lines.length && lines[to + 1].trim() !== '') to++;
  return { from: from + 1, to: to + 1 };
}

/** the section as text: { heading, level, fromLine, toLine, text, body } */
export function readSection(text, ref, { line, includeChildren = true } = {}) {
  const h = findSection(text, ref, { line }); const lines = String(text).split('\n');
  let end = h.end;
  if (!includeChildren) { const next = sections(text).find((x) => x.line > h.line); if (next && next.line - 1 < end) { end = next.line - 1; while (end > h.line && lines[end - 1].trim() === '') end--; } }
  const slice = lines.slice(h.line - 1, end);
  return { heading: h.text, level: h.level, fromLine: h.line, toLine: end, text: slice.join('\n'), body: slice.slice(1).join('\n').replace(/^\n+/, '') };
}

const trimNl = (s) => String(s).replace(/^\n+/, '').replace(/\n+$/, '');

/** replace what is under a heading (sub-sections included) with `content`. The heading stays unless `includeHeading`, where `content` brings its own. */
export function replaceSection(text, ref, content, { line, includeHeading = false } = {}) {
  const h = findSection(text, ref, { line }); const lines = String(text).split('\n');
  const body = trimNl(content) ? trimNl(content).split('\n') : [];
  const head = includeHeading ? [] : (body.length ? [lines[h.line - 1], ''] : [lines[h.line - 1]]);
  const rest = lines.slice(h.end); const sep = rest.length && rest[0].trim() !== '' ? [''] : [];
  const next = [...lines.slice(0, h.line - 1), ...head, ...body, ...sep, ...rest];
  return next.join('\n');
}

/** insert `content` as new blocks after a heading's section (sub-sections included) or after the block with a ` ^id`. */
export function insertAfter(text, after, content, { line } = {}) {
  const lines = String(text).split('\n'); const add = trimNl(content).split('\n');
  if (!trimNl(content)) fail('Nothing to insert.');
  const isId = typeof after === 'string' && /^\^[\w-]+$/.test(after.trim());
  const end = isId ? findBlock(text, after.trim()).to : findSection(text, after, { line }).end;
  const rest = lines.slice(end);
  return [...lines.slice(0, end), '', ...add, ...(rest.length && rest[0].trim() !== '' ? [''] : []), ...rest].join('\n');
}

const nth = (hay, needle, n) => { let at = -1; for (let i = 0; i < n; i++) { at = hay.indexOf(needle, at + 1); if (at < 0) return -1; } return at; };
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);

function locate(text, quote, occurrence, what) {
  if (!quote) fail(`${what}: the text is empty.`);
  const masked = maskCode(String(text)); const n = count(masked, quote);
  if (!n) fail(`${what}: text not found outside code: ${JSON.stringify(quote.slice(0, 60))}. Read the page again and copy it exactly.`);
  if (n > 1 && !occurrence) fail(`${what}: the text appears ${n} times. Add more context, or pass "occurrence" (1 to ${n}).`);
  const at = nth(masked, quote, occurrence || 1);
  if (at < 0) fail(`${what}: there is no occurrence ${occurrence}; the text appears ${n} times.`);
  return at;
}
const clash = (s, what) => { if (/\{(\+\+|--|~~|==|>>)|(\+\+|--|~~|==|<<)\}|~>/.test(s)) fail(`${what} contains CriticMarkup characters; rewrite it without them.`); };

/** comment on a passage: {==passage==}{>>Author, 2026-11-20 14:05: comment<<} */
export function addComment(text, quote, comment, { author = '', occurrence, date } = {}) {
  clash(quote, 'The passage'); if (!String(comment).trim()) fail('The comment is empty.');
  const at = locate(text, quote, occurrence, 'add_comment');
  const body = commentBody(author, String(comment).trim().replace(/\n+/g, ' '), date || stamp());
  return text.slice(0, at) + `{==${quote}==}{>>${body}<<}` + text.slice(at + quote.length);
}

/** suggest a change as CriticMarkup: `oldText` → `newText` (`{~~old~>new~~}`), or delete it (`{--old--}`),
 *  or with `insertAfter` and no oldText, add `newText` after that passage (`{++new++}`). A comment can come with it. */
export function suggestEdit(text, { oldText = '', newText = '', insertAfter: anchor = '', comment = '', author = '', occurrence, date } = {}) {
  clash(oldText, 'oldText'); clash(newText, 'newText'); clash(anchor, 'insertAfter');
  let from, to, markup;
  if (oldText) {
    from = locate(text, oldText, occurrence, 'suggest_edit'); to = from + oldText.length;
    markup = newText === '' ? `{--${oldText}--}` : `{~~${oldText}~>${newText}~~}`;
  } else if (anchor) {
    if (!newText) fail('suggest_edit: give newText to insert.');
    from = locate(text, anchor, occurrence, 'suggest_edit') + anchor.length; to = from; markup = `{++${newText}++}`;
  } else fail('suggest_edit: give oldText (to change or delete) or insertAfter (to add).');
  if (String(comment).trim()) markup += `{>>${commentBody(author, String(comment).trim().replace(/\n+/g, ' '), date || stamp())}<<}`;
  return text.slice(0, from) + markup + text.slice(to);
}
