// Folio — dates with a time, an end and a reminder ([[2026-12-01]]{09:00 remind 30m}) and the reminders engine of the
// main process, on a fake clock: each reminder fires once, while Folio runs; one missed while closed is listed as overdue.
import assert from 'node:assert/strict';
import { parseTail, parseMention, mentionText, tailText, remindAt, whenLabel, findWhen, scanReminders, lineTitle, offsetMinutes, tailLength } from '../src/renderer/page-when.js';
import { createReminders, reminderId } from '../src/main/reminders.js';

const ok = (m) => console.log('  ✓ ' + m);
console.log('\nreminders');

/* ---------- syntax ---------- */
const samples = ['[[2026-12-01]]', '[[2026-12-01]]{09:00}', '[[2026-12-03]]{→ 2026-12-05}', '[[2026-12-01]]{09:00 → 10:30}', '[[2026-12-01]]{09:00 → 2026-12-02 17:00}', '[[2026-12-01]]{09:00 remind}', '[[2026-12-01]]{09:00 remind 30m}', '[[2026-12-01]]{remind 1d}', '[[2026-12-01]]{→ 2026-12-04 remind 2d}', '[[2026-12-01]]{08:15 remind 45m}'];
for (const s of samples) assert.equal(mentionText(parseMention(s)), s, `${s} is written back as read`);
ok('every documented form reads and writes back to the same characters');
assert.deepEqual(parseTail('9:05 -> 10:00 remind 1h'), { time: '09:05', endDay: null, endTime: '10:00', remind: '1h' });
assert.equal(mentionText(parseMention('[[2026-12-01]]{9:05 -> 10:00 remind 0m}')), '[[2026-12-01]]{09:05 → 10:00 remind}', 'hand-written forms are tidied only when Folio rewrites the chip');
for (const bad of ['', 'meeting', '25:00', '09:00 remind soon', '→ 10:00', '09:00 → 2026-02-31', 'remind 30m 09:00', '09:00 extra']) assert.equal(parseTail(bad), null, `"${bad}" is not a date tail`);
assert.equal(tailLength('{see below} x'), 0); assert.equal(tailLength('{09:00} x'), 7);
assert.equal(parseMention('[[2026-02-31]]{09:00}'), null); assert.equal(parseMention('[[2026-12-01 09:00]]'), null, 'a time inside the brackets is not a day link');
assert.equal(tailText({ time: null, endTime: '10:00', endDay: null, remind: null }), '', 'an end time without a start time is dropped');
ok('text in braces that is not exactly a date tail stays ordinary text; a time is never written inside [[ ]]');

