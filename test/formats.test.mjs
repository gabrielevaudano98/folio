// Folio format tests: round-trips must be lossless, formulas and charts must compute.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBoard, serializeBoard, splitBoardDoc, joinBoardDoc, applyEdgeStyle, autoLayout } from '../src/renderer/board-core.js';
import { parseWorkbook, serializeWorkbook, evaluator, shiftFormula } from '../src/renderer/sheet-core.js';
import { findRefs, resolveTarget, rewriteRefs } from '../src/renderer/refs-syntax.js';
import { resolveRef } from '../src/renderer/refs.js';
import { parseDeck, splitSlides, joinDeck, setDirective, setNotes, parseFrontmatter, zoomTarget } from '../src/renderer/slides-core.js';
import { scanObjects, extractObjects, setObjectAttrs, setMany, removeObject, addObject, nextId, geometry, alignPatches, distributePatches, zPatches, retarget, nextGroup, locked, groupOf, setObjectBody, inlineSafe, textStyle, linePoints, linePath, parseFill, fillCss, fillSvg, adjustCss, frameCss, safeColor, replaceImageSrc, pathBlock, polygonsBlock, simplify, pointsPath, parsePoints } from '../src/renderer/slides-objects.js';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { pageExtensions } from '../src/renderer/page-schema.js';
import { portableMarkdown } from '../src/renderer/page-syntax.js';
import { headings } from '../src/renderer/markdown.js';
import { INSERTS, CATEGORIES, filterInserts } from '../src/renderer/inserts.js';
import { Window } from 'happy-dom';
import { createPageCodec, splitBlocks } from '../src/renderer/page-core.js';
import { mentionEntries, extractTags, blockIds, linkKind, ymd, statusClass, statusOptions, STATUSES } from '../src/renderer/page-mentions.js';
import { parseTSV, parseCSV, gfmTable, sheetFromTable, compareCells } from '../src/renderer/page-table.js';
import { findMatches, replaceAll } from '../src/renderer/page-find.js';
import { sections, moveSection, shiftSection } from '../src/renderer/page-outline.js';
import { TABS, COMPACT, buildRibbon } from '../src/renderer/page-ribbon.js';
import { EditorState } from '@tiptap/pm/state';
import { listChanges, accept as acceptCm, reject as rejectCm, clean as cleanCm, resolveAll, parseComment, commentBody, docReview, settle, resolveThread } from '../src/renderer/page-critic.js';
import { parseProps, setProp, removeProp, renameProp, newKey, renameTag, setTypeOverrides, inferType } from '../src/renderer/page-props.js';
import { reactionOf, splitThread, myReaction, commentParts, mentionAt } from '../src/renderer/page-reactions.js';
import { findMentions, linkMention, linkAllMentions } from '../src/renderer/refs-syntax.js';
import { formatDate, fillTemplate, askVars, splitTemplate, mergeProps, parseButton, buttonSource, listTemplates, STARTERS, CURSOR, templateMeta, withoutMeta, setMeta, communityItems, templateFileName } from '../src/renderer/page-templates.js';
import { htmlToMarkdown, looksLikeMarkdown, isCodeHtml } from '../src/renderer/page-paste.js';
import { toDocx, pdfOptions, pageCss } from '../src/renderer/page-docx.js';
import { markdownIt } from '../src/renderer/markdown.js';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { createActionLog, perDoc } from '../src/renderer/history.js';
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
  { const md = open(fx('pages/media.md'));
    assert(!md.m.blocks.some((b) => b.raw)); assert.equal(codec.save(md.m, md.doc), fx('pages/media.md'));
    const imgs = []; md.doc.descendants((n) => { if (n.type.name === 'image') imgs.push(n.attrs); });
    assert.deepEqual([imgs[0].src, imgs[0].alt, imgs[0].size, imgs[0].title], ['assets/team.png', 'Team photo', '400', 'The team in Turin']);
    const { mediaKind, webProvider } = await import('../src/renderer/page-syntax.js');
    assert.deepEqual(imgs.map((a) => mediaKind(a.src)), ['image', 'image', 'video', 'audio', 'pdf', 'web']);
    assert.equal(webProvider('https://youtu.be/dQw4w9WgXcQ').thumb, 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'); assert.equal(webProvider('https://example.com'), null);
    const k = md.kids.findIndex((n) => n.type.name === 'image' && n.attrs.size === '400');
    const resized = codec.save(md.m, withKids(md.kids.map((n, i) => (i === k ? n.type.create({ ...n.attrs, size: '250', title: 'New caption' }) : n))));
    assert.equal(resized, fx('pages/media.md').replace('![Team photo|400](assets/team.png "The team in Turin")', '![Team photo|250](assets/team.png "New caption")'));
    ok('images keep width (|400) and caption; video, audio, PDF and web embeds use the image syntax; resizing rewrites one line');
    const { markdownIt } = await import('../src/renderer/markdown.js'); const h = markdownIt.render(fx('pages/media.md'));
    assert.match(h, /<figure class="md-figure"><img src="assets\/team.png" alt="Team photo" title="The team in Turin" style="width:400px"><figcaption>The team in Turin<\/figcaption><\/figure>/);
    assert.match(h, /<video class="md-media" controls preload="metadata" data-src="assets\/demo.mp4"/); assert.match(h, /<audio class="md-media"/);
    assert.match(h, /class="md-card md-file" href="assets\/report-2026.pdf"/); assert.match(h, /class="md-card md-embed"[\s\S]*img.youtube.com/);
    assert.match(h, /<p class="md-bookmark" data-host="folio.app"/); assert.match(h, /<p class="md-filecard" data-host="budget.xlsx"/);
    ok('the Read view draws figures with captions, players, PDF and embed cards, bookmarks and file cards'); }
  { const ch = open(fx('pages/chips.md'));
    assert(!ch.m.blocks.some((b) => b.raw), ch.m.blocks.filter((b) => b.raw).map((b) => b.src).join('|')); assert.equal(codec.save(ch.m, ch.doc), fx('pages/chips.md'));
    ok('links, days, people, tags, inline fields and emoji are plain text: the page opens and saves byte-identical, with no raw blocks');
    const { markdownIt } = await import('../src/renderer/markdown.js'); const h = markdownIt.render(fx('pages/chips.md'));
    assert(h.includes('<span class="md-tag">#project/alpha</span>') && h.includes('<span class="md-tag">#design-system</span>') && h.includes('<span class="md-tag">#todo</span>'));
    assert(!h.includes('md-tag">#code') && !h.includes('md-tag">#</span>') && h.includes('C#'));
    assert(h.includes('md-status is-blue" data-key="status">In progress</span>') && h.includes('md-status is-green" data-key="status">Done</span>') && h.includes('<span class="md-field" data-key="owner"><b>owner</b> Ada</span>'));
    assert(h.includes('wikilink wikilink-date') && h.includes('data-wikilink="2026-11-21"'));
    assert.equal(headings(fx('pages/chips.md'))[0].text, 'Weekly note #q4');
    ok('the Read view draws tags and status chips, and a heading keeps its #tag in the outline'); }
  { // D6: a column's alignment is written once, in the rule under the header; other rows stay as written
    const src = '# T\n\n| Name | Qty |\n| --- | --- |\n| Pear | 3 |\n| Apple | 10 |\n\nAfter.\n';
    const t = open(src); const ti = t.kids.findIndex((k) => k.type.name === 'table'); const table = t.kids[ti];
    const rows = []; table.forEach((r) => { const cells = []; r.forEach((c, _, i) => cells.push(i === 1 ? c.type.create({ ...c.attrs, align: 'center' }, c.content) : c)); rows.push(r.type.create(r.attrs, cells)); });
    const out = codec.save(t.m, withKids(t.kids.map((k, i) => (i === ti ? table.type.create(table.attrs, rows) : k))));
    assert.match(out, /\| -+ \| :-+: \|/, out); assert(out.startsWith('# T\n\n') && out.endsWith('\n\nAfter.\n')); ok('centring a table column writes :---: and leaves the rest of the page as written'); }
  { // D7: find and replace work across bold text inside a paragraph; replace all is one transaction
    const f = open('# Find\n\nalpha **beta** Alpha\n\nnot alphabet\n');
    let st = EditorState.create({ doc: f.doc });
    assert.equal(findMatches(st.doc, 'alpha').length, 3); assert.equal(findMatches(st.doc, 'alpha', { wholeWord: true }).length, 2); assert.equal(findMatches(st.doc, 'alpha', { matchCase: true }).length, 2);
    assert.equal(findMatches(st.doc, 'alphabeta', {}).length, 0); assert.equal(findMatches(st.doc, 'alpha beta', {}).length, 1); assert.equal(findMatches(st.doc, 'al(p)', { regex: true }).length, 3); assert.equal(findMatches(st.doc, '(', { regex: true }).length, 0);
    let steps = 0; const n = replaceAll(st, (tr) => { st = st.apply(tr); steps++; }, 'alpha', 'omega', { wholeWord: true });
    assert.equal(n, 2); assert.equal(steps, 1); assert.equal(codec.save(f.m, st.doc), '# Find\n\nomega **beta** omega\n\nnot alphabet\n');
    st = EditorState.create({ doc: f.doc }); replaceAll(st, (tr) => { st = st.apply(tr); }, '(al)pha', '$1to', { regex: true });
    assert.equal(codec.save(f.m, st.doc), '# Find\n\nalto **beta** Alto\n\nnot altobet\n');
    ok('find: case, whole words, patterns, across bold text; replace all is one step and keeps formatting'); }
  { // D9: templates
  const now = new Date(2026, 10, 20, 9, 5);
  assert.equal(formatDate(now, 'dddd D MMMM YYYY, HH:mm [at] h a'), 'Friday 20 November 2026, 09:05 at 9 am'); assert.equal(formatDate(now), '2026-11-20');
  const f = fillTemplate('# {{title}}\n{{date}} {{ time }} {{date:DD/MM}} {{yesterday}} {{tomorrow}} {{weekday}} {{Budget.sheet#A1}} {{cursor}}', { title: 'Plan', now });
  assert.equal(f, `# Plan\n2026-11-20 09:05 20/11 2026-11-19 2026-11-21 Friday {{Budget.sheet#A1}} ${CURSOR}`);
  ok('template variables: title, dates and times with formats, yesterday and tomorrow; Folio live values {{…}} are left alone');
  const mt = '---\nnote: Atlas\n---\nWe met about Atlas on Monday, and `Atlas` in code, [[Atlas]] linked, [the Atlas page](a.md), atlas lower.\n```\nAtlas\n```\nAtlasX and Atlases are other words.';
  const ms = findMentions(mt, 'Atlas'); assert.deepEqual(ms.map((m) => m.match), ['Atlas', 'atlas']);
  assert(linkMention(mt, ms[0], 'Atlas').includes('about [[Atlas]] on Monday') && linkMention(mt, ms[1], 'Atlas').includes('[[Atlas|atlas]] lower'));
  assert.deepEqual(findMentions('Abc and ABC', 'ABC').length, 2); assert.deepEqual(findMentions('x Atlas', 'At'), []);
  const all = linkAllMentions(mt, 'Atlas');
  assert.equal(all.count, 2); assert(all.text.includes('about [[Atlas]] on Monday') && all.text.includes('[[Atlas|atlas]] lower'));
  assert.equal(all.text.replace(/\[\[Atlas\|atlas\]\]/, 'atlas').replace('about [[Atlas]] on', 'about Atlas on'), mt, 'only the two mentions changed');
  assert.equal(linkAllMentions(all.text, 'Atlas').count, 0, 'running it again changes nothing');
  ok('unlinked mentions: whole words outside front matter, code, links and references; the link keeps the case as written; Link all does every one in a single pass');
  assert.equal(reactionOf('👍'), '👍'); assert.equal(reactionOf(' ❤️ '), '❤️'); assert.equal(reactionOf('👍🏽'), '👍🏽'); assert.equal(reactionOf('🇮🇹'), '🇮🇹');
  assert.equal(reactionOf('👍👍'), ''); assert.equal(reactionOf('ok 👍'), ''); assert.equal(reactionOf('1'), ''); assert.equal(reactionOf(''), '');
  const th = splitThread([{ author: 'Ada', text: 'Check this' }, { author: 'Bob', text: '👍' }, { author: 'Cy', text: 'Agreed' }, { author: 'Ada', text: '👍' }, { author: 'Bob', text: '🎉' }]);
  assert.deepEqual(th.messages.map((m) => m.k), [0, 2]); assert.deepEqual(th.reactions.map((r) => [r.emoji, r.authors.join('+')]), [['👍', 'Bob+Ada'], ['🎉', 'Bob']]);
  assert.equal(splitThread([{ author: 'Ada', text: '👍' }]).messages.length, 1, 'the first comment is always a message');
  assert.equal(myReaction(th.reactions[0], 'Ada'), 3); assert.equal(myReaction(th.reactions[0], 'Zed'), -1);
  assert.deepEqual(commentParts('Hi [[People/Ada Lovelace]] and [[Plan#Goals|the plan]], [[People/Bob|@Bob]]!'), [{ text: 'Hi ' }, { link: 'People/Ada Lovelace', label: 'Ada Lovelace', person: true }, { text: ' and ' }, { link: 'Plan', label: 'the plan', person: false }, { text: ', ' }, { link: 'People/Bob', label: 'Bob', person: true }, { text: '!' }]);
  assert.deepEqual(mentionAt('Thanks @ad', 10), { query: 'ad', from: 7 }); assert.deepEqual(mentionAt('@', 1), { query: '', from: 0 }); assert.equal(mentionAt('mail a@b', 8), null); assert.equal(mentionAt('hi @ada and', 11), null);
  ok('comments: a one-emoji reply is a reaction (grouped, toggled by its author), a [[People/Name]] link is a mention; the file gains no new syntax');
  const ask = '# {{ask:Project name}}\nOwner: {{ask:Owner|people}} {{ask:Owner|people}}\nDue {{ask:Due|date}}\n{{ask:Notes|long}}';
  assert.deepEqual(askVars(ask), [{ label: 'Project name', kind: 'text' }, { label: 'Owner', kind: 'people' }, { label: 'Due', kind: 'date' }, { label: 'Notes', kind: 'long' }]);
  assert.equal(fillTemplate(ask, { answers: { 'Project name': 'Atlas', Owner: 'Ada', Due: '2026-12-01' } }), '# Atlas\nOwner: [[Ada]] [[Ada]]\nDue 2026-12-01\n');
  assert.equal(fillTemplate('{{ask:Name}} {{ask:X|people}}', { keepAsk: true }), '[Name] [X]'); assert.equal(fillTemplate('a{{ask:Name}}b'), 'ab');
  ok('template questions: {{ask:Label}}, |people (a link), |date, |long; asked once per label; empty when skipped, [Label] in previews');
  assert.deepEqual(splitTemplate('---\ntags: [a]\n---\n\n# T\n'), { fm: '---\ntags: [a]\n---\n', body: '# T\n' });
  assert.equal(mergeProps('---\ntags: [x, A]\nowner: Ada\n---\n', '---\ntags: [a, meeting]\nowner: Bob\ndate: 2026-11-20\n---\n'), '---\ntags: [x, A, meeting]\nowner: Ada\ndate: 2026-11-20\n---\n');
  assert.equal(mergeProps('', '---\ntags: [daily]\n---\n'), '---\ntags:\n  - daily\n---\n'); ok("a template's properties join the page's: new keys added, tags joined, existing values kept");
  const b = { label: 'New meeting', template: 'Meeting notes', where: 'above' };
  assert.deepEqual(parseButton(buttonSource(b).replace(/^```template-button\n|```$/g, '')), b); assert.deepEqual(parseButton('template: Decision log'), { label: 'New Decision log', template: 'Decision log', where: 'below' });
  const btn = open(buttonSource(b) + '\n'); assert(!btn.m.blocks.some((x) => x.raw)); assert.equal(codec.save(btn.m, btn.doc), buttonSource(b) + '\n');
  ok('a template button is a ```template-button``` fence (readable anywhere) and round-trips');
  const list = listTemplates(['Templates/Meeting notes.md', 'Templates/Team/Standup.md', 'Templates/Deck.slides.md', 'Other/x.md'], { 'Templates/Meeting notes.md': { category: 'Rituals', description: 'Ours' } });
  assert.deepEqual(list.slice(0, 2).map((t) => [t.id, t.name, t.category, t.desc, t.source]), [['Templates/Meeting notes.md', 'Meeting notes', 'Rituals', 'Ours', 'mine'], ['Templates/Team/Standup.md', 'Standup', 'Team', '', 'mine']]);
  assert(!list.some((t) => t.starter && t.name === 'Meeting notes') && list.some((t) => t.id === 'starter:okrs') && list.filter((t) => t.starter).length === STARTERS.length - 1);
  ok('your Templates/ pages come first (folders and the template: map give categories) and replace starters of the same name');
  const tm = '---\ntemplate:\n  description: Agenda and notes\n  category: Meetings\n  icon: 📝\ntags: [meeting]\n---\n# {{title}}\n';
  assert.deepEqual(templateMeta(tm), { description: 'Agenda and notes', category: 'Meetings', icon: '📝' });
  assert.equal(withoutMeta(tm), '---\ntags: [meeting]\n---\n# {{title}}\n'); assert.equal(withoutMeta('---\ntemplate:\n  category: X\n---\n# A\n'), '# A\n'); assert.equal(withoutMeta('# A\n'), '# A\n');
  assert.equal(setMeta('# A\n', { category: 'Docs', description: 'Hi: there' }), '---\ntemplate:\n  category: Docs\n  description: "Hi: there"\n---\n\n# A\n');
  assert.equal(setMeta(tm, { category: 'Planning' }), tm.replace('Meetings', 'Planning')); assert.equal(templateMeta(setMeta(tm, { icon: '' })).icon, undefined);
  ok('a template describes itself in a template: map that never reaches the pages made from it');
  const ci = communityItems({ templates: [{ id: 'lean', name: 'Lean canvas', file: 'lean.md', category: 'Strategy', icon: '🧑‍💼x' }, { name: 'Evil', file: 'https://evil.example/x.md' }, { name: 'Up', file: '../x.md' }, { file: 'noname.md' }] }, 'https://x.org/c/index.json');
  assert.deepEqual(ci.map((t) => [t.id, t.url, t.icon]), [['community:lean', 'https://x.org/c/lean.md', '🧑‍💼x']]); assert.equal(templateFileName('A/B: c?'), 'A B c');
  ok('the community index only lists files next to it; names become safe file names');
  const dir = new URL('../community/templates/', new URL('../', import.meta.url)); const idx = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
  const now9 = new Date(2026, 10, 20, 9, 5);
  for (const t of [...STARTERS.map((x) => ({ name: x.name, text: x.text })), ...idx.templates.map((x) => ({ name: x.name, text: fs.readFileSync(new URL(x.file, dir), 'utf8') }))]) {
    const text = fillTemplate(withoutMeta(t.text), { title: t.name, now: now9 }).split(CURSOR).join('');
    const o = open(text); assert(!o.m.blocks.some((x) => x.raw), t.name + ': ' + o.m.blocks.filter((x) => x.raw).map((x) => x.src).join('|')); assert.equal(codec.save(o.m, o.doc), text, t.name);
    assert(parseProps(text).props.length >= 1 && !text.includes('template:'), t.name);
  }
  ok(`all ${STARTERS.length} collection and ${idx.templates.length} community templates are fully editable and open without changes`);
  }


  { // D10: CriticMarkup is editable, round-trips, and the review helpers work on the document
    const r = open(fx('pages/review.md'));
    assert(!r.m.blocks.some((b) => b.raw), r.m.blocks.filter((b) => b.raw).map((b) => b.src).join('|')); assert.equal(codec.save(r.m, r.doc), fx('pages/review.md'));
    const items = docReview(r.doc);
    assert.deepEqual(items.map((i) => i.kind + ':' + (i.text ?? i.quote)), ['ins:within 30 days', 'del: as soon as possible', 'sub:30', 'thread:Liability is capped.']);
    assert.equal(items[3].comments[0].text, 'Check with legal.');
    let st = EditorState.create({ doc: r.doc }); const tr = st.tr; for (const it of items.filter((i) => i.kind !== 'thread')) settle(st, it, true, tr); st = st.apply(tr);
    assert.equal(codec.save(r.m, st.doc), '# Contract review\n\nThe supplier will deliver within 30 days.\nPayment terms 30 days. {==Liability is capped.==}{>>Check with legal.<<}\n\nNormal paragraph without marks.\n');
    st = EditorState.create({ doc: r.doc }); st = st.apply(resolveThread(st, docReview(st.doc)[3]));
    assert(codec.save(r.m, st.doc).includes('days. Liability is capped.\n\nNormal'));
    ok('CriticMarkup opens as editable marks and nodes, saves byte-identical; accept all and resolve a thread change only those blocks'); }
  const empty = codec.load(''); const ed = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] }); codec.bind(empty, ed);
  assert.equal(codec.save(empty, ed), ''); assert.equal(splitBlocks('\n\n').blocks.length, 0); ok('an empty page stays empty');
  for (const k of ['window', 'document', 'DOMParser']) delete globalThis[k];
  await win.happyDOM.close();
}

