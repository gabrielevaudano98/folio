// Folio pages test: edit a page in the Write view and check on disk that only the edited lines changed.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as D from 'docx';
import mammoth from 'mammoth';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pages-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
// the community template gallery, served from this repository's community/templates on this machine
const galleryDir = new URL('../community/templates/', import.meta.url);
const gallery = http.createServer((req, res) => { try { const f = new URL('.' + decodeURIComponent(req.url.split('?')[0]), galleryDir); if (!f.href.startsWith(galleryDir.href)) throw 0; res.end(fs.readFileSync(f)); } catch { res.statusCode = 404; res.end(); } });
await new Promise((r) => gallery.listen(0, '127.0.0.1', r));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47593, authorName: 'Tester', templateGallery: `http://127.0.0.1:${gallery.address().port}/index.json` }));
const read = (f) => fs.readFileSync(path.join(ws, 'pages', f), 'utf8');
fs.writeFileSync(path.join(ws, 'pages', 'd1.md'), '# Formatting\n\nPlain paragraph here\n');
fs.writeFileSync(path.join(ws, 'pages', 'd3.md'), '# Slash\n\nStart here\n');
fs.copyFileSync(path.join(ws, 'pages', 'structure.md'), path.join(ws, 'pages', 'd4.md'));
fs.writeFileSync(path.join(ws, 'pages', 'd4c.md'), '# Code\n\n```js\nconst answer = 42; // the answer\n```\n');
fs.writeFileSync(path.join(ws, 'pages', 'd4b.md'), '# Media\n\n![Team|400](assets/team.png "Old caption")\n\nAfter.\n');
fs.mkdirSync(path.join(ws, 'pages', 'assets'), { recursive: true });
fs.copyFileSync(new URL('../build/icon.png', import.meta.url), path.join(ws, 'pages', 'assets', 'team.png'));
fs.writeFileSync(path.join(ws, 'pages', 'd2.md'), '# Blocks\n\nFirst paragraph.\n\nSecond paragraph.\n\n- one\n- two\n- three\n\nLast paragraph.\n');
fs.writeFileSync(path.join(ws, 'pages', 'd5.md'), '# Mentions\n\nStart here\n');
fs.writeFileSync(path.join(ws, 'pages', 'Atlas Plan.md'), '# Atlas Plan\n\n## Goals\n\nShip the editor.\n\n## Risks\n\nNone yet.\n');
fs.mkdirSync(path.join(ws, 'People'), { recursive: true }); fs.writeFileSync(path.join(ws, 'People', 'Ada Lovelace.md'), '# Ada Lovelace\n');
fs.writeFileSync(path.join(ws, 'pages', 'd6.md'), '# Table\n\n| Name | Qty |\n| --- | --- |\n| Pear | 3 |\n| Apple | 10 |\n| Fig | 2 |\n\nEnd.\n');
fs.writeFileSync(path.join(ws, 'pages', 'd7.md'), '# Find\n\nalpha beta alpha\n\nAlpha gamma\n\n## Second\n\nPainted **bold** and plain\n\n## Third\n\nLast words\n');
fs.writeFileSync(path.join(ws, 'pages', 'd8.md'), '---\ntitle: Weekly\ntags: [alpha]\ndone: false\n---\n# Weekly\n\nText #beta here.\n');
fs.writeFileSync(path.join(ws, 'pages', 'd9.md'), '# Plan\n\nIntro.\n');
fs.writeFileSync(path.join(ws, 'pages', 'd15.md'), '# History\n\nFirst draft of the text.\n');
fs.writeFileSync(path.join(ws, 'pages', 'd11.md'), '# Paste\n\nStart here\n\n{++new idea++} and {==noted==}{>>Ada, 2026-11-20 14:05: Check<<}\n');
const exportDir = path.join(tmp, 'out'); fs.mkdirSync(exportDir);
const importFile = path.join(tmp, 'Imported doc.docx');
fs.writeFileSync(importFile, await D.Packer.toBuffer(new D.Document({ numbering: { config: [{ reference: 'b', levels: [{ level: 0, format: D.LevelFormat.BULLET, text: '•', alignment: D.AlignmentType.LEFT }] }] }, sections: [{ children: [
  new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('Imported title')] }),
  new D.Paragraph({ children: [new D.TextRun('Plain and '), new D.TextRun({ text: 'strong', bold: true }), new D.TextRun(' words.')] }),
  new D.Paragraph({ numbering: { reference: 'b', level: 0 }, children: [new D.TextRun('First point')] }),
  new D.Paragraph({ numbering: { reference: 'b', level: 0 }, children: [new D.TextRun('Second point')] }),
] }] })));
fs.writeFileSync(path.join(ws, 'pages', 'd10.md'), '# Review\n\nNormal paragraph without marks.\n\nPayment terms {~~60~>30~~} days.\n');
const html = read('html.md'), obs = read('obsidian.md');
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); const p2 = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; })();

const typeAtEnd = (text, add) => `(() => { const p = [...document.querySelectorAll('.rich-prose p, .rich-prose h1')].find((x) => x.textContent === ${JSON.stringify(text)}); if (!p) return false;
  document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand('insertText', false, ${JSON.stringify(add)}); return true; })()`;
// select characters [a, b) of the paragraph or heading whose text starts with `text`
const select = (text, a, b) => `(() => { const el = [...document.querySelectorAll('.rich-prose p, .rich-prose h1')].find((x) => x.textContent.startsWith(${JSON.stringify(text)}));
  document.querySelector('.rich-prose').focus(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  const at = (n) => { for (const t of nodes) { if (n <= t.length) return [t, n]; n -= t.length; } const l = nodes.at(-1); return [l, l.length]; };
  const r = document.createRange(); r.setStart(...at(${a})); r.setEnd(...at(${b})); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })();`;
