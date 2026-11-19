// Folio format tests: round-trips must be lossless, formulas and charts must compute.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBoard, serializeBoard, splitBoardDoc, joinBoardDoc, applyEdgeStyle, autoLayout } from '../src/renderer/board-core.js';
import { parseWorkbook, serializeWorkbook, evaluator, shiftFormula } from '../src/renderer/sheet-core.js';
import { findRefs, resolveTarget, rewriteRefs } from '../src/renderer/refs-syntax.js';
import { resolveRef } from '../src/renderer/refs.js';
import { parseDeck, splitSlides, joinDeck, setDirective, setNotes, parseFrontmatter } from '../src/renderer/slides-core.js';
import { scanObjects, extractObjects, setObjectAttrs, setMany, removeObject, addObject, nextId, geometry, alignPatches, distributePatches, zPatches, retarget, nextGroup, locked, groupOf, setObjectBody, inlineSafe, textStyle, linePoints, linePath, parseFill, fillCss, fillSvg, adjustCss, frameCss, safeColor, replaceImageSrc, pathBlock, polygonsBlock, simplify, pointsPath, parsePoints } from '../src/renderer/slides-objects.js';
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

// SmartArt and Design ideas (P9)
{
  const { parseItems, smartArt, SMART_TYPES } = await import('../src/renderer/slides-smartart.js');
  const { designIdeas, analyse, BLOCKS } = await import('../src/renderer/slides-designer.js');
  const { parseDeck: pd } = await import('../src/renderer/slides-core.js');
  assert.deepEqual(parseItems('- A\n  - a1\n- B\n1. C'), [{ text: 'A', depth: 0, children: [{ text: 'a1', depth: 2, children: [] }] }, { text: 'B', depth: 0, children: [] }, { text: 'C', depth: 0, children: [] }]); ok('diagram lists keep their nesting');
  for (const [t] of SMART_TYPES) { const h = smartArt(t, '- One\n- Two\n  - sub\n- <b>Three</b>', 800, 400); assert.match(h, /<svg class="sm-svg"/, t); assert.match(h, /One/); assert.doesNotMatch(h, /<b>Three<\/b>/, `${t} escapes text`); }
  ok(`all ${SMART_TYPES.length} diagram types draw and escape their text`);
  const slide = '\n<!-- section: Plan -->\n## Our plan\n\n- Research\n- Design\n- Build\n- Launch\n\n<!--\nSay it slowly\n-->\n';
  const ids = designIdeas(slide).map((x) => x.id); assert(['cards', 'process', 'chevron', 'cycle', 'pyramid'].every((k) => ids.includes(k)), ids.join());
  const applied = designIdeas(slide).find((x) => x.id === 'process').chunk; assert.match(applied, /<!-- section: Plan -->/); assert.match(applied, /Say it slowly/); assert.match(applied, /::: smartart type=process x=88 y=200 w=1104 h=260\n- Research\n- Design\n- Build\n- Launch\n:::/);
  ok('design ideas offer diagrams and layouts and keep sections and notes');
  assert.equal(designIdeas('## Plan\n\n- 2025: Pilot\n- 2026: Launch\n')[0].id, 'timeline'); assert(designIdeas('## Team\n\n![](a.png)\n\nWe ship\n').some((x) => x.id === 'image-right')); assert(designIdeas('## 42%\n\nGrowth\n').some((x) => x.id === 'big-number'));
  assert.equal(designIdeas('::: box x=1 y=1\nHi\n:::\n').length, 0); ok('dates suggest a timeline, pictures suggest picture layouts, hand-placed slides get no ideas');
  for (const [, , body] of BLOCKS) assert.equal(pd('---\nmarp: true\n---\n\n' + body).slides.length, 1); ok('building blocks are single slides');
}

