// Folio Sheets — how one cell's value is written in a Markdown table cell, and read back. Pure, no dependencies:
// the Univer converter (convert.js), the plain evaluator (renderer/sheet-core.js) and the data engine share it.
//
//   42        number            '42       the text "42"        (Excel's apostrophe: text that would read as
//   TRUE      boolean           'TRUE     the text "TRUE"       something else keeps one apostrophe in front)
//   =A1+1     formula           '=A1      the text "=A1"
//   a<br>b    text with a line break      a&lt;br>b   the text "a<br>b"
//   &#32;x    the text " x"      (blanks at either end, which a Markdown table would trim, as numeric entities)
//   &amp;lt;  the text "&lt;"    (an "&" that would otherwise start &lt; &amp; or &#n;, which are read as characters)
//
// Files written before this rule read the same, except a cell that starts with an apostrophe followed by a number,
// TRUE/FALSE or "=": it now means text, as it does in Excel and Google Sheets.

const BR = /<br\s*\/?>/gi;
const NUM = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const ENT = /&(#\d{1,7}|lt|amp);/g;
const decode = (_, e) => (e === 'lt' ? '<' : e === 'amp' ? '&' : (() => { try { return String.fromCodePoint(Number(e.slice(1))); } catch { return `&${e};`; } })());

/** the value a raw cell holds, before the apostrophe rule: null (empty), { f }, { v, t: 2 } number, { v, t: 3 } boolean, { v, t: 1 } text */
function plain(s) {
  if (s === '') return null;
  if (s.length > 1 && s.startsWith('=')) return { f: s };
  if (NUM.test(s) && String(Number(s)) === s) return { v: Number(s), t: 2 };
  if (s === 'TRUE' || s === 'FALSE') return { v: s === 'TRUE' ? 1 : 0, t: 3 };
  return { v: textOf(s), t: 1 };
}
const textOf = (s) => s.split(BR).map((p) => p.replace(ENT, decode)).join('\n');

/** does this text need an apostrophe to stay text? */
const needsQuote = (s) => { const p = plain(s); return !p || p.t !== 1 || (s.startsWith("'") && needsQuote(s.slice(1))); };

/** markdown cell text → Univer-shaped cell (value part only), or null for an empty cell */
export function readCell(raw) {
  const s = String(raw ?? '');
  if (s.length > 1 && s.startsWith("'")) { const rest = s.slice(1); if (needsQuote(rest)) return { v: textOf(rest), t: 1 }; }
  return plain(s);
}

/** a text value → markdown cell text that reads back as the same text */
export function writeText(text) {
  let s = String(text);
  if (s === '') return '';
  s = s.replace(/&(?=(#\d{1,7}|lt|amp);)/g, '&amp;').replace(/<(?=br\s*\/?>)/gi, '&lt;').replace(/\r\n?|\n/g, '<br>');
  const lead = /^ +/.exec(s)?.[0].length || 0;
  if (lead === s.length) return '&#32;'.repeat(lead);
  const trail = / +$/.exec(s)?.[0].length || 0;
  s = '&#32;'.repeat(lead) + s.slice(lead, s.length - trail) + '&#32;'.repeat(trail);
  // tabs and other blanks at the edges are trimmed by Markdown too: they are written as numeric entities as well
  s = s.replace(/^[\t\v\f ]+|[\t\v\f ]+$/g, (m) => [...m].map((ch) => `&#${ch.codePointAt(0)};`).join(''));
  const p = plain(s);
  if (!p || p.t !== 1 || p.v !== String(text).replace(/\r\n?/g, '\n') || (s.startsWith("'") && needsQuote(s.slice(1)))) return "'" + s;
  return s;
}

/** the value a plain evaluator should see for a raw cell (text after the apostrophe rule, numbers as numbers) */
export function cellValue(raw) {
  const c = readCell(raw);
  if (!c) return '';
  if (c.f) return c.f;
  return c.t === 3 ? !!c.v : c.v;
}