// inline pickers: [[ @ # :
{
  const files = ['Notes/Plan.md', 'Notes/Roadmap.md', 'People/Ada Lovelace.md', 'Budget.sheet.md', 'Journal/2026-11-19.md'];
  const stemOf = (p) => p.split('/').pop().replace(/(\.(slides|board|sheet))?\.md$/i, '');
  const ctx = { files, from: 'Notes/Plan.md', refName: stemOf, now: () => new Date('2026-11-20T10:00:00'),
    headingsOf: async () => [{ text: 'Goals', level: 2 }, { text: 'Risks', level: 2 }],
    blocksOf: async (p) => (p === 'Notes/Plan.md' ? [{ id: 'abc123', text: 'Ship the editor' }] : []),
    tags: async () => [{ tag: 'q4', count: 3 }, { tag: 'project/alpha', count: 1 }] };
  const ins = async (k, q) => (await mentionEntries(k, q, ctx)).map((e) => e.insert || (e.create ? 'create:' + e.create : null));
  assert.deepEqual((await ins('link', 'road'))[0], '[[Roadmap]]'); assert((await ins('link', 'road')).includes('create:road')); assert(!(await ins('link', 'Roadmap')).some((x) => String(x).startsWith('create:')));
  assert((await ins('link', 'ada')).includes('[[Ada Lovelace]]')); assert(!(await ins('link', '')).includes('[[Plan]]'));
  ok('[[ lists documents and people by fuzzy name, offers to create a page, and leaves out the page you are on');
  assert.deepEqual(await ins('link', 'Roadmap#'), ['[[Roadmap#Goals]]', '[[Roadmap#Risks]]']); assert.deepEqual(await ins('link', '#ri'), ['[[#Risks]]']);
  assert.deepEqual(await ins('link', 'Plan#^'), ['[[Plan#^abc123]]']); assert.equal((await mentionEntries('link', 'Roadmap#^', ctx))[0].disabled, true);
  ok('[[Note# lists headings and [[Note#^ lists blocks that already have an id; a block-less page says how to make one');
  assert.deepEqual((await ins('at', '')).slice(0, 3), ['[[2026-11-20]]', '[[2026-11-21]]', '[[2026-11-19]]']);
  assert.deepEqual((await ins('at', 'next friday'))[0], '[[2026-11-27]]'); assert.equal((await ins('at', 'tomorrow'))[0], '[[2026-11-21]]');
  assert.equal((await ins('at', 'domani'))[0], '[[2026-11-21]]'); assert.equal((await ins('at', 'tra 3 giorni'))[0], '[[2026-11-23]]'); assert.equal((await ins('at', '25 dec'))[0], '[[2026-12-25]]');
  ok('@ understands dates in English and Italian (tomorrow, next friday, domani, tra 3 giorni, 25 dec) and links the daily note');
  const at = await mentionEntries('at', 'ada', ctx); assert.equal(at[0].group, 'People');
  assert(!at.some((e) => e.insert === '[[2026-11-19]]')); ok('@ puts people first and does not list daily notes as pages');
  assert.deepEqual((await ins('at', 'done')).filter((x) => x.startsWith('[status')), ['[status:: Done]']); assert.equal((await ins('at', 'status')).filter((x) => x.startsWith('[status')).length, 4);
  ok('@status offers the status chips');
  assert.deepEqual(await ins('tag', 'q'), ['#q4 ', '#q ']); assert.deepEqual(await ins('tag', 'alp'), ['#project/alpha ', '#alp ']); assert.deepEqual(await ins('tag', ''), []);
  assert.deepEqual(await ins('tag', '123'), []); ok('# lists known tags by use, offers a new one, and ignores bare numbers');
  assert.equal((await ins('emoji', 'smile'))[0], '😄'); assert.equal((await ins('emoji', 'rocket'))[0], '🚀'); assert.deepEqual(await ins('emoji', 's'), []); assert.deepEqual(await ins('emoji', 'zzzzqq'), []);
  ok(': finds emoji by name and keyword and inserts the character itself');
  assert.deepEqual(extractTags('---\ntags: [a, B]\n---\n# T\nHi #q4 and #q4, C# no, #123 no, `#code`\n```\n#fence\n```\n(#paren) #Q4'), ['a', 'B', 'q4', 'paren']);
  assert.deepEqual(extractTags('---\ntags:\n  - x\n  - y z\n---\nbody #w'), ['x', 'y z', 'w']); ok('tags come from front matter and the text, outside code, once each');
  assert.deepEqual(blockIds('Para one ^abc\n- [ ] task ^t-1\nplain\n## Head ^h'), [{ id: 'abc', text: 'Para one' }, { id: 't-1', text: 'task' }, { id: 'h', text: 'Head' }]); ok('block ids are read from the end of lines');
  assert.equal(linkKind('2026-11-21', files, 'a.md'), 'date'); assert.equal(linkKind('Ada Lovelace', files, 'a.md'), 'person'); assert.equal(linkKind('Roadmap#Goals', files, 'a.md'), 'doc'); assert.equal(linkKind('Nope', files, 'a.md'), 'missing');
  assert.equal(statusClass('In progress'), 'blue'); assert.equal(statusClass('Done'), 'green'); assert.equal(statusClass('Whatever'), 'gray'); assert.equal(ymd(new Date(2026, 0, 5)), '2026-01-05'); ok('a link knows whether it is a day, a person, a page or missing; status words get their colour');
  assert.deepEqual(statusOptions('# no front matter'), STATUSES); assert.deepEqual(statusOptions('---\ntitle: A\n---\n'), STATUSES);
  assert.deepEqual(statusOptions('---\nfolio:\n  status: [Idea, "In design", Shipped]\n---\nx'), ['Idea', 'In design', 'Shipped']);
  assert.deepEqual(statusOptions('---\nfolio:\n  status:\n    - Draft\n    - Review\ntags: [a]\n---\nx'), ['Draft', 'Review']);
  ok('status options come from front matter folio.status (inline or list), else the defaults');
  setTypeOverrides({ owner: 'link', due: 'text', count: 'number' });
  assert.equal(inferType('Owner', '[[People/Ada]]'), 'link'); assert.equal(inferType('due', '2026-11-20'), 'text'); assert.equal(inferType('count', 'many'), 'text'); assert.equal(inferType('count', 3), 'number'); // a type that does not fit the value is ignored
  setTypeOverrides({}); assert.equal(inferType('due', '2026-11-20'), 'date'); ok('property types chosen per workspace override inference only when the value fits');
  assert(INSERTS.some((i) => i.id === 'today' && /^\[\[\d{4}-\d{2}-\d{2}\]\]$/.test(i.md)) && filterInserts('status', { recent: [] })[0].item.id === 'status'); ok('/today, /tomorrow and /status are in the / menu');
}