assert.equal(offsetMinutes('30m'), 30); assert.equal(offsetMinutes('1h'), 60); assert.equal(offsetMinutes('2d'), 2880); assert.equal(offsetMinutes('1w'), 10080); assert.equal(offsetMinutes('0'), 0);
const at = (s) => { const d = remindAt(parseMention(s)); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
assert.equal(at('[[2026-12-01]]{09:00 remind 30m}'), '2026-12-1 8:30'); assert.equal(at('[[2026-12-01]]{09:00 remind}'), '2026-12-1 9:00');
assert.equal(at('[[2026-12-01]]{remind}'), '2026-12-1 9:00', 'an all-day date reminds at 9:00'); assert.equal(at('[[2026-12-01]]{remind 1d}'), '2026-11-30 9:00');
assert.equal(remindAt(parseMention('[[2026-12-01]]{09:00}')), null);
ok('the reminder time: the start (9:00 for an all-day date) minus the chosen offset');

const lab = (s) => whenLabel(parseMention(s), (d) => ({ '2026-11-28': 'Tomorrow', '2026-12-03': '3 Dec', '2026-12-05': '5 Dec' }[d] || d));
assert.equal(lab('[[2026-11-28]]{09:00}'), 'Tomorrow 9:00'); assert.equal(lab('[[2026-12-03]]{→ 2026-12-05}'), '3 Dec → 5 Dec');
assert.equal(lab('[[2026-11-28]]{09:00 → 10:30 remind}'), 'Tomorrow 9:00 → 10:30'); assert.equal(lab('[[2026-12-03]]{14:00 → 2026-12-05 09:00}'), '3 Dec 14:00 → 5 Dec 9:00');
ok('chips read as “Tomorrow 9:00”, “3 Dec → 5 Dec”');

const page = '---\ndue: "[[2026-12-09]]{remind}"\n---\n# Plan\n\n- [ ] Call **Ada** [[2026-12-01]]{09:00 remind 30m} about [[Budget]] [status:: Doing]\n\n```\n[[2026-12-02]]{remind}\n```\n\nInline `[[2026-12-03]]{remind}` is code. Trip [[2026-12-04]]{→ 2026-12-06} and [[2026-12-07]]{see notes}.\n\n> [[2026-12-01]]{09:00 remind 30m} again\n';
assert.deepEqual(findWhen(page).map((w) => w.src), ['[[2026-12-01]]{09:00 remind 30m}', '[[2026-12-04]]{→ 2026-12-06}', '[[2026-12-07]]', '[[2026-12-01]]{09:00 remind 30m}']);
const rs = scanReminders(page);
assert.deepEqual(rs.map((r) => [r.key, r.line, r.title]), [['[[2026-12-01]]{09:00 remind 30m}#0', 6, 'Call Ada about Budget Doing'], ['[[2026-12-01]]{09:00 remind 30m}#1', 14, 'again']]);
assert.equal(lineTitle('## [[2026-12-01]]{remind} Pay rent ^abc1', '[[2026-12-01]]{remind}'), 'Pay rent');
ok('reminders are found outside code and front matter, with their line and a readable title; twins get their own key');

/* ---------- the engine, on a fake clock ---------- */
function fakeClock(start) {
  let t = start; const timers = new Map(); let id = 0;
  return {
    now: () => t, setTimeout: (f, ms) => { timers.set(++id, { f, due: t + ms }); return id; }, clearTimeout: (i) => timers.delete(i),
    advance(ms) { const end = t + ms; for (;;) { const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0]; if (!next || next[1].due > end) break; timers.delete(next[0]); t = next[1].due; next[1].f(); } t = end; },
    pending: () => timers.size,
  };
}
const start = new Date(2026, 11, 1, 8, 0).getTime(); // 1 December 2026, 8:00
const files = {
  'Plan.md': '# Plan\n\n- [ ] Call Ada [[2026-12-01]]{09:00 remind 30m}\n- [ ] Late [[2026-11-30]]{09:00 remind}\n',
  'Other.md': 'Standup [[2026-12-01]]{08:45 remind}\nNo reminder [[2026-12-01]]{10:00}\n',
  'pic.png': 'remind',
};
const clock = fakeClock(start); let store = {}; const fired = []; let changes = 0;
const notes = { allFiles: async () => Object.keys(files), read: async (r) => files[r] };
const eng = createReminders({ notes, clock, states: () => store, setStates: (m) => { store = m; }, onFire: (r) => fired.push(`${r.rel}:${r.title}`), onChange: () => changes++ });
await eng.scanAll();
let l = eng.list();
assert.deepEqual(l.map((r) => [r.rel, r.state]), [['Plan.md', 'overdue'], ['Plan.md', 'upcoming'], ['Other.md', 'upcoming']]);
assert.equal(fired.length, 0, 'a reminder missed while Folio was closed is listed, not announced');
ok('a scan lists every reminder, soonest first; one whose time passed before Folio opened is overdue');

