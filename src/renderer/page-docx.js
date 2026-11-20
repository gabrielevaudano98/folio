// Word export: the page's Read-view HTML becomes a .docx with real Word structure.
// Headings, lists, tables, footnotes, a contents field, page breaks and images map to Word's own;
// CriticMarkup suggestions become tracked changes and comments become Word comments with replies.
import * as D from 'docx';

/* page setup shared by PDF and Word export */
export const PAGE_SIZES = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6], A5: [148, 210] }; // millimetres, portrait
export const MARGINS = { normal: [1, 1, 1, 1], narrow: [0.5, 0.5, 0.5, 0.5], wide: [1, 2, 1, 2] }; // inches: top, right, bottom, left
export function pageSetup(p = {}) {
  return {
    size: PAGE_SIZES[p.size] ? p.size : 'A4',
    landscape: !!p.landscape,
    margins: MARGINS[p.margins] ? p.margins : 'normal',
    pageNumbers: p.pageNumbers !== false,
    header: !!p.header,
  };
}
/* the options Electron's printToPDF takes for a page setup */
export function pdfOptions(p, title = '') {
  const s = pageSetup(p); const [w, h] = PAGE_SIZES[s.size]; const [top, right, bottom, left] = MARGINS[s.margins];
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const box = (inner, align) => `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:8px;color:#888;width:100%;padding:0 ${Math.round(left * 72)}px 0 ${Math.round(left * 72)}px;text-align:${align}">${inner}</div>`;
  return {
    printBackground: true,
    pageSize: { width: w / 25.4, height: h / 25.4 },
    landscape: s.landscape,
    margins: { marginType: 'custom', top, right, bottom, left },
    displayHeaderFooter: s.pageNumbers || s.header,
    headerTemplate: s.header ? box(esc(title), 'right') : '<span></span>',
    footerTemplate: s.pageNumbers ? box('<span class="pageNumber"></span> / <span class="totalPages"></span>', 'center') : '<span></span>',
  };
}
/* a print stylesheet for the same setup when the page is printed or exported from HTML */
export function pageCss(p) {
  const s = pageSetup(p); const [top, right, bottom, left] = MARGINS[s.margins];
  return `@page{size:${s.size} ${s.landscape ? 'landscape' : 'portrait'};margin:${top}in ${right}in ${bottom}in ${left}in}`;
}

