// Paste and import: HTML from Word, Google Docs, Notion and the web becomes clean, portable Markdown.
// The result is parsed by the page codec like any typed Markdown, so a pasted page saves as plain text.
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';

const style = (el) => (el.getAttribute?.('style') || '').toLowerCase();
const css = (el, prop) => { const m = style(el).match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`)); return m ? m[1].trim() : ''; };

/* where the HTML came from: cleanup differs a little */
export function htmlSource(html) {
  if (/urn:schemas-microsoft-com:office|class="?Mso|mso-/i.test(html)) return 'word';
  if (/id="docs-internal-guid|docs-\w+-guid/i.test(html)) return 'gdocs';
  if (/notion-|data-block-id/i.test(html)) return 'notion';
  return 'web';
}

function unwrap(el) { const p = el.parentNode; if (!p) return; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); }
function rename(el, tag) {
  const doc = el.ownerDocument; const n = doc.createElement(tag);
  while (el.firstChild) n.appendChild(el.firstChild);
  for (const a of ['href', 'src', 'alt', 'title', 'width', 'colspan', 'rowspan', 'start', 'type', 'checked']) if (el.hasAttribute?.(a)) n.setAttribute(a, el.getAttribute(a));
  el.parentNode.replaceChild(n, el); return n;
}
const wrapIn = (el, tag) => { const w = el.ownerDocument.createElement(tag); el.parentNode.insertBefore(w, el); w.appendChild(el); return w; };

/* inline styles that carry meaning (Google Docs and Word write formatting as CSS) become tags */
function styleToTags(el) {
  const s = style(el); if (!s || el.closest?.('pre')) return;
  const mono = /courier|consolas|monaco|menlo|monospace|source code|roboto mono/.test(css(el, 'font-family'));
  const wrap = (tag) => { const w = el.ownerDocument.createElement(tag); while (el.firstChild) w.appendChild(el.firstChild); el.appendChild(w); };
  const fw = css(el, 'font-weight'); if (/^(bold|[6-9]00)$/.test(fw) && !/^H[1-6]$/.test(el.parentNode?.nodeName)) wrap('strong');
  if (/italic/.test(css(el, 'font-style'))) wrap('em');
  const deco = css(el, 'text-decoration') + ' ' + css(el, 'text-decoration-line');
  if (/line-through/.test(deco)) wrap('del');
  if (/underline/.test(deco) && !el.closest('a')) wrap('u');
  const va = css(el, 'vertical-align'); if (/super/.test(va)) wrap('sup'); else if (/sub/.test(va)) wrap('sub');
  const bg = css(el, 'background-color') || css(el, 'background') || css(el, 'mso-highlight');
  if (bg && !/^(transparent|none|initial|inherit|white|#fff(fff)?|rgba?\(255,\s*255,\s*255(,\s*1)?\)|rgba\(0,\s*0,\s*0,\s*0\))$/.test(bg) && el.nodeName === 'SPAN' && el.textContent.trim()) wrap('mark');
  if (mono && el.nodeName === 'SPAN' && el.textContent.trim()) wrap('code');
}

/* Word writes lists as paragraphs with mso-list styles and a typed bullet: rebuild real lists */
function wordLists(root) {
  const isItem = (p) => p?.nodeName === 'P' && (/mso-list/.test(style(p)) || /MsoListParagraph/.test(p.className || ''));
  const groups = [];
  for (const p of root.querySelectorAll('p')) { if (!isItem(p)) continue; const g = groups[groups.length - 1]; if (g && g[g.length - 1] === p.previousElementSibling) g.push(p); else groups.push([p]); }
  for (const g of groups) {
    const doc = g[0].ownerDocument; const stack = []; let top = null;
    for (const p of g) {
      const lvl = Math.max(1, +(style(p).match(/level(\d)/)?.[1] || 1));
      const marker = p.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]');
      const mtext = (marker?.textContent || '').replace(/\u00a0/g, ' ').trim();
      const ordered = /^\(?[0-9a-zA-Z]{1,4}[.)]$/.test(mtext);
      marker?.remove();
      while (stack.length > lvl) stack.pop();
      while (stack.length < lvl) {
        const list = doc.createElement(ordered ? 'ol' : 'ul');
        if (!stack.length) top = list;
        else { const host = stack[stack.length - 1]; (host.lastElementChild || host.appendChild(doc.createElement('li'))).appendChild(list); }
        stack.push(list);
      }
      const li = doc.createElement('li'); while (p.firstChild) li.appendChild(p.firstChild);
      li.innerHTML = li.innerHTML.replace(/^(\s|&nbsp;)+/, '');
      stack[stack.length - 1].appendChild(li);
    }
    g[0].parentNode.insertBefore(top, g[0]); g.forEach((p) => p.remove());
  }
}

/* a table becomes a GFM table only when its cells hold inline text: flatten what Word and Docs put inside */
function tidyTables(root) {
  for (const t of root.querySelectorAll('table')) {
    for (const c of t.querySelectorAll('td, th')) {
      for (const inner of [...c.querySelectorAll('ul, ol')]) { inner.replaceWith(...[...inner.children].map((li, i) => { const s = c.ownerDocument.createElement('span'); s.innerHTML = (inner.nodeName === 'OL' ? `${i + 1}. ` : '• ') + li.innerHTML + (i < inner.children.length - 1 ? '<br>' : ''); return s; })); }
      const ps = [...c.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6')];
      const pa = ps[0] && (ps[0].getAttribute('align') || css(ps[0], 'text-align')); if (pa && !c.getAttribute('align')) c.setAttribute('align', pa);
      ps.forEach((p, i) => { if (i < ps.length - 1 && p.textContent.trim()) p.appendChild(c.ownerDocument.createElement('br')); unwrap(p); });
      for (const br of [...c.querySelectorAll('br')]) if (!br.nextSibling || (br.nextSibling.nodeType === 3 && !br.nextSibling.data.trim() && !br.nextSibling.nextSibling)) br.remove();
    }
    const rows = [...t.querySelectorAll('tr')]; if (!rows.length) continue;
    if (!t.querySelector('th')) for (const td of [...rows[0].children]) rename(td, 'th');
    if (!t.querySelector('thead')) { const head = t.ownerDocument.createElement('thead'); const body = rows[0].parentNode; t.insertBefore(head, t.firstChild); head.appendChild(rows[0]); if (body.nodeName === 'TBODY' && !body.children.length) body.remove(); }
    for (const th of t.querySelectorAll('th, td')) { const a = (th.getAttribute('align') || css(th, 'text-align') || '').toLowerCase(); if (/^(left|center|right)$/.test(a)) th.setAttribute('align', a); }
  }
}

/* clean a pasted document in place */
export function cleanHtml(doc, source = 'web') {
  const root = doc.body;
  for (const el of [...root.querySelectorAll('style, script, meta, link, title, noscript, template, iframe, object, embed, form, input:not([type=checkbox]), button, select, textarea, svg, canvas, xml')]) el.remove();
  for (const el of [...root.querySelectorAll('*')]) if (/^(O|W|V|M):/i.test(el.nodeName) || el.nodeName.includes(':')) el.nodeName.toUpperCase() === 'O:P' ? el.remove() : unwrap(el);
  const walker = doc.createTreeWalker(root, 128); const comments = []; while (walker.nextNode()) comments.push(walker.currentNode); comments.forEach((c) => c.remove());
  // Google Docs wraps everything in <b style="font-weight:normal" id="docs-internal-guid-…">
  for (const b of [...root.querySelectorAll('b[id^="docs-internal-guid"], b[style*="font-weight:normal"], b[style*="font-weight: normal"]')]) unwrap(b);
  if (source === 'word') {
    for (const p of [...root.querySelectorAll('p.MsoTitle, p[class*="Title"]')]) rename(p, 'h1');
    for (const p of [...root.querySelectorAll('p[class*="Heading"], p[class*="heading"]')]) { const n = +(p.className.match(/(\d)/)?.[1] || 2); rename(p, `h${Math.min(6, n)}`); }
    for (const p of [...root.querySelectorAll('p.MsoQuote, p.MsoIntenseQuote, p[class*="Quote"]')]) wrapIn(p, 'blockquote');
    wordLists(root);
  }
  // Google Docs checklists
  for (const li of [...root.querySelectorAll('li[role="checkbox"]')]) { const box = doc.createElement('input'); box.setAttribute('type', 'checkbox'); if (li.getAttribute('aria-checked') === 'true') box.setAttribute('checked', ''); li.insertBefore(box, li.firstChild); }
  // Notion and other apps draw checkboxes with divs
  for (const el of [...root.querySelectorAll('.checkbox, [class*="to-do"] .checkbox')]) { const box = doc.createElement('input'); box.setAttribute('type', 'checkbox'); if (/checkbox-on|checked/.test(el.className)) box.setAttribute('checked', ''); el.replaceWith(box); }
  for (const el of [...root.querySelectorAll('[style]')]) styleToTags(el);
  for (const el of [...root.querySelectorAll('font, span:not([data-color]):not([data-bg])')]) unwrap(el);
  for (const a of [...root.querySelectorAll('a')]) { const h = a.getAttribute('href') || ''; if (!h || /^(javascript:|#$)/i.test(h) || /^#_?(Toc|ftn|edn|msocom)/i.test(h)) unwrap(a); }
  for (const li of [...root.querySelectorAll('li')]) { const ps = [...li.children].filter((c) => c.nodeName === 'P' || c.nodeName === 'DIV'); if (ps.length === 1) unwrap(ps[0]); }
  tidyTables(root);
  // remove empty paragraphs Word and Docs use as spacing
  for (const p of [...root.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6')]) if (!p.textContent.replace(/[\s\u00a0]+/g, '') && !p.querySelector('img, input, table, hr')) p.remove();
  for (const el of [...root.querySelectorAll('*')]) for (const a of [...el.attributes]) if (!/^(href|src|alt|title|width|colspan|rowspan|start|type|checked|align|data-color|data-bg|class)$/.test(a.name)) el.removeAttribute(a.name);
  for (const el of [...root.querySelectorAll('[class]')]) { const lang = el.nodeName === 'CODE' && (el.getAttribute('class').match(/language-[\w+#-]+/)?.[0]); if (lang) el.setAttribute('class', lang); else el.removeAttribute('class'); }
  return root;
}

let service = null;
function turndown() {
  if (service) return service;
  const td = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced', fence: '```', emDelimiter: '*', strongDelimiter: '**', linkStyle: 'inlined', br: '\\' });
  td.use(gfm);
  td.addRule('strike', { filter: ['del', 's', 'strike'], replacement: (c) => (c.trim() ? `~~${c}~~` : c) });
  td.addRule('mark', { filter: 'mark', replacement: (c) => (c.trim() ? `==${c}==` : c) });
  td.addRule('keepInline', { filter: ['u', 'sup', 'sub'], replacement: (c, n) => (c.trim() ? `<${n.nodeName.toLowerCase()}>${c}</${n.nodeName.toLowerCase()}>` : c) });
  td.addRule('color', { filter: (n) => n.nodeName === 'SPAN' && (n.hasAttribute('data-color') || n.hasAttribute('data-bg')), replacement: (c, n) => { const a = [n.getAttribute('data-color') && `color=${n.getAttribute('data-color')}`, n.getAttribute('data-bg') && `bg=${n.getAttribute('data-bg')}`].filter(Boolean).join(' '); return c.trim() ? `[${c}]{${a}}` : c; } });
  td.addRule('image', { filter: 'img', replacement: (_, n) => { const src = n.getAttribute('src') || ''; if (!src) return ''; const alt = (n.getAttribute('alt') || '').replace(/[[\]|\n]/g, ' ').trim(); const w = parseInt(n.getAttribute('width') || '', 10); const title = n.getAttribute('title'); return `![${alt}${w > 0 ? `|${w}` : ''}](${src.replace(/ /g, '%20').replace(/\)/g, '%29')}${title ? ` "${title.replace(/"/g, "'")}"` : ''})`; } });
  td.addRule('listItem', {
    filter: 'li',
    replacement(content, node, options) {
      const parent = node.parentNode; let prefix = options.bulletListMarker + ' ';
      if (parent.nodeName === 'OL') { const start = parseInt(parent.getAttribute('start') || '1', 10) || 1; prefix = `${start + [...parent.children].indexOf(node)}. `; }
      content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n' + ' '.repeat(prefix.length));
      return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
    },
  });
  td.addRule('details', { filter: 'details', replacement: (c, n) => { const s = n.querySelector('summary'); const title = s ? td.turndown(s.innerHTML).trim() : 'Details'; const body = c.replace(title, '').trim(); return `\n\n<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>\n\n`; } });
  td.addRule('summary', { filter: 'summary', replacement: () => '' });
  td.addRule('figcaption', { filter: 'figcaption', replacement: () => '' });
  service = td; return td;
}

/* tidy what turndown writes so it reads like hand-written Markdown */
export function tidyMarkdown(md) {
  return md.replace(/\u00a0/g, ' ').replace(/(^|\n)\\(?=\n|$)/g, '$1').replace(/\\+$/, '').replace(/[ \t]+$/gm, '').replace(/\\\n(\s*\n)/g, '\n$1').replace(/\n{3,}/g, '\n\n')
    .replace(/^(\s*[-*]) {2,}/gm, '$1 ').replace(/^(\s*)\* (?=\S)/gm, '$1- ')
    .replace(/\*\*\s*\*\*/g, '').replace(/^(#{1,6}) \*\*(.+)\*\*$/gm, '$1 $2').trim();
}

/* HTML → { markdown, images } where images are the data:/file: sources the caller should store as files */
export function htmlToMarkdown(html, { source = htmlSource(html) } = {}) {
  const doc = new DOMParser().parseFromString(String(html).replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '').replace(/<!\[if !supportLists\]>|<!\[endif\]>/gi, ''), 'text/html');
  const root = cleanHtml(doc, source);
  const images = [...new Set([...root.querySelectorAll('img')].map((i) => i.getAttribute('src') || '').filter((s) => /^(data:image|file:|blob:)/i.test(s)))];
  // figures: keep the caption as the image title so it round-trips
  for (const f of [...root.querySelectorAll('figure')]) { const cap = f.querySelector('figcaption')?.textContent.trim(); const img = f.querySelector('img'); if (img && cap && !img.getAttribute('title')) img.setAttribute('title', cap); }
  const markdown = tidyMarkdown(turndown().turndown(root));
  return { markdown, images, source };
}

/* plain text that is clearly Markdown is parsed as Markdown */
const MD_BLOCK = /^(#{1,6}\s+\S|\s*[-*+]\s+\S|\s*\d+[.)]\s+\S|>\s?|```|~~~|\|.+\||\s*[-*+]\s\[[ xX]\]\s|---\s*$|\$\$|> \[!\w+)/m;
const MD_INLINE = /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|\[\[[^\]\n]+\]\]|`[^`\n]+`|~~[^~\n]+~~|==[^=\n]+==/;
export function looksLikeMarkdown(text) {
  const t = String(text || ''); if (!t.trim() || t.length > 500000) return false;
  if (/\t/.test(t) && t.split('\n').filter((l) => l.includes('\t')).length > 1) return false; // spreadsheet cells
  return MD_BLOCK.test(t) || MD_INLINE.test(t);
}

/* code editors copy HTML that is just coloured monospace text: paste it as a code block */
export function isCodeHtml(html) { return /white-space:\s*pre/i.test(html) && /font-family:[^;"]*(consolas|courier|menlo|monaco|monospace|fira|jetbrains|source code)/i.test(html) && !/<(p|h\d|li|table)\b/i.test(html); }

export const PASTE = new PluginKey('folioPaste');

/* put Markdown at the selection as page content; in Suggesting mode it is marked as an insertion */
export function insertMarkdown(editor, md, toNodes) {
  const view = editor.view; const nodes = toNodes?.(md) || [];
  if (!nodes.length) return false;
  const { schema } = view.state;
  let frag; try { frag = Fragment.fromArray(nodes.map((j) => schema.nodeFromJSON(j))); } catch { return false; }
  const single = frag.childCount === 1 && frag.firstChild.type.name === 'paragraph';
  const tr = view.state.tr;
  const suggest = editor.storage.suggestMode?.on;
  if (suggest && !tr.selection.empty && schema.marks.criticDel) { const { from, to } = tr.selection; tr.addMark(from, to, schema.marks.criticDel.create()); tr.setSelection(tr.selection.constructor.near(tr.doc.resolve(to))); }
  const start = tr.selection.from;
  const sel = tr.selection; const $f = sel.$from;
  // several blocks pasted after a line of text start new blocks; they do not glue onto that line
  let at = null;
  if (!single && sel.empty && $f.parent.isTextblock) {
    const names = []; for (let d = $f.depth; d > 0; d--) names.push([d, $f.node(d).type.name]);
    const inCell = names.some(([, n]) => /^table(Cell|Header)$/.test(n));
    const list = names.filter(([, n]) => /^(bulletList|orderedList|taskList)$/.test(n)).pop();
    if (!inCell) {
      let pos = null;
      if (!$f.parent.content.size) { pos = $f.before(); tr.replaceRange(pos, $f.after(), new Slice(frag, 0, 0)); at = 'replaced'; }
      else if ($f.parentOffset === $f.parent.content.size) { pos = list ? $f.after(list[0]) : $f.after(); tr.insert(pos, frag); at = 'after'; }
      if (at) { tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, pos + frag.size)), -1)); tr.__pasteStart = pos; }
    }
  }
  if (!at) tr.replaceSelection(single ? new Slice(frag, 1, 1) : Slice.maxOpen(frag));
  if (suggest && schema.marks.criticIns) tr.addMark(at ? tr.__pasteStart : start, at ? tr.__pasteStart + frag.size : tr.selection.from, schema.marks.criticIns.create());
  view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta(PASTE, md));
  return true;
}
/* plain text: lines stay lines, blank lines start paragraphs, nothing is read as Markdown */
export function insertPlainText(editor, text) {
  const view = editor.view; const { schema } = view.state;
  if (!text) return false;
  if (view.state.selection.$from.parent.type.spec.code) { view.dispatch(view.state.tr.insertText(text).scrollIntoView()); return true; }
  const paras = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const nodes = paras.map((p) => schema.nodes.paragraph.create(null, p.split('\n').flatMap((l, i) => [...(i ? [schema.nodes.hardBreak.create()] : []), ...(l ? [schema.text(l)] : [])])));
  const frag = Fragment.fromArray(nodes);
  view.dispatch(view.state.tr.replaceSelection(nodes.length === 1 ? new Slice(frag, 1, 1) : Slice.maxOpen(frag)).scrollIntoView());
  return true;
}

/*
 * SmartPaste: HTML from other apps and Markdown-looking text go through the Markdown codec.
 * Options: toNodes(md) → JSON nodes; saveImage(src) → Promise<path|null>; onError(err).
 */
export const SmartPaste = Extension.create({
  name: 'smartPaste',
  addOptions() { return { toNodes: null, saveImage: null, onError: null }; },
  addProseMirrorPlugins() {
    const ext = this; const editor = this.editor;
    const insert = (view, md) => insertMarkdown(editor, md, ext.options.toNodes);
    return [new Plugin({
      key: PASTE,
      props: {
        handlePaste(view, e) {
          const cd = e.clipboardData; if (!cd) return false;
          if ([...(cd.files || [])].some((f) => f.type.startsWith('image/'))) return false;
          const $from = view.state.selection.$from;
          if ($from.parent.type.spec.code || $from.parent.type.name === 'folioRaw') return false;
          const html = cd.getData('text/html'); const text = cd.getData('text/plain');
          if (view.input?.shiftKey) return insertPlainText(editor, text);
          if (html && /data-pm-slice/.test(html)) return false; // copied inside Folio: ProseMirror keeps it exact
          if (text && /\t/.test(text) && text.trim().split('\n').length > 1 && /<table/i.test(html || '')) return false; // spreadsheet cells: the table handles take them
          if (editor.storage.suggestMode?.on && text && !text.includes('\n') && !/<(p|h\d|li|table|img)\b/i.test(html || '')) return false;
          if (html && isCodeHtml(html) && text) return insert(view, '```\n' + text.replace(/\n$/, '') + '\n```');
          if (html && /<[a-z][\s\S]*>/i.test(html)) {
            let res; try { res = htmlToMarkdown(html); } catch (er) { ext.options.onError?.(er); return false; }
            if (!res.markdown.trim()) return false;
            if (!res.images.length || !ext.options.saveImage) return insert(view, res.markdown);
            e.preventDefault();
            (async () => {
              let md = res.markdown;
              for (const src of res.images) {
                let rel = null; try { rel = await ext.options.saveImage(src); } catch (er) { ext.options.onError?.(er); }
                md = md.split(src.replace(/ /g, '%20').replace(/\)/g, '%29')).join(rel ? encodeURI(rel) : '');
              }
              insert(editor.view, md.replace(/!\[[^\]]*\]\(\)/g, ''));
            })();
            return true;
          }
          if (text && looksLikeMarkdown(text)) return insert(view, text.replace(/\r\n?/g, '\n'));
          return false;
        },
      },
    })];
  },
});
