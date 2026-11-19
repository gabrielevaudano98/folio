// Folio format tests: round-trips must be lossless, formulas and charts must compute.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBoard, serializeBoard, splitBoardDoc, joinBoardDoc, applyEdgeStyle, autoLayout } from '../src/renderer/board-core.js';
import { parseWorkbook, serializeWorkbook, evaluator, shiftFormula } from '../src/renderer/sheet-core.js';
import { findRefs, resolveTarget, rewriteRefs } from '../src/renderer/refs-syntax.js';
import { resolveRef } from '../src/renderer/refs.js';
import { parseDeck, splitSlides, joinDeck, setDirective, setNotes, parseFrontmatter } from '../src/renderer/slides-core.js';
import { scanObjects, extractObjects, setObjectAttrs, setMany, removeObject, addObject, nextId, geometry, alignPatches, distributePatches, zPatches, retarget, nextGroup, locked, groupOf, setObjectBody, inlineSafe, textStyle, linePoints, linePath, parseFill, fillCss, fillSvg, adjustCss, frameCss, safeColor, replaceImageSrc, pathBlock, polygonsBlock, simplify, pointsPath, parsePoints } from '../src/renderer/slides-objects.js';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { pageExtensions } from '../src/renderer/page-schema.js';
import { portableMarkdown } from '../src/renderer/page-syntax.js';
import { headings } from '../src/renderer/markdown.js';
import { INSERTS, CATEGORIES, filterInserts } from '../src/renderer/inserts.js';
import { Window } from 'happy-dom';
import { createPageCodec, splitBlocks } from '../src/renderer/page-core.js';
import { parseChartSpec, toSeries, sheetRange, chartSvg } from '../src/renderer/chart.js';

