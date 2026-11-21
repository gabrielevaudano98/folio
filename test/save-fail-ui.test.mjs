// Folio: a failed save never throws away unsaved text (closing a tab, closing the folder, quitting).
// Switching folder and the language reload share saveAllOrAsk() with closing the folder.
import assert from 'node:assert/strict';
import { workspace, runApp, open, errors, log, step } from './harness.mjs';

const w = workspace('savefail', 47611);
const run = (id, wait = 500) => step(`window.__folioRun(${JSON.stringify(id)})`, wait);
const edit = (t) => step(`const v=window.__folioEditor.view;v.dispatch({changes:{from:0,insert:${JSON.stringify(t)}}})`, 900);
const tabs = "[...document.querySelectorAll('#tabs .tab')].map(e=>e.dataset.tab)";
const closeX = step("document.querySelector('#tabs .tab-close[data-close=\"Onboarding.md\"]').click()", 1200);
const breakWrite = { failWrites: true, wait: 100 };
const fixWrite = { failWrites: false, wait: 100 };
const r = await runApp(w, [
  { size: [1400, 900], wait: 1200 },
  open('Onboarding.md'), run('mode-split', 600), breakWrite, edit('UNSAVED '),
  closeX,
  log(`[${tabs}.includes('Onboarding.md'), window.__folioEditor.text.startsWith('UNSAVED ')]`),
  log("(window.__folioToasts||[]).join(' | ')"),
  // closing the folder with a failed save asks first; Cancel keeps the tab
  run('close-folder', 1000), log("document.querySelector('#sheet-prompt')?.open"),
  step("document.querySelector('#sheet-prompt [data-no]').click()", 600), log(`${tabs}.includes('Onboarding.md')`),
  // Quit (⌘Q) asks the same way; Cancel keeps the app and the tab
  { quit: true, wait: 1200 }, log("document.querySelector('#sheet-prompt')?.open"),
  step("document.querySelector('#sheet-prompt [data-no]').click()", 800), log(`${tabs}.includes('Onboarding.md')`),
  // once the disk works again, closing saves and closes
  fixWrite, closeX, log(`${tabs}.includes('Onboarding.md')`),
  errors,
]);
const j = r.js;
assert.deepEqual(j[0], [true, true], 'a failed save keeps the tab and its text'); console.log('  ✓ a failed save on close keeps the tab open with its unsaved text');
assert.match(j[1], /disk full/i); console.log('  ✓ the error toast names the reason');
assert.equal(j[2], true); assert.equal(j[3], true); console.log('  ✓ closing the folder asks before dropping unsaved pages; Cancel keeps them');
assert.equal(j[4], true); assert.equal(j[5], true); console.log('  ✓ quitting asks too; Cancel keeps the app running with the tab');
assert.equal(j[6], false); assert.match(w.read('Onboarding.md'), /^UNSAVED /); console.log('  ✓ once the write works, closing saves the text and closes the tab');
assert.deepEqual(j[7], [], 'no renderer errors'); console.log('  ✓ no renderer errors');
