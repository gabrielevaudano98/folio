// Folio — noticing a call: the registry reader and the once-per-call rule. No Windows needed: `reg` output is a fixture.
import assert from 'node:assert/strict';
import { MIC_KEY, appName, parseInUse, createEpisodes, createMicWatch } from '../src/main/meeting/mic-watch.js';

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
const base = MIC_KEY.replace(/^HKCU/, 'HKEY_CURRENT_USER'); // `reg query` prints the long hive name
const reg = (...rows) => `\r\n${base}\r\n    Value    REG_SZ    Allow\r\n\r\n` + rows.map(([k, start, stop]) => `${base}\\${k}\r\n    Value    REG_SZ    Allow\r\n    LastUsedTimeStart    REG_QWORD    ${start}\r\n    LastUsedTimeStop    REG_QWORD    ${stop}\r\n`).join('\r\n');

console.log('\ncall detection');
await t('app names: installed paths and package names', () => {
  assert.equal(appName('X\\NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe'), 'Zoom');
  assert.equal(appName('X\\MSTeams_8wekyb3d8bbwe'), 'Microsoft Teams');
  assert.equal(appName('X\\NonPackaged\\C:#Users#a#AppData#Local#Microsoft#Teams#current#Teams.exe'), 'Microsoft Teams');
  assert.equal(appName('X\\Microsoft.SkypeApp_kzf8qxf38zg5c'), 'Skype');
  assert.equal(appName('X\\NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe'), 'the browser');
  assert.equal(appName('X\\NonPackaged\\C:#Tools#Standup.exe'), 'Standup');
});
await t('only apps that have the microphone open now are listed', () => {
  const out = parseInUse(reg(['NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe', '0x1db6a1c2d3e4f500', '0x0'], ['MSTeams_8wekyb3d8bbwe', '0x1db6a1c2d3e4f600', '0x1db6a1c2d3e4f700'], ['NonPackaged\\C:#Tools#Old.exe', '0x0', '0x0']));
  assert.deepEqual(out.map((a) => a.name), ['Zoom']);
});
await t('empty, partial or odd output gives an empty list and never throws', () => {
  for (const x of ['', 'ERROR: The system was unable to find the specified registry key or value.', `${base}\\X\r\n    LastUsedTimeStart    REG_QWORD    nonsense\r\n`, null, undefined]) assert.deepEqual(parseInUse(x), []);
  assert.deepEqual(parseInUse(`${base}\\Z\r\n    LastUsedTimeStart    REG_QWORD    0x5\r\n`), [], 'a start without a stop is a half-read key, not a call');
  assert.deepEqual(parseInUse(`${base}\\Y\n    LastUsedTimeStart    REG_QWORD    0x5\n    LastUsedTimeStop    REG_QWORD    0x0\n`).map((a) => a.name), ['Y']); // LF line ends too
});
await t('a call is offered once, after the hold time, not for a short blip', () => {
  const e = createEpisodes({ holdMs: 8000, quietMs: 30000 });
  assert.equal(e.step(['Zoom'], 0), null); assert.equal(e.step(['Zoom'], 4000), null);
  assert.equal(e.step(['Zoom'], 8000), 'Zoom');
  assert.equal(e.step(['Zoom'], 12000), null); assert.equal(e.step(['Zoom'], 600000), null); // the same call never asks again
  const b = createEpisodes({ holdMs: 8000, quietMs: 30000 }); // a blip: open and closed within a few seconds
  assert.equal(b.step(['Discord'], 0), null); assert.equal(b.step([], 4000), null); assert.equal(b.step([], 40000), null); assert.equal(b.open, false);
});
await t('muting (the microphone let go for a moment) does not start a new call', () => {
  const e = createEpisodes({ holdMs: 8000, quietMs: 30000 });
  e.step(['Teams'], 0); assert.equal(e.step(['Teams'], 8000), 'Teams');
  assert.equal(e.step([], 12000), null); assert.equal(e.step(['Teams'], 20000), null); // back after 8 s: same call
  assert.equal(e.step([], 30000), null); assert.equal(e.step([], 70000), null); // really over
  e.step(['Teams'], 80000); assert.equal(e.step(['Teams'], 88000), 'Teams'); // the next call is offered
});
await t('the watcher skips the app itself, stays quiet while recording, and survives a failing reg', async () => {
  let text = reg(['NonPackaged\\C:#Users#a#AppData#Local#Programs#Folio#Folio.exe', '0x1', '0x0']), busy = false, clock = 0, boom = false; const calls = [];
  const w = createMicWatch({ exec: async () => { if (boom) throw new Error('no reg'); return text; }, onCall: (c) => calls.push(c), isBusy: () => busy, own: ['Folio.exe'], now: () => clock, episodes: createEpisodes({ holdMs: 8000, quietMs: 30000 }) });
  for (clock = 0; clock <= 20000; clock += 4000) await w.tick();
  assert.deepEqual(calls, [], 'Folio using its own microphone is not a call');
  text = reg(['NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe', '0x1', '0x0']);
  busy = true; for (clock = 100000; clock <= 130000; clock += 4000) await w.tick();
  assert.deepEqual(calls, [], 'nothing is offered while a recording runs');
  busy = false; for (clock = 200000; clock <= 216000; clock += 4000) await w.tick();
  assert.deepEqual(calls, [{ app: 'Zoom' }]);
  boom = true; await w.tick(); // no throw
  assert.equal(calls.length, 1);
});
await t('an offer that fails is contained: tick never rejects, and the next tick still runs', async () => {
  let clock = 0, offers = 0;
  const w = createMicWatch({ exec: async () => reg(['NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe', '0x1', '0x0']), onCall: async () => { offers++; throw new Error('notification failed'); }, now: () => clock, episodes: createEpisodes({ holdMs: 0, quietMs: 1000 }) });
  await w.tick(); await w.tick(); assert.equal(offers, 1, 'the failed offer ran once for this call'); // and no unhandled rejection reached the process
});
await t('start and stop manage one timer', () => {
  const made = [], cleared = [];
  const w = createMicWatch({ exec: async () => '', onCall() {}, setTimer: (f, ms) => { const h = { f, ms, unref() {} }; made.push(h); return h; }, clearTimer: (h) => cleared.push(h) });
  w.start(); w.start(); assert.equal(made.length, 1); assert.equal(w.on, true);
  w.stop(); w.stop(); assert.equal(cleared.length, 1); assert.equal(w.on, false);
});
console.log(`\n${n} checks passed`);
