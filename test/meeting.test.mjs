// Folio — meeting recorder end to end, in the app: Settings section, a recording fed from a wav file, the saved note
// with notes checked against the transcript. The audio takes the real path: fake microphone → page → worker. Needs the real components (about 1.8 GB), so it runs only when asked:
//   FOLIO_MEETING_E2E=1 FOLIO_COMPONENTS_DIR=<folder with the components> FOLIO_MEETING_WAV=<wav with speech> node test/meeting.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { workspace, runApp, log, step, errors } from './harness.mjs';

if (process.env.FOLIO_MEETING_E2E !== '1') { console.log('\nmeeting e2e skipped (set FOLIO_MEETING_E2E=1)'); process.exit(0); }
const w = workspace('meeting', 47611);
const settings = JSON.parse(fs.readFileSync(path.join(w.ud, 'settings.json'), 'utf8'));
fs.writeFileSync(path.join(w.ud, 'settings.json'), JSON.stringify({ ...settings, features: { 'meeting-recorder': { enabled: true, noticeSeen: true, autoNotes: true } } }));
// how long the wav plays: data chunk size over byte rate, read from the RIFF chunks (a wav may carry extra chunks)
const wav = fs.readFileSync(process.env.FOLIO_MEETING_WAV);
let off = 12, byteRate = 32000, dataBytes = 0;
while (off + 8 <= wav.length) {
  const id = wav.toString('ascii', off, off + 4), size = wav.readUInt32LE(off + 4);
  if (id === 'fmt ' && size >= 16) byteRate = wav.readUInt32LE(off + 16) || 32000;
  if (id === 'data') { dataBytes = Math.min(size, wav.length - off - 8); break; }
  off += 8 + size + (size & 1);
}
if (!dataBytes) throw new Error('FOLIO_MEETING_WAV has no audio data');
const wavMs = Math.ceil(dataBytes / byteRate * 1000);
const waitFor = (expr, ms) => ({ js: `new Promise((r)=>{const t0=Date.now();const k=()=>{let v;try{v=(${expr})}catch{};if(v||Date.now()-t0>${ms})r(!!v);else setTimeout(k,300)};k()})`, log: true, wait: 100 });
const steps = [
  { size: [1300, 900], wait: 800 },
  step("window.__folioRun('settings')", 1500),
  waitFor("document.querySelector('#set-features [data-feat=\"start\"]')", 15000),
  log("[...document.querySelectorAll('#set-features .row-sub')].map((e)=>e.textContent)"),
  log("document.querySelector('#set-features [data-feat=enable]').getAttribute('role')+'|'+document.querySelector('#set-features [data-feat=enable]').checked"),
  log("!document.querySelector('#btn-record').hidden"), // the one-click button is there once the recorder is on and its model is downloaded
  { js: "document.querySelector('dialog[open]')?.close();1", wait: 300 },
  { js: "const b=document.querySelector('#btn-record');b.click();b.click();1", wait: 800 }, // one click starts (no question about the title); a second at once changes nothing
  waitFor("document.querySelector('.meeting-bar [data-meeting-stop]')", 90000),
  log("document.querySelector('.meeting-bar').textContent"),
  log("document.querySelector('#btn-record').dataset.recording + '|' + !!document.querySelector('#sheet-prompt[open]')"),
  { js: '1', wait: wavMs + 5000 }, // the fake microphone plays the whole wav through the page, as real audio would
  { js: "document.querySelector('#btn-record').click();1", wait: 500 }, // and one click stops
  waitFor("(window.__folioToasts||[]).includes('Meeting saved.')", 120000),
  waitFor("!document.querySelector('.meeting-bar')", 600000), // notes are written after the transcript
  log('window.__folioToasts'),
  errors,
];
const r = await runApp(w, steps, { FOLIO_FEATURES_ANY_PLATFORM: '1', FOLIO_FAKE_MEDIA: '1', FOLIO_FAKE_AUDIO_FILE: process.env.FOLIO_MEETING_WAV, FOLIO_COMPONENTS_DIR: process.env.FOLIO_COMPONENTS_DIR }, 900000);
console.log('\nmeeting');
const [ready, subs, sw, visible, started, bar, btn, saved, gone, toasts, errs] = r.js;
assert.equal(started, true, r.log.slice(-3000));
assert.equal(ready, true, r.log.slice(-3000));
assert.ok(subs.some((s) => /Speech model.*Ready/.test(s) || /Needed to record · Ready/.test(s)), JSON.stringify(subs));
assert.equal(sw, 'switch|true');
assert.equal(visible, true); assert.match(bar, /Recording/); assert.equal(btn, 'true|false', 'the button shows the recording and no title question was asked');
assert.equal(saved, true, r.log.slice(-3000)); assert.equal(gone, true);
assert.deepEqual(errs, []);
assert.deepEqual(toasts, ['Meeting saved.'], 'a double click started one recording and no message about a second one');
const dir = path.join(w.ws, 'Meetings'); const files = fs.readdirSync(dir);
assert.equal(files.length, 1, files.join()); assert.match(files[0], /^\d{4}-\d\d-\d\d \d\d-\d\d Meeting\.md$/, files[0]); // the default title, renamed later by the person
const md = fs.readFileSync(path.join(dir, files[0]), 'utf8');
assert.match(md, /^---\ntype: meeting\ntitle: "Meeting"/); assert.match(md, /worker_peak_mb: \d+/); assert.match(md, /transcription_speed: [\d.]+/);
assert.match(md, /## Transcript/); assert.match(md, /(You|Others): /); // the fake microphone is the 'me' track; on Linux the computer sound carries it too
assert.match(md, /notes: qwen3-1\.7b-q4km/); assert.match(md, /## Notes/);
assert.ok(!fs.readdirSync(path.join(process.env.FOLIO_COMPONENTS_DIR, '..', 'meetings')).some((f) => f.endsWith('.jsonl')), 'work file removed');
console.log(md);
console.log('  ok meeting recorded, transcribed and noted', JSON.stringify(toasts));
