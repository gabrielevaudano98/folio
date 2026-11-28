// Folio — page core: lossless Markdown for the page editor.
// A page is split into top-level blocks. Each block is either edited richly (when the editor can write it back with the
// same meaning) or kept as a raw block (shown drawn, edited as source). Saving rewrites only the blocks that changed;
// every other byte stays as the author wrote it. Pure: no DOM, so it runs in the format tests.
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import taskLists from 'markdown-it-task-lists';
import katex from '@vscode/markdown-it-katex';
import container from 'markdown-it-container';
import { diffArrays } from 'diff';
import { softBreaks } from './page-syntax.js';

const FM = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const DEF = /^ {0,3}\[\^?[^\]\n]+\]:/m; // link reference or footnote definition

/* The oracle: two pieces of Markdown mean the same thing when markdown-it draws them the same way. */
const oracle = new MarkdownIt({ html: true, linkify: false, typographer: false })
  .use(footnote).use(mark).use(taskLists, { enabled: false }).use(katex.default || katex, { throwOnError: false, strict: 'ignore' })
  .use(container, 'columns').use(container, 'column');
const draw = (src, defs) => oracle.render(defs ? `${src}\n\n${defs}\n` : src).replace(/\s+/g, ' ').replace(/> </g, '><').trim();

/* Keep the conventions the rest of Folio (and the AI) reads: the serializer escapes them, we put them back. */
export function tidy(md) {
  return md
    .replace(/\\\[\\\[([^\]\n]+)\\\]\\\]/g, '[[$1]]')
    .replace(/\\\[([A-Za-z][\w ]{0,29}?::[ \t]*[^\]\n]{0,80}?)[ \t]*\\\]/g, '[$1]')
    .replace(/\\\[!([\w-]+(?:\|[^\]\n]*)?)\\\]/g, '[!$1]').replace(/\\\[!([\w-]+(?:\|[^\]\n]*)?)\]/g, '[!$1]')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

/* Split a body into top-level blocks with the whitespace that follows each one. */
export function splitBlocks(body) {
  const lines = []; let at = 0;
  for (const l of body.split('\n')) { lines.push(at); at += l.length + 1; }
  lines.push(body.length + 1);
  const off = (line) => Math.min(lines[line] ?? body.length, body.length);
  const spans = [];
  for (const t of oracle.parse(body, {})) {
    if (t.level !== 0 || !t.map || t.nesting === -1) continue;
    const a = off(t.map[0]); let b = off(t.map[1]);
    // a container's map stops before its closing fence: take the fence too
    if (t.type.startsWith('container_')) { const close = /^ {0,3}:{3,}[ \t]*(?:\n|$)/.exec(body.slice(b)); if (close) b += close[0].length; }
    if (spans.length && a < spans.at(-1)[1]) continue;
    while (b > a && /\s/.test(body[b - 1])) b--;
    if (b > a) spans.push([a, b]);
  }
  // HTML blocks that open more <details> than they close run until they are closed: one block, editable as a toggle
  for (let i = 0; i < spans.length; i++) {
    const count = (t, re) => (t.match(re) || []).length;
    let bal = (t) => count(t, /<details[\s>]/gi) - count(t, /<\/details>/gi);
    let depth = bal(body.slice(spans[i][0], spans[i][1]));
    let j = i;
    while (depth > 0 && j + 1 < spans.length) { j++; depth += bal(body.slice(spans[j][0], spans[j][1])); }
    if (j > i && depth === 0) { spans.splice(i, j - i + 1, [spans[i][0], spans[j][1]]); }
  }
  // anything between blocks that is not whitespace (definitions, stray text) becomes its own raw block
  const blocks = []; let cur = 0;
  const pushGap = (a, b) => {
    const s = body.slice(a, b), t = s.trim();
    if (!t) return;
    const start = a + s.indexOf(t);
    blocks.push({ a: start, b: start + t.length, gap: true });
  };
  for (const [a, b] of spans) { pushGap(cur, a); blocks.push({ a, b }); cur = b; }
  pushGap(cur, body.length);
  blocks.sort((x, y) => x.a - y.a);
  const lead = blocks.length ? body.slice(0, blocks[0].a) : body;
  return {
    lead,
    blocks: blocks.map((k, i) => ({ src: body.slice(k.a, k.b), sep: body.slice(k.b, i + 1 < blocks.length ? blocks[i + 1].a : body.length), gap: !!k.gap })),
  };
}