// D6, D7: tables from the clipboard, sections, the ribbon
{
  assert.deepEqual(parseTSV('Name\tQty\nPear\t3\nApple\t10\n'), [['Name', 'Qty'], ['Pear', '3'], ['Apple', '10']]);
  assert.deepEqual(parseTSV('a\t"b\tc"\n"x ""y"""\t'), [['a', 'b\tc'], ['x "y"', '']]); assert.equal(parseTSV('no tabs here'), null); assert.deepEqual(parseTSV('a\tb\nc'), [['a', 'b'], ['c', '']]);
  assert.deepEqual(parseCSV('Name;Qty\nPear;3'), [['Name', 'Qty'], ['Pear', '3']]);
  assert.deepEqual(parseCSV('Name,Qty\n"Pear, green",3\nApple,10\n'), [['Name', 'Qty'], ['Pear, green', '3'], ['Apple', '10']]);
  assert.equal(parseCSV('Alice, Bob\nCarol, Dan'), null, 'two lines of commas could be prose'); assert.equal(parseCSV('a,b\nc,d,e\nf,g'), null, 'uneven lines are not a table');
  assert.equal(parseCSV('one sentence, with a comma.'), null); assert.equal(parseCSV('{"a": 1,\n"b": 2,\n"c": 3}'), null, 'code is left alone'); assert.equal(parseCSV('a,\n1,2\n3,4'), null, 'an empty header cell is suspicious');
  ok('paste: comma- or semicolon-separated lines become a table only when nothing else fits (same field count, quotes, short cells, not code)');
  ok('cells copied from Excel or Sheets (tabs, quoted cells) become rows; plain text does not');
  assert.equal(gfmTable([['A', 'B|C'], ['1', '2']], [null, 'right']), '| A | B\\|C |\n| --- | ---: |\n| 1 | 2 |');
  assert.equal(sheetFromTable('Costs', [['Item', 'Price'], ['Pen', '2']]), '# Costs\n\n## Sheet1\n\n| Item | Price |\n| --- | --- |\n| Pen | 2 |\n');
  assert.deepEqual(['10', '', '9', 'b', 'A', '1,000'].sort(compareCells), ['9', '10', '1,000', 'A', 'b', '']); ok('a table becomes a sheet; sorting puts numbers by value, then text, empty cells last');
  const doc = 'Title\n=====\n\nIntro\n\n## A\n\na\n\n### A1\n\nx\n\n## B\n\nb\n\n```\n## not a heading\n```\n';
  assert.deepEqual(sections(doc).map((h) => [h.line, h.level, h.end]), [[0, 1, 21], [5, 2, 13], [9, 3, 13], [13, 2, 21]]);
  assert.equal(moveSection(doc, 13, 5), 'Title\n=====\n\nIntro\n\n## B\n\nb\n\n```\n## not a heading\n```\n\n## A\n\na\n\n### A1\n\nx\n');
  assert.equal(moveSection(doc, 5, -1), 'Title\n=====\n\nIntro\n\n## B\n\nb\n\n```\n## not a heading\n```\n\n## A\n\na\n\n### A1\n\nx\n');
  assert.equal(moveSection(doc, 5, 9), doc); ok('outline sections: a heading with everything under it (setext too, never inside code); moving one moves it whole');
  assert.equal(shiftSection(doc, 5, 1), doc.replace('### A1', '#### A1').replace('## A\n', '### A\n')); assert.equal(shiftSection(doc, 5, -1), doc.replace('### A1', '## A1').replace('## A\n', '# A\n'));
  assert.equal(shiftSection('## A\n\n###### deep\n', 0, 1), '## A\n\n###### deep\n'); assert.equal(shiftSection('Title\n=====\n\n## B\n', 0, 1), 'Title\n-----\n\n### B\n');
  ok('promote and demote change a heading and its sub-headings together, never past H1 or H6');
  const ids = TABS.flatMap((t) => t.groups.flatMap((g) => (g.items || []).flat(2).map((b) => b.cmd)));
  for (const id of ids.filter((x) => x.startsWith('ins:'))) assert(INSERTS.some((i) => i.id === id.slice(4)), id);
  assert.deepEqual(TABS.map((t) => t.label), ['Home', 'Insert', 'Layout', 'Review', 'View', 'Table']); assert(TABS.every((t) => t.groups.every((g) => g.label)));
  const html = buildRibbon({ icons: new Proxy({}, { get: () => '<svg></svg>' }), styleOptions: '' });
  assert(html.includes('data-mode="compact"') && html.includes('role="tablist"') && (html.match(/role="tabpanel"/g) || []).length === 6 && COMPACT.length >= 5);
  ok("the ribbon has Word's tabs with labelled groups, a compact row, and every Insert button is a registry item");
  assert.deepEqual(headings('---\ntitle: x\n---\n\nTitle\n=====\n\nPara\nmore\n---\n\n- item\n---\n\n***\n---\n').map((h) => [h.line, h.level, h.text]), [[4, 1, 'Title'], [7, 2, 'Para more']]);
  ok('the outline reads setext headings (=== and ---), not lists or thematic breaks'); }

