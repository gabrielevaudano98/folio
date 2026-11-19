// Folio format tests: round-trips must be lossless, formulas and charts must compute.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBoard, serializeBoard, splitBoardDoc, joinBoardDoc, applyEdgeStyle, autoLayout } from '../src/renderer/board-core.js';
import { parseWorkbook, serializeWorkbook, evaluator, shiftFormula } from '../src/renderer/sheet-core.js';
import { parseDeck, splitSlides, joinDeck, setDirective, setNotes, parseFrontmatter } from '../src/renderer/slides-core.js';
import { scanObjects, extractObjects, setObjectAttrs, setMany, removeObject, addObject, nextId, geometry, alignPatches, distributePatches, zPatches, retarget, nextGroup, locked, groupOf, setObjectBody, inlineSafe, textStyle } from '../src/renderer/slides-objects.js';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { pageExtensions } from '../src/renderer/page-schema.js';
import { portableMarkdown } from '../src/renderer/page-syntax.js';
import { headings } from '../src/renderer/markdown.js';
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
assert(inlineSafe('### Title\n- one\n- two\n\n**bold** and *italic* and [a link](https://x.y)')); assert(!inlineSafe('text\n::: note\nx\n:::')); assert(!inlineSafe('![i](a.png)')); assert(!inlineSafe('```js\nx\n```')); assert(!inlineSafe('<b>x</b>')); assert(!inlineSafe('| a | b |')); ok('inline text editing refuses bodies it could not round-trip');
const T = '::: box #a x=1 y=1 w=100 h=50\nOld\n:::\n\n::: box #b x=2 y=2 w=100 h=50\nKeep\n:::\n';
const T2 = setObjectBody(T, 'a', '## New\n- a\n- b'); assert.equal(scanObjects(T2).length, 2); assert.equal(scanObjects(T2)[1].body, 'Keep'); assert.equal(scanObjects(T2)[0].body, '## New\n- a\n- b'); ok('writing a box body leaves the other objects alone');
assert.deepEqual(textStyle({ font: 'serif', size: '40', align: 'center', line: '1.4', valign: 'middle' }), ['font-family:Georgia, "Times New Roman", serif', 'font-size:40px', 'text-align:center', 'line-height:1.4', 'justify-content:center']); ok('text attributes become CSS');

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
  assert(html.some((s) => s.startsWith('<details>')) && html.some((s) => s.startsWith('<!--')) && html.some((s) => s.includes('<kbd>')));
  ok('HTML the editor cannot hold becomes raw blocks instead of being rewritten');

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

  const empty = codec.load(''); const ed = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] }); codec.bind(empty, ed);
  assert.equal(codec.save(empty, ed), ''); assert.equal(splitBlocks('\n\n').blocks.length, 0); ok('an empty page stays empty');
  for (const k of ['window', 'document', 'DOMParser']) delete globalThis[k];
  await win.happyDOM.close();
}

// charts
const spec = parseChartSpec('type: line\ntitle: T\nsource: Budget.sheet.md\nsheet: Costs\nrange: A1:G5\nby: rows');
const s = toSeries(sheetRange(sheetText, spec.sheet, spec.range), 'rows');
assert.deepEqual(s.categories, ['Q1', 'Q2', 'Q3', 'Q4']); assert.equal(s.series.length, 4); ok('chart series in rows skip text rows');
assert.match(chartSvg(s, spec), /<svg class="chart"/); ok('chart renders to SVG');

console.log(`\n${n} format checks passed`);
