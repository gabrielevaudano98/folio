// Folio references between documents — syntax only (no imports, safe for every bundle).
//   [[Target#part|label]]   link: opens the target at the part
//   {{Target#part}}         value: the computed result, inline (a sheet cell, a slide title, a heading's first line)
//   ![[Target#part]]        embed: the part drawn in place (sheet range as a table, slide, board, page section)
// Target is a document name (Budget, Budget.sheet, folder/Budget.sheet.md) or a path from the root (/folder/Budget.sheet.md).

const SPAN = /(!?)\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]|\{\{([^}\n]+?)\}\}/g;

/** "Budget.sheet#Summary!B7" → { target: 'Budget.sheet', part: 'Summary!B7' } */
export function parseRef(raw) {
  const s = String(raw).trim(); const i = s.indexOf('#');
  return i < 0 ? { target: s, part: '' } : { target: s.slice(0, i).trim(), part: s.slice(i + 1).trim() };
}

/** every reference in a text, outside code fences and inline code, with offsets */
export function findRefs(text) {
  const out = []; let fence = null, off = 0;
  for (const line of text.split('\n')) {
    const f = line.match(/^\s*(```|~~~)/);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    else if (!fence) {
      const masked = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
      SPAN.lastIndex = 0; let m;
      while ((m = SPAN.exec(masked))) {
        const kind = m[4] != null ? 'value' : m[1] ? 'embed' : 'link';
        const body = m[4] != null ? m[4] : m[2];
        out.push({ kind, raw: line.slice(m.index, m.index + m[0].length), start: off + m.index, end: off + m.index + m[0].length, label: m[3] || null, ...parseRef(body) });
      }
    }
    off += line.length + 1;
  }
  return out;
}

/** plain-text mentions of a document's name that are not links yet: outside front matter, code, links and references.
 *  Returns [{ start, end, line, text }] with offsets in `text`. */
export function findMentions(text, name) {
  const n = String(name || '').trim(); if (n.length < 3) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu');
  const fm = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text); const skipTo = fm ? fm[0].length : 0;
  const refs = findRefs(text); const out = []; let fence = null, off = 0, lineNo = 0;
  for (const line of text.split('\n')) {
    lineNo++;
    const f = line.match(/^\s*(```|~~~)/);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    else if (!fence && off >= skipTo) {
      const masked = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)).replace(/\[[^\]]*\]\([^)]*\)|<[^>]*>|https?:\/\/\S+|\{\{[^}]*\}\}/g, (m) => ' '.repeat(m.length));
      re.lastIndex = 0; let m;
      while ((m = re.exec(masked))) {
        const a = off + m.index, b = a + m[0].length;
        if (refs.some((r) => a < r.end && b > r.start)) continue;
        out.push({ start: a, end: b, line: lineNo, text: line.trim().slice(0, 200), match: text.slice(a, b) });
      }
    }
    off += line.length + 1;
  }
  return out;
}
/** turn one mention into a link: [[Name]], or [[Name|as written]] when the case differs */
/** every unlinked mention of `name` in a text, linked in one pass (from the end, so the offsets stay true) */
export function linkAllMentions(text, name) {
  const hits = findMentions(text, name).sort((a, b) => b.start - a.start); let out = text;
  for (const h of hits) out = linkMention(out, h, name);
  return { text: out, count: hits.length };
}
export const linkMention = (text, m, name) => text.slice(0, m.start) + (m.match === name ? `[[${name}]]` : `[[${name}|${m.match}]]`) + text.slice(m.end);

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.?\//, '');
const stem = (p) => norm(p).split('/').pop().replace(/(\.(slides|board|sheet))?\.(md|markdown|mdx|txt)$/i, '');
const noExt = (p) => norm(p).replace(/\.(md|markdown|mdx|txt)$/i, '');

/** resolve a target to a workspace path, from the list of files (relative paths). Absolute (/x) is from the root; otherwise
 *  relative to `from`'s folder first, then anywhere by name. */
export function resolveTarget(target, files, from = '') {
  if (!target) return from || null;
  const t = norm(target.replace(/^\//, '')).toLowerCase();
  const exact = (cand) => files.find((f) => f.toLowerCase() === cand || noExt(f).toLowerCase() === cand);
  if (target.startsWith('/')) return exact(t) || null;
  const dir = norm(from).split('/').slice(0, -1).join('/');
  return (dir && exact(`${dir}/${t}`.toLowerCase())) || exact(t)
    || files.find((f) => noExt(f).split('/').pop().toLowerCase() === t)
    || files.find((f) => stem(f).toLowerCase() === t) || null;
}

/** document type from its path */
export const docKind = (p) => (/\.slides\.md$/i.test(p) ? 'slides' : /\.board\.md$/i.test(p) ? 'board' : /\.sheet\.md$/i.test(p) ? 'sheet' : 'page');

/** the text to write for a renamed target, keeping the style the author used (name, name with type, or path) */
function retarget(oldTarget, newPath) {
  if (oldTarget.startsWith('/')) return '/' + (/\.md$/i.test(oldTarget) ? newPath : noExt(newPath));
  if (oldTarget.includes('/')) return /\.md$/i.test(oldTarget) ? newPath : noExt(newPath);
  if (/\.md$/i.test(oldTarget)) return newPath.split('/').pop();
  return /\.(slides|board|sheet)$/i.test(oldTarget) ? noExt(newPath).split('/').pop() : stem(newPath);
}

/** rewrite every reference in `text` (a document at `from`) that points at `oldPath`, so it points at `newPath`.
 *  `filesBefore` is the file list before the move. Only the target text of matching references changes. */
export function rewriteRefs(text, from, oldPath, newPath, filesBefore) {
  const refs = findRefs(text).filter((r) => r.target && resolveTarget(r.target, filesBefore, from) === oldPath);
  if (!refs.length) return text;
  let out = ''; let at = 0;
  for (const r of refs) {
    const i = text.indexOf(r.target, r.start);
    out += text.slice(at, i) + retarget(r.target, newPath); at = i + r.target.length;
  }
  return out + text.slice(at);
}

/** markdown-it plugin: {{value}} and ![[embed]] become placeholders that hydrateRefs fills in */
export function refsPlugin(md, { escape }) {
  md.inline.ruler.before('emphasis', 'folio_value', (state, silent) => {
    const m = state.src.slice(state.pos).match(/^\{\{([^}\n]+?)\}\}/);
    if (!m) return false;
    if (!silent) { const t = state.push('html_inline', '', 0); t.content = `<span class="ref-value" data-ref="${escape(m[1].trim())}">${escape(m[1].trim())}</span>`; }
    state.pos += m[0].length; return true;
  });
  md.inline.ruler.before('image', 'folio_embed', (state, silent) => {
    const m = state.src.slice(state.pos).match(/^!\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/);
    if (!m) return false;
    if (!silent) { const t = state.push('html_inline', '', 0); t.content = `<span class="ref-embed" data-ref="${escape(m[1].trim())}"${m[2] ? ` data-label="${escape(m[2].trim())}"` : ''}>${escape(m[1].trim())}</span>`; }
    state.pos += m[0].length; return true;
  });
}