// D8: properties (front matter) and tags
{
  const t = '---\ntitle: My page # note\ntags: [q4, project/alpha]\naliases:\n  - One\n  - "Two: x"\ndone: false\ncount: 3\ndue: 2026-12-01\nowner: "[[Ada]]"\nfolio:\n  status: [a, b]\n---\n# Body #q4\n';
  assert.deepEqual(parseProps(t).props.map((p) => [p.key, p.type]), [['title', 'text'], ['tags', 'tags'], ['aliases', 'list'], ['done', 'checkbox'], ['count', 'number'], ['due', 'date'], ['owner', 'link'], ['folio', 'object']]);
  assert.deepEqual(parseProps(t).props[2].value, ['One', 'Two: x']); assert.equal(parseProps(t).props[0].value, 'My page');
  ok('front matter reads as typed properties (text, tags, list, checkbox, number, date, link); nested maps are read-only');
  const only = (a, b) => { const x = a.split('\n'), y = b.split('\n'); return y.filter((l) => !x.includes(l)); };
  assert.deepEqual(only(t, setProp(t, 'done', true)), ['done: true']);
  assert.deepEqual(only(t, setProp(t, 'aliases', ['One', 'Three'])), ['  - Three']);
  assert.deepEqual(only(t, setProp(t, 'tags', ['q4', 'q1'])), ['tags: [q4, q1]']);
  assert.equal(setProp(t, 'folio', 'x'), t); assert.equal(setProp(t, 'title', 'a: b').includes('title: "a: b"'), true);
  assert(setProp(t, 'new', 'hi').includes('  status: [a, b]\nnew: hi\n---\n# Body #q4\n'));
  assert.equal(removeProp(t, 'count').includes('count:'), false); assert(renameProp(t, 'due', 'deadline').includes('\ndeadline: 2026-12-01\n')); assert.equal(renameProp(t, 'due', 'title'), t);
  ok('changing a property rewrites only its lines; comments, quoting, order and nested values stay; lists keep their style');
  assert.equal(setProp('# Hi\n', 'tags', ['a'], 'tags'), '---\ntags:\n  - a\n---\n\n# Hi\n'); assert.equal(removeProp('---\nx: 1\n---\n# Hi\n', 'x'), '# Hi\n');
  assert.equal(setProp('', 'done', false, 'checkbox'), '---\ndone: false\n---\n'); assert.equal(newKey(t), 'property'); assert.equal(newKey(setProp(t, 'property', '')), 'property 2');
  ok('the first property creates the front matter; removing the last removes it');
  assert.equal(renameTag(t, 'project', 'work'), t.replace('project/alpha', 'work/alpha'));
  assert.equal(renameTag('a #q4 b `#q4` #q4x (#q4)\n```\n#q4\n```\n#Q4.', 'q4', 'q1'), 'a #q1 b `#q4` #q4x (#q1)\n```\n#q4\n```\n#q1.');
  assert.equal(renameTag(t, 'q4', 'bad tag'), t);
  ok('renaming a tag changes it in the text and the front matter, nested tags too, never inside code or longer tags'); }