/* Markers the author chose, so a rewritten block reads like its neighbours. */
function sniffStyle(body) {
  const bullet = body.match(/^\s*([*+-]) (?!\s*$)/m)?.[1];
  const ordered = body.match(/^\s*\d+([.)]) /m)?.[1];
  return { bullet: bullet && bullet !== '-' ? bullet : null, ordered: ordered === ')' ? ')' : null };
}
function applyStyle(md, style) {
  if (!style.bullet && !style.ordered) return md;
  let fence = false;
  return md.split('\n').map((l) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return l; }
    if (fence) return l;
    if (style.bullet) l = l.replace(/^(\s*)- (?!-)/, `$1${style.bullet} `);
    if (style.ordered) l = l.replace(/^(\s*)(\d+)\. /, `$1$2) `);
    return l;
  }).join('\n');
}

/**
 * md: a TipTap MarkdownManager (parse, serialize). Returns load and save.
 * load(text) -> model with `json` to give to the editor. bind(model, doc) after the editor holds it. save(model, doc) -> text.
 */

/* The serializer moves spaces at the edges of marked text outside the mark (right for **bold**, wrong for CriticMarkup,
   where `{-- old--}` means the space was deleted too). Spaces at the edges of {++ ++} {-- --} {== ==} text are pinned
   to private-use characters while serializing and put back after. */
const PIN = { ' ': '\uE000', '\t': '\uE001' };
const KEEP_EDGES = new Set(['criticIns', 'criticDel', 'criticHl']);
function pinEdges(node) {
  if (node.type === 'text' && node.marks?.some((m) => KEEP_EDGES.has(m.type))) return { ...node, text: node.text.replace(/^[ \t]+|[ \t]+$/g, (w) => w.replace(/[ \t]/g, (c) => PIN[c])) };
  return node.content ? { ...node, content: node.content.map(pinEdges) } : node;
}
const unpin = (t) => t.replace(/\uE000/g, ' ').replace(/\uE001/g, '\t');

