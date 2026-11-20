// Folio pages test: edit a page in the Write view and check on disk that only the edited lines changed.
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import electron from 'electron';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pages-'));
const ws = path.join(tmp, 'ws'), ud = path.join(tmp, 'ud');
fs.cpSync(new URL('./fixture', import.meta.url), ws, { recursive: true }); fs.mkdirSync(ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ workspace: ws, openTabs: [], mcpPort: 47593 }));
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
  { js: 'window.__folioErrors || []', log: true, wait: 100 },
];
const stepsFile = path.join(tmp, 'steps.json'); fs.writeFileSync(stepsFile, JSON.stringify(steps));
const child = spawn(electron, ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: { ...process.env, FOLIO_USER_DATA: ud, FOLIO_SHOT: stepsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), 90000);
child.on('exit', () => {
  clearTimeout(timer);
  const logs = out.split('\n').filter((l) => l.startsWith('js ')).map((l) => JSON.parse(l.slice(3)));
  console.log('\npages'); if (process.env.DEBUG) console.log(logs, out.slice(-3000));
  assert.equal(logs.length, 37, out.slice(-2000));
  const [rawCount, typed, rawEdited, typed2, obsNodes, c1, c2, c3, mathDone, s1, s2, s3, s4, empty, closed, plusOpened, dragged, menuOpen, folds, hiddenBy, t1, t2, resized, captioned, colours, langSet, m1, m2, m3, m4, m5, m6, m7, m8, chips, hovered, errors] = logs;
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
  assert(fs.existsSync(path.join(ws, 'Journal', `${tomorrow}.md`)), 'daily note'); assert.match(fs.readFileSync(path.join(ws, 'Journal', `${tomorrow}.md`), 'utf8'), /^# \w+,? \d+ \w+ \d{4}\n\n$/);
  console.log('  ✓ opening a day link makes the daily note in Journal/ on first use');
});
