// Folio — the search window's core: the query ("quoted phrase" plus words), content matches with snippets, ranking
// (Best match puts titles first and recent edits higher; Last edited sorts by mtime), recency groups, and the main
// process's cached full-text search over a folder (changed notes are read again, deleted ones dropped).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { parseQuery, matchContent, snippetOf, titleMatch, rankResults, recencyGroups, iconOf, termMarks } from '../src/renderer/search-core.js';
import { createNotes } from '../src/main/notes.js';

const ok = (m) => console.log('  ✓ ' + m);
console.log('\nsearch');

assert.deepEqual(parseQuery('  "my projects" Alpha  ').terms, ['my projects', 'alpha']);
assert.deepEqual(parseQuery('say "hi').terms, ['say', 'hi']);
assert.equal(parseQuery('"a  b" c').text, 'a b c');
ok('a quoted phrase is one term, the other words are terms of their own; an unclosed quote is text');

const text = '# Plan\n\nWe ship the beta in March.\n\n- [ ] Ask **Anna** about the beta launch\n';
const m = matchContent(text, ['beta', 'launch']);
assert.equal(m.total, 3); assert.equal(m.line, 3);
assert.equal(m.snippets.length, 2);
assert.equal(m.snippets[1].text, 'Ask Anna about the beta launch');
assert.deepEqual(m.snippets[1].marks, [[19, 23], [24, 30]]);
assert.equal(matchContent(text, ['beta', 'nowhere']), null);
assert.equal(matchContent(text, ['ship the beta']).total, 1);
ok('every term must appear; snippets drop list and bold markers and mark the terms');

const long = 'x '.repeat(200) + 'needle ' + 'y '.repeat(200);
const s = snippetOf(long, ['needle'], 80);
assert.ok(s.text.startsWith('…') && s.text.endsWith('…') && s.text.length <= 82);
assert.equal(s.text.slice(s.marks[0][0], s.marks[0][1]), 'needle');
ok('a long line is cut around its first match and the mark still lands on the word');

assert.equal(iconOf('---\nicon: 🚀\ntags: a\n---\n# x'), '🚀');
assert.equal(iconOf('# no front matter\nicon: 🚀'), '');
assert.deepEqual(termMarks('Beta beta', ['beta']), [[0, 4], [5, 9]]);
ok('the page icon comes from front matter only');

const q = parseQuery('road');
assert.ok(titleMatch('Roadmap', q).strong);
assert.ok(titleMatch('Roadmap', q).score > titleMatch('Product roadmap 2027', q).score, 'a title that starts with the term ranks higher');
assert.equal(titleMatch('Rows and dots', q).strong, false, 'scattered letters: the old fuzzy Go to note match');
ok('titles: all terms inside is a strong match; otherwise the fuzzy name match of Go to note');

const now = Date.UTC(2026, 10, 27, 12);
const files = [
  { path: 'a/Notes.md', title: 'Notes', modified: now - 40 * 864e5 },
  { path: 'Roadmap.md', title: 'Roadmap', modified: now - 90 * 864e5 },
  { path: 'b/Weekly.md', title: 'Weekly', modified: now - 3600e3 },
  { path: 'Old.md', title: 'Old', modified: now - 400 * 864e5 },
];
const content = new Map([
  ['a/Notes.md', { total: 1, line: 4, snippets: [] }],
  ['b/Weekly.md', { total: 9, line: 2, snippets: [] }],
  ['Roadmap.md', { total: 1, line: 1, snippets: [] }],
]);
const best = rankResults(files, q, content, { now }).map((r) => r.path);
assert.equal(best[0], 'Roadmap.md', 'a title hit beats content hits');
assert.equal(best[1], 'b/Weekly.md', 'more hits and a recent edit rank higher');
assert.deepEqual(best, ['Roadmap.md', 'b/Weekly.md', 'a/Notes.md']);
assert.deepEqual(rankResults(files, q, content, { now, sort: 'edited' }).map((r) => r.path), ['b/Weekly.md', 'a/Notes.md', 'Roadmap.md']);
assert.deepEqual(rankResults(files, q, content, { now, titleOnly: true }).map((r) => r.path), ['Roadmap.md']);
const tie = rankResults([{ path: 'x/Roadmap.md', title: 'Roadmap', modified: 0 }, { path: 'y/Roadmap.md', title: 'Roadmap', modified: 0, open: true }], q, null, { now });
assert.equal(tie[0].path, 'y/Roadmap.md', 'an open tab wins a tie, as in Go to note');
ok('Best match: titles first, then content by hits and recency; Last edited; Title only ignores content');