clock.advance(30 * 60000); // 8:30
assert.deepEqual(fired, ['Plan.md:Call Ada']);
clock.advance(15 * 60000); // 8:45
assert.deepEqual(fired, ['Plan.md:Call Ada', 'Other.md:Standup']);
clock.advance(24 * 3600000);
assert.equal(fired.length, 2, 'each reminder fires once');
eng.update('Plan.md', files['Plan.md'] + 'more text\n'); eng.update('Other.md', files['Other.md']);
assert.equal(fired.length, 2, 'saving the page again does not fire it again');
ok('each reminder fires once, at its time, while Folio runs');

// a new reminder added while running fires; editing the words around one keeps its id and state
eng.update('New.md', 'Ship [[2026-12-02]]{12:00 remind 1h}\n');
const idNew = reminderId('New.md', '[[2026-12-02]]{12:00 remind 1h}#0');
eng.setState(idNew, 'done');
eng.update('New.md', 'Ship it now [[2026-12-02]]{12:00 remind 1h} today\n');
assert.equal(eng.list().find((r) => r.id === idNew).state, 'done', 'Done survives editing the line');
clock.advance(2 * 86400000);
assert.equal(fired.length, 2, 'a reminder marked done before its time does not fire');
eng.setState(idNew, null);
eng.update('New.md', 'Ship [[2026-12-05]]{09:00 remind}\n');
const nowD = new Date(clock.now()); assert.ok(nowD < new Date(2026, 11, 5, 9));
clock.advance(new Date(2026, 11, 5, 9).getTime() - clock.now());
assert.equal(fired.at(-1), 'New.md:Ship');
ok('a reminder added while Folio runs fires; Done survives editing the words around it and stops it firing');

// dismiss hides it; states are pruned when the reminder is gone; a rename carries states
const idPlan = reminderId('Plan.md', '[[2026-12-01]]{09:00 remind 30m}#0');
eng.setState(idPlan, 'dismissed');
assert.ok(!eng.list().some((r) => r.id === idPlan)); assert.equal(store[idPlan], 'dismissed');
eng.rename('Plan.md', 'Archive/Plan.md');
assert.equal(store[reminderId('Archive/Plan.md', '[[2026-12-01]]{09:00 remind 30m}#0')], 'dismissed'); assert.ok(!(idPlan in store));
delete files['Plan.md']; files['Archive/Plan.md'] = '# gone\n'; delete files['New.md'];
await eng.scanAll();
assert.deepEqual(store, {}, 'states of reminders that no longer exist are dropped');
eng.update('Other.md', null);
assert.deepEqual(eng.list(), []);
eng.stop(); assert.equal(clock.pending(), 0);
assert.ok(changes > 0);
ok('Dismiss hides a reminder; renames carry Done and Dismiss; states of deleted reminders are dropped (settings, not the page)');

// a far reminder: the timer never waits more than an hour, and still fires on time
{
  const c = fakeClock(start); const got = [];
  const e = createReminders({ notes: { allFiles: async () => ['a.md'], read: async () => 'x [[2027-01-10]]{07:00 remind}' }, clock: c, onFire: (r) => got.push(r.at) });
  await e.scanAll();
  c.advance(3 * 3600000); assert.equal(c.pending(), 1);
  c.advance(new Date(2027, 0, 10, 7).getTime() - c.now()); assert.deepEqual(got, [new Date(2027, 0, 10, 7).getTime()]);
  e.reset(); assert.equal(c.pending(), 0);
}
ok('a far reminder is re-armed at least hourly and fires on time; a new workspace stops the timer');

