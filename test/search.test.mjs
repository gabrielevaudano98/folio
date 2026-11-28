// Folio — the search window's core: the query ("quoted phrase" plus words), content matches with snippets, ranking
// (Best match puts titles first and recent edits higher; Last edited sorts by mtime), recency groups, and the main
// process's cached full-text search over a folder (changed notes are read again, deleted ones dropped).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { parseQuery, matchContent, snippetOf, titleMatch, rankResults, recencyGroups, iconOf, termMarks, inDateRange, creatorOf, creatorChoices } from '../src/renderer/search-core.js';
import { createRecents, RECENT_KEY } from '../src/renderer/recents.js';
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
// #86: by name, for the notes a capped walk did not reach; nothing outside the folder or that is not a note
assert.deepEqual((await notes.find('', { paths: ['proj/Plan.md', '../x.md', 'Diary.md', 'nope.md'] })).map((r) => r.path).sort(), ['Diary.md', 'proj/Plan.md']);
assert.deepEqual((await notes.find('beta', { paths: ['proj/Plan.md'] })).map((r) => r.path), ['proj/Plan.md']);
assert.ok(warm < cold, `the second search must be served from memory: ${warm} ms vs the first ${cold} ms`);
fs.writeFileSync(path.join(ws, 'Diary.md'), 'Nothing about the beta\n', { flag: 'w' });
fs.utimesSync(path.join(ws, 'Diary.md'), new Date(), new Date(Date.now() + 5000));
fs.rmSync(path.join(ws, 'n0.md'));
assert.deepEqual((await notes.find('beta')).map((r) => r.path).sort(), ['Diary.md', 'n1000.md', 'n500.md', 'proj/Plan.md']);
fs.rmSync(ws, { recursive: true, force: true });
ok(`main: 1,502 notes searched by content (first pass ${cold} ms, then ${warm} ms from memory); folder scope, phrase, changed and deleted notes`);

