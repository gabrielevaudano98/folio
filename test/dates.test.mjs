// Folio — day links read as people say them ("Tomorrow", "Friday", "3 Dec"), the file keeps the ISO day,
// "@tod" already offers today, and a day link is never a broken link.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { formatDay, parseDay, dayTense, monthGrid, isoDay } from '../src/renderer/page-dates.js';
import { createNotes } from '../src/main/notes.js';

const ok = (m) => console.log('  ✓ ' + m);
console.log('\ndates');
const now = new Date(2026, 10, 22, 10); // Sunday 22 November 2026
const it = (s, style) => formatDay(s, { now, lang: 'it', style });
const en = (s, style) => formatDay(s, { now, lang: 'en', style });

assert.deepEqual(['2026-11-22', '2026-11-23', '2026-11-21'].map((d) => it(d)), ['Oggi', 'Domani', 'Ieri']);
assert.deepEqual(['2026-11-22', '2026-11-23', '2026-11-21'].map((d) => en(d)), ['Today', 'Tomorrow', 'Yesterday']);
ok('today, tomorrow and yesterday, in Italian and English');
assert.equal(it('2026-11-27'), 'Venerdì'); assert.equal(en('2026-11-27'), 'Friday');
assert.equal(it('2026-11-17'), 'Martedì scorso'); assert.equal(en('2026-11-17'), 'Last Tuesday');
ok('a weekday within the week ahead, “last …” within the week behind');
assert.equal(it('2026-12-03'), '3 dic'); assert.equal(en('2026-12-03'), '3 Dec');
assert.equal(it('2027-01-15'), '15 gen 2027'); assert.equal(en('2027-01-15'), '15 Jan 2027');
ok('day and month this year, with the year otherwise');
assert.equal(en('2026-11-23 09:30'), 'Tomorrow 09:30');
ok('a time is kept after the day');
assert.equal(it('2026-11-23', 'full'), 'Lunedì 23 novembre 2026');
assert.equal(en('2026-11-23', 'dmy'), '23/11/2026'); assert.equal(en('2026-11-23', 'mdy'), '11/23/2026'); assert.equal(en('2026-11-23', 'iso'), '2026-11-23');
ok('the other formats of Settings → Date format');
assert.equal(parseDay('2026-02-31'), null); assert.equal(parseDay('0099-03-04').date.getFullYear(), 99); assert.equal(en('2026-02-31'), '2026-02-31'); assert.equal(parseDay('2026-11-23 25:00'), null);
ok('an impossible day is left as written');
assert.deepEqual(['2026-11-22', '2026-11-21', '2026-12-01'].map((d) => dayTense(d, now)), ['today', 'past', 'future']);
const grid = monthGrid(2026, 10, 'it'); assert.equal(grid.length, 6); assert.equal(isoDay(grid[0][0]), '2026-10-26'); assert.equal(grid[0][0].getDay(), 1);
assert.equal(monthGrid(2026, 10, 'en')[0][0].getDay(), 0);
ok('the calendar starts on Monday in Italian and Sunday in English');

/* the @ menu: the first letters of a date word already offer that day */
globalThis.window = globalThis.window || {}; // i18n is imported by page-mentions for labels
const { dateEntries } = await import('../src/renderer/page-mentions.js');
const ins = async (q, lang) => (await dateEntries(q, now, { lang })).map((e) => e.insert);
assert.deepEqual(await ins('tod'), ['[[2026-11-22]]']);
assert.deepEqual((await ins('dom', 'it')).slice(0, 2), ['[[2026-11-23]]', '[[2026-11-29]]']); // domani, domenica first
assert.equal((await ins('ven', 'it'))[0], '[[2026-11-27]]');
assert.equal((await ins('next friday'))[0], '[[2026-11-27]]');
ok('“@tod”, “@dom”, “@ven” offer the day before the word is finished');

/* link health: [[2026-11-23]] is a date, [[Nowhere]] is a missing page */
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-dates-'));
fs.writeFileSync(path.join(ws, 'a.md'), '# A\n\nDue [[2026-11-23]] and [[2028-02-29#Notes]], see [[Nowhere]] and [[2025-02-29]].\n');
const notes = createNotes(() => ws);
const broken = await notes.brokenLinks('a.md');
assert.deepEqual(broken.map((b) => b.ref), ['[[Nowhere]]', '[[2025-02-29]]']);
ok('a real day link is never reported as broken; a missing page or an impossible day (2025-02-29) still is');