const fx = (f) => fs.readFileSync(new URL(`../test/fixture/${f}`, new URL('../', import.meta.url)), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
console.log('\nformats');

// board
const boardText = fx('System.board.md');
const parts = splitBoardDoc(boardText);
const model = parseBoard(parts.code); model.edges.forEach(applyEdgeStyle);
assert.equal(joinBoardDoc(parts, serializeBoard(model)), boardText); ok('board-md round-trip is byte-identical');
assert.equal(model.edges.find((e) => e.op === '..|>').line, 'dashed'); ok('board-md realization is dashed with a hollow triangle');
assert.equal(model.nodes.find((n) => n.id === 'Order').body.length, 5); ok('board-md class bodies keep members');
const auto = parseBoard('a -> b\nb -> c'); autoLayout(auto); assert(auto.nodes.every((x) => x.x != null)); ok('board-md auto layout places implicit nodes');

// sheet
const sheetText = fx('Budget.sheet.md');
const wb = parseWorkbook(sheetText);
assert.equal(serializeWorkbook(wb), sheetText); ok('sheet-md untouched workbook is byte-identical');
const wb2 = parseWorkbook(sheetText); wb2.filter((b) => b.type === 'sheet')[1].rows[1][1] = '475';
const out2 = serializeWorkbook(wb2);
assert(out2.includes(sheetText.split('## Rates')[0].trim())); assert(out2.includes('475')); ok('editing one sheet leaves the other sheets as written');
assert.equal(serializeWorkbook(parseWorkbook(out2)), out2); ok('sheet-md serialization is stable');
const ev = evaluator(wb.filter((b) => b.type === 'sheet')[0]);
assert.equal(ev.value(5, 7), 28050); assert.equal(ev.value(6, 7), 'Over budget'); ok('sheet-md formulas compute (SUM, IF, absolute refs)');
const rates = evaluator(wb.filter((b) => b.type === 'sheet')[1]); assert.equal(rates.value(1, 2), 600); ok('sheet-md VLOOKUP');
assert.equal(shiftFormula('=SUM(A1:B2)+$C$3', 2, 1), '=SUM(B3:C4)+$C$3'); ok('formula references shift, locked ones stay');
const cyc = evaluator({ rows: [['=B1', '=A1']] }); assert.equal(cyc.value(0, 0), '#CYCLE!'); ok('circular references are caught');

// slides
const deckText = fx('Pitch.slides.md');
const deck = parseDeck(deckText);
assert(deck.slides.length >= 7); assert.equal(deck.slides[0].layout, 'title'); ok('slides-md parses slides and layouts');
assert.equal(deck.slides[3].layout, 'image-right'); ok('layout directives do not leak to the next slide');
const fm = parseFrontmatter(deckText);
assert.equal(joinDeck(fm.raw, splitSlides(fm.body)), deckText); ok('slides-md split and join are byte-identical');
assert.match(setDirective('## A', 'layout', 'quote'), /<!-- layout: quote -->/); assert.match(setNotes('## A\n', 'Say hi'), /<!--\nSay hi\n-->/); ok('directives and notes are written as Marp comments');
assert.match(deck.slides[1].notes, /problem/); ok('HTML comments become speaker notes');

// placed objects (slides-md v2)
const last = deck.slides[deck.slides.length - 1];
assert.equal(last.objects.length, 3); assert.deepEqual(last.objects.map((o) => o.kind), ['box', 'shape', 'image']); ok('slides-md finds boxes, shapes and positioned images, ignoring code fences');
assert.deepEqual(last.objects.map((o) => o.id), ['claim', 'dot', null]); assert.equal(geometry(last.objects[0]).w, 520); ok('objects keep ids and geometry');
assert.match(last.objects[0].body, /::: note/); assert.doesNotMatch(last.content, /Placed text/); assert.match(last.content, /Placed objects/); ok('nested containers stay in the box and flow text excludes objects');
const moved = setObjectAttrs(last.src, 'claim', { x: 100, y: 210.5 });
const before = last.src.split('\n'), after = moved.split('\n');
assert.equal(after.length, before.length); assert.equal(after.filter((l, i) => l !== before[i]).length, 1); assert.match(moved, /::: box #claim x=100 y=210.5 w=520 h=240 fill=#f2f2f2 radius=12/); ok('moving an object rewrites only its opener line');
assert.equal(setObjectAttrs(last.src, 'claim', { x: 80 }), last.src); ok('setting an unchanged value is a no-op');
assert.match(setObjectAttrs(last.src, 2, { w: 300, rotate: 15 }), /\{x=960 y=200 w=300 h=240 crop=0,0,1,.8 rotate=15\}/); ok('images take geometry in curly braces, new attributes append');
assert.doesNotMatch(setObjectAttrs(last.src, 'dot', { fill: null }), /fill=#111/); ok('null removes an attribute');
assert.equal(scanObjects(removeObject(last.src, 'dot')).length, 2); assert.equal(scanObjects(addObject(last.src, `::: box #${nextId(last.src)} x=0 y=0\nHi\n:::`)).length, 4); ok('objects can be added and removed');
assert.equal(setMany(last.src, [['claim', { x: 1 }], ['dot', { x: 2 }]]).split('\n').filter((l, i) => l !== before[i]).length, 2); ok('a group move changes one line per object');
const chunks = splitSlides(fm.body); chunks[chunks.length - 1] = setObjectAttrs(chunks[chunks.length - 1], 'claim', { x: 100 });
const edited = joinDeck(fm.raw, chunks); assert.equal(edited.split('\n').length, deckText.split('\n').length); assert.equal(deckText.split('\n').filter((l, i) => l !== edited.split('\n')[i]).length, 1); ok('an edit in a slide leaves every other slide byte-identical');

// arrange
const A = scanObjects('::: box #a x=10 y=10 w=100 h=50\n:::\n\n::: box #b x=300 y=80 w=200 h=50 z=2\n:::\n\n::: box #c x=700 y=30 w=100 h=100 lock=true group=g1\n:::\n');
assert.deepEqual(alignPatches(A, [0, 1], 'left', { width: 1280, height: 720 }), [[1, { x: 10 }]]); assert.deepEqual(alignPatches(A, [0], 'center', { width: 1280, height: 720 }), [[0, { x: 590 }]]); ok('align to the selection, or to the slide for one object');
const D = distributePatches(A, [0, 1, 2], 'h'); assert.deepEqual(D, [[1, { x: 305 }]]); assert.deepEqual(distributePatches(A, [0, 1], 'h'), []); ok('distribute spreads three or more objects evenly');
assert.deepEqual(zPatches(A, [0], 'front'), [[0, { z: 3 }]]); assert.deepEqual(zPatches(A, [1], 'back'), [[1, { z: -1 }]]); ok('stacking order writes z');
assert(locked(A[2])); assert.equal(groupOf(A[2]), 'g1'); assert.equal(nextGroup(A), 'group-1'); ok('lock and group are plain attributes');
assert.equal(retarget('::: box #a x=10 y=10 w=100 h=50\nHi\n:::', '::: box #a x=0 y=0\n:::'), '::: box #box-1 x=34 y=34 w=100 h=50\nHi\n:::'.replace('#box-1', '#' + nextId('::: box #a x=0 y=0\n:::'))); ok('pasting offsets the copy and gives it a new id');

// text in boxes
assert(inlineSafe('### Title\n- one\n- two\n\n**bold** and *italic* and [a link](https://x.y)')); assert(!inlineSafe('text\n::: note\nx\n:::')); assert(!inlineSafe('![i](a.png)')); assert(!inlineSafe('```js\nx\n```')); assert(!inlineSafe('<b>x</b>')); ok('inline text editing refuses bodies it could not round-trip');
const T = '::: box #a x=1 y=1 w=100 h=50\nOld\n:::\n\n::: box #b x=2 y=2 w=100 h=50\nKeep\n:::\n';
const T2 = setObjectBody(T, 'a', '## New\n- a\n- b'); assert.equal(scanObjects(T2).length, 2); assert.equal(scanObjects(T2)[1].body, 'Keep'); assert.equal(scanObjects(T2)[0].body, '## New\n- a\n- b'); ok('writing a box body leaves the other objects alone');
assert.deepEqual(textStyle({ font: 'serif', size: '40', align: 'center', line: '1.4', valign: 'middle' }), ['font-family:Georgia, "Times New Roman", serif', 'font-size:40px', 'text-align:center', 'line-height:1.4', 'justify-content:center']); ok('text attributes become CSS');

// board ports on the source side
{ const bm = parseBoard('a: rect @0,0\nb: rect @200,0\na.right -> b.left'); assert.equal(bm.nodes.length, 2); assert.equal(bm.edges[0].from, 'a'); assert.equal(bm.edges[0].fromPort, 'right'); ok('a port on the source of an edge is not read as a new node'); }

// references between documents
const files = ['Roadmap.md', 'Budget.sheet.md', 'Pitch.slides.md', 'System.board.md', 'Projects/Meeting notes.md', 'Projects/Pricing ideas.md'];
const roadmap = fx('Roadmap.md');
const R = findRefs(roadmap); assert.deepEqual(R.filter((r) => r.kind === 'value').map((r) => r.target + '#' + r.part), ['Budget.sheet#Costs!H6', 'Budget.sheet#Costs!H7', 'Pitch.slides#1']);
assert.equal(R.filter((r) => r.kind === 'embed').length, 3); assert.equal(findRefs('`{{X#1}}`\n```\n[[Y]]\n```').length, 0); ok('references are found outside code');
assert.equal(resolveTarget('Budget.sheet', files), 'Budget.sheet.md'); assert.equal(resolveTarget('Budget', files), 'Budget.sheet.md'); assert.equal(resolveTarget('Pricing ideas', files, 'Projects/Meeting notes.md'), 'Projects/Pricing ideas.md'); assert.equal(resolveTarget('/Budget.sheet.md', files), 'Budget.sheet.md'); assert.equal(resolveTarget('Nope', files), null); ok('targets resolve by name, type, path and folder');
const env = { files, from: 'Roadmap.md', read: async (p) => fx(p) };
const total = await resolveRef('Budget.sheet#Costs!H6', env); assert.equal(total.kind, 'sheet'); assert.match(total.value, /28[.,\s]?050/);
assert.equal((await resolveRef('Budget.sheet#Costs!H7', env)).value, 'Over budget'); assert.match((await resolveRef('Budget.sheet#Costs!A1:H5', env)).html, /<table class="ref-table">.*Engineering/); ok('sheet references give formatted cell values and range tables');
assert.equal((await resolveRef('Pitch.slides#1', env)).value, 'Folio'); assert.match((await resolveRef('System.board', env)).html, /<svg class="ref-board"/); assert.match((await resolveRef('System.board#api', env)).value, /Orders API/); ok('slide titles and boards resolve');
assert.match((await resolveRef('Roadmap#Linked results', env)).value, /Linked results/); await assert.rejects(resolveRef('Budget.sheet#Nope!A1', env), /no sheet named Nope/); await assert.rejects(resolveRef('Missing#x', env), /not found/); ok('page sections resolve and errors explain what is missing');
const meeting = fx('Projects/Meeting notes.md');
const movedRefs = rewriteRefs(meeting, 'Projects/Meeting notes.md', 'Budget.sheet.md', 'Finance/Plan 2027.sheet.md', files);
assert.match(movedRefs, /\[\[Plan 2027\.sheet#Costs!H6\|the total\]\]/); assert.match(movedRefs, /\{\{\/Finance\/Plan 2027\.sheet\.md#Costs!H6\}\}/);
assert.equal(movedRefs.split('\n').filter((l, i) => l !== meeting.split('\n')[i]).length, 1); ok('renaming a document rewrites only the references to it, in the style they were written');
{
  const { loadExternals } = await import('../src/renderer/refs.js');
  const { formulaRefs, evaluator: ev2, parseWorkbook: pw } = await import('../src/renderer/sheet-core.js');
  const calc = '## Plan\n\n| A | B |\n| --- | --- |\n| Budget | ={{Budget.sheet#Costs!H6}} |\n| Double | =B2*2 |\n| Q1 sum | =SUM({{Budget.sheet#Costs!D2:D5}}) |\n| Missing | ={{Nope#A1}} |\n';
  assert.deepEqual(formulaRefs(calc), ['Budget.sheet#Costs!H6', 'Budget.sheet#Costs!D2:D5', 'Nope#A1']);
  const ext = await loadExternals(calc, { files, from: 'Calc.sheet.md', read: async (p) => fx(p), seen: ['Calc.sheet.md'] });
  const e2 = ev2(pw(calc).find((b) => b.type === 'sheet'), { external: ext });
  assert.equal(e2.value(1, 1), 28050); assert.equal(e2.value(2, 1), 56100); assert.equal(e2.value(3, 1), 6690); assert.equal(e2.value(4, 1), '#REF!');
  ok('sheet formulas can use values and ranges from other documents');
  const loop = { 'A.sheet.md': '## S\n\n| x |\n| --- |\n| ={{B.sheet#S!A2}} |\n', 'B.sheet.md': '## S\n\n| x |\n| --- |\n| ={{A.sheet#S!A2}} |\n' };
  const extA = await loadExternals(loop['A.sheet.md'], { files: Object.keys(loop), from: 'A.sheet.md', read: async (p) => loop[p], seen: ['A.sheet.md'] });
  assert.equal(ev2(pw(loop['A.sheet.md']).find((b) => b.type === 'sheet'), { external: extA }).value(1, 0), '#REF!'); ok('a reference loop between sheets is reported, not followed forever');
}

// inserted objects: lines, connectors, icons, media
{
  const ins = deck.slides.find((x) => x.title === 'Inserted objects');
  assert.deepEqual(ins.objects.map((o) => o.kind), ['shape', 'shape', 'line', 'line', 'icon', 'media']); ok('lines, icons and media are placed objects');
  const byId = Object.fromEntries(ins.objects.filter((o) => o.id && o.kind !== 'line').map((o) => [o.id, geometry(o)]));
  assert.deepEqual(linePoints(ins.objects[2], byId), [[360, 320], [760, 360]]); ok('a connector runs between the facing sides of its two objects');
  assert.deepEqual(linePoints(ins.objects[3], byId), [[120, 560], [520, 560]]); assert.equal(linePath([[0, 0], [10, 10]], 'elbow'), 'M0,0 L5,0 L5,10 L10,10'); ok('free lines use x y w h, elbow routes bend once');
  const moved = setObjectAttrs(ins.src, 'a', { y: 100 }); const d2 = parseDeck(joinDeck(fm.raw, [moved]));
  const s2 = d2.slides[0]; const by2 = Object.fromEntries(s2.objects.filter((o) => o.id && o.kind !== 'line').map((o) => [o.id, geometry(o)]));
  assert.deepEqual(linePoints(s2.objects[2], by2)[0], [360, 160]); assert.equal(moved.split('\n').filter((l, i) => l !== ins.src.split('\n')[i]).length, 1); ok('moving an object moves its connector without rewriting the connector');
}

// format (P6)
assert.equal(fillCss('#f2f2f2'), '#f2f2f2'); assert.equal(fillCss('linear(#111,#888,45)'), 'linear-gradient(45deg, #111, #888)'); assert.equal(fillCss('radial(#fff,#000)'), 'radial-gradient(circle, #fff, #000)');
assert.equal(fillCss('red;background:url(x)'), null); assert.equal(safeColor('expression(alert(1))'), null); ok('fills accept colours and gradients and refuse anything else');
assert.match(fillSvg('linear(#111,#888,90)', 'g1').defs, /<linearGradient id="g1" x1="0" y1="0.5" x2="1" y2="0.5">/); assert.equal(fillSvg('linear(#111,#888,90)', 'g1').fill, 'url(#g1)'); ok('shapes get SVG gradients');
assert.deepEqual(adjustCss('brightness:1.2,grayscale:1,blur:3,evil:9,contrast:99'), ['brightness(1.2)', 'grayscale(1)', 'blur(3px)', 'contrast(3)']); ok('picture adjustments are clamped and filtered');
assert.deepEqual(frameCss({ kind: 'box', attrs: { shadow: 'soft', border: '2', stroke: '#333', dash: 'true' } }), ['filter:drop-shadow(0 6px 18px rgba(0,0,0,.18))', 'border:2px dashed #333']); assert.deepEqual(frameCss({ kind: 'image', attrs: { mask: 'circle' } }), ['clip-path:circle(50% at 50% 50%)']); ok('shadows, borders and picture masks');
assert.equal(replaceImageSrc('![Cover](assets/a.png "t"){x=1 y=2 w=3 h=4}', 0, 'assets/b.png'), '![Cover](assets/b.png "t"){x=1 y=2 w=3 h=4}'); ok('replacing a picture keeps its alt text, title and geometry');
{
  const blk = pathBlock('p1', [[100, 100], [300, 100], [200, 300]], ' closed=true'); assert.equal(blk, '::: path #p1 x=100 y=100 w=200 h=200 points="0,0 1,0 0.5,1" closed=true :::');
  const [o] = scanObjects(blk); assert.equal(o.kind, 'path'); assert.deepEqual(parsePoints(o.attrs.points), [[0, 0], [1, 0], [0.5, 1]]); ok('free shapes store points relative to their box');
  assert.equal(pointsPath([[0, 0], [1, 0], [0.5, 1]], true, false), 'M0,0 L1,0 L0.5,1 Z'); assert.match(pointsPath([[0, 0], [1, 0], [0.5, 1]], true, true), /^M0,0 C/); ok('points become straight or smooth paths');
  assert.equal(simplify([[0, 0], [1, 0.1], [2, 0], [3, 0.1], [10, 0]], 1).length, 2); assert(simplify(Array.from({ length: 41 }, (_, i) => [Math.sin((i / 40) * 2 * Math.PI) * 60, Math.cos((i / 40) * 2 * Math.PI) * 60]), 2.5).length >= 6); ok('drawn strokes are simplified, closed loops keep their shape');
  assert.equal(polygonsBlock('m', [[[[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]]]]), '::: path #m x=0 y=0 w=100 h=50 d="M0,0L1,0L1,1L0,1L0,0Z" :::'); ok('merged outlines become an even-odd path');
}

// themes, masters and templates (P7)
{
  const { parseDeck: pd, setGlobal: sg, SIZES: SZ } = await import('../src/renderer/slides-core.js');
  const brand = fx('Brand.slides.md'), report = fx('Report.slides.md');
  const r0 = pd(report); assert.equal(r0.masters.length, 1); assert.equal(r0.shown.length, 2); assert.deepEqual(r0.slides.map((x) => x.number), [null, 1, 2]); ok('master slides are not numbered or shown');
  const r = pd(report, { template: brand });
  assert.equal(r.theme, 'paper'); assert.equal(r.global.accent, '#0a5c36'); assert.equal(r.global['heading-font'], 'Georgia'); assert.equal(r.global.title, 'Quarterly report'); ok('a template deck gives its theme and tokens, the deck keeps its own title');
  assert.deepEqual(r.masters.map((m) => [m.master, !!m.fromTemplate]), [['all', true], ['title', false]]); ok('masters come from the template and from the deck');
  assert.equal(r.slides[1].layout, 'title'); assert.deepEqual(SZ['1:1'], [1080, 1080]); assert.deepEqual(pd('---\nsize: 9:16\n---\n\n# x').width, 720); ok('slide sizes include square, portrait and A4');
  assert.equal(sg('---\nmarp: true\naccent: #111\n---\n', 'accent', null), '---\nmarp: true\n---\n'); assert.equal(sg('---\nmarp: true\n---\n', 'heading-font', 'Georgia'), '---\nmarp: true\nheading-font: Georgia\n---\n'); ok('front matter keys are set and removed');
}

// slide management (P8)
{
  const { parseDeck: pd, setFlag, addComment, removeComment, sectionsOf } = await import('../src/renderer/slides-core.js');
  const { checkDeck, contrast } = await import('../src/renderer/slides-a11y.js');
  const t = '---\nmarp: true\n---\n\n<!-- section: Intro -->\n# Hello\n\n---\n\n<!-- hidden -->\n## Secret\n\n<!-- comment (Ana, 2026-11-19): Tighten this -->\n\n---\n\n<!-- section: Results -->\n## Numbers\n\n<!--\nSpeaker note\n-->\n';
  const d = pd(t);
  assert.deepEqual(d.slides.map((x) => [x.hidden, x.section]), [[false, 'Intro'], [true, null], [false, 'Results']]); assert.deepEqual(d.shown.map((x) => x.index), [0, 2]); assert.deepEqual(d.slides.map((x) => x.number), [1, 2, 3]); ok('hidden slides keep their number and are left out of the show');
  assert.deepEqual(sectionsOf(d).map((x) => [x.name, x.slides]), [['Intro', [0, 1]], ['Results', [2]]]); ok('sections run until the next section');
  assert.deepEqual(d.slides[1].comments.map((c) => [c.author, c.date, c.text]), [['Ana', '2026-11-19', 'Tighten this']]); assert.equal(d.slides[1].notes, ''); assert.equal(d.slides[2].notes, 'Speaker note'); ok('comments are not speaker notes');
  const c1 = addComment('## X\n', { author: 'Bo', date: '2026-11-20', text: 'Line one\nline --> two' }); assert.equal(c1, '## X\n\n<!-- comment (Bo, 2026-11-20): Line one line —> two -->\n');
  assert.equal(removeComment(c1, 0), '## X\n'); assert.equal(setFlag('## X\n', 'hidden', true), '<!-- hidden -->\n## X\n'); assert.equal(setFlag('<!-- hidden -->\n## X\n', 'hidden', false), '## X\n'); ok('comments and flags are added and removed as single lines');
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21); assert(contrast('#777777', '#ffffff') < 4.5);
  const bad = pd('---\nmarp: true\nink: "#aaaaaa"\n---\n\nNo title here\n\n![](a.png)\n\n::: box #tiny x=0 y=0 w=100 h=40 size=12 color=#cccccc fill=#ffffff\nhello\n:::\n\n---\n\n## Same\n\n---\n\n## Same\n');
  const kinds = checkDeck(bad).map((x) => x.kind).sort(); assert.deepEqual(kinds, ['alt', 'contrast', 'contrast', 'contrast', 'contrast', 'duplicate', 'duplicate', 'size', 'title']);
  ok('the accessibility checker finds missing titles, picture descriptions, low contrast, tiny text and duplicate titles');
}

// pages: lossless Markdown in the page editor (with a DOM, as in the app: TipTap reads inline HTML only when it has one)
{
  const win = new Window(); win.document.write('<!DOCTYPE html><html><body></body></html>');
  Object.assign(globalThis, { window: win, document: win.document, DOMParser: win.DOMParser });
  const ext = pageExtensions(); const schema = getSchema(ext);
  const codec = createPageCodec(new MarkdownManager({ extensions: ext, markedOptions: { gfm: true } }));
  const open = (text) => { const m = codec.load(text); const doc = schema.nodeFromJSON(m.json); assert(codec.bind(m, doc)); return { m, doc, kids: Array.from({ length: doc.childCount }, (_, i) => doc.child(i)) }; };
  const withKids = (kids) => schema.node('doc', null, kids);
  const para = (t) => schema.node('paragraph', null, t ? [schema.text(t)] : []);
  const corpus = fs.readdirSync(new URL('../test/fixture/pages/', new URL('../', import.meta.url))).filter((f) => f.endsWith('.md'));
  assert(corpus.length >= 6);
  for (const f of corpus) {
    const text = fx('pages/' + f);
    const { m, doc, kids } = open(text);
    assert.equal(codec.save(m, doc), text, `${f}: opening and saving changes nothing`);
    // edit each rich paragraph in turn: only its own text may change
    m.blocks.forEach((b, k) => {
      if (b.raw || b.count !== 1 || kids[m.first[k]].type.name !== 'paragraph') return;
      const next = kids.slice(); next[m.first[k]] = para('Edited.');
      const head = text.slice(0, text.indexOf(b.src)), tail = text.slice(text.indexOf(b.src) + b.src.length);
      assert.equal(codec.save(m, withKids(next)), head + 'Edited.' + tail, `${f}: editing block ${k} touches only that block`);
    });
  }
  ok(`page corpus (${corpus.length} files): opening is byte-identical, editing a paragraph rewrites only that paragraph`);

  const obs = open(fx('pages/obsidian.md'));
  assert(!obs.m.blocks.some((b) => b.raw)); ok('an Obsidian page (footnotes, maths, callouts, comments) is fully editable');
  const html = open(fx('pages/html.md')).m.blocks.filter((b) => b.raw).map((b) => b.src);
  assert(!html.some((s) => s.startsWith('<details>')) && html.some((s) => s.startsWith('<!--')) && html.some((s) => s.includes('<kbd>')));
  ok('HTML the editor cannot hold becomes raw blocks instead of being rewritten; <details> is a toggle');
  const st = open(fx('pages/structure.md'));
  assert(!st.m.blocks.some((b) => b.raw), st.m.blocks.filter((b) => b.raw).map((b) => b.src).join('|'));
  const kinds = new Set(); st.doc.descendants((n) => { kinds.add(n.type.name + (n.attrs?.heading ? n.attrs.heading : '')); });
  for (const k of ['breadcrumb', 'toc', 'blockquote', 'details', 'details2', 'columns', 'column', 'pageBreak']) assert(kinds.has(k), k);
  ok('toggles, toggle headings, columns, contents, breadcrumb, page breaks and callouts are editable blocks');
  { const { parseCallout, calloutMarker } = await import('../src/renderer/callouts.js');
    assert.deepEqual(['faq', 'tldr', 'error', 'cite', 'weird'].map((k) => parseCallout(`[!${k}] x`).type), ['question', 'abstract', 'danger', 'quote', 'note']);
    const c = parseCallout('[!callout|💡 yellow]- Read me'); assert.deepEqual([c.emoji, c.color, c.fold, c.title, c.label], ['💡', 'yellow', '-', 'Read me', 'Callout']);
    assert.equal(calloutMarker({ kind: 'tip', emoji: '🚀', color: 'green', fold: '+' }), '[!tip|🚀 green]+'); ok('callouts: Obsidian types and aliases, Notion icon and colour, fold'); }
  { const { markdownIt } = await import('../src/renderer/markdown.js');
    const h = markdownIt.render(fx('pages/structure.md'));
    assert.match(h, /<details class="callout callout-question callout-c-orange">/); assert.match(h, /<details class="callout callout-success callout-c-green" open>/);
    assert.match(h, /class="md-columns"[\s\S]*class="md-column"/); assert.match(h, /class="md-toc"[\s\S]*href="#appendix"/); assert.match(h, /class="md-breadcrumb"/); assert.match(h, /class="page-break"/);
    assert.match(h, /callout-emoji[^>]*>💡/); ok('the Read view draws callouts (folded as details), columns, contents with links, breadcrumb and page breaks'); }

  const g = open(fx('pages/gfm.md')); const gt = fx('pages/gfm.md');
  const li = g.m.blocks.findIndex((b) => b.src.startsWith('* Star'));
  const list = g.kids[g.m.first[li]];
  const longer = list.copy(list.content.addToEnd(schema.node('listItem', null, [para('Added')])));
  const out = codec.save(g.m, withKids(g.kids.map((n, i) => (i === g.m.first[li] ? longer : n))));
  assert.match(out, /^\* Last\n\* Added$/m); assert(out.includes('1) Parenthesis numbering')); ok('a rewritten list keeps the author\'s bullet marker');

  const ins = codec.save(g.m, withKids([...g.kids.slice(0, 2), para('New paragraph'), ...g.kids.slice(2)]));
  const firstTwo = g.m.blocks[0].src + g.m.blocks[0].sep + g.m.blocks[1].src;
  assert(ins.startsWith(firstTwo + '\n\nNew paragraph\n\n' + g.m.blocks[2].src)); assert(ins.endsWith(gt.slice(gt.indexOf(g.m.blocks[2].src)))); ok('inserting a paragraph adds lines and leaves the rest as written');

  const del = codec.save(g.m, withKids(g.kids.filter((_, i) => i !== g.m.first[1])));
  assert(!del.includes('A first paragraph')); assert(del.includes(g.m.blocks[2].src) && del.startsWith(g.m.blocks[0].src)); ok('deleting a block removes only that block');

  const hp = open(fx('pages/html.md')); const r = hp.kids.findIndex((n) => n.type.name === 'folioRaw' && n.attrs.source.startsWith('<p align'));
  const edRaw = codec.save(hp.m, withKids(hp.kids.map((n, i) => (i === r ? n.type.create({ source: '<p align="right">Moved</p>' }) : n))));
  assert.equal(edRaw, fx('pages/html.md').replace('<p align="center">Centred paragraph</p>', '<p align="right">Moved</p>')); ok('a raw block edited as source is written back as typed');

  const fmText = fx('pages/obsidian.md'); const fmEd = open(fmText);
  const h = fmEd.kids.slice(); h[0] = schema.node('heading', { level: 1 }, [schema.text('Renamed')]);
  assert(codec.save(fmEd.m, withKids(h)).startsWith(fmText.match(/^---[\s\S]*?---\n\n/)[0] + '# Renamed\n')); ok('front matter is kept byte for byte');

  assert(!obs.m.json.content.some((n) => n.type === 'paragraph' && !n.content?.length)); ok('loading adds no empty paragraphs');
  const trail = open(fx('pages/obsidian.md')); const withTrail = withKids([...trail.kids, para('')]); const t2 = codec.load(fx('pages/obsidian.md'));
  assert(codec.bind(t2, withTrail)); assert.equal(codec.save(t2, withTrail), fx('pages/obsidian.md')); ok('the editor\'s trailing empty paragraph belongs to no block');
  // D1 syntax: each form reads and writes back unchanged, and is a real node or mark
  const forms = {
    'Water H<sub>2</sub>O and E = mc<sup>2</sup>.': ['subscript', 'superscript'],
    'Euler $e^{i\\pi} + 1 = 0$ is neat.': ['inlineMath'],
    '$$\n\\frac{a}{b}\n$$': ['blockMath'],
    'A claim[^n1] and a note^[Said in place.].\n\n[^n1]: The source, with **bold**.': ['footnoteRef', 'footnoteInline', 'footnoteDef'],
    'Visible %%only for me%% text.': ['hiddenComment'],
    'A [red word]{color=red} and [marked]{color=blue bg=yellow}.': ['folioColor'],
    'Centred paragraph\n{align=center}': ['textAlign:center'],
    '## Right heading {align=right}': ['textAlign:right'],
    'Prices $5 and $10 stay text.': [],
  };
  for (const [src, want] of Object.entries(forms)) {
    const { m, doc } = open(src);
    assert.equal(codec.save(m, doc), src); assert(!m.blocks.some((b) => b.raw), `${src} should not be raw`);
    const seen = new Set(); doc.descendants((n) => { seen.add(n.type.name); n.marks.forEach((k) => seen.add(k.type.name)); if (n.attrs?.textAlign) seen.add('textAlign:' + n.attrs.textAlign); });
    for (const w of want) assert(seen.has(w), `${src} → ${w}`);
    if (!want.length) assert(!seen.has('inlineMath'));
  }
  ok('superscript, subscript, maths, footnotes, hidden comments, colour and alignment read and write back unchanged');
  const made = schema.node('doc', null, [schema.node('paragraph', { textAlign: 'center' }, [schema.text('Hi ', []), schema.text('there', [schema.marks.folioColor.create({ color: 'green' })]), schema.text(' x', [schema.marks.superscript.create()])])]);
  assert.equal(codec.save(codec.load(''), made), 'Hi [there]{color=green} <sup>x</sup>\n{align=center}\n'); ok('colour, alignment and superscript made in the editor write Folio Markdown');
  assert.equal(portableMarkdown('A [word]{color=red bg=yellow} here.\n{align=center}\n\n## T {align=right}\n'), 'A word here.\n\n## T\n'); ok('portable export removes Folio-only colour and alignment');
  assert.deepEqual(headings('# A [red]{color=red} title {align=center}\n## B %%x%%').map((h) => h.text), ['A red title', 'B']); ok('the outline shows headings without Folio syntax');

  { const sb = open('Line one\nline two with **bold**\nline three');
    assert.equal(sb.doc.firstChild.content.content.filter((n) => n.type.name === 'softBreak').length, 2); assert(!sb.doc.textContent.includes('\n') || sb.doc.firstChild.textContent.split('\n').length === 3);
    const ed2 = sb.doc.firstChild.copy(sb.doc.firstChild.content.addToEnd(schema.text(' end')));
    assert.equal(codec.save(sb.m, withKids([ed2])), 'Line one\nline two with **bold**\nline three end\n');
    ok('a line that continues the paragraph is a soft break node and is written back as a newline'); }
  { const nc = open('> [!callout|💡 yellow] Read this first\n> Body.\n\nNext.'); const q = nc.kids[0];
    const para = q.firstChild; const changed = q.copy(q.content.replaceChild(0, para.copy(para.content.append(schema.node('paragraph', null, [schema.text('!')]).content))));
    assert.equal(codec.save(nc.m, withKids([changed, nc.kids[1]])), '> [!callout|💡 yellow] Read this first\n> Body.!\n\nNext.'); ok('editing a Notion callout keeps its marker unescaped'); }
  const empty = codec.load(''); const ed = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] }); codec.bind(empty, ed);
  assert.equal(codec.save(empty, ed), ''); assert.equal(splitBlocks('\n\n').blocks.length, 0); ok('an empty page stays empty');
  for (const k of ['window', 'document', 'DOMParser']) delete globalThis[k];
  await win.happyDOM.close();
}

// the / menu registry
{
  assert(INSERTS.every((i) => CATEGORIES.includes(i.cat) && (i.turn || i.run) && i.label && (i.icon || i.badge)));
  assert.equal(new Set(INSERTS.map((i) => i.id)).size, INSERTS.length); ok('every insert has a category, an action and an icon, and a unique id');
  const all = filterInserts('', { recent: ['math', 'h2'] });
  assert.deepEqual(all.slice(0, 2).map((x) => [x.group, x.item.id]), [['Recent', 'math'], ['Recent', 'h2']]); assert.equal(all.filter((x) => x.group !== 'Recent').length, INSERTS.length);
  ok('with no query the menu shows recent items, then every category');
  assert.equal(filterInserts('h2', { recent: [] })[0].item.id, 'h2'); assert.equal(filterInserts('todo', { recent: [] })[0].item.id, 'task');
  assert.equal(filterInserts('equation', { recent: [] })[0].item.id, 'math'); assert.equal(filterInserts('[[', { recent: [] })[0].item.id, 'link');
  assert(filterInserts('cal', { recent: [] }).slice(0, 6).every((x) => x.item.id.startsWith('callout'))); assert.equal(filterInserts('columns', { recent: [] })[0].item.id, 'columns-2'); assert.equal(filterInserts('toggle', { recent: [] })[0].item.id, 'toggle'); assert.equal(filterInserts('toc', { recent: [] })[0].item.id, 'toc');
  ok('search matches labels and aliases (h2, todo, equation, [[, columns, toggle, toc)');
  const t = filterInserts('3x4', { recent: [] }); assert.equal(t.length, 1); assert.deepEqual(t[0].args, { rows: 3, cols: 4 }); assert.deepEqual(filterInserts('table 2×5', { recent: [] })[0].args, { rows: 2, cols: 5 });
  ok('/3x4 inserts a table of that size');
  assert.equal(filterInserts('zzzz', { recent: [] }).length, 0); ok('no match gives an empty menu');
}

// charts
const spec = parseChartSpec('type: line\ntitle: T\nsource: Budget.sheet.md\nsheet: Costs\nrange: A1:G5\nby: rows');
const s = toSeries(sheetRange(sheetText, spec.sheet, spec.range), 'rows');
assert.deepEqual(s.categories, ['Q1', 'Q2', 'Q3', 'Q4']); assert.equal(s.series.length, 4); ok('chart series in rows skip text rows');
assert.match(chartSvg(s, spec), /<svg class="chart"/); ok('chart renders to SVG');

console.log(`\n${n} format checks passed`);
