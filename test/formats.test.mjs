// Folio format tests: round-trips must be lossless, formulas and charts must compute.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBoard, serializeBoard, splitBoardDoc, joinBoardDoc, applyEdgeStyle, autoLayout } from '../src/renderer/board-core.js';
import { parseWorkbook, serializeWorkbook, evaluator, shiftFormula } from '../src/renderer/sheet-core.js';
import { parseDeck, splitSlides, joinDeck, setDirective, setNotes, parseFrontmatter } from '../src/renderer/slides-core.js';
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

// charts
const spec = parseChartSpec('type: line\ntitle: T\nsource: Budget.sheet.md\nsheet: Costs\nrange: A1:G5\nby: rows');
const s = toSeries(sheetRange(sheetText, spec.sheet, spec.range), 'rows');
assert.deepEqual(s.categories, ['Q1', 'Q2', 'Q3', 'Q4']); assert.equal(s.series.length, 4); ok('chart series in rows skip text rows');
assert.match(chartSvg(s, spec), /<svg class="chart"/); ok('chart renders to SVG');

console.log(`\n${n} format checks passed`);