/* ---------- #86: missed while closed, announced at the next start ---------- */
{
  const page = { 'a.md': 'Old [[2026-11-20]]{09:00 remind}\nMissed one [[2026-11-30]]{09:00 remind}\nMissed two [[2026-12-01]]{07:00 remind}\nDone [[2026-11-30]]{10:00 remind}\nLater [[2026-12-01]]{09:00 remind}\n' };
  const c = fakeClock(start); let seenAt = new Date(2026, 10, 25).getTime(); const missed = [], got = []; let st = { [reminderId('a.md', '[[2026-11-30]]{10:00 remind}#0')]: 'done' };
  const mk = () => createReminders({ notes: { allFiles: async () => Object.keys(page), read: async (r) => page[r] }, clock: c, states: () => st, setStates: (m) => { st = m; }, seen: () => seenAt, setSeen: (t) => { seenAt = t; }, onMissed: (l) => missed.push(l.map((r) => r.title)), onFire: (r) => got.push(r.title) });
  const e = mk(); await e.scanAll();
  assert.deepEqual(missed, [['Missed one', 'Missed two']], 'one announcement, soonest first; before the last run and done ones are left out');
  assert.equal(seenAt, start); assert.deepEqual(e.list().filter((r) => r.state === 'overdue').map((r) => r.title), ['Old', 'Missed one', 'Missed two'], 'missed ones stay listed as overdue');
  await e.scanAll(); assert.equal(missed.length, 1, 'a later scan of the same opening does not announce them again');
  c.advance(60 * 60000); assert.deepEqual(got, ['Later']); assert.equal(seenAt, start + 60 * 60000, 'a reminder that fires moves the seen moment');
  e.leave(); assert.equal(seenAt, c.now());
  // Folio closed for a day, then opened: only what came due in between is announced
  page['a.md'] += 'Next day [[2026-12-02]]{08:00 remind}\n'; c.advance(24 * 3600000); e.stop();
  const e2 = mk(); await e2.scanAll(); assert.deepEqual(missed.at(-1), ['Next day']); assert.deepEqual(got, ['Later']);
  // a folder never seen before announces nothing from the past
  seenAt = null; const e3 = mk(); await e3.scanAll(); assert.equal(missed.length, 2); assert.equal(seenAt, c.now());
  // a reset (another folder) looks again, for that folder
  e3.reset(); seenAt = c.now() - 2 * 3600000; await e3.scanAll(); assert.deepEqual(missed.at(-1), ['Next day']);
  // a note that could not be read holds the seen moment back (and leave() too): a later scan still announces its reminder
  {
    const c2 = fakeClock(start); let seen2 = new Date(2026, 10, 25).getTime(); const got2 = []; let fail = true;
    const pages = { 'a.md': 'One [[2026-11-30]]{09:00 remind}\n', 'b.md': 'Two [[2026-11-30]]{10:00 remind}\n' };
    const r = createReminders({ notes: { notePaths: async () => ({ paths: Object.keys(pages), capped: false }), read: async (p) => { if (p === 'b.md' && fail) throw new Error('busy'); return pages[p]; } }, clock: c2, seen: () => seen2, setSeen: (t) => { seen2 = t; }, onMissed: (l) => got2.push(l.map((x) => x.title)) });
    const before = seen2; await r.scanAll(); assert.deepEqual(got2, [['One']]); assert.equal(seen2, before, 'not moved after a failed read');
    r.leave(); assert.equal(seen2, before, 'leaving after an incomplete scan does not move it either');
    fail = false; await r.scanAll(); assert.deepEqual(got2, [['One'], ['Two']], 'the next scan announces what it could not read, once'); assert.equal(seen2, start);
    // the listing cap does not hold it back: notes past it are never read, listed or fired
    const c3 = fakeClock(start); let seen3 = before;
    await createReminders({ notes: { notePaths: async () => ({ paths: ['a.md'], capped: true }), read: async (p) => pages[p] }, clock: c3, seen: () => seen3, setSeen: (t) => { seen3 = t; } }).scanAll();
    assert.equal(seen3, start);
  }
}
ok('reminders due while Folio was closed are announced once at the next start (done ones and older ones left out), stay overdue, and move the seen moment');