// type /query on a new line, check the menu opened, press Enter, then type text
const key = (k) => `document.querySelector('.rich-prose').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true }));`;
const slash = (q, text) => [
  { js: `document.execCommand('insertParagraph'); document.execCommand('insertText', false, '/${q}'); true`, wait: 350 },
  { js: `(() => { const n = document.querySelectorAll('.slash-menu .slash-item').length; ${key('Enter')} ${text ? `document.execCommand('insertText', false, ${JSON.stringify(text)});` : ''} return n > 0; })()`, log: true, wait: 400 },
];
// type a trigger ([[ @ # :) on a new line, check the menu offers `needle`, then choose that item as a click would
const pick = (typed, needle, wait = 500) => [
  { js: `document.execCommand('insertParagraph'); document.execCommand('insertText', false, ${JSON.stringify(typed)}); true`, wait },
  { js: `(() => { const it = [...document.querySelectorAll('.slash-menu .slash-item')].find((i) => i.textContent.includes(${JSON.stringify(needle)})); if (!it) return false; it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`, log: true, wait: 700 },
];
const keyDown = (k, mods) => `document.querySelector('.rich-prose').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true, ...${JSON.stringify(mods)} })); true`;
const findEl = (text) => `[...document.querySelectorAll('.rich-prose p, .rich-prose h1, .rich-prose h2, .rich-prose li')].find((x) => x.textContent.startsWith(${JSON.stringify(text)}))`;
const hover = (text) => `(() => { const el = ${findEl(text)}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 20, clientY: r.top + 6 })); return true; })()`;
// drag the block under the handle and drop it just below the element starting with `to`
const drag = (from, to) => `(() => { const dt = new DataTransfer(); const grip = document.querySelector('.block-grip');
  grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const el = ${findEl(to)}; const r = el.getBoundingClientRect(); const x = r.left + 10, y = r.bottom + 6;
  const prose = document.querySelector('.rich-prose');
  prose.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  prose.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); return true; })()`;
