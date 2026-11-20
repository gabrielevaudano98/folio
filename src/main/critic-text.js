// Folio — CriticMarkup helpers on plain text (no editor, no Node imports): shared by the page editor, the Read view and the MCP tools.
export const CRITIC = /\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{==([\s\S]*?)==\}|\{>>([\s\S]*?)<<\}/g;
const META = /^([^,:\n]{1,48}), (\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?): ([\s\S]*)$/;
/** a comment's author, time and text */
export function parseComment(body) { const m = META.exec(body); return m ? { author: m[1].trim(), date: m[2], text: m[3] } : { author: '', date: '', text: body }; }
export const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const commentBody = (author, text, date = stamp()) => (author ? `${author.replace(/[,:\n]/g, ' ').trim()}, ${date}: ${text}` : text).replace(/<</g, '‹‹');

/* code spans and fences are never markup: blank them out (same length) before matching */
export function maskCode(text) {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
}
/** every change and comment in a text: { kind: ins|del|sub|hl|comment, from, to, text, old?, new?, comment? } */
export function listChanges(text) {
  const masked = maskCode(String(text)); const out = []; CRITIC.lastIndex = 0; let m;
  while ((m = CRITIC.exec(masked))) {
    const raw = text.slice(m.index, m.index + m[0].length); const r = new RegExp(CRITIC.source).exec(raw);
    const base = { from: m.index, to: m.index + m[0].length, raw };
    if (r[1] != null) out.push({ ...base, kind: 'ins', text: r[1] });
    else if (r[2] != null) out.push({ ...base, kind: 'del', text: r[2] });
    else if (r[3] != null) out.push({ ...base, kind: 'sub', old: r[3], new: r[4], text: r[4] });
    else if (r[5] != null) out.push({ ...base, kind: 'hl', text: r[5] });
    else out.push({ ...base, kind: 'comment', text: r[6], comment: parseComment(r[6]) });
  }
  return out;
}
const apply = (text, pick) => { let out = '', at = 0; for (const c of listChanges(text)) { const r = pick(c); if (r == null) continue; out += text.slice(at, c.from) + r; at = c.to; } return out + text.slice(at); };
/** accept one change (by its `from`) or all of them; comments and highlights stay */
export const accept = (text, from = null) => apply(text, (c) => (from != null && c.from !== from ? null : c.kind === 'ins' ? c.text : c.kind === 'del' ? '' : c.kind === 'sub' ? c.new : null));
export const reject = (text, from = null) => apply(text, (c) => (from != null && c.from !== from ? null : c.kind === 'ins' ? '' : c.kind === 'del' ? c.text : c.kind === 'sub' ? c.old : null));
/** remove comments and highlight markup (the text stays), as Resolve all does */
export const resolveAll = (text) => apply(text, (c) => (c.kind === 'comment' ? '' : c.kind === 'hl' ? c.text : null));
/** the text as it would read with every suggestion accepted and no comments: for exports and AI tools */
export const clean = (text) => resolveAll(accept(text));