// templates and placeholders
{
  const T = await import('../src/renderer/slides-templates.js');
  const { parseDeck: pd, placeholdersFor, splitTitle, mastersFor } = await import('../src/renderer/slides-core.js');
  assert.equal(T.BUILTIN.length, 8);
  for (const text of T.BUILTIN) {
    const info = T.templateInfo(text); const d = pd(text);
    assert(info.name && info.description && info.variants.length === 2, info.name);
    assert.deepEqual(d.masters.map((m) => m.master), ['all', 'title', 'section'], info.name);
    assert(d.shown.length >= 3, info.name); assert(d.global.paper && d.global.accent && d.global['heading-font'], info.name);
    for (const v of info.variants) assert.equal(Object.keys(v.tokens).length, 5, `${info.name} ${v.name}`);
  }
  ok('the 8 built-in templates have tokens, variants, masters for all/title/section and sample slides');
  const swiss = T.BUILTIN.find((x) => T.templateInfo(x).name === 'Swiss');
  const deckText = T.newDeckFrom({ ...T.templateInfo(swiss), text: swiss, builtin: true }, 'Launch plan');
  assert.match(deckText, /^---\nmarp: true\ntemplate: Templates\/Swiss\.slides\ntitle: Launch plan\n---\n/); assert.match(deckText, /# Launch plan/); assert.doesNotMatch(deckText, /<!-- master/); ok('a new deck links the template and copies its sample slides');
  const d = pd(deckText, { template: swiss });
  const ttl = d.slides.find((x) => x.layout === 'title'), body = d.slides.find((x) => x.layout === 'default'), two = d.slides.find((x) => x.layout === 'two-columns');
  assert.deepEqual(Object.keys(placeholdersFor(d, ttl)).sort(), ['subtitle', 'title']); assert.deepEqual(mastersFor(d, ttl).map((m) => m.master), ['title']); ok('title only: the title master replaces the all-slides master');
  assert.deepEqual(Object.keys(placeholdersFor(d, body)).sort(), ['body', 'title']); assert.deepEqual(Object.keys(placeholdersFor(d, two)), []); assert.deepEqual(mastersFor(d, two).map((m) => m.master), ['all']); ok('content slides use the title and body placeholders; two-column slides keep their layout and the decorations');
  assert.deepEqual(splitTitle('Intro\n\n## Title\n\n- a'), { title: '## Title', rest: 'Intro\n\n- a' }); assert.deepEqual(splitTitle('```\n# not\n```\nx'), { title: '', rest: '```\n# not\n```\nx' }); ok('the title is the first heading outside code');
  const applied = T.applyTemplate('---\nmarp: true\ntheme: graphite\naccent: "#ff0000"\ntitle: Mine\n---\n\n# Hi\n', { ...T.templateInfo(swiss), text: swiss, builtin: true });
  assert.equal(applied, '---\nmarp: true\ntitle: Mine\ntemplate: Templates/Swiss.slides\n---\n\n# Hi\n'); ok('applying a template removes the deck\'s own design keys and keeps its slides');
  const saved = T.templateFromDeck(deckText, { name: 'Mine', description: 'For me' }, swiss); const si = T.templateInfo(saved); const sd = pd(saved);
  assert.equal(si.name, 'Mine'); assert.equal(sd.global.accent, '#e3120b'); assert.equal(sd.masters.length, 3); assert(sd.shown.length >= 3); assert.equal(si.variants.length, 2); ok('Save as template keeps the effective design, the masters and sample slides');
}

// charts
const spec = parseChartSpec('type: line\ntitle: T\nsource: Budget.sheet.md\nsheet: Costs\nrange: A1:G5\nby: rows');
const s = toSeries(sheetRange(sheetText, spec.sheet, spec.range), 'rows');
assert.deepEqual(s.categories, ['Q1', 'Q2', 'Q3', 'Q4']); assert.equal(s.series.length, 4); ok('chart series in rows skip text rows');
assert.match(chartSvg(s, spec), /<svg class="chart"/); ok('chart renders to SVG');

console.log(`\n${n} format checks passed`);
