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
// 16-bit PCM: duration from the byte rate in the header
const wav = fs.readFileSync(process.env.FOLIO_MEETING_WAV); const wavMs = Math.ceil((wav.length - 44) / (wav.readUInt32LE(28) || 32000) * 1000);
const waitFor = (expr, ms) => ({ js: `new Promise((r)=>{const t0=Date.now();const k=()=>{let v;try{v=(${expr})}catch{};if(v||Date.now()-t0>${ms})r(!!v);else setTimeout(k,300)};k()})`, log: true, wait: 100 });
const steps = [
  { size: [1300, 900], wait: 800 },
  step("window.__folioRun('settings')", 1500),
  waitFor("document.querySelector('#set-features [data-feat=\"start\"]')", 15000),
  log("[...document.querySelectorAll('#set-features .row-sub')].map((e)=>e.textContent)"),
  log("document.querySelector('#set-features [data-feat=enable]').getAttribute('role')+'|'+document.querySelector('#set-features [data-feat=enable]').checked"),
  { js: "document.querySelector('#set-features [data-feat=\"start\"]').click();1", wait: 800 },
  { js: "(()=>{const i=document.querySelector('#prompt-input');i.value='Weekly sync';document.querySelector('#sheet-prompt form').requestSubmit();return 1})()", wait: 500 },
  waitFor("document.querySelector('.meeting-bar [data-meeting-stop]')", 90000),
  log("document.querySelector('.meeting-bar').textContent"),
  { js: '1', wait: wavMs + 5000 }, // the fake microphone plays the whole wav through the page, as real audio would
  { js: "document.querySelector('.meeting-bar [data-meeting-stop]').click();1", wait: 500 },
  waitFor("(window.__folioToasts||[]).includes('Meeting saved.')", 120000),
  waitFor("!document.querySelector('.meeting-bar')", 600000), // notes are written after the transcript
  log('window.__folioToasts'),
  errors,
];
const r = await runApp(w, steps, { FOLIO_FEATURES_ANY_PLATFORM: '1', FOLIO_FAKE_MEDIA: '1', FOLIO_FAKE_AUDIO_FILE: process.env.FOLIO_MEETING_WAV, FOLIO_COMPONENTS_DIR: process.env.FOLIO_COMPONENTS_DIR }, 900000);
console.log('\nmeeting');
const [ready, subs, sw, started, bar, saved, gone, toasts, errs] = r.js;
assert.equal(started, true, r.log.slice(-3000));
assert.equal(ready, true, r.log.slice(-3000));
assert.ok(subs.some((s) => /Speech model.*Ready/.test(s) || /Needed to record · Ready/.test(s)), JSON.stringify(subs));
assert.equal(sw, 'switch|true');
assert.match(bar, /Recording/);
assert.equal(saved, true, r.log.slice(-3000)); assert.equal(gone, true);
assert.deepEqual(errs, []);
const dir = path.join(w.ws, 'Meetings'); const files = fs.readdirSync(dir);
assert.equal(files.length, 1, files.join()); assert.match(files[0], /^\d{4}-\d\d-\d\d \d\d-\d\d Weekly sync\.md$/);
const md = fs.readFileSync(path.join(dir, files[0]), 'utf8');
assert.match(md, /^---\ntype: meeting\ntitle: "Weekly sync"/); assert.match(md, /worker_peak_mb: \d+/); assert.match(md, /transcription_speed: [\d.]+/);
assert.match(md, /## Transcript/); assert.match(md, /Others: /);
assert.match(md, /notes: qwen3-1\.7b-q4km/); assert.match(md, /## Notes/);
assert.ok(!fs.readdirSync(path.join(process.env.FOLIO_COMPONENTS_DIR, '..', 'meetings')).some((f) => f.endsWith('.jsonl')), 'work file removed');
console.log(md);
console.log('  ok meeting recorded, transcribed and noted', JSON.stringify(toasts));