const local = new Date(2026, 10, 27, 15).getTime();
const at = (d, h = 10) => new Date(2026, 10, 27 - d, h).getTime();
const g = recencyGroups([{ path: 'a', time: at(0) }, { path: 'b', time: at(1) }, { path: 'c', time: at(3) }, { path: 'd', time: at(30) }, { path: 'e', time: at(0, 1) }, { path: 'z', time: 0 }], local);
assert.deepEqual(g.map((x) => [x.key, x.items.map((i) => i.path)]), [['today', ['a', 'e']], ['yesterday', ['b']], ['week', ['c']], ['older', ['d']]]);
assert.deepEqual(recencyGroups([{ path: 'a', time: at(9) }], local).map((x) => x.key), ['older']);
ok('recent pages are grouped Today, Yesterday, Past week, Older, newest first, without the never-touched');

// the main process: cached full-text search, folder scope, changed and deleted notes
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-search-'));
fs.mkdirSync(path.join(ws, 'proj'));
fs.writeFileSync(path.join(ws, 'proj', 'Plan.md'), '---\nicon: 📌\n---\n# Plan\n\nThe beta ships in March.\n');
fs.writeFileSync(path.join(ws, 'Diary.md'), 'Nothing about it here.\n');
for (let i = 0; i < 1500; i++) fs.writeFileSync(path.join(ws, `n${i}.md`), `# Note ${i}\n\n${'lorem ipsum dolor sit amet '.repeat(40)}${i % 500 === 0 ? 'beta' : ''}\n`);
const notes = createNotes(() => ws);
let t0 = Date.now();
const all = await notes.find('');
const cold = Date.now() - t0;
assert.equal(all.length, 1502);
assert.equal(all.find((r) => r.path === 'proj/Plan.md').icon, '📌');
t0 = Date.now();
const hits = await notes.find('beta');
const warm = Date.now() - t0;
assert.deepEqual(hits.map((r) => r.path).sort(), ['n0.md', 'n1000.md', 'n500.md', 'proj/Plan.md']);
assert.equal(hits.find((r) => r.path === 'proj/Plan.md').snippets[0].text, 'The beta ships in March.');
assert.deepEqual((await notes.find('beta', { folder: 'proj' })).map((r) => r.path), ['proj/Plan.md']);
assert.deepEqual((await notes.find('"ships in march"')).map((r) => r.path), ['proj/Plan.md']);
assert.ok(warm < 1500, `warm search took ${warm} ms (cold ${cold} ms)`);
fs.writeFileSync(path.join(ws, 'Diary.md'), 'Now the beta is here too.\n', { flag: 'w' });
fs.utimesSync(path.join(ws, 'Diary.md'), new Date(), new Date(Date.now() + 5000));
fs.rmSync(path.join(ws, 'n0.md'));
assert.deepEqual((await notes.find('beta')).map((r) => r.path).sort(), ['Diary.md', 'n1000.md', 'n500.md', 'proj/Plan.md']);
fs.rmSync(ws, { recursive: true, force: true });
ok(`main: 1,502 notes searched by content (first pass ${cold} ms, then ${warm} ms from memory); folder scope, phrase, changed and deleted notes`);
