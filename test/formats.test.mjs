// Folio format tests: round-trips must be lossless, formulas and charts must compute.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBoard, serializeBoard, splitBoardDoc, joinBoardDoc, applyEdgeStyle, autoLayout } from '../src/renderer/board-core.js';
import { parseWorkbook, serializeWorkbook, evaluator, shiftFormula } from '../src/renderer/sheet-core.js';
import { parseDeck, splitSlides, joinDeck, setDirective, setNotes, parseFrontmatter } from '../src/renderer/slides-core.js';
import { scanObjects, extractObjects, setObjectAttrs, setMany, removeObject, addObject, nextId, geometry } from '../src/renderer/slides-objects.js';
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

// charts
const spec = parseChartSpec('type: line\ntitle: T\nsource: Budget.sheet.md\nsheet: Costs\nrange: A1:G5\nby: rows');
const s = toSeries(sheetRange(sheetText, spec.sheet, spec.range), 'rows');
assert.deepEqual(s.categories, ['Q1', 'Q2', 'Q3', 'Q4']); assert.equal(s.series.length, 4); ok('chart series in rows skip text rows');
assert.match(chartSvg(s, spec), /<svg class="chart"/); ok('chart renders to SVG');

console.log(`\n${n} format checks passed`);
