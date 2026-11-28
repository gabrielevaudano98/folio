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