export function createPageCodec(md) {
  const serialize = (nodes, style) => {
    const content = nodes.map((n) => (n.toJSON ? n.toJSON() : n)).filter((n) => !(n.type === 'paragraph' && !n.content?.length));
    if (!content.length) return '';
    return applyStyle(tidy(unpin(md.serialize({ type: 'doc', content: content.map(pinEdges) }))), style);
  };

  function load(text) {
    const fm = text.match(FM)?.[0] || '';
    const body = text.slice(fm.length);
    const { lead, blocks } = splitBlocks(body);
    // definitions (footnotes, link references) a block uses travel with it to the parser and the oracle
    const defMap = new Map();
    for (const b of blocks) if (DEF.test(b.src)) for (const d of b.src.split(/\n(?= {0,3}\[)/)) {
      const label = d.match(/^ {0,3}\[(\^?[^\]\n]+)\]:/)?.[1]?.toLowerCase();
      if (label && !defMap.has(label)) defMap.set(label, d); // the first definition wins, as in Markdown
    }
    const used = (src, foot) => {
      if (!defMap.size) return '';
      const out = new Set();
      for (const m of src.matchAll(/\[(\^?[^\]\n]+)\]/g)) { const l = m[1].toLowerCase(); if (l.startsWith('^') === foot && defMap.has(l)) out.add(defMap.get(l)); }
      return [...out].join('\n');
    };
    const style = sniffStyle(body);
    const content = [];
    for (const b of blocks) {
      let nodes = null;
      {
        try {
          const isDef = DEF.test(b.src);
          const refDefs = isDef ? '' : used(b.src, false), defs = isDef ? '' : [refDefs, used(b.src, true)].filter(Boolean).join('\n\n');
          const parsed = (softBreaks(md.parse(refDefs ? `${b.src}\n\n${refDefs}` : b.src)).content) || [];
          const back = serialize(parsed, style);
          // a definition draws nothing on its own: draw it with references to its labels
          const refs = isDef ? [...b.src.matchAll(/^ {0,3}\[(\^?[^\]\n]+)\]:/gm)].map((m) => `[${m[1]}]`).join(' ') : '';
          const look = (t) => (refs ? draw(`${refs}\n\n${t}`) : draw(t, defs));
          if (parsed.length && !parsed.some((n) => n.type === 'folioRaw') && look(back) === look(b.src)) nodes = parsed;
        } catch { nodes = null; }
      }
      b.raw = !nodes;
      if (!nodes) nodes = [{ type: 'folioRaw', attrs: { source: b.src } }];
      b.count = nodes.length;
      content.push(...nodes);
    }
    return { text, fm, lead, blocks, style, json: { type: 'doc', content }, orig: null };
  }

  /* Remember the editor's own nodes for each block (the editor may normalize the JSON slightly). */
  function bind(model, doc) {
    const kids = []; doc.forEach((n) => kids.push(n));
    const expected = model.blocks.reduce((s, b) => s + b.count, 0);
    // the editor may add an empty paragraph at the end (trailing node); it belongs to no block
    const tailOk = kids.length >= expected && kids.slice(expected).every((n) => n.type.name === 'paragraph' && !n.content.size);
    if (!tailOk) { model.orig = null; model.kids = kids; return false; }
    const owner = [], first = [];
    model.blocks.forEach((b, k) => { first[k] = owner.length; for (let i = 0; i < b.count; i++) owner.push(k); });
    model.orig = kids; model.owner = owner; model.first = first;
    return true;
  }

  function save(model, doc) {
    const cur = []; doc.forEach((n) => cur.push(n));
    // a page written with CRLF only gets CRLF in what the editor writes too (blocks kept verbatim keep theirs anyway)
    const crlf = /\r\n/.test(model.text) && !/(^|[^\r])\n/.test(model.text);
    const nl = (t) => (crlf ? t.replace(/\r?\n/g, '\r\n') : t);
    // not bound (the editor reshaped the document): fall back to writing everything, still keeping front matter
    if (!model.orig) { const all = serialize(cur, model.style); return model.fm + (all ? nl(all + '\n') : ''); }
    const same = cur.length === model.orig.length && cur.every((n, i) => n === model.orig[i] || n.eq(model.orig[i]));
    if (same) return model.text;

    // output items: original node index, or a new node
    const items = [];
    let oi = 0;
    for (const part of diffArrays(model.orig, cur, { comparator: (a, b) => a === b || a.eq(b) })) {
      if (part.removed) { oi += part.count; continue; }
      if (part.added) { for (const n of part.value) items.push({ node: n }); continue; }
      for (const n of part.value) items.push({ i: oi++, node: n });
    }
    // group into pieces: whole original blocks are written verbatim, everything else is serialized in runs
    const pieces = []; let run = [];
    const flush = () => { if (!run.length) return; const t = serialize(run, model.style); if (t) pieces.push({ text: nl(t), k: null }); run = []; };
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      if (it.i != null && it.i >= model.owner.length) continue; // the editor's own empty paragraph at the end
      if (it.i != null) {
        const k = model.owner[it.i], blk = model.blocks[k];
        const first = model.first[k];
        let whole = it.i === first;
        for (let c = 1; whole && c < blk.count; c++) whole = items[j + c]?.i === first + c;
        if (whole) { flush(); pieces.push({ text: blk.src, k }); j += blk.count - 1; continue; }
      }
      run.push(it.node);
    }
    flush();

    let out = model.lead;
    pieces.forEach((p, n) => {
      out += p.text;
      const next = pieces[n + 1];
      if (next) out += p.k != null && next.k === p.k + 1 ? model.blocks[p.k].sep : nl('\n\n');
      else out += p.k === model.blocks.length - 1 ? model.blocks[p.k].sep : nl('\n');
    });
    if (!pieces.length) out = model.lead.trim() ? model.lead : '';
    return model.fm + out;
  }

  return { load, bind, save };
}