/* ---------- #86: a reminder on a front matter date ---------- */
{
  const { propReminders, setPropRemind, removeProp, renameProp, remindKeys } = await import('../src/renderer/page-props.js');
  const pg = '---\ntitle: Trip\ndue: 2026-12-01 09:30\ndue-remind: 30m\nstart: 2026-12-03\nstart-remind: 0\nend: 2026-12-05\nnote-remind: 1d\nbad: 2026-12-06\nbad-remind: soon\n---\n# Trip plan\n\nBody [[2026-12-02]]{remind}\n';
  assert.deepEqual(propReminders(pg).map((r) => [r.key, r.value, r.remind, r.line]), [['due', '2026-12-01 09:30', '30m', 3], ['start', '2026-12-03', '0', 5]]);
  const rs = scanReminders(pg);
  const at = (t) => { const d = new Date(t); return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
  assert.deepEqual(rs.map((r) => [r.key, r.title, r.line, at(r.at)]), [['[[2026-12-02]]{remind}#0', 'Body', 14, '12-2 9:00'], ['fm:due: 2026-12-01 09:30 remind 30m', 'Trip plan · due', 3, '12-1 9:00'], ['fm:start: 2026-12-03 remind 0', 'Trip plan · start', 5, '12-3 9:00']]);
  assert.deepEqual([...remindKeys(pg)].sort(), ['due-remind', 'start-remind'], 'only a -remind line that reads as a reminder is the date’s; `bad-remind: soon` stays an ordinary property');
  // a list or a nested map under that name is the person's: never rewritten, removed or renamed with the date
  for (const tail of ['due-remind:\n  - keep\n  - this', 'due-remind:\n  a: 1\n  b: 2', 'due-remind: soon']) {
    const pl = `---\ndue: 2026-12-01\n${tail}\n---\n# T\n`;
    assert.deepEqual([...remindKeys(pl)], [], tail); assert.deepEqual(propReminders(pl), [], tail);
    assert.equal(setPropRemind(pl, 'due', '1d'), pl, `${tail}: not replaced`); assert.equal(setPropRemind(pl, 'due', ''), pl, `${tail}: not removed`);
    assert.equal(removeProp(pl, 'due'), `---\n${tail}\n---\n# T\n`, `${tail}: removing the date leaves it`);
    assert(renameProp(pl, 'due', 'end').includes(`\n${tail}\n`), `${tail}: renaming the date leaves it`);
  }
  // set, change, remove: one line each, nothing else moves
  const p0 = '---\ntitle: Trip\nend: 2026-12-05 # last day\ntags: [a]\n---\n# Trip\n';
  const p1 = setPropRemind(p0, 'end', '1d'); assert.equal(p1, '---\ntitle: Trip\nend: 2026-12-05 # last day\nend-remind: 1d\ntags: [a]\n---\n# Trip\n');
  assert.equal(setPropRemind(p1, 'end', '0'), p1.replace('end-remind: 1d', 'end-remind: 0'));
  assert.equal(setPropRemind(p1, 'end', ''), p0); assert.equal(setPropRemind(p0, 'title', '1d'), p0, 'only a date takes a reminder'); assert.equal(setPropRemind(p0, 'end', 'soon'), p0);
  assert.equal(removeProp(p1, 'end'), '---\ntitle: Trip\ntags: [a]\n---\n# Trip\n', 'removing the date removes its reminder');
  assert.equal(renameProp(p1, 'end', 'finish'), p1.replace('end:', 'finish:').replace('end-remind:', 'finish-remind:'), 'renaming the date renames its reminder');
  const crlf = p0.replace(/\n/g, '\r\n'); assert.equal(setPropRemind(crlf, 'end', '2h'), p1.replace('1d', '2h').replace(/\n/g, '\r\n'));
  // the title is the first real heading (not a `#` in a code fence); a value with anything after the date or time reminds of nothing
  const fenced = '---\ndue: 2026-12-01\ndue-remind: 0\n---\n```sh\n# Fake\n```\n# Real `code` title\n';
  assert.deepEqual(scanReminders(fenced).map((r) => r.title), ['Real code title · due']);
  for (const bad of ['2026-12-01T09:00garbage', '2026-12-01x', '2026-12-01 09:00 or later']) assert.deepEqual(scanReminders(`---\ndue: ${bad}\ndue-remind: 0\n---\n# T\n`), [], bad);
  assert.equal(scanReminders('---\ndue: 2026-12-01T09:00\ndue-remind: 0\n---\n# T\n').length, 1, 'an ISO date and time still reminds');
  // the engine fires it like a mention
  const c = fakeClock(new Date(2026, 11, 1, 8, 0).getTime()); const got = [];
  const e = createReminders({ notes: { allFiles: async () => ['t.md'], read: async () => pg }, clock: c, onFire: (r) => got.push(r.title) });
  await e.scanAll(); c.advance(90 * 60000); assert.deepEqual(got, ['Trip plan · due']);
}
ok('a front matter date reminds with a `<name>-remind:` line (0 = at its time, 9:00 for a date); setting, changing or removing it writes only that line; the engine fires it');

/* ---------- #86: the whole-folder scan stops at the listing cap: a capped scan keeps the states it could not check ---------- */
{
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { createNotes } = await import('../src/main/notes.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-cap-')); fs.mkdirSync(path.join(dir, 'p')); fs.writeFileSync(path.join(dir, 'p', 'a.md'), 'x'); fs.writeFileSync(path.join(dir, 'b.txt'), 'y'); fs.writeFileSync(path.join(dir, 'c.png'), '');
  const np = await createNotes(() => dir).notePaths();
  assert.deepEqual([np.paths.sort(), np.capped], [['b.txt', 'p/a.md'], false], 'names only, no stat, not capped');
  fs.rmSync(dir, { recursive: true, force: true });
  // a real folder past the cap: 5000 names, capped (the walk can overshoot inside one folder; the list does not)
  const big = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-cap-big-'));
  for (let d = 0; d < 3; d++) { fs.mkdirSync(path.join(big, `d${d}`)); for (let i = 0; i < 1700; i++) fs.writeFileSync(path.join(big, `d${d}`, `n${i}.md`), ''); }
  const bp = await createNotes(() => big).notePaths(); fs.rmSync(big, { recursive: true, force: true });
  assert.deepEqual([bp.paths.length, bp.capped, new Set(bp.paths).size], [5000, true, 5000], '5100 notes: 5000 listed, capped');
  // folders deeper than the walk goes are not listed either: that listing is not the whole folder
  const deep = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-deep-')); const far = path.join(deep, ...Array.from({ length: 15 }, (_, i) => `l${i}`));
  fs.mkdirSync(far, { recursive: true }); fs.writeFileSync(path.join(far, 'x.md'), ''); fs.writeFileSync(path.join(deep, 'top.md'), '');
  const dp = await createNotes(() => deep).notePaths(); fs.rmSync(deep, { recursive: true, force: true });
  assert.deepEqual([dp.paths, dp.capped], [['top.md'], true], 'a note past the depth limit makes the listing capped');
  const c = fakeClock(new Date(2026, 11, 1, 8, 0).getTime()); let st = { 'gone.md::x': 'done', 'a.md::y': 'dismissed' };
  const mk = (capped) => createReminders({ notes: { notePaths: async () => ({ paths: ['a.md'], capped }), read: async () => 'nothing here' }, clock: c, states: () => st, setStates: (m) => { st = m; } });
  await mk(true).scanAll(); assert.deepEqual(Object.keys(st), ['gone.md::x', 'a.md::y'], 'a capped listing is not the whole folder: nothing is dropped');
  await mk(false).scanAll(); assert.deepEqual(st, {}, 'a complete one drops the states of reminders that are gone');
}
ok('the reminders scan lists names only and, when the folder listing hits its cap, keeps the Done / Dismiss states it could not check');