// D10: CriticMarkup on any text (Read view, exports, AI tools)
{
  const t = 'Hello {++new ++}world{-- old--}. {~~cat~>dog~~} and {==this==}{>>Ada, 2026-11-20 14:05: Why?<<}{>>Bob, 2026-11-20 15:00: Because<<} `{++code++}`';
  assert.deepEqual(listChanges(t).map((c) => c.kind + ':' + c.text), ['ins:new ', 'del: old', 'sub:dog', 'hl:this', 'comment:Ada, 2026-11-20 14:05: Why?', 'comment:Bob, 2026-11-20 15:00: Because']);
  assert.equal(acceptCm(t), 'Hello new world. dog and {==this==}{>>Ada, 2026-11-20 14:05: Why?<<}{>>Bob, 2026-11-20 15:00: Because<<} `{++code++}`');
  assert.equal(rejectCm(t), 'Hello world old. cat and {==this==}{>>Ada, 2026-11-20 14:05: Why?<<}{>>Bob, 2026-11-20 15:00: Because<<} `{++code++}`');
  assert.equal(cleanCm(t), 'Hello new world. dog and this `{++code++}`'); assert.equal(acceptCm(t, listChanges(t)[1].from), t.replace('{-- old--}', ''));
  assert.deepEqual(parseComment('Ada, 2026-11-20 14:05: Why? Yes: really'), { author: 'Ada', date: '2026-11-20 14:05', text: 'Why? Yes: really' }); assert.deepEqual(parseComment('Plain note'), { author: '', date: '', text: 'Plain note' });
  assert.equal(commentBody('Ada, Inc', 'a <<b', '2026-11-20 10:00'), 'Ada  Inc, 2026-11-20 10:00: a ‹‹b');
  ok('CriticMarkup: list, accept, reject (one or all), clean; never inside code; comments carry author and time'); }

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