const steps = [
  { size: [1400, 900], wait: 1200 },
  { js: "document.querySelector('[data-dir=\"pages\"]').click()", wait: 500 },
  { js: "document.querySelector('[data-file=\"pages/html.md\"]').click()", wait: 900 },
  { js: "document.querySelector('#view-switch [data-view=\"edit\"]').click()", wait: 900 },
  { js: "document.querySelectorAll('.rich-raw').length", log: true, wait: 100 },
  { js: typeAtEnd('Final paragraph.', ' Done'), log: true, wait: 2500 },
  { js: `(() => { const raw = [...document.querySelectorAll('.rich-raw')].find((x) => x.textContent.includes('Centred paragraph')); raw.querySelector('.rich-raw-preview').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const a = raw.querySelector('textarea'); a.value = '<p align="center">Centred text</p>'; a.dispatchEvent(new Event('input', { bubbles: true }));
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; })()`, log: true, wait: 2500 },
  { js: "document.querySelector('[data-file=\"pages/obsidian.md\"]').click()", wait: 1200 },
  { js: typeAtEnd('Research log', ' 2026'), log: true, wait: 2500 },
  { js: "document.querySelectorAll('.rich-folioRaw').length + ':' + document.querySelectorAll('.rich-fn, .rich-math, .rich-blockMath, .rich-fn-def').length", log: true, wait: 100 },
  ...(process.env.DEBUG ? [{ js: "[...document.querySelectorAll('.rich-raw')].map((x) => x.textContent)", log: true, wait: 100 }] : []),
  // D1: format from the ribbon, check the Markdown on disk
  { js: "document.querySelector('[data-file=\"pages/d1.md\"]').click()", wait: 1200 },
  { js: select('Plain paragraph here', 0, 5), wait: 200 },
  { js: "document.querySelector('.ribbon [data-cmd=colour]').click(); document.querySelector('#rb-colours [data-colour=red]').click(); true", log: true, wait: 400 },
  { js: select('Plain paragraph here', 6, 15), wait: 200 },
  { js: "document.querySelector('.ribbon [data-cmd=superscript]').click(); document.querySelector('.ribbon [data-cmd=alignCenter]').click(); true", log: true, wait: 400 },
  { js: select('Plain paragraph here', 20, 20), wait: 200 },
  { js: "document.querySelector('.ribbon [data-cmd=footnote]').click(); document.execCommand('insertText', false, 'Source.'); true", log: true, wait: 400 },
  ...(process.env.DEBUG ? [{ js: "document.querySelector('.rich-prose').innerHTML", log: true, wait: 100 }] : []),
  { js: select('Formatting', 10, 10), wait: 200 },
  { js: "document.querySelector('.ribbon [data-cmd=inlineMath]').click(); true", wait: 400 },
  { js: "(() => { const i = document.querySelector('.rich-math input'); if (!i) return false; i.value = 'x^2'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()", log: true, wait: 2500 },
  // D3: the / menu
  { js: "document.querySelector('[data-file=\"pages/d3.md\"]').click()", wait: 1200 },
  { js: typeAtEnd('Start here', ''), wait: 200 },
  ...slash('h2', 'Section'), ...slash('div', ''), ...slash('3x4', ''),
  { js: "(() => { const p = [...document.querySelectorAll('.rich-prose > p')].at(-1); document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.setStart(p, 0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); })()", wait: 300 },
  { js: `document.execCommand('insertText', false, '/tip'); true`, wait: 350 },
  { js: `(() => { const n = document.querySelectorAll('.slash-menu .slash-item').length; ${key('Enter')} return n > 0; })()`, log: true, wait: 400 },
  { js: "document.execCommand('insertParagraph'); document.execCommand('insertText', false, '/zzz'); true", wait: 300 },
  { js: "!!document.querySelector('.slash-menu .slash-empty') || [document.querySelector('.slash-menu')?.outerHTML?.slice(0, 300), getSelection().anchorNode?.parentElement?.outerHTML?.slice(0, 200)]", log: true, wait: 100 },
  { js: "document.querySelector('.rich-prose').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); !document.querySelector('.slash-menu')", log: true, wait: 2500 },
  // D2: blocks
  { js: "document.querySelector('[data-file=\"pages/d2.md\"]').click()", wait: 1200 },
  { js: hover('First paragraph.'), wait: 300 },
  { js: "document.querySelector('.block-grip').click(); document.querySelector('.block-menu [data-turn=h2]').click(); true", wait: 300 },
  { js: typeAtEnd('Second paragraph.', ''), wait: 200 },
  { js: keyDown('ArrowDown', { ctrlKey: true, shiftKey: true }), wait: 200 },
  { js: typeAtEnd('two', ''), wait: 200 },
  { js: keyDown('d', { ctrlKey: true }), wait: 200 },
  { js: typeAtEnd('Last paragraph.', ''), wait: 200 },
  { js: keyDown('l', { ctrlKey: true, altKey: true }), wait: 300 },
  { js: hover('Last paragraph.', true), wait: 300 },
  { js: "document.querySelector('.block-plus').click(); true", wait: 400 },
  { js: "(() => { const open = !!document.querySelector('.slash-menu .slash-item'); " + key('Escape') + " document.execCommand('delete'); return open; })()", log: true, wait: 300 },
  { js: hover('First paragraph.'), wait: 300 },
  { js: drag('First paragraph.', 'Last paragraph.'), log: true, wait: 2500 },
  // D4: structure
  { js: "document.querySelector('[data-file=\"pages/d4.md\"]').click()", wait: 1200 },
  { js: "(() => { const m = [...document.querySelectorAll('.rich-callout-marker')].find((x) => x.dataset.label === 'Success'); m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return !!document.querySelector('.callout-menu'); })()", log: true, wait: 300 },
  { js: "document.querySelector('.callout-menu [data-kind=warning]').click(); true", wait: 300 },
  { js: "(() => { const n = document.querySelectorAll('.rich-callout.is-folded').length; document.querySelector('.rich-callout-fold[aria-expanded=false]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return n + ':' + document.querySelectorAll('.rich-callout.is-folded').length; })()", log: true, wait: 300 },
  { js: "(() => { const h = [...document.querySelectorAll('.rich-prose h2')].find((x) => x.textContent.includes('Appendix')); h.querySelector('.rich-hfold').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return [...document.querySelectorAll('.rich-prose > p')].filter((p) => p.textContent === 'Last paragraph.' && p.classList.contains('rich-fold-hidden')).length; })()", log: true, wait: 300 },
  { js: "(() => { const h = [...document.querySelectorAll('.rich-prose h2')].find((x) => x.textContent.includes('Appendix')); h.querySelector('.rich-hfold').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()", wait: 200 },
  { js: typeAtEnd('Last paragraph.', ''), wait: 200 },
  ...slash('toggle', 'My toggle'),
  { js: "(() => { const p = [...document.querySelectorAll('.rich-prose > p')].at(-1); document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.setStart(p, 0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()", wait: 300 },
  { js: "document.execCommand('insertText', false, '/columns'); true", wait: 350 },
  { js: `(() => { const n = document.querySelectorAll('.slash-menu .slash-item').length; ${key('Enter')} document.execCommand('insertText', false, 'Column A'); return n > 0; })()`, log: true, wait: 400 },
  { js: 'true', wait: 2500 },
  // D4b: resize an image and edit its caption
  { js: "document.querySelector('[data-file=\"pages/d4b.md\"]').click()", wait: 1500 },
  { js: `(() => { const g = document.querySelector('.rich-img-resize'); const r = g.getBoundingClientRect(); const x = r.left + 4, y = r.top + 10;
    g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y }));
    g.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: x - 150, clientY: y }));
    g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: x - 150, clientY: y })); return true; })()`, log: true, wait: 400 },
  { js: "(() => { const c = document.querySelector('.rich-caption'); c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); const i = c.querySelector('input'); i.value = 'New caption'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()", log: true, wait: 2500 },
  // D4c: syntax colours and the language menu
  { js: "document.querySelector('[data-file=\"pages/d4c.md\"]').click()", wait: 1500 },
  { js: "[document.querySelectorAll('.rich-code .hljs-keyword').length, document.querySelectorAll('.rich-code .hljs-number').length, document.querySelectorAll('.rich-code .hljs-comment').length].join(':')", log: true, wait: 100 },
  { js: "(() => { const s = document.querySelector('.rich-code-lang'); s.value = 'python'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()", log: true, wait: 2500 },
  // D5: [[ @ # : pickers, chips, hover card, daily note
  { js: "document.querySelector('[data-file=\"pages/d5.md\"]').click()", wait: 1500 },
  { js: typeAtEnd('Start here', ''), wait: 200 },
  ...pick('[[atl', 'Atlas Plan'),
  ...pick('@ada', 'Ada Lovelace'),
  ...pick('@tomorrow', 'Tomorrow'),
  ...pick('[[Atlas Plan#Go', 'Goals'),
  ...pick('#design', '#design-system', 900),
  ...pick(':rocket', ':rocket:'),
  ...pick('@done', 'Done'),
  ...pick('[[Brand New Idea', 'Create', 700),
  { js: 'true', wait: 2500 },
  { js: "['.rich-wikilink.is-person', '.rich-wikilink.is-date', '.rich-tag', '.rich-status.is-green'].map((q) => document.querySelectorAll(q).length).join(':')", log: true, wait: 100 },
  { js: "(() => { const el = [...document.querySelectorAll('.rich-wikilink')].find((x) => x.dataset.target === 'Atlas Plan'); el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true; })()", wait: 900 },
  { js: "(() => { const c = document.querySelector('.rich-hover'); return !!c && c.textContent.includes('Atlas Plan'); })()", log: true, wait: 100 },
  { js: "(() => { const el = document.querySelector('.rich-wikilink.is-date'); const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, ctrlKey: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; el.dispatchEvent(new MouseEvent('mousedown', o)); el.dispatchEvent(new MouseEvent('mouseup', o)); return true; })()", wait: 2000 },
  // D6: sort, centre and move a column from the Table tab; paste cells from a spreadsheet
  { js: "document.querySelector('[data-file=\"pages/d6.md\"]').click()", wait: 1500 },
  { js: "(() => { const td = [...document.querySelectorAll('.rich-prose td')].find((c) => c.textContent === '3'); document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.setStart(td.querySelector('p'), 0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()", wait: 300 },
  { js: "(() => { const shown = !document.querySelector('#rb-tab-table').hidden && !document.querySelector('.rb-compact .rb-table').hidden; document.querySelector('.ribbon [data-cmd=sortAsc]').click(); return shown; })()", log: true, wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=cellCenter]').click(); true", wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=colLeft]').click(); true", wait: 300 },
  { js: typeAtEnd('End.', ''), wait: 200 },
  { js: "(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'A\\tB\\n1\\t2\\n'); return !document.querySelector('.rich-prose').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()", log: true, wait: 2500 },
  // D7: find and replace, one undo; format painter; outline drag and demote; ribbon layouts; zoom
  { js: "document.querySelector('[data-file=\"pages/d7.md\"]').click()", wait: 1500 },
  { js: typeAtEnd('alpha beta alpha', ''), wait: 200 },
  { js: "document.querySelector('.ribbon [data-cmd=replace]').click(); const q = document.querySelector('.find-q'); q.value = 'alpha'; q.dispatchEvent(new Event('input')); [document.querySelector('.find-bar').hidden, document.querySelector('.find-replace').hidden, document.querySelectorAll('.rich-prose .find-hit').length, document.querySelector('.find-count').textContent]", log: true, wait: 300 },
  { js: "const r = document.querySelector('.find-r'); r.value = 'omega'; document.querySelector('[data-f=all]').click(); document.querySelector('.rich-prose').textContent", log: true, wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=undo]').click(); document.querySelector('.rich-prose').textContent", log: true, wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=redo]').click(); document.querySelector('[data-f=close]').click(); document.querySelector('.find-bar').hidden", log: true, wait: 300 },
  { js: select('Painted', 10, 10), wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=painter]').click(); document.querySelector('.pane-rich, .ribbon').closest('.pane-rich')?.classList.contains('is-painting') ?? true", log: true, wait: 200 },
  { js: select('Painted', 17, 22), wait: 300 },
  { js: "document.querySelector('.rich-prose').dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); true", wait: 1500 },
  { js: "(() => { const links = [...document.querySelectorAll('#outline-list a')]; const from = links.find((a) => a.textContent === 'Third'), to = links.find((a) => a.textContent === 'Second'); if (!from || !to) return links.map((a) => a.textContent); const dt = new DataTransfer(); from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); const r = to.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5, clientY: r.top + 2 }; to.dispatchEvent(new DragEvent('dragover', o)); to.dispatchEvent(new DragEvent('drop', o)); from.dispatchEvent(new DragEvent('dragend', { bubbles: true })); return true; })()", log: true, wait: 1500 },
  { js: "(() => { const a = [...document.querySelectorAll('#outline-list a')].find((x) => x.textContent === 'Second'); a.focus(); a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, shiftKey: true, bubbles: true, cancelable: true })); return [...document.querySelectorAll('#outline-list a')].map((x) => x.textContent).join('|'); })()", log: true, wait: 1500 },
  { js: "(() => { const r = document.querySelector('.ribbon'); document.querySelector('.rb-compact [data-cmd=ribbonMode]').click(); const full = r.dataset.mode; document.querySelector('#rb-tab-insert').click(); const ins = document.querySelector('#rb-tab-insert').getAttribute('aria-selected'); const vis = !document.querySelector('#rb-panel-insert').hidden && document.querySelector('#rb-panel-home').hidden; return [full, localStorage.getItem('folio.ribbon'), ins, vis]; })()", log: true, wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=zoomIn]').click(); [document.querySelector('.rich-page').style.zoom, document.getElementById('st-zoom-val').textContent, /words/.test(document.getElementById('st-words').textContent)]", log: true, wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=zoomReset]').click(); document.querySelector('.rb-tabs [data-cmd=ribbonMode]').click(); [document.querySelector('.rich-page').style.zoom, document.querySelector('.ribbon').dataset.mode]", log: true, wait: 2500 },
  // D8: properties above the title, tag click, Tags in the sidebar
  { js: "document.querySelector('[data-file=\"pages/d8.md\"]').click()", wait: 1500 },
  { js: "[...document.querySelectorAll('.prop-row')].map((r) => r.dataset.key + ':' + r.dataset.type).join(',')", log: true, wait: 100 },
  { js: "document.querySelector('.prop-row[data-key=done] .prop-check').click(); true", wait: 200 },
  { js: "(() => { const i = document.querySelector('.prop-row[data-key=tags] .prop-add-chip'); i.focus(); i.value = 'gamma'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()", wait: 200 },
  { js: "(() => { document.querySelector('.props-add').click(); const k = document.querySelector('.prop-new-key'); k.value = 'owner'; k.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); const v = document.querySelector('.prop-row[data-key=owner] .prop-input'); v.value = 'Ada'; v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return document.activeElement !== v; })()", log: true, wait: 1500 },
  { js: "(() => { const el = document.querySelector('.rich-tag'); const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, ctrlKey: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; el.dispatchEvent(new MouseEvent('mousedown', o)); el.dispatchEvent(new MouseEvent('mouseup', o)); return el.textContent; })()", log: true, wait: 1200 },
  { js: "[document.getElementById('sidebar-search').value, document.getElementById('results-head').textContent, [...document.querySelectorAll('#results .result-name')].map((x) => x.textContent).join('|')]", log: true, wait: 1500 },
  { js: "[...document.querySelectorAll('#tags-list .tag-item')].map((b) => b.dataset.tag + (b.getAttribute('aria-current') ? '*' : '')).join(',')", log: true, wait: 100 },
  // D9: insert a template (properties merge, caret at {{cursor}}), a template button, today's daily note
  { js: "document.querySelector('[data-file=\"pages/d9.md\"]').click()", wait: 1500 },
  { js: typeAtEnd('Intro.', ''), wait: 200 },
  { js: "document.querySelector('.ribbon [data-cmd=\"app:template\"]').click(); true", wait: 400 },
  { js: "(() => { const s = document.querySelector('.tg-search input'); s.value = 'meeting notes'; s.dispatchEvent(new Event('input', { bubbles: true })); const c = [...document.querySelectorAll('.tg-card')]; const m = c.find((x) => x.querySelector('.tg-card-name').textContent === 'Meeting notes'); m.click(); document.querySelector('[data-act=useHere]').click(); return document.querySelectorAll('.tg-nav-item').length; })()", log: true, wait: 800 },
  { js: "document.execCommand('insertText', false, 'Budget '); true", wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=\"app:template-button\"]').click(); true", wait: 400 },
  { js: "(() => { const m = [...document.querySelectorAll('#sheet-prompt .tpl-card')].find((x) => x.textContent.includes('Decision log')); m.querySelector('input').checked = true; document.querySelector('#sheet-prompt form').requestSubmit(); return true; })()", wait: 800 },
  { js: "(() => { const b = document.querySelector('.rich-prose .template-btn'); if (!b) return false; b.click(); return b.textContent; })()", log: true, wait: 2500 },
  { js: "document.querySelector('.ribbon [data-cmd=\"app:daily-note\"]').click(); true", wait: 2000 },
  // D10: comment on a word, suggest an insertion and a deletion, accept them all
  { js: "document.querySelector('[data-file=\"pages/d10.md\"]').click()", wait: 1500 },
  { js: select('Normal', 0, 6), wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=comment]').click(); true", wait: 400 },
  { js: "(() => { const ta = document.querySelector('.rv-draft textarea'); if (!ta) return false; ta.value = 'Is this the right tone?'; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return !document.querySelector('.review-pane').hidden; })()", log: true, wait: 600 },
  { js: "(() => { const p = [...document.querySelectorAll('.rich-prose p')].find((x) => x.textContent.startsWith('Normal')); document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()", wait: 300 },
  { js: "document.querySelector('.ribbon [data-cmd=suggest]').click(); document.execCommand('insertText', false, ' Really'); true", wait: 300 },
  { js: "(() => { const p = [...document.querySelectorAll('.rich-prose p')].find((x) => x.textContent.startsWith('Normal')); const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n, t; while ((n = w.nextNode())) if (n.textContent.includes('without')) t = n; const r = document.createRange(); r.setStart(t, t.textContent.indexOf('without') + 7); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()", wait: 300 },
  { js: "for (let i = 0; i < 8; i++) document.querySelector('.rich-prose').dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })); [document.querySelectorAll('.rich-prose .critic-ins').length, document.querySelectorAll('.rich-prose .critic-del').length, document.querySelectorAll('.rv-card').length]", log: true, wait: 1500 },
  { js: "(() => { const before = document.querySelector('.rv-count').textContent; document.querySelector('.ribbon [data-cmd=suggest]').click(); document.querySelector('.ribbon [data-cmd=acceptAll]').click(); return before; })()", log: true, wait: 2000 },
  // the template gallery: a collection template for a new page, a favourite, a community download
  { js: "document.querySelector('.ribbon [data-cmd=\"app:template\"]').click(); true", wait: 900 },
  { js: "(() => { [...document.querySelectorAll('.tg-nav-item')].find((b) => b.textContent.includes('Planning')).click(); const c = [...document.querySelectorAll('.tg-card')].find((x) => x.textContent.includes('OKRs')); c.click(); [...document.querySelectorAll('.tg-card')].find((x) => x.textContent.includes('OKRs')).querySelector('.tg-star').click(); return [document.querySelectorAll('.tg-card').length, document.querySelector('.tg-preview h3').textContent]; })()", log: true, wait: 900 },
  { js: "(() => { const i = document.querySelector('.tg-name input'); if (i) i.value = 'Q1 goals'; document.querySelector('[data-act=useNew]').click(); return true; })()", wait: 2000 },
  { js: "document.querySelector('.ribbon [data-cmd=\"app:template\"]').click(); true", wait: 900 },
  { js: "(() => { const favs = [...document.querySelectorAll('.tg-card .tg-card-name')].map((x) => x.textContent).join('|'); [...document.querySelectorAll('.tg-nav-item')].find((b) => b.textContent.includes('Browse online')).click(); return favs; })()", log: true, wait: 2000 },
  { js: "(() => { const c = [...document.querySelectorAll('.tg-card')].find((x) => x.textContent.includes('Lean canvas')); if (!c) return document.querySelector('.tg-main').textContent.slice(0, 200); c.click(); return document.querySelectorAll('.tg-card').length; })()", log: true, wait: 1500 },
  { js: "document.querySelector('[data-act=save]').click(); true", wait: 1500 },
  { js: "[document.querySelector('.tg-nav-item[aria-current]')?.textContent, [...document.querySelectorAll('.tg-card .tg-card-name')].map((x) => x.textContent).join('|')]", log: true, wait: 200 },
  { js: "document.querySelector('[data-act=close]').click(); true", wait: 600 },
  // D11: paste from Word and the web, paste Markdown, export Word, import Word
  { js: "document.querySelector('[data-file=\"pages/d11.md\"]').click()", wait: 1500 },
  { js: "(() => { const p = [...document.querySelectorAll('.rich-prose p')].find((x) => x.textContent === 'Start here'); document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()", wait: 400 },
  { js: "(() => { const dt = new DataTransfer(); dt.setData('text/html', '<html xmlns:o=\"urn:schemas-microsoft-com:office:office\"><body><p class=MsoNormal>Pasted <b>bold</b> <span style=\"background:yellow;mso-highlight:yellow\">marked</span><o:p></o:p></p><p class=MsoListParagraphCxSpFirst style=\"mso-list:l0 level1 lfo1\"><![if !supportLists]><span style=\"mso-list:Ignore\">·<span>&nbsp;</span></span><![endif]>Alpha</p><p class=MsoListParagraphCxSpLast style=\"mso-list:l0 level1 lfo1\"><![if !supportLists]><span style=\"mso-list:Ignore\">·<span>&nbsp;</span></span><![endif]>Beta</p></body></html>'); dt.setData('text/plain', 'Pasted bold marked Alpha Beta'); return !document.querySelector('.rich-prose').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()", log: true, wait: 800 },
  { js: "(() => { const dt = new DataTransfer(); dt.setData('text/plain', '## From text\\n\\n- [ ] x\\n- [ ] y'); return !document.querySelector('.rich-prose').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()", log: true, wait: 1500 },
  { js: "document.querySelector('#btn-more').click(); true", wait: 400 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.startsWith('Export')).click(); true", wait: 600 },
  { js: "(() => { const d = document.querySelector('#sheet-prompt'); d.querySelector('[data-format=docx]').click(); d.querySelector('[data-size=Letter]').click(); d.querySelector('[data-landscape=true]').click(); const rev = !d.querySelector('[data-review]').hidden; d.querySelector('button[type=submit]').click(); return rev; })()", log: true, wait: 3500 },
  { js: "document.querySelector('#btn-more').click(); true", wait: 400 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.startsWith('Import')).click(); true", wait: 3000 },
  // D15: version history — edit, open the history, see the change, restore the first version
  { js: "document.querySelector('[data-file=\\\"pages/d15.md\\\"]').click()", wait: 1500 },
  { js: "(() => { const p = [...document.querySelectorAll('.rich-prose p')].find((x) => x.textContent.startsWith('First draft')); document.querySelector('.rich-prose').focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()", wait: 400 },
  { js: "document.execCommand('insertText', false, ' Second thoughts.'); true", wait: 1800 },
  { js: "document.querySelector('#btn-more').click(); true", wait: 400 },
  { js: "[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent.startsWith('Version history')).click(); true", wait: 1200 },
  { js: "(() => { const h = document.querySelector('#history'); const items = [...h.querySelectorAll('.hv-versions .hv-v')]; items[items.length - 1].click(); return [!h.hidden, items.length]; })()", log: true, wait: 800 },
  { js: "(() => { const h = document.querySelector('#history'); return [h.querySelectorAll('.hv-diff ins').length, h.querySelector('.hv-bar-text').textContent.includes('change'), h.querySelectorAll('[data-put]').length]; })()", log: true, wait: 100 },
  { js: "(async () => { const h = document.querySelector('#history'); h.querySelector('[data-act=name]').click(); await new Promise((r) => setTimeout(r, 400)); const i = document.querySelector('#prompt-input'); i.value = 'First draft'; document.querySelector('.prompt-form').requestSubmit(); await new Promise((r) => setTimeout(r, 700)); return h.querySelector('.hv-v.is-named')?.textContent.includes('First draft') === true; })()", log: true, wait: 300 },
  { js: "document.querySelector('#history [data-act=restore]').click(); true", wait: 1500 },
  { js: "[document.querySelector('#history').hidden, document.querySelector('.rich-prose').textContent.includes('Second thoughts')]", log: true, wait: 100 },
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile, FOLIO_EXPORT_DIR: exportDir, FOLIO_IMPORT_FILE: importFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 200000);
child.on('exit', () => gallery.close());
child.on('exit', async () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\npages'); if (process.env.DEBUG) console.log(logs, out.slice(-3000));
  assert.equal(logs.length, 70, out.slice(-2000));
  const [rawCount, typed, rawEdited, typed2, obsNodes, c1, c2, c3, mathDone, s1, s2, s3, s4, empty, closed, plusOpened, dragged, menuOpen, folds, hiddenBy, t1, t2, resized, captioned, colours, langSet, m1, m2, m3, m4, m5, m6, m7, m8, chips, hovered, tableTab, pasted, findOpen, replaced, undone, closed2, painting, dragged2, outlineAfter, modes, zoomed, zoomBack, propRows, propBlur, tagClicked, tagSearch, tagPane, tplCount, tplButton, paneShown, marks10, counts10, galleryOkrs, favsAndCommunity, communityCount, savedView, pasteWord, pasteMd, exportSheet, histOpen, histDiff, histNamed, histRestored, errors] = logs;
  assert.deepEqual(errors, []);
  assert(rawCount >= 3 && typed && rawEdited && typed2, JSON.stringify(logs)); console.log('  ✓ HTML the editor cannot hold is shown as raw blocks');
  assert.equal(read('html.md'), html.replace('Final paragraph.', 'Final paragraph. Done').replace('Centred paragraph', 'Centred text')); console.log('  ✓ typing in a paragraph and editing a raw block change only those lines');
  assert.equal(read('obsidian.md'), obs.replace('# Research log', '# Research log 2026')); console.log('  ✓ footnotes, maths, callouts and front matter survive an edit byte for byte');
  const [rawObs, drawn] = obsNodes.split(':').map(Number);
  assert.equal(rawObs, 0); assert(drawn >= 5, obsNodes); console.log('  ✓ footnotes and maths are drawn and editable in the Write view');
  assert(c1 && c2 && c3 && mathDone, JSON.stringify(logs));
  assert.equal(read('d1.md'), '# Formatting$x^2$\n\n[Plain]{color=red} <sup>paragraph</sup> here[^1]\n{align=center}\n\n[^1]: Source.\n');
  console.log('  ✓ colour, superscript, centre, footnote and maths from the ribbon write Folio Markdown');
  assert(s1 && s2 && s3 && s4 && empty && closed, JSON.stringify(logs.slice(9)));
  const d3 = read('d3.md');
  assert(d3.startsWith('# Slash\n\nStart here\n\n## Section\n\n---\n\n|'), d3); assert.equal(d3.split('\n').filter((l) => l.startsWith('|')).length, 4);
  assert.equal(d3.split('\n').find((l) => l.startsWith('|')).split('|').length - 2, 4); assert.match(d3, /\n---\n/, d3); assert.match(d3, /\n> \[!tip\]/, d3);
  console.log('  ✓ the / menu turns a line into a heading and inserts a 3 × 4 table, a divider and a callout');
  console.log('  ✓ the / menu shows when nothing matches and closes with Esc');
  const d2 = read('d2.md');
  assert(plusOpened && dragged, JSON.stringify(logs.slice(15)));
  assert.match(d2, /^# Blocks\n\n- one\n- two\n- two\n- three\n\nSecond paragraph\.\n\nLast paragraph\. \^[a-z0-9]{6}\n\n## First paragraph\.\n$/, d2);
  console.log('  ✓ blocks: turn into from the handle menu, move down, duplicate a list item, copy link to block (^id), drag to move');
  const d4 = read('d4.md'), d4src = fs.readFileSync(new URL('./fixture/pages/structure.md', import.meta.url), 'utf8');
  assert(menuOpen && folds === '1:0' && hiddenBy === 1 && t1 && t2, JSON.stringify(logs.slice(17)));
  assert(d4.includes('> [!warning]+ Shipped\n'), d4.slice(0, 600)); assert(d4.includes('> [!faq]- Folded question\n'), 'opening a folded callout does not change the file');
  assert(d4.startsWith(d4src.slice(0, d4src.indexOf('> [!success]'))), 'the blocks before the edit are unchanged');
  assert.match(d4, /Last paragraph\.\n\n<details open>\n<summary>My toggle<\/summary>\n\n[\s\S]*<\/details>\n\n:::: columns\n::: column\nColumn A\n:::\n::: column\n\n:::\n::::\n$/, d4);
  console.log('  ✓ callouts: change the type from the menu; folding callouts and headings does not touch the file');
  console.log('  ✓ /toggle and /columns insert a toggle and two columns');
  assert(resized && captioned); assert.match(read('d4b.md'), /^# Media\n\n!\[Team\|250\]\(assets\/team\.png "New caption"\)\n\nAfter\.\n$/, read('d4b.md'));
  console.log('  ✓ dragging the image handle writes its width (|250) and the caption is edited in place');
  assert.equal(colours, '1:1:1'); assert(langSet); assert.equal(read('d4c.md'), '# Code\n\n```python\nconst answer = 42; // the answer\n```\n');
  console.log('  ✓ code blocks are coloured as in the Read view and the language menu writes the fence language');
  assert([m1, m2, m3, m4, m5, m6, m7, m8].every(Boolean), JSON.stringify([m1, m2, m3, m4, m5, m6, m7, m8]));
  const d5 = read('d5.md');
  assert.equal(d5, `# Mentions\n\nStart here\n\n[[Atlas Plan]]\n\n[[Ada Lovelace]]\n\n[[${tomorrow}]]\n\n[[Atlas Plan#Goals]]\n\n#design-system\n\n🚀\n\n[status:: Done]\n\n[[Brand New Idea]]\n`, d5);
  console.log('  ✓ [[ and @ link a page, a person, tomorrow and a heading; # picks a tag, : an emoji, @done a status chip; the page is written as plain Markdown');
  assert(fs.existsSync(path.join(ws, 'pages', 'Brand New Idea.md'))); assert.equal(fs.readFileSync(path.join(ws, 'pages', 'Brand New Idea.md'), 'utf8'), '# Brand New Idea\n\n');
  console.log('  ✓ “Create” in the [[ menu makes the page next to this one and links it');
  const [people, days, tags, statuses] = chips.split(':').map(Number);
  assert(people >= 1 && days >= 1 && tags >= 1 && statuses >= 1, chips); assert(hovered); console.log('  ✓ people, days, tags and status are drawn as chips, and resting on a link shows a preview');
  assert(fs.existsSync(path.join(ws, 'Journal', `${tomorrow}.md`)), 'daily note'); assert.match(fs.readFileSync(path.join(ws, 'Journal', `${tomorrow}.md`), 'utf8'), /^---\ntags: \[daily\]\n---\n# \w+ \d+ \w+ \d{4}\n[\s\S]*## Focus/);
  console.log('  ✓ opening a day link makes the daily note in Journal/ on first use');
  assert(tableTab && pasted, JSON.stringify([tableTab, pasted]));
  const norm = (t) => t.replace(/ +/g, ' ').replace(/-{3,}/g, '---');
  assert.equal(norm(read('d6.md')), '# Table\n\n| Qty | Name |\n| :---: | --- |\n| 2 | Fig |\n| 3 | Pear |\n| 10 | Apple |\n\nEnd.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', read('d6.md'));
  console.log('  ✓ tables: the Table tab appears in a table; sort by a column (numbers by value), centre it, move it left; cells pasted from a spreadsheet become a table');
  assert.deepEqual(findOpen.slice(0, 3), [false, false, 3], JSON.stringify(findOpen)); assert.match(findOpen[3], / of 3$/);
  assert(replaced.includes('omega beta omega') && replaced.includes('omega gamma'), replaced); assert(undone.includes('alpha beta alpha') && undone.includes('Alpha gamma'), undone); assert(closed2);
  console.log('  ✓ find and replace: matches are highlighted and counted; Replace all is undone with one Undo');
  assert(painting && dragged2 === true, JSON.stringify([painting, dragged2])); assert.equal(outlineAfter, 'Find|Third|Second');
  assert.equal(read('d7.md'), '# Find\n\nomega beta omega\n\nomega gamma\n\n## Third\n\nLast words\n\n### Second\n\nPainted **bold** and **plain**\n', read('d7.md'));
  console.log('  ✓ format painter copies bold to the next selection; dragging a heading in the outline moves its section; Alt+Shift+→ demotes it');
  assert.deepEqual(modes, ['full', 'full', 'true', true]); assert.deepEqual(zoomed, ['1.1', '110%', true]); assert.deepEqual(zoomBack, ['', 'compact']);
  console.log('  ✓ the ribbon switches between one row and Word-style tabs and remembers it; page zoom shows in the status bar');
  assert.equal(propRows, 'title:text,tags:tags,done:checkbox'); assert(propBlur);
  assert.equal(read('d8.md'), '---\ntitle: Weekly\ntags: [alpha, gamma]\ndone: true\nowner: Ada\n---\n# Weekly\n\nText #beta here.\n', read('d8.md'));
  console.log('  ✓ properties: a checkbox, a new tag and a new property each rewrite only their own front matter lines');
  assert.equal(tagClicked, '#beta'); assert.equal(tagSearch[0], '#beta'); assert.match(tagSearch[1], /^1 page tagged #beta/); assert.equal(tagSearch[2], 'd8');
  assert(tagPane.includes('beta*') && tagPane.includes('gamma') && tagPane.includes('alpha'), tagPane);
  console.log('  ✓ Ctrl/⌘ click on a tag lists its pages; the Tags section lists every tag, with the current one marked');
  assert(tplCount >= 10, tplCount); assert.equal(tplButton, 'New decision log');
  const d9 = read('d9.md');
  assert.match(d9, /^---\ntags:\n  - meeting\n  - decision\ndate: \d{4}-\d{2}-\d{2}\nattendees: \[\]\nstatus: Proposed\ndeciders: \[\]\n---\n# Plan\n\nIntro\.\n\n> \[!info\] /, d9);
  assert(d9.includes('## Agenda\n\n1. Budget First topic\n'), d9);
  assert(d9.includes('```template-button\nlabel: New decision log\ntemplate: Decision log\n```\n\n[status:: Proposed]\n\n## Context') && !d9.includes('# d9'), d9);
  assert(d9.includes('| Option | Pros | Cons |') && !d9.includes('⁣') && !d9.includes('{{'), d9);
  console.log('  ✓ templates: a starter goes in with its properties merged and the caret at {{cursor}}; a template button inserts its template below it');
  const today = (() => { const d = new Date(); const p2 = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; })();
  const daily = fs.readFileSync(path.join(ws, 'Journal', `${today}.md`), 'utf8');
  assert(daily.startsWith('---\ntags: [daily]\n---\n# ') && daily.includes('## Focus\n\n- [ ] Top priority'), daily);
  console.log('  ✓ Today opens the daily note, made from the Daily note template');
  assert.equal(paneShown, true); assert.deepEqual(marks10.slice(0, 2), [2, 2]); assert(marks10[2] >= 3, JSON.stringify(marks10)); assert.match(counts10, /^1 comment · 3 suggestions$/);
  assert.equal(read('d10.md'), '# Review\n\n{==Normal==}{>>Tester, ' + read('d10.md').match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)[0] + ': Is this the right tone?<<} paragraph marks. Really\n\nPayment terms 30 days.\n', read('d10.md'));
  console.log('  ✓ comments: select, comment, the thread is saved as CriticMarkup with author and time; Suggesting marks typing and deleting; Accept all applies every suggestion');
  assert.deepEqual(galleryOkrs, [3, 'OKRs']);
  const okrs = read('OKRs.md'); assert(okrs.startsWith('---\ntags: [okr]\nperiod: ""\nowner: ""\n---\n# OKRs\n\n## Objective 1: An inspiring goal\n') && !okrs.includes('template:') && !okrs.includes('⁣'), okrs);
  console.log('  ✓ gallery: a category lists its templates; New page makes a page from the template, named after it, next to the open page');
  assert.equal(favsAndCommunity, 'OKRs'); assert.equal(communityCount, 8);
  const lean = fs.readFileSync(path.join(ws, 'Templates', 'Lean canvas.md'), 'utf8');
  assert(lean.startsWith('---\ntemplate:\n  description: A one-page business model for a new idea\n  category: Strategy\n  icon: 🧩\n  source: "http://127.0.0.1:') && lean.includes('| Problem | Solution |'), lean);
  assert.equal(savedView[0].replace(/\d+$/, ''), 'All of mine'); assert(savedView[1].includes('Lean canvas'), savedView[1]);
  console.log('  ✓ gallery: a starred template opens under Favourites; a community template downloads into Templates/ and shows under My templates');

  assert.deepEqual(histOpen[0], true); assert(histOpen[1] >= 3, JSON.stringify(histOpen));
  assert(histDiff[0] >= 1 && histDiff[1] && histDiff[2] >= 1, JSON.stringify(histDiff)); assert.equal(histNamed, true);
  assert.deepEqual(histRestored, [true, false], JSON.stringify(histRestored));
  assert.equal(read('d15.md'), '# History\n\nFirst draft of the text.\n');
  console.log('  ✓ version history: the edit appears as a version, the diff shows what changed, a version can be named, and restoring it puts the first text back');
  assert.equal(pasteWord, true); assert.equal(pasteMd, true); assert.equal(exportSheet, true);
  const d11 = read('d11.md');
  assert(d11.includes('Start here\n\nPasted **bold** ==marked==\n\n- Alpha\n- Beta\n\n## From text\n\n- [ ] x\n- [ ] y') && !d11.includes('mso') && !d11.includes('<o:p>'), d11);
  console.log('  ✓ paste: Word HTML becomes bold, highlight and a real list; Markdown text becomes headings and a task list; the file is plain Markdown');
  const docxFile = path.join(exportDir, 'd11.docx'); assert(fs.existsSync(docxFile), fs.readdirSync(exportDir).join());
  const docxHtml = (await mammoth.convertToHtml({ path: docxFile })).value;
  assert(docxHtml.includes('<h1>Paste</h1>') && docxHtml.includes('<strong>bold</strong>') && docxHtml.includes('<ul>') && docxHtml.includes('Alpha') && docxHtml.includes('new idea'), docxHtml);
  const docxZip = await (await import('jszip')).default.loadAsync(fs.readFileSync(docxFile)); const docXml = await docxZip.file('word/document.xml').async('string');
  assert(docXml.includes('w:orient="landscape"') && docXml.includes('w:w="15840"') && /<w:ins [^>]*w:author="Tester"/.test(docXml) && (await docxZip.file('word/comments.xml').async('string')).includes('Check'), 'page setup, tracked insertion, comment');
  console.log('  ✓ export: the export sheet makes a Word file with the chosen paper and orientation, real headings and lists, a tracked insertion and a comment');
  const imported = fs.readFileSync(path.join(ws, 'Imported doc.md'), 'utf8');
  assert.equal(imported, '# Imported title\n\nPlain and **strong** words.\n\n- First point\n- Second point\n', imported);
  console.log('  ✓ import: a Word file becomes a page with its headings, bold text and list');
});