// #86: the Created sort, the Date and Created by filters, and the recents store shared with the sidebar
{
  const rows = [{ path: 'a.md', title: 'A', modified: now - 3600e3, created: now - 40 * 864e5 }, { path: 'b.md', title: 'B', modified: now - 20 * 864e5, created: now - 2 * 864e5 }, { path: 'c.md', title: 'C', modified: now - 864e5 }];
  assert.deepEqual(rankResults(rows, parseQuery('a b c'), new Map(rows.map((r) => [r.path, { total: 1, line: 1, snippets: [] }])), { now, sort: 'created' }).map((r) => r.path), ['b.md', 'a.md', 'c.md'], 'newest page first; a page with no known creation time last');
  const local = new Date(2026, 10, 27, 15).getTime(); const midnight = new Date(2026, 10, 27).getTime();
  const pick = (f) => [{ path: 'today', modified: midnight + 60e3, created: midnight - 60e3 }, { path: 'week', modified: local - 6 * 864e5, created: local - 6 * 864e5 }, { path: 'month', modified: local - 29 * 864e5, created: 0 }, { path: 'old', modified: local - 40 * 864e5, created: local - 40 * 864e5 }].filter((r) => inDateRange(r, f, local)).map((r) => r.path);
  assert.deepEqual(pick(''), ['today', 'week', 'month', 'old']);
  assert.deepEqual(pick('edited-today'), ['today']); assert.deepEqual(pick('edited-week'), ['today', 'week']); assert.deepEqual(pick('edited-month'), ['today', 'week', 'month']);
  assert.deepEqual(pick('created-today'), [], 'created a minute before midnight is not today'); assert.deepEqual(pick('created-week'), ['today', 'week']); assert.deepEqual(pick('created-month'), ['today', 'week'], 'no known creation time: left out');
  assert.equal(inDateRange({ modified: local + 864e5 }, 'edited-today', local), false, 'a date in the future is not today'); assert.equal(inDateRange({ created: local + 60e3 }, 'created-month', local), false);
  const creators = { 'a.md': { by: 'you' }, 'b.md': { by: 'Claude Desktop' }, 'd.md': { by: 'Cursor' }, 'e.md': { by: 'you' } };
  assert.equal(creatorOf(creators, 'b.md'), 'Claude Desktop'); assert.equal(creatorOf(creators, 'c.md'), ''); assert.equal(creatorOf(creators, 'constructor'), '');
  assert.deepEqual(creatorChoices(creators, ['c.md', 'b.md', 'a.md', 'd.md', 'e.md', 'f.md']), [{ value: 'you', count: 2 }, { value: 'Claude Desktop', count: 1 }, { value: 'Cursor', count: 1 }, { value: '', count: 2 }]);
  ok('Created sort (newest first); Date: edited or created today (since midnight), past week, past month; Created by: you, each assistant, not known');

  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
  let ws = '/w1', clock = 1000; const st = mem();
  const r = createRecents({ workspace: () => ws, storage: st, now: () => clock++, max: 3 }); let changes = 0; const off = r.onChange(() => changes++);
  for (const p of ['a.md', 'b.md', 'dir/c.md', 'a.md']) r.opened(p);
  assert.deepEqual(r.list(5), ['a.md', 'dir/c.md', 'b.md']); assert.equal(changes, 4);
  r.opened('d.md'); assert.deepEqual(r.list(5), ['d.md', 'a.md', 'dir/c.md'], 'at most max pages a folder');
  r.moved('dir', 'moved'); assert.deepEqual(r.list(5), ['d.md', 'a.md', 'moved/c.md'], 'a renamed folder takes its pages along');
  r.moved('a.md', null); assert.deepEqual(r.list(5), ['d.md', 'moved/c.md'], 'a deleted page leaves');
  ws = '/w2'; assert.deepEqual(r.list(5), [], 'per folder'); r.opened('x.md'); ws = '/w1'; assert.deepEqual(r.list(1), ['d.md']);
  const other = createRecents({ workspace: () => '/w1', storage: st }); assert.deepEqual(other.list(5), ['d.md', 'moved/c.md'], 'a second reader (the sidebar) sees the same store');
  off(); r.opened('z.md'); assert.equal(changes, 8);
  st.setItem(RECENT_KEY, '{ broken'); assert.deepEqual(r.list(5), []); r.opened('a.md'); assert.deepEqual(r.list(5), ['a.md'], 'corrupt storage reads as empty and is replaced');
  const throwing = createRecents({ workspace: () => '/w', storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  throwing.opened('a.md'); assert.deepEqual(throwing.list(), []);
  // a trashed folder leaves, and Undo puts its pages back where they were
  const t2 = createRecents({ workspace: () => '/t', storage: mem(), now: () => clock++ });
  for (const p of ['a.md', 'dir/b.md', 'dir/c.md', 'e.md']) t2.opened(p);
  const gone = t2.forget('dir'); assert.deepEqual(Object.keys(gone).sort(), ['dir/b.md', 'dir/c.md']); assert.deepEqual(t2.list(5), ['e.md', 'a.md']);
  t2.restore(gone); assert.deepEqual(t2.list(5), ['e.md', 'dir/c.md', 'dir/b.md', 'a.md']);
  // malformed maps read as nothing, broken entries are dropped
  const st3 = mem(); st3.setItem(RECENT_KEY, JSON.stringify({ '/a': ['x.md'], '/b': { 'ok.md': 5, 'bad.md': 'soon', 'nan.md': null } }));
  assert.deepEqual(createRecents({ workspace: () => '/a', storage: st3 }).list(5), []);
  assert.deepEqual([createRecents({ workspace: () => '/b', storage: st3 }).list(5), createRecents({ workspace: () => '/b', storage: st3 }).times()], [['ok.md'], { 'ok.md': 5 }]);
  // a denied localStorage getter does not stop the window
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
  try { const d = createRecents({ workspace: () => '/d' }); d.opened('a.md'); assert.deepEqual(d.list(), []); } finally { if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage; }
  ok('recents: one store per folder, newest first, capped, follows renames and deletes, read by the search window and the sidebar alike; broken storage is harmless');

  // main: a note's creation time, and who created it from version history
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-created-'));
  fs.writeFileSync(path.join(dir, 'Copied.md'), '# Copied\n'); const past = new Date(now - 90 * 864e5); fs.utimesSync(path.join(dir, 'Copied.md'), past, past);
  fs.writeFileSync(path.join(dir, 'New.md'), '# New\n'); fs.writeFileSync(path.join(dir, 'Found.md'), '# Found\n'); fs.writeFileSync(path.join(dir, 'ByAi.md'), '# By AI\n');
  const rowsMain = await createNotes(() => dir).find('');
  const c = rowsMain.find((x) => x.path === 'Copied.md'); assert.ok(c.created <= c.modified && c.created === past.getTime(), 'a copy that kept an old modification time counts as created then');
  const { createHistory } = await import('../src/main/history.js'); const h = createHistory(() => dir);
  await h.snapshot('New.md', '# New\n', { reason: 'created', force: true }); await h.snapshot('New.md', '# New\n\nmore\n', { reason: 'edit' });
  await h.snapshot('Found.md', '# Found\n', { reason: 'open', force: true });
  await h.snapshot('ByAi.md', '# By AI\n', { by: 'Claude Desktop', reason: 'ai', force: true });
  const cr = await h.creators();
  assert.deepEqual(Object.fromEntries(Object.entries(cr).map(([k, v]) => [k, v.by])), { 'New.md': 'you', 'ByAi.md': 'Claude Desktop' }, 'a file Folio found already there has no known creator');
  assert.equal(await h.creators(), cr, 'cached while the history does not change');
  await h.rename('ByAi.md', 'Moved.md'); assert.equal((await h.creators())['Moved.md']?.by, 'Claude Desktop', 'the creator follows a rename');
  // the creator outlives the versions thinning drops (here: at most 2 kept), and one corrupt index is skipped, not fatal
  const h2 = createHistory(() => dir, { policy: { everything: 30 * 864e5, hourly: 183 * 864e5, minGap: 0, maxVersions: 2 } });
  await h2.snapshot('Long.md', 'v0', { by: 'Cursor', reason: 'ai', force: true }); for (let i = 1; i <= 4; i++) await h2.snapshot('Long.md', `v${i}`, { reason: 'edit', force: true });
  assert.equal((await h2.list('Long.md')).length, 2); fs.writeFileSync(path.join(dir, '.folio', 'history', 'files', 'broken.json'), '{ not json');
  const cr2 = await h2.creators(); assert.equal(cr2['Long.md']?.by, 'Cursor', 'still the assistant that created it'); assert.equal(cr2['New.md']?.by, 'you');
  fs.rmSync(dir, { recursive: true, force: true });
  ok('main: a note’s creation time (birth time, or its modification time when that is older); its creator from version history, cached, following renames');
}