const twip = (inch) => Math.round(inch * 1440);
const mm = (v) => Math.round((v / 25.4) * 1440);
const COLOR = { gray: '787774', brown: '9F6B53', orange: 'D9730D', yellow: 'CB912F', green: '448361', blue: '337EA9', purple: '9065B0', pink: 'C14C8A', red: 'D44C47' };
const FILL = { gray: 'F1F1EF', brown: 'F4EEEE', orange: 'FBECDD', yellow: 'FBF3DB', green: 'EDF3EC', blue: 'E7F3F8', purple: 'F6F3F9', pink: 'FAF1F5', red: 'FDEBEC' };
const CALLOUT = { note: 'blue', info: 'blue', todo: 'blue', abstract: 'blue', tip: 'green', success: 'green', question: 'yellow', warning: 'orange', caution: 'orange', important: 'purple', failure: 'red', danger: 'red', bug: 'red', example: 'purple', quote: 'gray' };
const SKIP = /^(SCRIPT|STYLE|TEMPLATE|BUTTON|DT|DD|DL|HEAD|META|LINK|NOSCRIPT)$/;
const INLINE = /^(#text|A|ABBR|B|BDI|BDO|BR|CITE|CODE|DATA|DEL|DFN|EM|I|IMG|INPUT|INS|KBD|LABEL|MARK|Q|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|VAR|WBR|STRIKE|FONT|MATH)$/;

function parseStamp(s) { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null; }
const initials = (name) => (name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || undefined;
const alignOf = (el) => {
  const a = (el.getAttribute?.('data-align') || el.getAttribute?.('align') || (el.getAttribute?.('style') || '').match(/text-align:\s*(\w+)/)?.[1] || '').toLowerCase();
  return { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED }[a];
};
const has = (el, c) => !!el.classList?.contains(c);

/*
 * toDocx(root, opts) → Uint8Array
 * root: an element holding the Read-view HTML. opts: { title, author, props, page, loadImage(src) → {data, type, width, height}|null,
 * rasterize(el) → {data, type, width, height}|null for drawn diagrams and charts, reviewMarks (default true) }
 */
export async function toDocx(root, opts = {}) {
  const page = pageSetup(opts.page);
  const [pw, ph] = PAGE_SIZES[page.size]; const [mt, mr, mb, ml] = MARGINS[page.margins];
  const contentTwip = (page.landscape ? mm(ph) : mm(pw)) - twip(ml) - twip(mr);
  const maxPx = Math.floor(contentTwip / 15);
  const author = opts.author || 'Folio';
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const ctx = { rev: 1, cid: 0, comments: [], footnotes: {}, fn: new Map(), images: new Map(), drawn: new Map(), used: new WeakSet(), lists: 0, toc: false };

  // images and drawings load first so the walk below stays synchronous
  const load = async (src) => { if (ctx.images.has(src)) return; let img = null; try { img = await opts.loadImage?.(src); } catch { img = null; } ctx.images.set(src, img); };
  await Promise.all([...root.querySelectorAll('img')].map((i) => load(i.getAttribute('src') || '')));
  for (const el of root.querySelectorAll('.mermaid, .chart-block')) { let r = null; try { r = await opts.rasterize?.(el); } catch { r = null; } if (r) ctx.drawn.set(el, r); }

  // footnotes: Markdown-it puts them in a section at the end; Word keeps them on the page
  const fnItems = [...root.querySelectorAll('section.footnotes li[id]')];
  fnItems.forEach((li, i) => ctx.fn.set(li.id, i + 1));
  /* ---------- inline: DOM → tokens → runs ---------- */
  function inline(node, fmt, out) { for (const n of [...node.childNodes]) one(n, fmt, out); return out; }
  function one(n, fmt, out) {
    do {
      if (n.nodeType === 3) { out.push({ t: 'text', text: fmt.pre ? n.data : n.data.replace(/\s+/g, ' '), fmt }); continue; }
      if (n.nodeType !== 1 || SKIP.test(n.nodeName) || ctx.used.has(n)) continue;
      const tag = n.nodeName;
      if (tag === 'BR') { out.push({ t: 'br', fmt }); continue; }
      if (has(n, 'katex')) { const tex = (n.querySelector('annotation')?.textContent || n.textContent).trim(); out.push({ t: 'text', text: tex, fmt: { ...fmt, math: true } }); continue; }
      if (has(n, 'katex-display')) { inline(n, fmt, out); continue; }
      if (has(n, 'footnote-ref')) { const id = (n.querySelector('a')?.getAttribute('href') || '').slice(1); const num = ctx.fn.get(id); if (num) out.push({ t: 'fn', n: num }); continue; }
      if (has(n, 'footnote-backref')) continue;
      if (tag === 'INPUT' && n.getAttribute('type') === 'checkbox') { out.push({ t: 'text', text: n.hasAttribute('checked') ? '☒ ' : '☐ ', fmt }); continue; }
      if (tag === 'IMG') { out.push({ t: 'img', src: n.getAttribute('src') || '', alt: n.getAttribute('alt') || '', width: parseInt((n.getAttribute('style') || '').match(/width:\s*(\d+)px/)?.[1] || n.getAttribute('width') || '', 10) || 0 }); continue; }
      if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IFRAME') { const src = n.getAttribute('src') || n.querySelector('source')?.getAttribute('src') || ''; out.push({ t: 'text', text: `[${tag.toLowerCase()}: ${src.split('/').pop()}]`, fmt: { ...fmt, italics: true } }); continue; }
      if (opts.reviewMarks !== false && (has(n, 'critic-hl') || has(n, 'critic-comment'))) { comment(n, fmt, out); continue; }
      if (opts.reviewMarks === false && has(n, 'critic-comment')) continue;
      if (tag === 'INS' && has(n, 'critic-ins')) { inline(n, opts.reviewMarks === false ? fmt : { ...fmt, ins: true }, out); continue; }
      if (tag === 'DEL' && has(n, 'critic-del')) { if (opts.reviewMarks !== false) inline(n, { ...fmt, del: true }, out); continue; }
      const f = { ...fmt };
      if (tag === 'STRONG' || tag === 'B') f.bold = true;
      else if (tag === 'EM' || tag === 'I' || tag === 'CITE' || tag === 'DFN' || tag === 'VAR') f.italics = true;
      else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') f.strike = true;
      else if (tag === 'U' || tag === 'INS') f.underline = true;
      else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') f.code = true;
      else if (tag === 'SUP') f.superScript = true;
      else if (tag === 'SUB') f.subScript = true;
      else if (tag === 'MARK') f.fill = FILL.yellow;
      else if (tag === 'SMALL') f.small = true;
      if (n.getAttribute('data-color') && COLOR[n.getAttribute('data-color')]) f.color = COLOR[n.getAttribute('data-color')];
      if (n.getAttribute('data-bg') && FILL[n.getAttribute('data-bg')]) f.fill = FILL[n.getAttribute('data-bg')];
      if (has(n, 'md-tag')) f.color = COLOR.blue;
      if (tag === 'A') {
        const href = n.getAttribute('href') || '';
        if (/^(https?:|mailto:|tel:)/i.test(href)) { const kids = []; inline(n, { ...f, link: true }, kids); out.push({ t: 'link', href, kids }); continue; }
        f.link = true; // wiki links and anchors: styled like links, nowhere to go in Word
      }
      inline(n, f, out);
    } while (false);
    return out;
  }
  // {==text==}{>>comment<<}{>>reply<<}: a Word comment on the range, the replies threaded under it
  function comment(n, fmt, out) {
    const marks = [];
    let range = null;
    if (has(n, 'critic-hl')) { range = n; for (let s = n.nextSibling; s; s = s.nextSibling) { if (s.nodeType === 3 && !s.data.trim()) continue; if (s.nodeType === 1 && has(s, 'critic-comment')) { marks.push(s); ctx.used.add(s); continue; } break; } }
    else { marks.push(n); for (let s = n.nextSibling; s; s = s.nextSibling) { if (s.nodeType === 3 && !s.data.trim()) continue; if (s.nodeType === 1 && has(s, 'critic-comment')) { marks.push(s); ctx.used.add(s); continue; } break; } }
    if (!marks.length) { inline(range, fmt, out); return; }
    const ids = marks.map((m, i) => {
      const id = ctx.cid++; const who = m.getAttribute('data-author') || author;
      const text = m.getAttribute('data-text') ?? (m.getAttribute('data-tip') || '');
      ctx.comments.push({ id, author: who, initials: initials(who), date: parseStamp(m.getAttribute('data-date')) || new Date(), children: text.split('\n').map((l) => new D.Paragraph({ children: [new D.TextRun(l)] })), ...(i ? { parentId: ctx.cid - 1 - i } : {}) });
      return id;
    });
    ids.forEach((id) => out.push({ t: 'cstart', id }));
    if (range) inline(range, fmt, out);
    ids.forEach((id) => { out.push({ t: 'cend', id }); out.push({ t: 'cref', id }); });
  }
  const runOpts = (text, f) => ({
    text, bold: f.bold, italics: f.italics || f.math, strike: f.strike, superScript: f.superScript, subScript: f.subScript,
    underline: f.underline || f.link ? {} : undefined, color: f.link ? '0563C1' : f.color, font: f.code || f.pre ? 'Consolas' : f.math ? 'Cambria Math' : undefined,
    size: f.code || f.pre ? 19 : f.small ? 18 : undefined, shading: f.fill || f.code ? { type: D.ShadingType.CLEAR, color: 'auto', fill: f.fill || 'F2F2F0' } : undefined,
  });
  const run = (text, f) => {
    if (f.ins) return new D.InsertedTextRun({ ...runOpts(text, f), id: ctx.rev++, author, date: now });
    if (f.del) return new D.DeletedTextRun({ ...runOpts(text, f), id: ctx.rev++, author, date: now });
    return new D.TextRun(runOpts(text, f));
  };
  function image(tk) {
    const img = ctx.images.get(tk.src);
    if (!img || !img.data) return new D.TextRun({ text: `[${tk.alt || 'image'}]`, italics: true });
    let w = tk.width || img.width || 400; let h = img.width && img.height ? Math.round((w * img.height) / img.width) : img.height || 300;
    if (w > maxPx) { h = Math.round((h * maxPx) / w); w = maxPx; }
    return new D.ImageRun({ type: img.type === 'jpeg' ? 'jpg' : img.type || 'png', data: img.data, transformation: { width: w, height: h }, altText: tk.alt ? { name: tk.alt, description: tk.alt, title: tk.alt } : undefined });
  }
  function runs(tokens) {
    // collapse whitespace across token boundaries and trim the ends, as a browser would
    const tk = tokens.filter((t) => t.t !== 'text' || t.text !== '');
    if (!tk.some((t) => t.fmt?.pre)) {
      let prevSpace = true;
      for (const t of tk) { if (t.t === 'text') { if (prevSpace) t.text = t.text.replace(/^ /, ''); if (t.text) prevSpace = t.text.endsWith(' '); } else if (t.t === 'br') prevSpace = true; else if (t.t === 'link') { for (const k of t.kids) if (k.t === 'text') { if (prevSpace) k.text = k.text.replace(/^ /, ''); if (k.text) prevSpace = k.text.endsWith(' '); } } else prevSpace = false; }
      for (let i = tk.length - 1; i >= 0; i--) { const t = tk[i]; if (t.t === 'text') { t.text = t.text.replace(/ $/, ''); if (t.text) break; } else if (t.t !== 'cend' && t.t !== 'cref') break; }
    }
    const out = [];
    for (const t of tk) {
      if (t.t === 'text') { if (t.text) out.push(run(t.text, t.fmt)); }
      else if (t.t === 'br') out.push(new D.TextRun({ break: 1 }));
      else if (t.t === 'img') out.push(image(t));
      else if (t.t === 'fn') out.push(new D.FootnoteReferenceRun(t.n));
      else if (t.t === 'cstart') out.push(new D.CommentRangeStart(t.id));
      else if (t.t === 'cend') out.push(new D.CommentRangeEnd(t.id));
      else if (t.t === 'cref') out.push(new D.TextRun({ children: [new D.CommentReference(t.id)] }));
      else if (t.t === 'link') { const kids = runs(t.kids); if (kids.length) out.push(new D.ExternalHyperlink({ link: t.href, children: kids })); }
    }
    return out;
  }
  const para = (tokens, b, extra = {}) => new D.Paragraph({
    children: runs(tokens || []),
    alignment: extra.alignment ?? b.align,
    indent: b.indent ? { left: b.indent } : undefined,
    shading: b.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: b.fill } : undefined,
    border: b.bar ? { left: { style: D.BorderStyle.SINGLE, size: 18, color: b.bar, space: 8 } } : undefined,
    ...extra,
  });

  /* ---------- blocks ---------- */
  function blocks(node, c, b) {
    const out = []; let loose = [];
    const flush = () => { if (loose.some((t) => t.t !== 'text' || t.text.trim())) out.push(para(loose, b)); loose = []; };
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { if (n.data.trim()) loose.push({ t: 'text', text: n.data.replace(/\s+/g, ' '), fmt: {} }); continue; }
      if (n.nodeType !== 1 || SKIP.test(n.nodeName)) continue;
      const tag = n.nodeName;
      if (INLINE.test(tag) && !has(n, 'katex-display') && !(tag === 'SPAN' && n.querySelector('p, div, ul, ol, table'))) { one(n, {}, loose); continue; }
      flush();
      block(n, b, out);
    }
    flush();
    return out;
  }
  function block(n, b, out) {
    const tag = n.nodeName;
    if (/^H[1-6]$/.test(tag)) { out.push(para(inline(n, {}, []), b, { heading: D.HeadingLevel[`HEADING_${tag[1]}`], alignment: alignOf(n) ?? b.align })); return; }
    if (has(n, 'katex-display') || (tag === 'P' && n.querySelector(':scope > .katex-display'))) { out.push(para(one(n, {}, []), b, { alignment: D.AlignmentType.CENTER })); return; }
    if (tag === 'P') { out.push(para(inline(n, {}, []), b, { alignment: alignOf(n) ?? b.align })); return; }
    if (tag === 'UL' || tag === 'OL') { list(n, b, 0, out); return; }
    if (tag === 'PRE') { code(n.textContent.replace(/\n$/, ''), b, out); return; }
    if (tag === 'HR') { if (!has(n, 'footnotes-sep')) out.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'C8C8C4', space: 1 } }, children: [] })); return; }
    if (tag === 'TABLE') { out.push(table(n, b)); out.push(new D.Paragraph({ children: [], spacing: { after: 60 } })); return; }
    if (tag === 'SECTION' && has(n, 'footnotes')) return;
    if (tag === 'NAV' && has(n, 'md-toc')) { ctx.toc = true; out.push(new D.TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' })); return; }
    if (tag === 'NAV') return;
    if (has(n, 'page-break')) { out.push(new D.Paragraph({ children: [new D.PageBreak()] })); return; }
    if (ctx.drawn.has(n)) { const d = ctx.drawn.get(n); ctx.images.set(n, d); out.push(para([{ t: 'img', src: n, alt: 'diagram', width: Math.min(d.width || maxPx, maxPx) }], b, { alignment: D.AlignmentType.CENTER })); return; }
    if (has(n, 'mermaid')) { code(n.querySelector('.mermaid-src')?.textContent || n.textContent, b, out); return; }
    if (tag === 'FIGURE') {
      const imgs = [...n.querySelectorAll('img')]; const cap = n.querySelector('figcaption');
      for (const i of imgs) out.push(para(one(i, {}, []), b, { alignment: D.AlignmentType.CENTER }));
      if (!imgs.length) blocks(n, ctx, b).forEach((x) => out.push(x));
      if (cap) out.push(para(inline(cap, { italics: true, small: true }, []), b, { alignment: D.AlignmentType.CENTER }));
      return;
    }
    const callout = has(n, 'callout') && (tag === 'BLOCKQUOTE' || tag === 'DETAILS');
    if (callout || tag === 'BLOCKQUOTE' || tag === 'DETAILS') {
      const cls = [...(n.classList || [])];
      const type = cls.find((c) => c.startsWith('callout-') && !c.startsWith('callout-c-') && c !== 'callout-title')?.slice(8);
      const tone = cls.find((c) => c.startsWith('callout-c-'))?.slice(10) || CALLOUT[type] || 'blue';
      const inner = callout ? { ...b, fill: FILL[tone] || FILL.blue, bar: COLOR[tone] || COLOR.blue } : tag === 'BLOCKQUOTE' ? { ...b, indent: (b.indent || 0) + 360, bar: 'C8C8C4' } : b;
      const title = n.querySelector(':scope > .callout-title, :scope > summary');
      if (title) out.push(para(inline(title, { bold: true }, []), inner));
      const holder = n.ownerDocument.createElement('div');
      for (const c of n.childNodes) if (c !== title) holder.appendChild(c.cloneNode(true));
      blocks(holder, ctx, inner).forEach((x) => out.push(x));
      return;
    }
    if (has(n, 'md-columns')) {
      const cols = [...n.children].filter((c) => has(c, 'md-column'));
      if (cols.length) {
        const none = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        const w = Math.floor(contentTwip / cols.length);
        out.push(new D.Table({
          width: { size: contentTwip, type: D.WidthType.DXA }, columnWidths: cols.map(() => w),
          borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
          rows: [new D.TableRow({ children: cols.map((c) => new D.TableCell({ width: { size: w, type: D.WidthType.DXA }, margins: { left: 80, right: 80 }, children: nonEmpty(blocks(c, ctx, b)) })) })],
        }));
        return;
      }
    }
    if (tag === 'IMG') { out.push(para(one(n, {}, []), b)); return; }
    // anything else (div, section, article, a card): walk inside it
    blocks(n, ctx, { ...b, align: alignOf(n) ?? b.align }).forEach((x) => out.push(x));
  }
  const nonEmpty = (kids) => (kids.length ? kids : [new D.Paragraph('')]);
  function code(text, b, out) {
    const lines = text.split('\n');
    lines.forEach((l, i) => out.push(new D.Paragraph({
      children: [new D.TextRun({ text: l || ' ', font: 'Consolas', size: 19 })],
      shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F5F5F3' }, indent: b.indent ? { left: b.indent } : undefined,
      spacing: { before: i ? 0 : 60, after: i === lines.length - 1 ? 120 : 0, line: 264 }, keepLines: true, keepNext: i < lines.length - 1,
    })));
  }
  function list(el, b, level, out) {
    const ordered = el.nodeName === 'OL'; const instance = ++ctx.lists;
    const tasks = has(el, 'contains-task-list');
    for (const li of el.children) {
      if (li.nodeName !== 'LI') continue;
      const head = []; const rest = [];
      for (const k of li.childNodes) { if (k.nodeType === 1 && !INLINE.test(k.nodeName)) rest.push(k); else if (!rest.length) head.push(k); else rest.push(k); }
      // a loose item: its first paragraph is the item's own line
      if (!head.some((k) => (k.textContent || '').trim()) && rest[0]?.nodeName === 'P') head.push(...rest.shift().childNodes);
      const tokens = []; for (const k of head) one(k, {}, tokens);
      const numbering = tasks || has(li, 'task-list-item') ? undefined : { reference: ordered ? 'folio-numbers' : 'folio-bullets', level: Math.min(level, 8), instance: ordered ? instance : 0 };
      out.push(para(tokens, b, numbering ? { numbering } : { indent: { left: (b.indent || 0) + 360 * (level + 1) } }));
      for (const k of rest) {
        if (k.nodeType !== 1) continue;
        if (k.nodeName === 'UL' || k.nodeName === 'OL') list(k, b, level + 1, out);
        else { const sub = []; block(k, { ...b, indent: (b.indent || 0) + 720 * (level + 1) }, sub); out.push(...sub); }
      }
    }
  }
  function table(el, b) {
    const rows = [...el.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr, :scope > tfoot > tr')];
    const cols = Math.max(1, ...rows.map((r) => [...r.children].reduce((s, c) => s + (+c.getAttribute('colspan') || 1), 0)));
    const w = Math.floor((contentTwip - (b.indent || 0)) / cols);
    const line = { style: D.BorderStyle.SINGLE, size: 4, color: 'D9D9D6' };
    return new D.Table({
      width: { size: w * cols, type: D.WidthType.DXA }, columnWidths: Array(cols).fill(w), indent: b.indent ? { size: b.indent, type: D.WidthType.DXA } : undefined,
      borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
      rows: rows.map((r) => {
        const head = (r.parentNode.nodeName === 'THEAD' && r === rows[0]) || [...r.children].every((c) => c.nodeName === 'TH');
        return new D.TableRow({
          tableHeader: head,
          children: [...r.children].map((c) => new D.TableCell({
            columnSpan: +c.getAttribute('colspan') || undefined,
            width: { size: w * (+c.getAttribute('colspan') || 1), type: D.WidthType.DXA },
            shading: head ? { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F3F3F1' } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [para(inline(c, head ? { bold: true } : {}, []), {}, { alignment: alignOf(c), spacing: { after: 0 } })],
          })),
        });
      }),
    });
  }

  for (const li of fnItems) {
    li.querySelectorAll('.footnote-backref').forEach((a) => a.remove());
    const n = ctx.fn.get(li.id);
    const kids = blocks(li, ctx, {});
    ctx.footnotes[n] = { children: kids.filter((k) => k instanceof D.Paragraph).length ? kids.filter((k) => k instanceof D.Paragraph) : [new D.Paragraph('')] };
  }

  const body = blocks(root, ctx, {});
  const level = (i, fmt, text) => ({ level: i, format: fmt, text, alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (i + 1) + 360 * i, hanging: 360 } } } });
  const bullets = ['•', '◦', '▪'];
  const numFmt = [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN];
  const props = opts.props || {};
  const keywords = Array.isArray(props.tags) ? props.tags.join(', ') : props.tags || '';
  const header = page.header ? { default: new D.Header({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ text: opts.title || '', color: '888888', size: 16 })] })] }) } : undefined;
  const footer = page.pageNumbers ? { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: [D.PageNumber.CURRENT, ' / ', D.PageNumber.TOTAL_PAGES], color: '888888', size: 16 })] })] }) } : undefined;
  const doc = new D.Document({
    creator: props.author || author, lastModifiedBy: author, title: props.title || opts.title || '', description: props.description || '', subject: props.subject || '', keywords,
    features: ctx.toc ? { updateFields: true } : undefined,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } } },
    numbering: { config: [
      { reference: 'folio-bullets', levels: Array.from({ length: 9 }, (_, i) => level(i, D.LevelFormat.BULLET, bullets[i % 3])) },
      { reference: 'folio-numbers', levels: Array.from({ length: 9 }, (_, i) => level(i, numFmt[i % 3], `%${i + 1}.`)) },
    ] },
    footnotes: ctx.footnotes,
    comments: { children: ctx.comments },
    sections: [{
      properties: { page: { size: { width: mm(pw), height: mm(ph), orientation: page.landscape ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: twip(mt), right: twip(mr), bottom: twip(mb), left: twip(ml) } } },
      headers: header, footers: footer,
      children: body.length ? body : [new D.Paragraph('')],
    }],
  });
  if (typeof Buffer !== 'undefined' && typeof window === 'undefined') return new Uint8Array(await D.Packer.toBuffer(doc));
  return new Uint8Array(await D.Packer.toArrayBuffer(doc));
}