// paste and Word: HTML from other apps becomes Markdown; a page exports to a Word file with real structure
{
  const win = new Window(); win.document.write('<!DOCTYPE html><html><body></body></html>');
  Object.assign(globalThis, { window: win, document: win.document, DOMParser: win.DOMParser });
  const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{}</style></head><body><p class=MsoTitle>Quarterly plan<o:p></o:p></p><p class=MsoNormal>We <b>ship</b> the <i>new</i> editor and <span style='background:yellow;mso-highlight:yellow'>hit</span> targets.</p><p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>·<span>&nbsp;&nbsp;</span></span><![endif]>First</p><p class=MsoListParagraphCxSpMiddle style='mso-list:l0 level2 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>o<span>&nbsp;&nbsp;</span></span><![endif]>Nested</p><p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>·<span>&nbsp;</span></span><![endif]>Second</p><p class=MsoNormal><o:p>&nbsp;</o:p></p><table class=MsoTableGrid><tr><td><p>Name</p></td><td><p>Score</p></td></tr><tr><td><p>Ada</p></td><td><p align=right>10</p></td></tr></table></body></html>`;
  const w = htmlToMarkdown(word);
  assert.equal(w.source, 'word');
  assert.equal(w.markdown, '# Quarterly plan\n\nWe **ship** the *new* editor and ==hit== targets.\n\n- First\n  - Nested\n- Second\n\n| Name | Score |\n| --- | ---: |\n| Ada | 10 |'.replace('---: |\n| Ada | 10 |', '--- |\n| Ada | 10  |').replace('| --- | --- |', '| --- | --- |'), w.markdown);
  const gd = htmlToMarkdown('<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc"><h1><span style="font-size:20pt">Title</span></h1><p><span style="font-weight:700">Bold</span><span> and </span><span style="font-style:italic">it</span><span> </span><a href="https://x.com"><span>link</span></a><span style="text-decoration:line-through"> gone</span></p><ul><li><p>a</p></li><li><p>b</p></li></ul></b>');
  assert.equal(gd.source, 'gdocs'); assert.equal(gd.markdown, '# Title\n\n**Bold** and *it* [link](https://x.com) ~~gone~~\n\n- a\n- b');
  const web = htmlToMarkdown('<article><h2>Hi</h2><p>Text <code>x</code> H<sub>2</sub>O</p><pre><code class="language-js">let a = 1;\nlet b;</code></pre><button>x</button><figure><img src="data:image/png;base64,AAAA" alt="A"><figcaption>Cap</figcaption></figure></article>');
  assert.equal(web.markdown, '## Hi\n\nText `x` H<sub>2</sub>O\n\n```js\nlet a = 1;\nlet b;\n```\n\n![A](data:image/png;base64,AAAA "Cap")'); assert.deepEqual(web.images, ['data:image/png;base64,AAAA']);
  assert(looksLikeMarkdown('# Title\ntext') && looksLikeMarkdown('see **this**') && !looksLikeMarkdown('just a sentence.') && !looksLikeMarkdown('a\tb\nc\td'));
  assert(isCodeHtml('<div style="font-family:Consolas;white-space:pre">x</div>') && !isCodeHtml('<p style="font-family:Consolas;white-space:pre">x</p>'));
  ok('paste: Word (lists, tables, highlight), Google Docs and web HTML become clean Markdown; images are collected; Markdown-looking text is detected');

  const src = 'Lead.\n\n# Plan\n\n[TOC]\n\nIntro **bold** [link](https://e.com) [[Wiki]]. Claim[^1]. Text {++added++} and {--gone--} and {~~old~>new~~}. {==Look==}{>>Ada, 2026-11-20 14:05: Check this<<}{>>Bob, 2026-11-20 15:00: Done<<}\n\n## Lists\n\n- a\n  - b\n- c\n\n1. one\n2. two\n\n> [!warning] Careful\n> Body text\n\n| A | B |\n| :-- | --: |\n| 1 | 2 |\n\n```js\nlet a = 1;\n```\n\n<div class="page-break"></div>\n\nEnd\n\n[^1]: Source.\n';
  const root = new DOMParser().parseFromString('<!DOCTYPE html><body>' + markdownIt.render(src), 'text/html').body;
  const bytes = await toDocx(root, { title: 'Plan', author: 'Tester', page: { size: 'Letter', landscape: true, header: true } });
  const zip = await JSZip.loadAsync(bytes); const xml = (f) => zip.file(f).async('string');
  const doc = await xml('word/document.xml'); const cm = await xml('word/comments.xml'); const ext = await xml('word/commentsExtended.xml');
  assert(doc.includes('w:pgSz w:w="15840" w:h="12240" w:orient="landscape"'), 'page size'); assert(doc.includes('w:pStyle w:val="Heading1"') && doc.includes('w:pStyle w:val="Heading2"'), 'headings');
  assert(/<w:ins [^>]*w:author="Tester"[^>]*>[\s\S]*?added/.test(doc) && /<w:del [^>]*>[\s\S]*?<w:delText[^>]*>gone/.test(doc) && /<w:delText[^>]*>old/.test(doc) && /<w:ins [^>]*>[\s\S]*?new/.test(doc), 'tracked changes');
  assert(cm.includes('w:author="Ada"') && cm.includes('w:author="Bob"') && cm.includes('Check this') && ext.includes('paraIdParent'), 'comments and reply'); assert(doc.includes('commentRangeStart') && doc.includes('commentReference'), 'comment anchors');
  assert(doc.includes('<w:tbl>') && doc.includes('w:val="right"') && doc.includes('Consolas') && doc.includes('w:type="page"') && doc.includes('w:numPr') && doc.includes('TOC \\h'), 'table, alignment, code, page break, lists, contents field');
  assert((await xml('word/footnotes.xml')).includes('Source.') && doc.includes('footnoteReference') && (await xml('word/footer1.xml')).includes('PAGE') && (await xml('word/header1.xml')).includes('Plan'), 'footnote, footer, header');
  const back = (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;
  assert(back.includes('<h1>') && back.includes('<strong>') && back.includes('<table>') && back.includes('<ol>') && back.includes('<ul>') && back.includes('href="https://e.com"') && back.includes('Careful') && back.includes('Look'), back);
  const clean = await toDocx(root, { title: 'Plan', reviewMarks: false }); const cz = await JSZip.loadAsync(clean);
  assert(!(await cz.file('word/document.xml').async('string')).includes('<w:del ') && !(await cz.file('word/document.xml').async('string')).includes('commentRangeStart'), 'clean export');
  const pdfo = pdfOptions({ size: 'A5', landscape: true, margins: 'narrow', header: true }, 'T&C'); assert(Math.abs(pdfo.pageSize.width - 148 / 25.4) < 1e-9 && pdfo.landscape && pdfo.margins.left === 0.5 && pdfo.headerTemplate.includes('T&amp;C') && pdfo.footerTemplate.includes('pageNumber'));
  assert.equal(pageCss({ size: 'Letter', landscape: true, margins: 'wide' }), '@page{size:Letter landscape;margin:1in 2in 1in 2in}');
  ok('Word export: headings, lists, table with alignment, code, footnote, contents field, page break, header and footer, page size; suggestions become tracked changes and comments with replies; clean drops them; PDF page setup');
  for (const k of ['window', 'document', 'DOMParser']) delete globalThis[k];
}

{
  const { docInfo, infoRows, size, ago } = await import('../src/renderer/page-info.js');
  const t = '---\ntitle: X\n---\n# One\n\nHello [link](a.md) and [[Other]] #tag\n\n- [x] a\n- [ ] b\n\n```js\nconst ignored = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n![pic](.asset/x.png) ![[Embed]] {==w==}{>>c<<} {++add++}\n';
  const i = docInfo(t);
  assert.equal(i.headings, 1); assert.equal(i.links, 2); assert.equal(i.images, 1); assert.equal(i.embeds, 1); assert.equal(i.tables, 1); assert.equal(i.codeBlocks, 1);
  assert.deepEqual(i.tasks, { done: 1, open: 1 }); assert.equal(i.comments, 1); assert.equal(i.suggestions, 1); assert.deepEqual(i.tags, ['tag']);
  assert(!/ignored/.test(JSON.stringify(i)) && i.words >= 8 && i.minutes === 1);
  assert.equal(size(900), '900 B'); assert.equal(size(2048), '2.0 KB'); assert.equal(ago(1000, 1000 + 5 * 60000), '5 min ago');
  assert(infoRows(i, 'a.md', { size: 100, mtimeMs: Date.now() }).some(([k, v]) => k === 'Tasks' && v === '1 of 2 done'));
  ok('Info: words, headings, links, images, embeds, tables, tasks, comments and suggestions are counted; code and front matter are not words');
}

// motion: transitions and animations
{
  const M = await import('../src/renderer/slides-motion.js');
  const mt = fx('Motion.slides.md'); const md = parseDeck(mt);
  const s1 = md.slides[0], s2 = md.slides[1];
  assert.deepEqual(s1.animations.map((a) => [a.target, a.effect, a.kind, a.trigger, a.duration, a.delay, a.repeat, a.by]), [['a', 'fade-in', 'entrance', 'click', 0.5, 0, 1, null], ['b', 'fly-in-up', 'entrance', 'with', 0.4, 0.2, 1, null], ['b', 'pulse', 'emphasis', 'after', 0.6, 0, 2, 'paragraph']]); ok('animation lines parse: target, effect, trigger, duration, delay, repeat, by paragraph');
  assert.equal(s2.transition, 'morph 0.8s'); assert.deepEqual(M.parseTransition(s2.transition), { name: 'morph', duration: 0.8 }); assert.equal(md.global.transition, 'fade'); ok('transitions per slide and for the whole deck');
  assert.equal(s1.notes, ''); assert.equal(s2.animations[0].target, 'body'); ok('animation blocks are not speaker notes');
  for (const a of s1.animations) assert.equal(M.parseAnim(M.animText(a)).effect, a.effect);
  assert.deepEqual(s1.animations.map(M.animText), ['#a fade-in', '#b fly-in-up with 0.4s delay=200ms', '#b pulse after repeat=2 by=paragraph']); const ch2 = { ...s1.animations[1], duration: 0.8 }; assert.equal(M.animText(ch2), '#b fly-in-up with 800ms delay=200ms'); ok('animation lines write back as they were typed; changed ones are rewritten');
  const fm2 = parseFrontmatter(mt); const ch = splitSlides(fm2.body);
  assert.equal(joinDeck(fm2.raw, ch.map((c, i) => M.setAnimations(c, parseDeck(mt).slides[i].animations))), mt); ok('rewriting the animations of every slide leaves the file byte-identical');
  const ch0 = M.setAnimations(ch[0], [...s1.animations.slice(1), s1.animations[0]]); assert.match(ch0, /animate: #b fly-in-up with 0.4s delay=200ms\nanimate: #b pulse after repeat=2 by=paragraph\nanimate: #a fade-in\n-->/); assert.equal(scanObjects(ch0).length, 2); ok('reordering animations rewrites only the animation block');
  assert.equal(M.setAnimations(ch[0], []).includes('animate'), false); ok('removing every animation removes the block');
  const steps = M.buildSteps(s1.animations, (a) => (a.target === 'b' ? 3 : 1));
  assert.deepEqual(steps.map((st) => st.map((x) => [x.anim.effect, x.anim.part ?? null, +x.start.toFixed(2)])), [[['fade-in', null, 0], ['fly-in-up', null, 0.2], ['pulse', 0, 0.6]], [['pulse', 1, 0]], [['pulse', 2, 0]]]); ok('build steps: with joins the click, after waits for the previous end, by paragraph adds a click per paragraph');
  assert.deepEqual(M.hiddenAtStart(s1.animations).map((a) => a.target), ['a', 'b']); ok('objects that enter start hidden');
  assert.equal(Object.keys(M.TRANSITIONS).length >= 24, true); for (const t of Object.keys(M.TRANSITIONS)) assert.equal(M.transitionFrames(t).length, 2); for (const e of Object.keys(M.EFFECTS)) assert(M.keyframes(M.parseAnim(`#x ${e}`)).length >= 2); ok('24+ transitions and every effect have keyframes');
}

// interactivity: links, zooms, custom shows, auto-advance
{
  const lt = fx('Links.slides.md'); const ld = parseDeck(lt);
  const z = ld.slides[0].objects.find((o) => o.kind === 'zoom');
  assert.equal(z.attrs.section, 'Detail'); assert.equal(zoomTarget(ld, z.attrs).title, 'Detail one'); assert.equal(zoomTarget(ld, { slide: '4' }).title, 'The end'); assert.equal(zoomTarget(ld, { slide: '9' }), null); ok('zoom objects point at a slide or the first slide of a section');
  const P = await import('../src/renderer/slides-present.js');
  assert.deepEqual(Object.fromEntries(Object.entries(P.customShows(ld)).map(([k, v]) => [k, v.map((x) => x.number)])), { short: [1, 3] }); ok('custom shows list slides by number, ranges allowed');
  assert.equal(ld.slides[3].advance, '1s'); assert.equal(ld.slides[2].advance, null); ok('auto-advance is a one-slide directive');
}

// PowerPoint interop: package reading, text conversion, and a .pptx made by pptxgenjs back to slides-md
{
  const I = await import('../src/renderer/slides-import.js');
  const X = await import('../src/renderer/slides-pptx.js');
  const H = await import('../src/renderer/slides-handouts.js');
  assert.deepEqual(I.themeTokens('<a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:srgbClr val="FAFAF7"/></a:lt1><a:accent1><a:srgbClr val="0A5C36"/></a:accent1><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="+mn-lt"/></a:minorFont>'), { paper: '#fafaf7', ink: '#111111', accent: '#0a5c36', 'heading-font': 'Georgia' }); ok('a PowerPoint theme becomes deck tokens (system colours and theme-font references handled)');
  assert.equal(I.folioLayout('title'), 'title'); assert.equal(I.folioLayout('secHead'), 'section'); assert.equal(I.folioLayout('', 'Folio · two-columns'), 'two-columns'); assert.equal(I.folioLayout('', 'Diapositiva titolo'), 'default'); assert.equal(I.folioLayout(undefined, 'Title Slide'), 'title'); ok('PowerPoint layouts map to Folio layouts, including the ones Folio wrote');
  const ph = I.placeholders('<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="0"/><a:ext cx="9525000" cy="952500"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"/></a:lvl1pPr></a:lstStyle></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr></p:sp>');
  assert.deepEqual(ph.map((p) => [p.id, p.role, p.valign, p.size, p.align]), [['2', 'title', 'bottom', 44, 'center'], ['3', 'body', null, null, null]]); assert.deepEqual(ph[0].geom, { x: 952500, y: 0, w: 9525000, h: 952500 }); ok('layout placeholders keep their role, box, anchor, size and alignment');
  const hm = I.htmlToMd('<p style="text-align: center;"><span style="font-size: 36pt;color: #111111;font-weight: bold;">Big idea</span></p><p><span style="font-size: 18pt;">Plain <span style="font-weight:bold;">bold </span>and <span style="font-style: italic;">it</span> &amp; more</span></p><ul><li><span style="font-size:18pt">One</span></li><ul><li><span style="font-size:18pt">Deeper</span></li></ul><li><span style="font-size:18pt">Two</span></li></ul><p><span style="font-size:18pt"># not a heading</span></p>');
  assert.equal(hm.md, '# Big idea\n\nPlain **bold** and *it* & more\n\n- One\n  - Deeper\n- Two\n\n\\# not a heading'); assert.equal(hm.look.size, 18); ok('PowerPoint text becomes Markdown: emphasis outside spaces, nested lists, bigger paragraphs as headings, literal markers escaped');
  assert.equal(I.unitPath('M 0 0 L 200 0 L 100 50 Z', 200, 100), 'M 0 0 L 1 0 L 0.5 0.5 Z'); ok('free-form outlines scale into the unit box');
  assert.deepEqual(X.pathPoints('M0,0 L1,0 C1,1 0,1 0,0 Z', 2, 4), [{ x: 0, y: 0, moveTo: true }, { x: 2, y: 0 }, { x: 0, y: 0, curve: { type: 'cubic', x1: 2, y1: 4, x2: 0, y2: 4 } }, { close: true }]); assert.equal(X.pathPoints('M0 0 A1 1 0 0 1 1 1', 1, 1), null); ok('outlines become PowerPoint freeform points (arcs fall back to a picture)');
  assert.equal(X.pickFont('-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui'), 'Segoe UI'); assert.equal(X.pickFont("'Inter', system-ui"), 'Inter'); assert.equal(X.pickFont('"New York", "Iowan Old Style", serif'), 'Georgia'); assert.equal(X.pickFont('"SF Mono", ui-monospace, monospace'), 'Consolas'); ok('font stacks export as a font PowerPoint can find on any machine');
  const cells = H.handoutCells(3, 1280, 720); assert.equal(cells.length, 3); assert(cells.every((c) => c.lines && c.w <= 794 / 2)); assert.equal(H.handoutCells(6, 1280, 720).length, 6); assert(H.handoutCells(9, 1280, 720).every((c) => c.x >= 56 && c.x + c.w <= 794 - 55)); ok('handout grids fit the page; three per page get note lines');

  // a real package: masters with placeholders, a hidden slide in a section, shapes, a line, a table and notes
  const PptxGenJS = (await import('pptxgenjs')).default;
  const p = new PptxGenJS(); p.layout = 'LAYOUT_WIDE';
  p.defineSlideMaster({ title: 'Title Slide', background: { color: '0A2540' }, objects: [{ rect: { x: 0, y: 7, w: 13.333, h: 0.5, fill: { color: 'FF6600' } } }, { placeholder: { options: { name: 'title', type: 'title', x: 1, y: 2, w: 11, h: 2, fontSize: 48 }, text: '' } }] });
  p.defineSlideMaster({ title: 'Title and Content', background: { color: 'FFFFFF' }, objects: [{ placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.4, w: 12, h: 1 }, text: '' } }, { placeholder: { options: { name: 'body', type: 'body', x: 0.5, y: 1.6, w: 12, h: 5 }, text: '' } }] });
  p.addSection({ title: 'Intro' });
  const s1 = p.addSlide({ masterName: 'Title Slide', sectionTitle: 'Intro' }); s1.addText('Quarterly review', { placeholder: 'title' });
  const s2 = p.addSlide({ masterName: 'Title and Content', sectionTitle: 'Intro' }); s2.addText('Results', { placeholder: 'title' });
  s2.addText([{ text: 'Revenue up', options: { bullet: true, breakLine: true } }, { text: 'Costs flat', options: { bullet: true } }], { placeholder: 'body' });
  s2.addShape('ellipse', { x: 10, y: 5, w: 2, h: 2, fill: { color: '0A5C36' } }); s2.addShape('line', { x: 1, y: 6.5, w: 4, h: 0, line: { color: '333333', width: 2, endArrowType: 'triangle' } });
  s2.addNotes('Say the number first.'); s2.hidden = true;
  s2.addTable([[{ text: 'A' }, { text: 'B' }], [{ text: '1' }, { text: '2' }]], { x: 6, y: 5, w: 3 });
  const buf = await p.write({ outputType: 'nodebuffer' });
  const { parse } = await import('../node_modules/pptxtojson/dist/index.js');
  const md = await I.importPowerPoint(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { parse, name: 'Review' });
  const d = parseDeck(md);
  assert.equal(d.masters.length, 2); assert.deepEqual(d.masters.map((m) => m.only), [true, true]); ok('each PowerPoint layout in use becomes a layout master');
  const tm = d.masters.find((m) => /title/.test(m.master)); assert.equal(tm.directives._backgroundColor ?? tm.directives.backgroundColor, '#0a2540'); assert((tm.objects || []).some((o) => o.attrs.placeholder === 'title')); assert((tm.objects || []).some((o) => o.attrs.fill === '#ff6600')); ok('masters keep their background, decorations and title placeholder');
  const shown = d.slides.filter((x) => !x.master);
  assert.equal(shown[0].layout, 'title'); assert.match(shown[0].raw ?? md, /# Quarterly review/); ok('titles become flow headings that fill the master placeholder');
  assert.equal(shown[1].hidden, true); assert.equal(shown[0].section, 'Intro'); assert.match(md, /- Revenue up\n- Costs flat/); assert.match(shown[1].notes || md, /Say the number first\./); ok('body text, hidden slides, sections and speaker notes come across');
  assert.match(md, /::: shape #s\d+ type=ellipse x=960 y=480 w=192 h=192 fill=#0a5c36/); assert.match(md, /::: line #l\d+ x=96 y=624 w=384 h=0 head=arrow stroke=#333333/); assert.match(md, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/); ok('shapes, arrows and tables land at the same geometry on the 1280×720 canvas');
  const ifm = parseFrontmatter(md); assert.equal(joinDeck(ifm.raw, splitSlides(ifm.body)), md); ok('an imported deck round-trips byte for byte');
  const PM = await import('../src/renderer/slides-pptx-motion.js');
  assert.equal(PM.transitionXml('push-left 1s', 5), '<p:transition spd="slow" advTm="5000"><p:push dir="l"/></p:transition>'); assert.deepEqual(PM.readTransition('<p:transition spd="slow" advTm="5000"><p:push dir="l"/></p:transition>'), { transition: 'push-left 1s', advance: '5s' });
  const tx = PM.timingXml(parseDeck(fx('Motion.slides.md')).slides[0].animations, { a: [{ spid: '3', paras: 1 }], b: [{ spid: '4', paras: 3 }] });
  assert.deepEqual(PM.readAnimations(tx, (id) => ({ 3: 'a', 4: 'b' })[id]), ['#a fade-in', '#b fly-in-up with 400ms delay=200ms', '#b pulse after by=paragraph']); ok('transitions and animations round-trip through PowerPoint timing XML');
  const tpl = await I.importPowerPoint(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { parse, name: 'Review', template: true });
  const td = parseDeck(tpl); assert.match(tpl, /template-name: Review/); assert.equal(td.masters.length, 2); assert.equal(td.slides.filter((x) => !x.master).length, 2); ok('a template import keeps the layouts as masters with one sample slide each');
}

// audience Q&A: the local page takes questions and the presenter reads them
{
  const QA = await import('../src/main/qa.js');
  const { url, qr } = await QA.startQa('Pitch');
  assert.match(url, /^http:\/\/[\d.]+:\d+\/$/); assert.match(qr, /^<svg/);
  const port = new URL(url).port; const base = `http://127.0.0.1:${port}`;
  const page = await (await fetch(base + '/')).text(); assert.match(page, /Questions · Pitch/); assert.match(page, /<form method="post" action="\/ask">/);
  const res = await fetch(base + '/ask', { method: 'POST', body: new URLSearchParams({ q: 'What about <b>pricing</b>?', n: 'Ada' }), redirect: 'manual' });
  assert.equal(res.status, 303); assert.equal((await fetch(base + '/../etc/passwd')).status, 404);
  assert.deepEqual(QA.pollQa().map((q) => [q.text, q.name]), [['What about <b>pricing</b>?', 'Ada']]);
  QA.stopQa(); ok('Q&A: a question page on the local network, questions reach the presenter, nothing else is served');
}

{ // history: per-document stacks and the file-action log
  const undo = [], redo = []; const docs = perDoc(undo, redo); const a = {}, b = {};
  assert.equal(docs.bind(a), true); undo.push('a1', 'a2'); redo.push('ar');
  assert.equal(docs.bind(a), false);
  assert.equal(docs.bind(b), true); assert.deepEqual([undo, redo], [[], []]); undo.push('b1');
  assert.equal(docs.bind(a), true); assert.deepEqual([undo, redo], [['a1', 'a2'], ['ar']]);
  docs.bind(b); assert.deepEqual(undo, ['b1']);
  ok('history: each document keeps its own undo and redo stacks');

  const log = createActionLog(3); const calls = [];
  const op = (name, fail = 0) => { let f = fail; return { label: name, undo: async () => { calls.push('u' + name); if (f-- > 0) throw new Error('boom'); }, redo: async () => { calls.push('r' + name); } }; };
  log.push(op('1')); log.push(op('2')); log.push(op('3')); log.push(op('4'));
  assert.equal(log.peek('undo').label, '4'); await log.run('undo'); await log.run('undo'); await log.run('undo');
  assert.deepEqual(calls, ['u4', 'u3', 'u2']); assert.equal(log.canUndo, false); assert.equal(log.peek('redo').label, '2');
  await log.run('redo'); assert.equal(calls.at(-1), 'r2'); log.push(op('5')); assert.equal(log.canRedo, false);
  ok('history: the file-action log undoes, redoes and forgets redo steps after a new action');

  const flaky = createActionLog(); flaky.push(op('x', 2));
  await assert.rejects(flaky.run('undo')); assert.equal(flaky.canUndo, true);
  await assert.rejects(flaky.run('undo')); assert.equal(flaky.canUndo, false);
  ok('history: a failing file action is kept for one retry, then dropped so it cannot block the log');

  const slow = createActionLog(); const order = [];
  const gate = []; slow.push({ label: 'a', undo: () => new Promise((r) => gate.push(() => { order.push('a'); r(); })), redo() {} });
  slow.push({ label: 'b', undo: () => new Promise((r) => gate.push(() => { order.push('b'); r(); })), redo() {} });
  const p1 = slow.run('undo'), p2 = slow.run('undo');
  await new Promise((r) => setTimeout(r, 20)); assert.equal(gate.length, 1); gate[0](); await p1;
  await new Promise((r) => setTimeout(r, 20)); gate[1](); await p2;
  assert.deepEqual(order, ['b', 'a']);
  ok('history: two quick undo presses run one after the other');
}

// headings(): fences close only on the same character and length, ATX headings may be indented up to 3 spaces
{
  const h = headings('# One\n\n````\n~~~\n# not a heading\n```\n# still code\n````\n\n   ## Two\n\n    ### code, four spaces\n\n# C#\n\n## Closed ##\n');
  assert.deepEqual(h.map((x) => [x.level, x.text]), [[1, 'One'], [2, 'Two'], [1, 'C#'], [2, 'Closed']]);
  ok('headings: a fence closes on its own marker, indented ATX headings count, a trailing # in a title stays');
  assert.deepEqual(sections('```\n```x\n# inside\n```\n# Real\n').map((x) => x.line), [4]); ok('outline sections close a fence the same way headings() does');
}

console.log(`\n${n} format checks passed`);
